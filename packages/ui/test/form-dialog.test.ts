import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatch, fakeContainer, fireWindowResize } from '../../core/test/fake-dom';
import { chooseOption, chosenLabel } from './listbox';
import { createFormDialog, type FormDialog, type FormDialogOptions } from '../src/form-dialog';
import { registerInput } from '../src/form-inputs';
import { defaultFormActions, type FormInputBase, type FormInputDef, type FormSchema } from '../src/form-model';

/** An input of a kind the schema types do not know (custom, or a mistake). */
const custom = <V>(def: FormInputBase<V> & { kind: string }) => def as unknown as FormInputDef;

type El = HTMLElement & {
  children: El[];
  tagName: string;
  textContent: string;
  value: string;
  checked: boolean;
  selectedIndex: number;
  disabled?: boolean;
};

const dialogs: FormDialog[] = [];
afterEach(() => {
  dialogs.splice(0).forEach((d) => d.close());
  vi.restoreAllMocks();
});

const all = (root: El): El[] => root.children.flatMap((c) => [c, ...all(c)]);
const find = (root: El, test: (el: El) => boolean) => all(root).find(test);
const idOf = (el: El) => el.getAttribute('id') ?? el.id;
const attr = (root: El, name: string, value: string) => find(root, (el) => el.getAttribute(name) === value);
const row = (root: El, id: string) => attr(root, 'data-field', id)!;
const control = (root: El, id: string) => find(row(root, id), (el) => ['input', 'select', 'button'].includes(el.tagName))!;
const error = (root: El, id: string) => find(row(root, id), (el) => el.className === 'pc-form-error')!;
const tabs = (root: El) => all(root).filter((el) => el.getAttribute('role') === 'tab');
const focused = () => document.activeElement as unknown as El;
const key = (target: El, k: string, init: Record<string, unknown> = {}) => dispatch(target, 'keydown', { key: k, ...init });
const type = (input: El, text: string) => {
  input.value = text;
  dispatch(input, 'input');
};

const schema: FormSchema = {
  id: 'ma',
  title: 'Moving average',
  sections: [
    {
      id: 'inputs',
      title: 'Inputs',
      groups: [
        {
          id: 'main',
          inputs: [
            {
              kind: 'number',
              id: 'length',
              label: 'Length',
              default: 20,
              min: 1,
              integer: true,
            },
            { kind: 'source', id: 'source', label: 'Source', default: 'close' },
            { kind: 'boolean', id: 'bands', label: 'Bands', default: false },
            {
              kind: 'number',
              id: 'width',
              label: 'Band width',
              default: 2,
              min: 0,
              visible: (v) => v.bands === true,
            },
          ],
        },
      ],
    },
    {
      id: 'style',
      title: 'Style',
      groups: [
        {
          id: 'line',
          label: 'Line',
          collapsible: true,
          inputs: [
            {
              kind: 'text',
              id: 'name',
              label: 'Name',
              default: 'MA',
              required: true,
            },
            {
              kind: 'slider',
              id: 'opacity',
              label: 'Opacity',
              min: 0,
              max: 100,
              default: 100,
              unit: '%',
            },
          ],
        },
      ],
    },
  ],
  actions: [
    { id: 'defaults', label: 'Defaults', role: 'reset', align: 'start' },
    { id: 'cancel', label: 'Cancel', role: 'cancel' },
    { id: 'ok', label: 'Ok', role: 'submit' },
  ],
};

function open(options: FormDialogOptions = {}, s: FormSchema = schema) {
  const host = fakeContainer() as unknown as El;
  const dialog = createFormDialog(host, s, options);
  dialogs.push(dialog);
  return { host, dialog, panel: dialog.el.children[0] as El };
}

describe('form dialog', () => {
  it('renders the schema with defaults and the given values, and focuses the first input', () => {
    const { host, dialog, panel } = open({ values: { length: 50 } });
    expect(host.children).toContain(dialog.el);
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(tabs(panel).map((t) => t.textContent)).toEqual(['Inputs', 'Style']);
    expect(control(panel, 'length').value).toBe('50');
    expect(chosenLabel(control(panel, 'source'))).toBe('Close');
    expect(focused()).toBe(control(panel, 'length'));
    expect(dialog.values).toEqual({
      length: 50,
      source: 'close',
      bands: false,
      width: 2,
      name: 'MA',
      opacity: 100,
    });
    const label = find(row(panel, 'length'), (el) => el.tagName === 'label')!;
    expect(label.getAttribute('for')).toBe(idOf(control(panel, 'length')));
  });

  it('previews valid edits, shows messages for invalid ones and restores on cancel', () => {
    const onChange = vi.fn();
    const onFieldChange = vi.fn();
    const onAction = vi.fn();
    const { host, panel } = open({ onChange, onFieldChange, onAction });
    const length = control(panel, 'length');
    type(length, '30');
    expect(onFieldChange).toHaveBeenLastCalledWith('length', 30, expect.objectContaining({ length: 30 }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ length: 30 }));

    type(length, '0');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(error(panel, 'length').hidden).toBe(false);
    expect(error(panel, 'length').textContent).toBe('Enter 1 or more.');
    expect(length.getAttribute('aria-invalid')).toBe('true');
    expect(length.getAttribute('aria-describedby')).toBe(idOf(error(panel, 'length')));

    key(length, 'Escape');
    expect(host.children).toEqual([]);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ length: 20 }));
    expect(onAction).toHaveBeenCalledWith('cancel', expect.objectContaining({ length: 20 }), expect.anything());
  });

  it('does not report a cancel when nothing was previewed', () => {
    const onChange = vi.fn();
    const { dialog } = open({ onChange });
    dialog.cancel();
    expect(onChange).not.toHaveBeenCalled();
    expect(dialog.isOpen).toBe(false);
  });

  it('shows inputs when their condition holds', () => {
    const { panel } = open();
    expect(row(panel, 'width').hidden).toBe(true);
    const bands = control(panel, 'bands');
    bands.checked = true;
    dispatch(bands, 'change');
    expect(row(panel, 'width').hidden).toBe(false);
  });

  it('submits with Enter and closes', () => {
    const onAction = vi.fn();
    const { host, panel } = open({ onAction });
    const length = control(panel, 'length');
    type(length, '9');
    key(length, 'Enter');
    expect(onAction).toHaveBeenCalledWith('ok', expect.objectContaining({ length: 9 }), expect.anything());
    expect(host.children).toEqual([]);
  });

  it('keeps the dialog open on an invalid submit and moves to the first invalid input', () => {
    const onAction = vi.fn();
    const { dialog, panel } = open({ onAction, values: { name: '' } });
    expect(dialog.section).toBe('inputs');
    expect(dialog.submit()).toBe(false);
    expect(onAction).not.toHaveBeenCalled();
    expect(dialog.section).toBe('style');
    expect(focused()).toBe(control(panel, 'name'));
    expect(error(panel, 'name').textContent).toBe('Required.');
    expect(dialog.errors).toEqual({ name: 'Required.' });
  });

  it('stays open when onAction returns false', () => {
    const { dialog } = open({ onAction: () => false });
    expect(dialog.submit()).toBe(false);
    expect(dialog.isOpen).toBe(true);
  });

  it('resets to the defaults', () => {
    const onChange = vi.fn();
    const { panel } = open({ onChange, values: { length: 99 } });
    dispatch(attr(panel, 'data-action', 'defaults')!, 'click');
    expect(control(panel, 'length').value).toBe('20');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ length: 20 }));
  });

  it('switches sections with the arrow keys on the tabs', () => {
    const { dialog, panel } = open();
    const [first, second] = tabs(panel);
    expect(first!.tabIndex).toBe(0);
    expect(second!.tabIndex).toBe(-1);
    key(first!, 'ArrowRight');
    expect(dialog.section).toBe('style');
    const selected = tabs(panel).find((t) => t.getAttribute('aria-selected') === 'true')!;
    expect(selected.textContent).toBe('Style');
    expect(focused()).toBe(selected);
    key(selected, 'Home');
    expect(dialog.section).toBe('inputs');
  });

  it('keeps focus on a clicked tab, so Escape still closes the dialog', () => {
    const { dialog, host, panel } = open();
    dispatch(tabs(panel)[1]!, 'click');
    expect(dialog.section).toBe('style');
    const selected = tabs(panel).find((t) => t.getAttribute('aria-selected') === 'true')!;
    expect(focused()).toBe(selected);
    key(selected, 'Escape');
    expect(host.children).toEqual([]);
  });

  it('keeps Tab inside the dialog', () => {
    const { panel } = open();
    const close = find(panel, (el) => el.getAttribute('aria-label') === 'Close')!;
    const ok = attr(panel, 'data-action', 'ok')!;
    ok.focus();
    expect(key(ok, 'Tab').defaultPrevented).toBe(true);
    expect(focused()).toBe(close);
    expect(key(close, 'Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(focused()).toBe(ok);
  });

  it('opens as a non-modal panel with header controls and header actions', () => {
    const extra = document.createElement('select') as unknown as El;
    const s: FormSchema = {
      ...schema,
      actions: [{ id: 'reset', label: 'Reset', role: 'reset', align: 'header' }, ...defaultFormActions],
    };
    const { dialog, panel } = open({ presentation: 'panel', headerControls: [extra] }, s);
    expect(dialog.el.className).toContain('pc-dialog-backdrop--panel');
    expect(panel.className).toContain('pc-dialog--panel');
    expect(panel.getAttribute('aria-modal')).toBeNull();
    const header = find(panel, (el) => el.className === 'pc-dialog-header')!;
    expect(header.children.map((el) => el.getAttribute('data-action') ?? el.getAttribute('aria-label') ?? el.tagName)).toEqual([
      'div',
      'select',
      'reset',
      'Close',
    ]);
    const footer = find(panel, (el) => el.className === 'pc-dialog-footer')!;
    expect(find(footer, (el) => el.getAttribute('data-action') === 'reset')).toBeUndefined();
    // Tab may leave a panel.
    const ok = attr(panel, 'data-action', 'ok')!;
    ok.focus();
    expect(key(ok, 'Tab').defaultPrevented).toBe(false);
    key(ok, 'Escape');
    expect(dialog.isOpen).toBe(false);
  });

  it('collapses a group from its heading', () => {
    const { dialog, panel } = open();
    dialog.showSection('style');
    const toggle = find(panel, (el) => el.className === 'pc-form-group-toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    dispatch(toggle, 'click');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(find(panel, (el) => idOf(el) === toggle.getAttribute('aria-controls'))!.hidden).toBe(true);
  });

  it('opens a collapsed group to reach an invalid input on submit', () => {
    const { dialog, panel } = open({ values: { name: '' } });
    dialog.showSection('style');
    const toggle = find(panel, (el) => el.className === 'pc-form-group-toggle')!;
    dispatch(toggle, 'click');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(dialog.submit()).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(focused()).toBe(control(panel, 'name'));
  });

  it('turns tabs into a select in a narrow host', () => {
    const { dialog, panel } = open({ compactWidth: 1000 });
    expect(panel.getAttribute('data-compact')).toBe('true');
    expect(tabs(panel)).toEqual([]);
    const select = find(panel, (el) => el.className.includes('pc-form-nav-select'))!;
    expect(chosenLabel(select.children[0]!)).toBe('Inputs');
    chooseOption(select.children[0]!, 1);
    expect(dialog.section).toBe('style');
    // The nav is rebuilt for the new section; focus stays on its select.
    const rebuilt = find(panel, (el) => el.className.includes('pc-form-nav-select'))!.children[0]!;
    expect(chosenLabel(rebuilt)).toBe('Style');
    expect(focused()).toBe(rebuilt);
  });

  it('shows a sidebar as list and detail in a narrow host', () => {
    const { dialog, panel } = open({ compactWidth: 1000 }, { ...schema, layout: 'sidebar' });
    expect(panel.getAttribute('data-view')).toBe('list');
    const items = all(panel).filter((el) => el.className === 'pc-form-nav-item');
    expect(items.map((i) => i.textContent)).toEqual(['Inputs', 'Style']);
    expect(focused()).toBe(items[0]);
    dispatch(items[1]!, 'click');
    expect(dialog.section).toBe('style');
    expect(panel.getAttribute('data-view')).toBe('detail');
    expect(focused()).toBe(control(panel, 'name'));
    dispatch(
      find(panel, (el) => el.className.includes('pc-form-back'))!,
      'click',
    );
    expect(panel.getAttribute('data-view')).toBe('list');
  });

  it('puts nav actions under a wide sidebar, in the compact list, and in the footer elsewhere', () => {
    const onAction = vi.fn();
    const withNav: FormSchema = {
      ...schema,
      layout: 'sidebar',
      actions: [{ id: 'more', label: 'More…', align: 'nav' }, ...defaultFormActions],
    };
    const where = (panel: El) => {
      const button = attr(panel, 'data-action', 'more');
      if (!button) return 'absent';
      return find(panel, (el) => el.className === 'pc-form-nav' && all(el).includes(button)) ? 'nav' : 'footer';
    };
    const footer = (panel: El) => all(find(panel, (el) => el.className === 'pc-dialog-footer')!).filter((el) => el.tagName === 'button').map((el) => el.getAttribute('data-action'));

    const wide = open({ onAction }, withNav);
    expect(where(wide.panel)).toBe('nav');
    expect(attr(wide.panel, 'data-action', 'more')!.className).toBe('pc-form-nav-item');
    expect(footer(wide.panel)).toEqual(['cancel', 'ok']);
    dispatch(attr(wide.panel, 'data-action', 'more')!, 'click');
    expect(onAction).toHaveBeenCalledWith('more', expect.anything(), wide.dialog);
    wide.dialog.close();

    // Compact: in the section list, and out of an open section (Back reaches it), never in the footer.
    const narrow = open({ compactWidth: 1000 }, withNav);
    expect(narrow.panel.getAttribute('data-view')).toBe('list');
    expect(where(narrow.panel)).toBe('nav');
    dispatch(all(narrow.panel).find((el) => el.textContent === 'Style')!, 'click');
    expect(where(narrow.panel)).toBe('absent');
    expect(footer(narrow.panel)).toEqual(['cancel', 'ok']);
    narrow.dialog.close();

    // No sidebar: a footer button at the start.
    const single = open({}, { ...withNav, layout: 'single' });
    expect(where(single.panel)).toBe('footer');
    expect(footer(single.panel)).toEqual(['more', 'cancel', 'ok']);
  });

  it('applies values from code without callbacks', () => {
    const onChange = vi.fn();
    const { dialog, panel } = open({ onChange });
    dialog.setValues({ bands: true, length: 5 });
    expect(control(panel, 'length').value).toBe('5');
    expect(row(panel, 'width').hidden).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('leaves Escape to an open color picker', () => {
    const s: FormSchema = {
      id: 'c',
      title: 'Colors',
      sections: [
        {
          id: 's',
          title: 'S',
          groups: [
            {
              id: 'g',
              inputs: [
                {
                  kind: 'color',
                  id: 'line',
                  label: 'Line',
                  default: '#3cc4a0',
                },
              ],
            },
          ],
        },
      ],
    };
    const { dialog, panel } = open({}, s);
    const trigger = control(panel, 'line');
    expect(idOf(trigger)).toBe(find(row(panel, 'line'), (el) => el.tagName === 'label')!.getAttribute('for'));
    dispatch(trigger, 'click');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    key(trigger, 'Escape');
    expect(dialog.isOpen).toBe(true);
  });

  it('shows a searchable select as a closed combobox that closes on pick', () => {
    const fruits = ['Apple', 'Apricot', 'Banana', 'Cherry', 'Grape', 'Lemon', 'Lime', 'Mango', 'Melon', 'Orange', 'Peach', 'Pear'];
    const s: FormSchema = {
      id: 'f',
      title: 'Fruit',
      sections: [
        {
          id: 's',
          title: 'S',
          groups: [
            {
              id: 'g',
              inputs: [
                { kind: 'select', id: 'fruit', label: 'Fruit', default: 'banana', searchable: true, options: fruits.map((f) => ({ value: f.toLowerCase(), label: f })) },
                { kind: 'number', id: 'count', label: 'Count', default: 1 },
              ],
            },
          ],
        },
      ],
    };
    const onChange = vi.fn();
    const { dialog, panel } = open({ onChange }, s);
    const trigger = control(panel, 'fruit');
    const label = find(row(panel, 'fruit'), (el) => el.tagName === 'label')!;
    const value = find(trigger, (el) => el.className === 'pc-form-combo-value')!;
    expect(trigger.getAttribute('aria-labelledby')).toBe(`${idOf(label)} ${idOf(value)}`);
    expect(value.textContent).toBe('Banana');
    const options = () => all(row(panel, 'fruit')).filter((el) => el.getAttribute('role') === 'option');
    const search = () => find(row(panel, 'fruit'), (el) => el.getAttribute('role') === 'combobox');

    // Open: the list shows every option with the chosen one marked and active.
    key(trigger, 'ArrowUp');
    const box = search()!;
    const list = find(row(panel, 'fruit'), (el) => el.getAttribute('role') === 'listbox')!;
    expect(box.getAttribute('aria-controls')).toBe(idOf(list));
    expect(box.getAttribute('aria-expanded')).toBe('true');
    expect(options()).toHaveLength(fruits.length);
    expect(options()[2]!.getAttribute('aria-selected')).toBe('true');
    expect(box.getAttribute('aria-activedescendant')).toBe(idOf(options()[2]!));
    // Page keys move by a page and stop at the ends.
    key(box, 'PageDown');
    expect(box.getAttribute('aria-activedescendant')).toBe(idOf(options()[10]!));
    key(box, 'PageDown');
    expect(box.getAttribute('aria-activedescendant')).toBe(idOf(options()[11]!));
    key(box, 'PageUp');
    key(box, 'PageUp');
    expect(box.getAttribute('aria-activedescendant')).toBe(idOf(options()[0]!));

    // Filter by label or value; the first match is active.
    type(box, 'me');
    expect(options().map((o) => o.textContent)).toEqual(['Lime', 'Melon']);
    expect(box.getAttribute('aria-activedescendant')).toBe(idOf(options()[0]!));
    key(box, 'ArrowDown');
    key(box, 'Enter');
    expect(search()).toBeUndefined();
    expect(focused()).toBe(trigger);
    expect(value.textContent).toBe('Melon');
    expect(dialog.values.fruit).toBe('melon');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ fruit: 'melon' }));

    // Tab closes the list without a change and leaves from the trigger.
    dispatch(trigger, 'click');
    key(search()!, 'ArrowDown');
    key(search()!, 'Tab');
    expect(search()).toBeUndefined();
    expect(focused()).toBe(trigger);
    expect(dialog.values.fruit).toBe('melon');

    // Values from code show on the closed control; Escape closes the list, not the dialog.
    dialog.setValues({ fruit: 'pear' });
    expect(value.textContent).toBe('Pear');
    dispatch(trigger, 'click');
    expect(dialog.values.fruit).toBe('pear');
    key(search()!, 'Escape');
    expect(dialog.isOpen).toBe(true);
  });

  it('keeps a searchable select list in place while the page moves, and reuses its rows', () => {
    const s: FormSchema = {
      id: 'z',
      title: 'Zone',
      sections: [
        {
          id: 's',
          title: 'S',
          groups: [
            {
              id: 'g',
              inputs: [
                {
                  kind: 'select',
                  id: 'zone',
                  label: 'Zone',
                  default: 'b',
                  searchable: true,
                  options: ['a', 'b', 'c'].map((v) => ({ value: v, label: v.toUpperCase() })),
                },
              ],
            },
          ],
        },
      ],
    };
    const { dialog, panel, host } = open({}, s);
    const trigger = control(panel, 'zone');
    const popover = () => find(row(panel, 'zone'), (el) => el.className.includes('pc-form-combo-popover'));
    const options = () => all(row(panel, 'zone')).filter((el) => el.getAttribute('role') === 'option');
    const search = () => find(row(panel, 'zone'), (el) => el.getAttribute('role') === 'combobox')!;
    const win = window as unknown as { innerHeight?: number };
    const height = win.innerHeight;
    win.innerHeight = 600;
    try {
      expect(trigger.getAttribute('aria-controls')).toBeNull();
      dispatch(trigger, 'click');
      const list = find(row(panel, 'zone'), (el) => el.getAttribute('role') === 'listbox')!;
      expect(trigger.getAttribute('aria-controls')).toBe(idOf(list));

      // Rows are made once: filtering shows the same elements again.
      const b = options()[1]!;
      type(search(), 'c');
      expect(options()).toHaveLength(1);
      type(search(), '');
      expect(options()[1]).toBe(b);

      // Escape stays with the list: the dialog and anything around it do not see it.
      const outer = vi.fn();
      host.addEventListener('keydown', outer);
      key(search(), 'Escape');
      expect(outer).not.toHaveBeenCalled();
      expect(popover()).toBeUndefined();
      expect(trigger.getAttribute('aria-controls')).toBeNull();
      expect(dialog.isOpen).toBe(true);

      // Near the bottom it opens above the trigger, placed by its measured height.
      trigger.getBoundingClientRect = () => ({ left: 20, right: 260, width: 240, top: 500, bottom: 528, height: 28 }) as DOMRect;
      dispatch(trigger, 'click');
      const up = popover()!;
      (up as unknown as { offsetHeight: number }).offsetHeight = 200;
      fireWindowResize();
      expect(up.style.top).toBe(`${500 - 4 - 200}px`);
      expect(up.style.bottom ?? '').toBe('');

      // A scroll or resize (focusing the search box, an on-screen keyboard) keeps it open while the trigger shows.
      dispatch(panel, 'scroll');
      fireWindowResize();
      expect(popover()).toBe(up);
      // Scrolled out of view, it closes, giving focus back without scrolling.
      const focus = vi.spyOn(trigger, 'focus');
      trigger.getBoundingClientRect = () => ({ left: 20, right: 260, width: 240, top: -80, bottom: -52, height: 28 }) as DOMRect;
      dispatch(panel, 'scroll');
      expect(popover()).toBeUndefined();
      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    } finally {
      win.innerHeight = height;
    }
  });

  it('throws on schema mistakes', () => {
    expect(() =>
      open(
        {},
        {
          id: 'x',
          title: 'X',
          sections: [
            {
              id: 's',
              title: 'S',
              groups: [{ id: 'g', inputs: [custom({ kind: 'nope', id: 'a', label: 'A' })] }],
            },
          ],
        },
      ),
    ).toThrow('unknown kind "nope"');
  });
});

describe('custom input kinds', () => {
  const stepperSchema: FormSchema = {
    id: 'custom',
    title: 'Custom',
    sections: [
      {
        id: 's',
        title: 'S',
        groups: [
          {
            id: 'g',
            inputs: [
              custom<number>({
                kind: 'stepper',
                id: 'width',
                label: 'Width',
                default: 1,
                validate: (v) => (v > 3 ? 'Too wide.' : null),
              }),
            ],
          },
        ],
      },
    ],
  };

  function stepper(input: { label: string }, ctx: { controlId: string; value: unknown; set(value: unknown): void }) {
    let value = ctx.value as number;
    const el = document.createElement('button');
    el.id = ctx.controlId;
    el.setAttribute('aria-label', input.label);
    el.addEventListener('click', () => ctx.set(++value));
    return {
      el,
      setValue: (v: unknown) => (value = v as number),
      setDisabled: (d: boolean) => (el.disabled = d),
    };
  }

  it('renders a registered kind and validates its values', () => {
    const unregister = registerInput('stepper', stepper);
    const onChange = vi.fn();
    const { dialog, panel } = open({ onChange }, stepperSchema);
    const button = control(panel, 'width');
    dispatch(button, 'click');
    expect(onChange).toHaveBeenLastCalledWith({ width: 2 });
    dispatch(button, 'click');
    dispatch(button, 'click');
    expect(dialog.errors).toEqual({ width: 'Too wide.' });
    expect(onChange).toHaveBeenCalledTimes(2);
    dialog.close();
    unregister();
    expect(() => open({}, stepperSchema)).toThrow('unknown kind "stepper"');
  });

  it('takes renderers for one dialog through the inputs option', () => {
    const { panel } = open({ inputs: { stepper } }, stepperSchema);
    expect(control(panel, 'width').getAttribute('aria-label')).toBe('Width');
  });

  it('restores a replaced built-in kind on unregister', () => {
    const text = vi.fn(stepper);
    const unregister = registerInput('text', text);
    const s: FormSchema = {
      id: 't',
      title: 'T',
      sections: [
        {
          id: 's',
          title: 'S',
          groups: [{ id: 'g', inputs: [{ kind: 'text', id: 'a', label: 'A' }] }],
        },
      ],
    };
    open({}, s).dialog.close();
    expect(text).toHaveBeenCalledTimes(1);
    unregister();
    const { panel } = open({}, s);
    expect(control(panel, 'a').tagName).toBe('input');
    expect(text).toHaveBeenCalledTimes(1);
  });
});
