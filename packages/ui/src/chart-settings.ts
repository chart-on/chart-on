import {
  applyChartSettings,
  chartSettingsSchema,
  type ChartSettingChoice,
  readChartSetting,
  type Chart,
  type ChartSettingField,
  type ChartSettingSection,
  type ChartTheme,
  type GridOptionsPatch,
} from '@chart-on/core';
import { Settings } from 'lucide';
import { appearanceOf, COLOR_KEYS, type AppearanceHandle, type AppearancePatch } from './appearance';
import { createFormDialog, type FormDialog } from './form-dialog';
import { localJson } from './local-json';
import { defaultFormActions, inputError, type FormInputDef, type FormSchema, type FormSection, type FormValues } from './form-model';
import { builtinText, keyedText, labelOf, shellText } from './messages';
import type { ToolbarItem } from './toolbar';
import type { CommandSource } from './command-palette-model';
import { retainTips } from './tooltip';

/** Where changed settings are kept between visits, by option path. */
export interface ChartSettingsStorage {
  load(): Record<string, unknown> | null;
  save(values: Record<string, unknown>): void;
}

/** `localStorage` storage; unavailable or blocked storage reads as empty and saves nothing. */
export function localSettingsStorage(key = 'charton:settings'): ChartSettingsStorage {
  return localJson(key, (data) => (typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : null));
}

/**
 * A settings field the app reads and writes itself instead of a chart option,
 * e.g. the shell theme or the language. It takes the same kinds as option
 * fields; `when.path` may name an option path or another app field's `id`.
 */
export interface AppSettingField extends Omit<ChartSettingField, 'path' | 'unset'> {
  /** Unique among the dialog's fields and distinct from option paths. */
  id: string;
  /** The current value; `undefined` leaves the field out. */
  get(chart: Chart): unknown;
  /** Apply `value`: called on each edit, and with the opening value on Cancel. */
  set(chart: Chart, value: unknown): void;
}

/** A settings section of app fields, shown after the option sections. */
export interface AppSettingSection {
  id: string;
  title: string;
  groups: readonly { id: string; label?: string; fields: readonly AppSettingField[] }[];
}

/** An app button in the settings dialog: one that leads elsewhere sits under the sections, one that acts on the dialog in the footer. */
export interface ChartSettingsAction {
  id: string;
  label: string;
  onClick(chart: Chart): void;
  /**
   * `nav` (default): under the section list, with the keyboard shortcuts
   * button, for a button that opens something else. `footer`: at the footer
   * start, for one that acts on the dialog itself.
   */
  placement?: 'nav' | 'footer';
}

/** Options for `createChartSettings`: the sections shown, where changed settings are saved, the appearance that takes color edits, and an open/close callback. */
export interface ChartSettingsOptions {
  /**
   * The sections to show, given the built-in ones (`chartSettingsSchema`):
   * return them filtered, reordered or with sections, groups and fields of
   * your own. Any chart option path works as a field.
   */
  sections?(defaults: readonly ChartSettingSection[]): readonly ChartSettingSection[];
  /**
   * Sections of fields the app reads and writes itself (see `AppSettingField`),
   * after the option sections. Edits apply live and Cancel restores them, but
   * they are not saved to `storage` and "Reset to defaults" leaves them alone:
   * the app keeps them.
   */
  fields?: readonly AppSettingSection[];
  /** Buttons of the app, e.g. one that opens another dialog (see `ChartSettingsAction.placement`). */
  actions?: readonly ChartSettingsAction[];
  /**
   * Where changed settings are kept; `null` keeps them for this visit only.
   * Default `localStorage`. Theme colors and grid lines go to `appearance`
   * instead while there is one.
   */
  storage?: ChartSettingsStorage | null;
  /**
   * `localStorage` key of the default storage. Default `'charton:settings'`.
   * Give each chart on a page its own key, or they share one set of settings.
   */
  storageKey?: string;
  /**
   * Appearance overrides that theme colors and grid lines are saved as, so
   * they survive a dark/light switch. Default the chart's (`appearanceOf`);
   * `null` applies them as plain options.
   */
  appearance?: AppearanceHandle | null;
  /** Called when the dialog opens or closes, e.g. to refresh a toolbar button's pressed state. */
  onOpenChange?(open: boolean): void;
}

/** Returned by `createChartSettings`: opens or closes the settings dialog and reads the saved settings. */
export interface ChartSettingsHandle {
  /** Open the dialog, at `section` if given; the open one when it is already open. Null when no field applies. */
  open(section?: string): FormDialog | null;
  /** Cancel the open dialog: the chart goes back to how it was when the dialog opened. */
  close(): void;
  readonly isOpen: boolean;
  readonly dialog: FormDialog | null;
  /** The saved settings that are not appearance overrides, by option path. */
  readonly values: Readonly<Record<string, unknown>>;
  /**
   * Command palette source (id `settings`) listing the dialog's sections;
   * running one opens the dialog at it. The shell adds it to its palette.
   */
  readonly commandSource: CommandSource;
  destroy(): void;
}

const handles = new WeakMap<Chart, ChartSettingsHandle>();

/** Per chart, opens its keyboard shortcuts dialog; set by `createShortcutSettings`, so apps without it do not ship it. */
const shortcutOpeners = new WeakMap<Chart, () => void>();

/**
 * Show (`open`) or hide (null) the "Keyboard shortcuts" button in the chart's settings dialog.
 * @internal
 */
export function linkShortcutSettings(chart: Chart, open: (() => void) | null): void {
  if (open) shortcutOpeners.set(chart, open);
  else shortcutOpeners.delete(chart);
}

/** The settings handle created for `chart`, if any. */
export function settingsOf(chart: Chart): ChartSettingsHandle | undefined {
  return handles.get(chart);
}

/**
 * Toolbar cog that opens the settings dialog of the chart it acts on; in the
 * `view` group, meant to sit beside the screenshot button. Pressed while the
 * dialog is open (pressing again closes it), and disabled on a chart without settings (outside a shell,
 * or with `settings: false`).
 */
export function settingsToolbarItem(): ToolbarItem {
  return {
    type: 'button',
    id: 'chart-settings',
    group: 'view',
    ...labelOf('toolbarSettings'),
    icon: Settings,
    onClick: (chart) => {
      const settings = settingsOf(chart);
      // Pressing it again while the dialog is open closes it, as Cancel does.
      if (settings?.isOpen) settings.close();
      else settings?.open();
    },
    isActive: (chart) => settingsOf(chart)?.isOpen ?? false,
    isDisabled: (chart) => settingsOf(chart) === undefined,
  };
}

/** A `select` with more choices than this gets a search box (the timezone list). */
const SEARCH_CHOICES = 20;

/** The form input for a settings field; its id is the option path. Long selects are searchable. */
export function settingInput(field: ChartSettingField): FormInputDef {
  const base = {
    id: field.path,
    label: field.label,
    ...(field.hint ? { hint: field.hint } : {}),
    ...(field.when ? { visible: (values: Readonly<FormValues>) => values[field.when!.path] === field.when!.equals } : {}),
  };
  switch (field.kind) {
    case 'select': {
      const options = [...(field.choices ?? [])];
      return { ...base, kind: 'select', options, ...(options.length > SEARCH_CHOICES ? { searchable: true } : {}) };
    }
    case 'slider':
      return { ...base, kind: 'slider', min: field.min ?? 0, max: field.max ?? 1, step: field.step, unit: field.unit };
    case 'number':
      return { ...base, kind: 'number', min: field.min, max: field.max, step: field.step };
    default:
      return { ...base, kind: field.kind };
  }
}

/** Appearance override path for `path`, or null when it is a plain option. */
function appearancePath(path: string): ['theme', keyof ChartTheme] | ['grid', 'horizontal' | 'vertical', string] | null {
  const [root, key, field] = path.split('.');
  if (root === 'theme' && key && COLOR_KEYS.has(key) && field === undefined) return ['theme', key as keyof ChartTheme];
  if (root === 'grid' && (key === 'horizontal' || key === 'vertical') && field) return ['grid', key, field];
  return null;
}

/** An appearance patch setting (or, with `undefined`, clearing) the override of each path. */
function appearancePatch(values: Readonly<Record<string, unknown>>): AppearancePatch {
  const theme: Record<string, unknown> = {};
  const grid: Record<string, Record<string, unknown>> = {};
  for (const [path, value] of Object.entries(values)) {
    const target = appearancePath(path);
    if (target?.[0] === 'theme') theme[target[1]] = value;
    else if (target?.[0] === 'grid') (grid[target[1]] ??= {})[target[2]] = value;
  }
  return { theme: theme as Partial<ChartTheme>, grid: grid as GridOptionsPatch };
}

/**
 * The chart settings dialog: the sections of `chartSettingsSchema` (or the
 * app's, see `sections`) as a form in `host` (the shell element, so it picks
 * up the theme). Edits apply live; Ok keeps them, Cancel and Escape put the
 * chart back, and "Reset to defaults" goes back to the app's options. Saved
 * settings are applied when the handle is created, and the main series'
 * settings again whenever a main series is added.
 */
export function createChartSettings(chart: Chart, host: HTMLElement, options: ChartSettingsOptions = {}): ChartSettingsHandle {
  const sections = options.sections?.(chartSettingsSchema) ?? chartSettingsSchema;
  const fields = sections.flatMap((s) => s.groups.flatMap((g) => g.fields));
  const appearance = options.appearance === undefined ? (appearanceOf(chart) ?? null) : options.appearance;
  const viaAppearance = (path: string) => appearance !== null && appearancePath(path) !== null;
  const storage = options.storage === undefined ? localSettingsStorage(options.storageKey) : options.storage;
  const plain = fields.filter((f) => !viaAppearance(f.path));
  const isSeries = (f: ChartSettingField) => f.path.startsWith('series.');
  const appFields = new Map((options.fields ?? []).flatMap((s) => s.groups.flatMap((g) => g.fields)).map((f) => [f.id, f]));

  // Only known paths with acceptable values, so storage cannot hand the chart anything else.
  let saved: Record<string, unknown> = {};
  const stored = loadStored(storage);
  for (const field of plain) {
    const value = stored[field.path];
    if (value !== undefined && !inputError(settingInput(field), value, {})) saved[field.path] = value;
  }

  /** The app's values, before any saved setting: what "Reset to defaults" goes back to. */
  const defaults = new Map<string, unknown>();
  const capture = (list: readonly ChartSettingField[]) => {
    for (const field of list) {
      const value = readChartSetting(chart, field);
      if (value !== undefined) defaults.set(field.path, value);
    }
  };
  const applySaved = (list: readonly ChartSettingField[]) =>
    applyChartSettings(chart, Object.fromEntries(list.filter((f) => f.path in saved).map((f) => [f.path, saved[f.path]])));
  capture(plain);
  applySaved(plain);
  // Shells create the main series only when data arrives.
  const offSeries = chart.on('series:add', ({ series }) => {
    if (series !== chart.main) return;
    const list = plain.filter(isSeries);
    capture(list);
    applySaved(list);
  });

  let dialog: FormDialog | null = null;

  const open = (section?: string): FormDialog | null => {
    if (dialog?.isOpen) {
      if (section) dialog.showSection(section);
      return dialog;
    }
    const { schema, shown, values } = buildForm(chart, sections, defaults, options);
    if (schema.sections.length === 0) return null;
    const startOverrides = appearance?.overrides ?? {};
    let applied: FormValues = { ...values };

    /** Apply the values that differ from what was last applied. */
    const preview = (next: FormValues) => {
      const changed = Object.fromEntries(Object.entries(next).filter(([path, value]) => !same(value, applied[path])));
      applied = { ...next };
      const plainChanged: FormValues = {};
      let touchesAppearance = false;
      for (const [id, value] of Object.entries(changed)) {
        const field = appFields.get(id);
        if (field) field.set(chart, value);
        else if (viaAppearance(id)) touchesAppearance = true;
        else plainChanged[id] = value;
      }
      applyChartSettings(chart, plainChanged);
      if (touchesAppearance) appearance?.set(appearancePatch(changed));
    };
    const finish = () => {
      dialog = null;
      options.onOpenChange?.(false);
    };

    dialog = createFormDialog(host, schema, {
      localization: chart.localization,
      values,
      section,
      onChange: preview,
      onAction: (action, current, form) => {
        if (action.startsWith('app:')) options.actions?.find((a) => `app:${a.id}` === action)?.onClick(chart);
        else if (action === 'shortcuts') shortcutOpeners.get(chart)?.();
        else if (action === 'reset') {
          // Back to the app's values; appearance overrides are dropped rather than set to them.
          const restored = Object.fromEntries(plain.filter((f) => defaults.has(f.path)).map((f) => [f.path, defaults.get(f.path)]));
          applyChartSettings(chart, restored);
          appearance?.set(appearancePatch(Object.fromEntries(fields.filter((f) => viaAppearance(f.path)).map((f) => [f.path, undefined]))));
          applied = { ...applied, ...Object.fromEntries(shown.map((f) => [f.path, readChartSetting(chart, f)])) };
          form.setValues(applied);
        } else if (action === 'ok') {
          saved = { ...saved };
          for (const field of plain) {
            if (!(field.path in current)) continue;
            if (same(current[field.path], defaults.get(field.path))) delete saved[field.path];
            else saved[field.path] = current[field.path];
          }
          saveStored(storage, saved);
          finish();
        } else if (action === 'cancel') {
          // Back to the opening values (also after a reset, which the form does not report),
          // then the appearance overrides exactly, so a color shown through its fallback
          // does not stay as an override.
          preview(current);
          appearance?.reset();
          appearance?.set(startOverrides);
          finish();
        }
      },
    });
    options.onOpenChange?.(true);
    return dialog;
  };

  const releaseTips = retainTips();
  const handle: ChartSettingsHandle = {
    open,
    close: () => dialog?.cancel(),
    get isOpen() {
      return dialog?.isOpen ?? false;
    },
    get dialog() {
      return dialog;
    },
    get values() {
      return { ...saved };
    },
    commandSource: {
      id: 'settings',
      get label() {
        return shellText(chart, 'chartSettingsTitle');
      },
      // The sections this chart shows, as the dialog would list them.
      entries: () =>
        buildForm(chart, sections, defaults, options).schema.sections.map((section) => ({
          id: section.id,
          label: section.title,
          description: shellText(chart, 'chartSettingsTitle'),
          run: () => void open(section.id),
        })),
    },
    destroy() {
      releaseTips();
      dialog?.cancel();
      offSeries();
      handles.delete(chart);
    },
  };
  handles.set(chart, handle);
  return handle;
}

/**
 * The app's stored settings; a storage that throws or returns something else reads as empty.
 * @internal
 */
export function loadStored(storage: ChartSettingsStorage | null): Record<string, unknown> {
  try {
    const data: unknown = storage?.load();
    return typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Save through the app's storage; a failing save keeps the settings for this visit.
 * @internal
 */
export function saveStored(storage: ChartSettingsStorage | null, values: Record<string, unknown>): void {
  try {
    storage?.save(values);
  } catch {
    // The settings still apply; they are just not kept.
  }
}

/** Internal: equal values, or equal as JSON. */
export const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * A select that also offers those of `values` its choices do not, e.g. a
 * timezone alias the app set: the dialog shows what is in effect, and Ok
 * does not fail on a value the user never touched.
 */
function withChoices(input: FormInputDef, values: readonly unknown[]): FormInputDef {
  if (input.kind !== 'select') return input;
  const missing = [...new Set(values)].filter(
    (v): v is string | number => (typeof v === 'string' || typeof v === 'number') && !input.options.some((o) => o.value === v),
  );
  return missing.length === 0 ? input : { ...input, options: [...input.options, ...missing.map((v) => ({ value: v, label: String(v) }))] };
}

/** The English text of the built-in sections, groups, fields and choices, by message key; see `localText`. */
let builtinTexts: Map<string, string> | undefined;

/**
 * The text of a part of the settings in the chart's language while it is the
 * built-in one: `settings.<section>`, `settings.<section>.<group>`,
 * `setting.<path>`, `setting.<path>#hint` and `setting.<path>.<choice>`.
 */
function localText(chart: Chart, key: string, label: string): string {
  if (!builtinTexts) {
    builtinTexts = new Map();
    const add = (k: string, text: string | undefined) => text !== undefined && builtinTexts!.set(k, text);
    for (const s of chartSettingsSchema) {
      add(`settings.${s.id}`, s.title);
      for (const g of s.groups) {
        add(`settings.${s.id}.${g.id}`, g.label);
        for (const f of g.fields) {
          add(`setting.${f.path}`, f.label);
          add(`setting.${f.path}#hint`, f.hint);
          for (const c of f.choices ?? []) add(`setting.${f.path}.${c.value}`, c.label);
        }
      }
    }
  }
  return builtinText(chart, key, label, builtinTexts.get(key));
}

/**
 * The form for `sections`, leaving out fields that have no value on this chart
 * (and groups and sections left empty). Selects also offer the current and
 * the app's (`defaults`) values.
 */
function buildForm(
  chart: Chart,
  sections: readonly ChartSettingSection[],
  defaults: ReadonlyMap<string, unknown>,
  app: Pick<ChartSettingsOptions, 'fields' | 'actions'>,
): { schema: FormSchema; shown: ChartSettingField[]; values: FormValues } {
  const values: FormValues = {};
  const shown: ChartSettingField[] = [];
  const formSections: FormSection[] = [];
  for (const section of sections) {
    const groups = [];
    for (const group of section.groups) {
      const inputs: FormInputDef[] = [];
      for (const field of group.fields) {
        // An option that does nothing without its plugin is left out.
        if (field.plugin && !chart.installedPlugins.includes(field.plugin)) continue;
        const value = readChartSetting(chart, field);
        if (value === undefined) continue;
        values[field.path] = value;
        shown.push(field);
        const key = `setting.${field.path}`;
        const local: ChartSettingField = {
          ...field,
          label: localText(chart, key, field.label),
          ...(field.hint ? { hint: localText(chart, `${key}#hint`, field.hint) } : {}),
          ...(field.choices
            ? { choices: field.choices.map(
                (c): ChartSettingChoice => ({
                  ...c,
                  label: c.labelKey ? keyedText(chart, c.labelKey, c.label, c.labelParams) : localText(chart, `${key}.${c.value}`, c.label),
                }),
              ),
            }
            : {}),
        };
        inputs.push(withChoices(settingInput(local), defaults.has(field.path) ? [value, defaults.get(field.path)] : [value]));
      }
      const label = group.label && localText(chart, `settings.${section.id}.${group.id}`, group.label);
      if (inputs.length > 0) groups.push({ id: group.id, ...(label ? { label } : {}), inputs });
    }
    if (groups.length > 0) formSections.push({ id: section.id, title: localText(chart, `settings.${section.id}`, section.title), groups });
  }
  for (const section of app.fields ?? []) {
    const groups = [];
    for (const group of section.groups) {
      const inputs: FormInputDef[] = [];
      for (const field of group.fields) {
        const value = field.get(chart);
        if (value === undefined) continue;
        values[field.id] = value;
        inputs.push(withChoices(settingInput({ ...field, path: field.id }), [value]));
      }
      if (inputs.length > 0) groups.push({ id: group.id, ...(group.label ? { label: group.label } : {}), inputs });
    }
    if (groups.length > 0) formSections.push({ id: section.id, title: section.title, groups });
  }
  const schema: FormSchema = {
    id: 'chart-settings',
    title: shellText(chart, 'chartSettingsTitle'),
    layout: 'sidebar',
    sections: formSections,
    actions: [
      // Reset acts on the whole dialog, so it sits in the header as in the other settings dialogs; the footer keeps Cancel and Ok.
      { id: 'reset', ...labelOf('dialogResetDefaults'), role: 'button', align: 'header' },
      ...(shortcutOpeners.has(chart)
        ? [{ id: 'shortcuts', label: shellText(chart, 'shortcutsOpen'), role: 'button' as const, align: 'nav' as const }]
        : []),
      ...(app.actions ?? []).map((a) => ({
        id: `app:${a.id}`,
        label: a.label,
        role: 'button' as const,
        align: a.placement === 'footer' ? ('start' as const) : ('nav' as const),
      })),
      ...defaultFormActions,
    ],
  };
  return { schema, shown, values };
}
