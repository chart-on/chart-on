import { ChevronDown, ChevronLeft } from 'lucide';
import { dialogButton, focusableIn, nextDialogId, openDialogFrame } from './dialog';
import { stepTab } from './indicator-picker-model';
import { h, icon, inlineKey } from './dom';
import { createListbox } from './listbox';
import type { Localizer } from '@chart-on/core';
import { inputRenderer, type InputControl, type InputRenderer } from './form-inputs';
import { keyedText, shellText } from './messages';
import {
  conditionHolds,
  copy,
  defaultFormActions,
  defaultValues,
  formErrors,
  inputPlaces,
  placeVisible,
  validateFormSchema,
  type FormAction,
  type FormGroup,
  type FormSchema,
  type FormSection,
  type FormValues,
  type InputPlace,
} from './form-model';

/** Options for `createFormDialog`: the values to edit, change and action callbacks, custom input renderers, the first section, and modal or panel presentation. */
export interface FormDialogOptions {
  /** Values to edit; inputs without one start from their `default`. */
  values?: FormValues;
  /**
   * Live preview: called with all values after every edit that leaves the
   * form valid, and with the opening values when the dialog is cancelled.
   */
  onChange?(values: FormValues): void;
  /** Called after each edit that leaves that input's own value valid. */
  onFieldChange?(id: string, value: unknown, values: FormValues): void;
  /**
   * Called when an action runs: `submit` only when the form is valid,
   * `cancel` after the values were restored. Return `false` from a submit to
   * keep the dialog open.
   */
  onAction?(id: string, values: FormValues, dialog: FormDialog): boolean | void;
  /** Renderers for this dialog only, by kind; they win over `registerInput`. */
  inputs?: Record<string, InputRenderer<never, never>>;
  /** Section shown first; default the first visible one. */
  section?: string;
  /** Below this width of the host in px, tabs become a select and the sidebar a list. Default 600. */
  compactWidth?: number;
  /**
   * `modal` (default): centred over a backdrop that blocks the host.
   * `panel`: docked to the host's right edge, a bottom sheet in compact mode,
   * with no backdrop or focus trap, so the chart stays usable while the
   * preview updates. Escape and the close button cancel either way.
   */
  presentation?: 'modal' | 'panel';
  /** Extra controls in the header, before the actions with `align: 'header'` and the close button. */
  headerControls?: readonly HTMLElement[];
  /** Accessible name of the close button. Default `dialogClose` in the `localization`'s language. */
  closeLabel?: string;
  /**
   * The language of the dialog's own text (Ok, Cancel, validation messages and
   * the like), usually `chart.localization`. Default English.
   */
  localization?: Localizer;
}

/** An open form dialog made by `createFormDialog`: reads its values and errors, switches sections, and submits, cancels or closes it. */
export interface FormDialog {
  /** Backdrop that holds the dialog. */
  readonly el: HTMLElement;
  readonly isOpen: boolean;
  /** A copy of the current values. */
  readonly values: FormValues;
  /** Messages of the visible, enabled inputs that are not valid, by input id. */
  readonly errors: Readonly<Record<string, string>>;
  /** Id of the section shown. */
  readonly section: string;
  showSection(id: string): void;
  /** Change values from code. Calls no callbacks. */
  setValues(patch: FormValues): void;
  /** Run the submit action: validate, then close unless `onAction` returns `false`. Returns whether it closed. */
  submit(): boolean;
  /** Restore the opening values (through `onChange`) and close. */
  cancel(): void;
  /** Close without restoring anything or calling callbacks. */
  close(): void;
}

interface Field {
  place: InputPlace;
  row: HTMLElement;
  control: InputControl;
  target: HTMLElement;
  error: HTMLElement;
}

const clone = (values: FormValues): FormValues => {
  const out: FormValues = {};
  for (const [key, value] of Object.entries(values)) out[key] = copy(value);
  return out;
};

/**
 * A modal settings dialog built from a schema. It opens at once in `host`
 * (the shell element, so it picks up the theme) and is removed when closed.
 * Throws when the schema has mistakes; `validateFormSchema` lists them.
 */
export function createFormDialog(host: HTMLElement, schema: FormSchema, options: FormDialogOptions = {}): FormDialog {
  const problems = validateFormSchema(schema, (kind) => inputRenderer(kind, options.inputs) !== undefined);
  if (problems.length > 0) throw new Error(`createFormDialog: ${problems.join(' ')}`);

  const id = nextDialogId('pc-form');
  const layout = schema.layout ?? 'single';
  const actions = schema.actions ?? defaultFormActions;
  const submitAction = actions.find((a) => a.role === 'submit') ?? defaultFormActions[1]!;
  const cancelAction = actions.find((a) => a.role === 'cancel') ?? defaultFormActions[0]!;
  const initial = { ...defaultValues(schema), ...clone(options.values ?? {}) };
  let values = clone(initial);
  let errors: Record<string, string> = {};
  let reported = false;
  let submitted = false;
  let isOpen = true;
  const touched = new Set<string>();
  const fields = new Map<string, Field>();
  const groupEls = new Map<FormGroup, HTMLElement>();
  /** Opens a collapsible group, e.g. to reach an invalid input inside it. */
  const groupOpeners = new Map<FormGroup, () => void>();
  const sectionEls = new Map<FormSection, HTMLElement>();
  let current: FormSection = schema.sections[0]!;
  let navKey = '';
  /** Compact sidebar: a section is open (detail) rather than the section list. */
  let detail = options.section !== undefined;

  const headerActions = actions.filter((a) => a.align === 'header').map(actionButton);
  const frame = openDialogFrame(host, {
    title: schema.title,
    className: `pc-form-dialog pc-form-dialog--${layout}`,
    onDismiss: () => cancel(),
    compactWidth: options.compactWidth,
    onCompactChange: () => renderNav(true),
    modal: options.presentation !== 'panel',
    headerControls: [...(options.headerControls ?? []), ...headerActions],
    closeLabel: options.closeLabel ?? shellText(options, 'dialogClose'),
  });
  const { panel } = frame;
  panel.setAttribute('data-layout', layout);
  panel.setAttribute('data-form', schema.id);

  const nav = h('div', { class: 'pc-form-nav' });
  const back = h(
    'button',
    { class: 'pc-btn pc-btn--ghost pc-form-back' },
    icon(ChevronLeft, 15),
    h('span', {}, shellText(options, 'dialogSections')),
  );
  back.addEventListener('click', () => {
    detail = false;
    renderNav(true);
    focusableIn(nav)[sectionList().indexOf(current)]?.focus();
  });
  const body = h('div', { class: 'pc-form-body' }, back);
  const status = h('div', { class: 'pc-sr-only', role: 'status' });
  const footer = h('div', { class: 'pc-dialog-footer' });
  const footerStart = h('div', { class: 'pc-dialog-actions pc-dialog-actions--start' });
  // Buttons that lead elsewhere: under the sections in a wide sidebar, else at the footer start (see `renderNav`).
  const navActions = h('div', { class: 'pc-form-nav-actions' });
  for (const action of actions) if (action.align === 'nav') navActions.append(actionButton(action));
  panel.append(h('div', { class: 'pc-form-main' }, nav, body), footer, status);

  const handle: FormDialog = {
    get el() {
      return frame.backdrop;
    },
    get isOpen() {
      return isOpen;
    },
    get values() {
      return clone(values);
    },
    get errors() {
      return { ...errors };
    },
    get section() {
      return current.id;
    },
    showSection: (sectionId) => {
      const section = sectionList().find((s) => s.id === sectionId);
      if (!section) return;
      detail = true;
      show(section);
    },
    setValues(patch) {
      values = { ...values, ...clone(patch) };
      for (const key of Object.keys(patch)) fields.get(key)?.control.setValue(values[key]);
      refresh();
    },
    submit: () => runAction(submitAction),
    cancel: () => cancel(),
    close,
  };

  buildSections();
  buildFooter();
  const start = options.section ? schema.sections.find((s) => s.id === options.section) : undefined;
  if (start) current = start;
  refresh();
  renderNav(true);
  focusFirst();

  function buildSections(): void {
    let index = 0;
    for (const section of schema.sections) {
      const el = h('div', {
        class: 'pc-form-section',
        role: 'tabpanel',
        id: `${id}-${section.id}-panel`,
        'aria-label': section.title,
      });
      for (const group of section.groups) el.append(buildGroup(section, group, () => index++));
      sectionEls.set(section, el);
      body.append(el);
    }
  }

  function buildGroup(section: FormSection, group: FormGroup, next: () => number): HTMLElement {
    const el = h('div', { class: 'pc-form-group' });
    const contentId = `${id}-g${next()}-body`;
    const content = h('div', { class: 'pc-form-group-body', id: contentId });
    if (group.label) {
      const headingId = `${contentId}-label`;
      el.setAttribute('role', 'group');
      el.setAttribute('aria-labelledby', headingId);
      if (group.collapsible) {
        const toggle = h('button', {
          class: 'pc-form-group-toggle',
          id: headingId,
          'aria-controls': contentId,
        });
        toggle.append(icon(ChevronDown, 14), h('span', {}, group.label));
        const set = (open: boolean) => {
          toggle.setAttribute('aria-expanded', String(open));
          content.hidden = !open;
        };
        set(!group.collapsed);
        toggle.addEventListener('click', () => set(content.hidden));
        groupOpeners.set(group, () => set(true));
        el.append(toggle);
      } else {
        el.append(h('div', { class: 'pc-form-group-label', id: headingId }, group.label));
      }
    }
    for (const input of group.inputs) content.append(buildField({ section, group, input }, next()));
    el.append(content);
    groupEls.set(group, el);
    return el;
  }

  function buildField(place: InputPlace, index: number): HTMLElement {
    const { input } = place;
    const controlId = `${id}-f${index}`;
    const labelId = `${controlId}-label`;
    const errorId = `${controlId}-error`;
    const render = inputRenderer(input.kind, options.inputs)!;
    const control = render(input, {
      controlId,
      labelId,
      value: values[input.id],
      get values() {
        return clone(values);
      },
      set: (value) => edit(input.id, value),
      localization: options.localization,
    });
    const target = control.focusTarget ?? control.el;
    const row = h('div', {
      class: `pc-form-field pc-form-field--${input.kind}`,
      'data-field': input.id,
    });
    row.append(h('label', { class: 'pc-form-label', id: labelId, for: controlId }, input.label));
    row.append(h('div', { class: 'pc-form-control' }, control.el));
    const described = [errorId];
    if (input.hint) {
      row.append(h('div', { class: 'pc-form-hint', id: `${controlId}-hint` }, input.hint));
      described.unshift(`${controlId}-hint`);
    }
    const error = h('div', { class: 'pc-form-error', id: errorId });
    error.hidden = true;
    row.append(error);
    target.setAttribute('aria-describedby', described.join(' '));
    fields.set(input.id, { place, row, control, target, error });
    return row;
  }

  function buildFooter(): void {
    const endSide = h('div', { class: 'pc-dialog-actions' });
    for (const action of actions) {
      if (action.align === 'header' || action.align === 'nav') continue;
      (action.align === 'start' ? footerStart : endSide).append(actionButton(action));
    }
    footer.append(footerStart, endSide);
  }

  function actionButton(action: FormAction): HTMLElement {
    return dialogButton(keyedText(options, action.labelKey, action.label), action.role === 'submit', () => runAction(action), action.id);
  }

  function sectionList(): FormSection[] {
    return schema.sections.filter((section) => conditionHolds(section.visible, values, true));
  }

  function show(section: FormSection, focusTab = false): void {
    current = section;
    // renderNav shows the current section and hides the others.
    renderNav(true);
    if (focusTab)
      focusableIn(nav)
        .find((el) => el.getAttribute('aria-selected') === 'true')
        ?.focus();
  }

  /** Tabs, sidebar list or compact select for the visible sections; rebuilt when they change. */
  function renderNav(force = false): void {
    const sections = sectionList();
    if (!sections.includes(current) && sections[0]) current = sections[0];
    for (const [s, el] of sectionEls) el.hidden = s !== current;
    const compact = frame.compact;
    const listMode = compact && layout === 'sidebar' && sections.length > 1 && !detail;
    const key = `${sections.map((s) => s.id).join('\n')}|${current.id}|${compact}|${listMode}`;
    if (!force && key === navKey) return;
    navKey = key;
    panel.setAttribute('data-view', listMode ? 'list' : 'detail');
    body.hidden = listMode;
    back.hidden = !(compact && layout === 'sidebar' && sections.length > 1);
    // Nav actions follow the section list: under the sidebar, or the compact list. An open compact
    // section leaves them out (Back reaches them), so the footer keeps only its own actions.
    const sideActions = layout === 'sidebar' && navActions.children.length > 0 && (!compact || listMode);
    for (const b of navActions.children) b.className = sideActions ? 'pc-form-nav-item' : 'pc-btn pc-btn--ghost';
    if (!sideActions) {
      if (layout === 'sidebar' && compact && sections.length > 1) navActions.remove();
      else footerStart.append(navActions);
    }
    nav.hidden = (sections.length <= 1 && !sideActions) || (compact && layout === 'sidebar' && !listMode);
    if (nav.hidden) return nav.replaceChildren();
    if (compact && layout === 'single') return nav.replaceChildren(sectionSelect(sections));
    nav.replaceChildren(listMode ? sectionLinks(sections) : sectionTabs(sections));
    if (sideActions) nav.append(navActions);
  }

  function sectionSelect(sections: FormSection[]): HTMLElement {
    return createListbox({
      options: sections.map((s) => ({ value: s.id, label: s.title })),
      value: current.id,
      label: shellText(options, 'dialogSection'),
      className: 'pc-form-nav-select',
      localization: options.localization,
      set: (value) => {
        const section = sections.find((s) => s.id === value);
        if (!section) return;
        show(section);
        // The nav was rebuilt: keep focus on the new select.
        focusableIn(nav)[0]?.focus();
      },
    }).el;
  }

  function sectionLinks(sections: FormSection[]): HTMLElement {
    const list = h('div', { class: 'pc-form-nav-list' });
    for (const s of sections) {
      const item = h('button', { class: 'pc-form-nav-item' }, s.title);
      item.addEventListener('click', () => {
        detail = true;
        show(s);
        focusFirst();
      });
      list.append(item);
    }
    return list;
  }

  function sectionTabs(sections: FormSection[]): HTMLElement {
    const vertical = layout === 'sidebar';
    const list = h('div', {
      class: 'pc-form-tabs',
      role: 'tablist',
      'aria-orientation': vertical ? 'vertical' : 'horizontal',
    });
    sections.forEach((s, i) => {
      const on = s === current;
      const tab = h(
        'button',
        {
          class: 'pc-form-tab',
          role: 'tab',
          id: `${id}-${s.id}-tab`,
          'aria-selected': String(on),
          'aria-controls': `${id}-${s.id}-panel`,
        },
        s.title,
      );
      tab.tabIndex = on ? 0 : -1;
      // The click rebuilds the tabs: move focus to the new tab, not to the page.
      tab.addEventListener('click', () => show(s, true));
      tab.addEventListener('keydown', (e) => {
        const next = stepTab(i, sections.length, inlineKey(e), vertical);
        if (next === null) return;
        e.preventDefault();
        show(sections[next]!, true);
      });
      list.append(tab);
    });
    return list;
  }

  function edit(inputId: string, value: unknown): void {
    if (!isOpen) return;
    values = {
      ...values,
      [inputId]: copy(value),
    };
    touched.add(inputId);
    refresh();
    if (!errors[inputId]) options.onFieldChange?.(inputId, value, clone(values));
    if (Object.keys(errors).length === 0) report(values);
  }

  function report(next: FormValues): void {
    reported = true;
    options.onChange?.(clone(next));
  }

  /** Re-evaluate visibility, disabled state and messages after values change. */
  function refresh(): void {
    errors = formErrors(schema, values, options);
    const shownGroups = new Set<FormGroup>();
    for (const [inputId, field] of fields) {
      const visible = placeVisible(field.place, values);
      field.row.hidden = !visible;
      if (visible) shownGroups.add(field.place.group);
      field.control.setDisabled(conditionHolds(field.place.input.disabled, values, false));
      const message = touched.has(inputId) || submitted ? errors[inputId] : undefined;
      field.error.textContent = message ?? '';
      field.error.hidden = !message;
      if (message) field.target.setAttribute('aria-invalid', 'true');
      else field.target.removeAttribute('aria-invalid');
    }
    for (const [group, el] of groupEls) el.hidden = !shownGroups.has(group);
    renderNav();
  }

  function focusFirst(): void {
    const scope = body.hidden ? nav : (sectionEls.get(current) ?? body);
    // The first input rather than a group heading.
    const candidates = focusableIn(scope);
    const first = candidates.find((el) => !el.className.includes('pc-form-group-toggle')) ?? candidates[0];
    (first ?? focusableIn(panel)[0])?.focus({ preventScroll: true });
  }

  function runAction(action: FormAction): boolean {
    if (!isOpen) return false;
    switch (action.role) {
      case 'cancel':
        cancel(action);
        return true;
      case 'reset':
        values = { ...values, ...defaultValues(schema) };
        for (const [inputId, field] of fields) field.control.setValue(values[inputId]);
        refresh();
        if (Object.keys(errors).length === 0) report(values);
        options.onAction?.(action.id, clone(values), handle);
        return false;
      case 'submit':
        return submit(action);
      default:
        options.onAction?.(action.id, clone(values), handle);
        return false;
    }
  }

  function submit(action: FormAction): boolean {
    submitted = true;
    refresh();
    const invalid = Object.keys(errors);
    if (invalid.length > 0) {
      status.textContent = invalid.length === 1 ? '1 field needs a fix.' : `${invalid.length} fields need a fix.`;
      const field = fields.get(invalid[0]!)!;
      detail = true;
      show(field.place.section);
      groupOpeners.get(field.place.group)?.();
      field.target.focus();
      return false;
    }
    if (options.onAction?.(action.id, clone(values), handle) === false) return false;
    close();
    return true;
  }

  function cancel(action: FormAction = cancelAction): void {
    if (!isOpen) return;
    values = clone(initial);
    if (reported) report(initial);
    close();
    options.onAction?.(action.id, clone(initial), handle);
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    for (const field of fields.values()) field.control.destroy?.();
    frame.close();
  }

  // Enter in a one-line input submits, as in any form.
  body.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if (e.key !== 'Enter' || e.defaultPrevented || e.isComposing || target.tagName?.toLowerCase() !== 'input') return;
    if ((target as HTMLInputElement).type === 'checkbox') return;
    e.preventDefault();
    runAction(submitAction);
  });

  return handle;
}
