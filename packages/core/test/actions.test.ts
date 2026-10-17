import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatch, fakeContainer } from './fake-dom';
import { ActionRegistry, normalizeShortcut, shortcutCandidates, type ShortcutEvent } from '../src/actions';
import { Chart, type ChartOptionsPatch } from '../src/chart';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  if (typeof document !== 'undefined') (document as unknown as { activeElement: unknown }).activeElement = null;
});

function chart(options: ChartOptionsPatch = {}) {
  const c = new Chart(fakeContainer(), { smoothZoom: false, ...options });
  charts.push(c);
  c.addCandles().setData(Array.from({ length: 1000 }, (_, i) => ({ time: i * 60, open: 10, high: 20, low: 0, close: 10 })));
  c.invalidate();
  (c as unknown as { render(t: number): void }).render(0);
  return c;
}

const ev = (key: string, extra: Partial<ShortcutEvent> = {}): ShortcutEvent => ({
  key,
  code: '',
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...extra,
});
const press = (target: unknown, key: string, extra: Record<string, unknown> = {}) => dispatch(target, 'keydown', { key, code: '', ...extra });
const hline = (price: number) => ({ type: 'hline', pane: 0, points: [{ time: 3000, price }], style: {} });

describe('normalizeShortcut', () => {
  it('writes shortcuts in one canonical form', () => {
    expect(normalizeShortcut('shift+ctrl+z')).toBe('Ctrl+Shift+Z');
    expect(normalizeShortcut('Cmd+Option+k')).toBe('Alt+Meta+K');
    expect(normalizeShortcut('mod+s')).toBe('Mod+S');
    expect(normalizeShortcut('ctrl+left')).toBe('Ctrl+ArrowLeft');
    expect(normalizeShortcut('Esc')).toBe('Escape');
    expect(normalizeShortcut('f5')).toBe('F5');
    expect(normalizeShortcut('+')).toBe('+');
    expect(normalizeShortcut('Ctrl++')).toBe('Ctrl++');
    expect(normalizeShortcut('Ctrl+Plus')).toBe('Ctrl++');
  });

  it('rejects text that is not a shortcut', () => {
    for (const bad of ['', 'Ctrl+', 'Ctrl+Ctrl+A', 'Hyper+A', 'Mod+Ctrl+A', 'A+B', 'Ctrl+?!']) {
      expect(() => normalizeShortcut(bad), bad).toThrow(RangeError);
    }
  });
});

describe('ActionRegistry', () => {
  it('runs actions by id and reports their state', () => {
    const actions = new ActionRegistry();
    let on = false;
    const run = vi.fn(() => {
      on = !on;
    });
    actions.register({ id: 'toggle', label: 'Toggle', keys: ['T'], run, checked: () => on });
    actions.register({ id: 'never', label: () => 'Never', run: () => true, enabled: () => false });
    expect(actions.run('toggle')).toBe(true);
    expect(actions.get('toggle')).toEqual({ id: 'toggle', label: 'Toggle', enabled: true, checked: true, keys: ['T'], defaultKeys: ['T'] });
    expect(actions.get('never')).toMatchObject({ label: 'Never', enabled: false, checked: null });
    expect(actions.run('never')).toBe(false);
    expect(actions.run('missing')).toBe(false);
    expect(actions.list().map((a) => a.id)).toEqual(['toggle', 'never']);
  });

  it('refuses taken ids and removes actions again', () => {
    const actions = new ActionRegistry();
    const listener = vi.fn();
    actions.on('actions:change', listener);
    const off = actions.register({ id: 'a', label: 'A', run: () => {} });
    expect(() => actions.register({ id: 'a', label: 'A', run: () => {} })).toThrow(RangeError);
    expect(() => actions.register({ id: 'b', label: 'B', keys: ['Nope+X'], run: () => {} })).toThrow(RangeError);
    off();
    expect(actions.has('a')).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('rebinds, turns off and restores shortcuts', () => {
    const actions = new ActionRegistry();
    const run = vi.fn();
    actions.register({ id: 'save', label: 'Save', keys: ['Mod+S'], run });
    expect(actions.handleKey(ev('s', { ctrlKey: true }))).toBe(true);
    expect(actions.handleKey(ev('s', { metaKey: true }))).toBe(true);

    actions.setKeys('save', ['Alt+S', 'F2']);
    expect(actions.keys('save')).toEqual(['Alt+S', 'F2']);
    expect(actions.handleKey(ev('s', { ctrlKey: true }))).toBe(false);
    expect(actions.handleKey(ev('F2'))).toBe(true);

    actions.setKeys('save', []);
    expect(actions.handleKey(ev('F2'))).toBe(false);
    expect(actions.get('save')!.keys).toEqual([]);

    actions.setKeys('save', null);
    expect(actions.keys('save')).toEqual(['Mod+S']);
    expect(run).toHaveBeenCalledTimes(3);
    expect(() => actions.setKeys('save', ['Ctrl+'])).toThrow(RangeError);
  });

  it('saves and loads the changed shortcuts, keeping ids registered later', () => {
    const actions = new ActionRegistry();
    actions.register({ id: 'a', label: 'A', keys: ['A'], run: () => {} });
    actions.setKeys('a', ['shift+a']);
    expect(actions.keymap).toEqual({ a: ['Shift+A'] });

    const errors = actions.setKeymap({ a: ['B', 'Ctrl+'], later: ['Alt+L'], b: 'C', c: null });
    expect(errors).toEqual([
      { id: 'a', keys: 'Ctrl+', reason: 'invalid shortcut' },
      { id: 'b', keys: 'C', reason: 'not a list of shortcuts' },
    ]);
    expect(actions.keymap).toEqual({ a: ['B'], later: ['Alt+L'] });
    const run = vi.fn();
    actions.register({ id: 'later', label: 'Later', keys: ['L'], run });
    expect(actions.handleKey(ev('l', { altKey: true }))).toBe(true);
    expect(actions.handleKey(ev('l'))).toBe(false);
    expect(actions.setKeymap('nope')).toHaveLength(1);
    expect(actions.keymap).toEqual({});
  });

  it('detects conflicts, with Mod standing for Ctrl and Cmd', () => {
    const actions = new ActionRegistry();
    actions.register({ id: 'a', label: 'A', keys: ['Mod+K'], run: () => {} });
    actions.register({ id: 'b', label: 'B', keys: ['Ctrl+K'], run: () => {} });
    actions.register({ id: 'c', label: 'C', keys: ['Meta+J'], run: () => {} });
    expect(actions.conflicts()).toEqual([{ keys: 'Ctrl+K', ids: ['a', 'b'] }]);
    expect(actions.actionsFor('Mod+K')).toEqual(['a', 'b']);
    expect(actions.actionsFor('cmd+j')).toEqual(['c']);
    expect(actions.actionsFor('Alt+K')).toEqual([]);
    actions.setKeys('b', ['Ctrl+Shift+K']);
    expect(actions.conflicts()).toEqual([]);
  });

  it('runs the first enabled action on a shared shortcut, app shortcuts first', () => {
    const actions = new ActionRegistry();
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    actions.register({ id: 'first', label: '1', keys: ['X'], run: first });
    actions.register({ id: 'second', label: '2', keys: ['Y'], run: second });
    actions.setKeys('second', ['X']);
    expect(actions.match(ev('x'))).toEqual(['second', 'first']);
    actions.handleKey(ev('x'));
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    second.mockReturnValue(false);
    actions.handleKey(ev('x'));
    expect(first).toHaveBeenCalledTimes(1);
  });

  it('keeps local shortcuts to a hovered or focused chart', () => {
    const actions = new ActionRegistry();
    const run = vi.fn();
    actions.register({ id: 'local', label: 'Local', keys: ['L'], local: true, run });
    expect(actions.handleKey(ev('l'), false)).toBe(false);
    expect(actions.handleKey(ev('l'), true)).toBe(true);
  });
});

describe('layout-independent matching', () => {
  const actions = new ActionRegistry();
  for (const [id, keys] of [
    ['undo', 'Mod+Z'],
    ['reset', 'Alt+R'],
    ['one', 'Ctrl+1'],
    ['select-all', 'Ctrl+A'],
    ['quit', 'Ctrl+Q'],
    ['zoom', '+'],
    ['big', 'Shift+B'],
    ['small', 'B'],
  ] as const) {
    actions.register({ id, label: id, keys: [keys], run: () => {} });
  }
  const match = (key: string, code: string, extra: Partial<ShortcutEvent> = {}) => actions.match(ev(key, { code, ...extra }))[0] ?? null;

  it('reads letters from the physical key when the layout types another script', () => {
    expect(match('я', 'KeyZ', { ctrlKey: true })).toBe('undo');
    expect(match('z', 'KeyZ', { metaKey: true })).toBe('undo');
  });

  it('reads letters from the physical key when a modifier types a symbol', () => {
    expect(match('®', 'KeyR', { altKey: true })).toBe('reset');
    expect(match('Dead', 'KeyR', { altKey: true })).toBe('reset');
  });

  it('prefers the typed Latin letter over the physical key', () => {
    // A layout with A where another has Q.
    expect(match('a', 'KeyQ', { ctrlKey: true })).toBe('select-all');
    expect(match('q', 'KeyA', { ctrlKey: true })).toBe('quit');
  });

  it('reads digits from the digit row when it types other characters', () => {
    expect(match('&', 'Digit1', { ctrlKey: true })).toBe('one');
    expect(match('1', 'Digit1', { ctrlKey: true, shiftKey: true })).toBe('one');
  });

  it('ignores Shift unless the shortcut names it, except for letters', () => {
    expect(match('+', 'Equal', { shiftKey: true })).toBe('zoom');
    expect(match('B', 'KeyB', { shiftKey: true })).toBe('big');
    expect(match('b', 'KeyB')).toBe('small');
    expect(shortcutCandidates(ev('ArrowLeft', { shiftKey: true }))).toEqual(['Shift+ArrowLeft', 'ArrowLeft']);
    expect(shortcutCandidates(ev('A', { shiftKey: true }))).toEqual(['Shift+A']);
  });

  it('needs the exact modifiers otherwise', () => {
    expect(match('z', 'KeyZ')).toBeNull();
    expect(match('z', 'KeyZ', { ctrlKey: true, altKey: true })).toBeNull();
    expect(match('z', 'KeyZ', { ctrlKey: true, metaKey: true })).toBeNull();
  });
});

describe('chart.actions', () => {
  it('lists the built-in commands without conflicts', () => {
    const c = chart();
    const ids = c.actions.list().map((a) => a.id);
    for (const id of ['scroll-older', 'zoom-in', 'reset-view', 'crosshair-next', 'fit-content', 'auto-scale', 'delete-drawings', 'undo', 'redo', 'lock-drawings']) {
      expect(ids).toContain(id);
    }
    expect(c.actions.conflicts()).toEqual([]);
    expect(c.actions.get('zoom-in')).toMatchObject({ label: 'Zoom in', keys: ['+', '='], enabled: true, checked: null });
    expect(c.actions.get('redo')!.keys).toEqual(['Mod+Shift+Z', 'Ctrl+Y']);
  });

  it('labels follow the localization messages', () => {
    const c = chart({ localization: { messages: { actionZoomIn: 'Vergrößern' } } });
    expect(c.actions.get('zoom-in')!.label).toBe('Vergrößern');
  });

  it('runs view commands from code, within the feature flags', () => {
    const c = chart();
    const spacing = c.time.barSpacing;
    expect(c.actions.run('zoom-in')).toBe(true);
    expect(c.time.barSpacing).toBeGreaterThan(spacing);
    c.applyOptions({ features: { zoom: false } });
    expect(c.actions.get('zoom-in')!.enabled).toBe(false);
    expect(c.actions.run('zoom-out')).toBe(false);
  });

  it('reports toggles as checked', () => {
    const c = chart();
    expect(c.actions.get('lock-drawings')!.checked).toBe(false);
    c.actions.run('lock-drawings');
    expect(c.drawings.locked).toBe(true);
    expect(c.actions.get('lock-drawings')!.checked).toBe(true);
    expect(c.actions.get('auto-scale')!.checked).toBe(true);
  });

  it('follows rebound and turned-off shortcuts on the chart', () => {
    const c = chart();
    c.actions.setKeys('zoom-in', ['Z']);
    const spacing = c.time.barSpacing;
    expect(press(c.root, '+').defaultPrevented).toBe(false);
    expect(c.time.barSpacing).toBe(spacing);
    expect(press(c.root, 'z', { code: 'KeyZ' }).defaultPrevented).toBe(true);
    expect(c.time.barSpacing).toBeGreaterThan(spacing);
    c.actions.setKeys('scroll-older', []);
    expect(press(c.root, 'ArrowLeft').defaultPrevented).toBe(false);
  });

  it('runs app shortcuts, and local ones only on a hovered or focused global chart', () => {
    const c = chart({ keyboard: { scope: 'global' } });
    const save = vi.fn();
    const open = vi.fn();
    c.actions.register({ id: 'app:save', label: 'Save', keys: ['Alt+S'], run: save });
    c.actions.register({ id: 'app:open', label: 'Open', keys: ['Alt+O'], local: true, run: open });
    const outside = document.createElement('div');
    expect(press(outside, 's', { code: 'KeyS', altKey: true }).defaultPrevented).toBe(true);
    press(outside, 'o', { code: 'KeyO', altKey: true });
    expect(save).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    (document as unknown as { activeElement: unknown }).activeElement = c.root;
    press(c.root, 'o', { code: 'KeyO', altKey: true });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('keeps the default drawing keys: Delete, copy, paste, undo and redo', async () => {
    const c = chart();
    expect(press(c.root, 'z', { ctrlKey: true }).defaultPrevented).toBe(false);
    const a = c.drawings.add(hline(5));
    c.drawings.add(hline(6));
    // Nothing selected: copy, paste and Delete are left to the page.
    expect(press(c.root, 'c', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press(c.root, 'v', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press(c.root, 'Delete').defaultPrevented).toBe(false);

    expect(press(c.root, 'z', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(c.drawings.getAll()).toHaveLength(1);
    expect(press(c.root, 'z', { metaKey: true }).defaultPrevented).toBe(true);
    expect(c.drawings.getAll()).toHaveLength(0);
    expect(press(c.root, 'Z', { metaKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(c.drawings.getAll()).toHaveLength(1);
    expect(press(c.root, 'y', { metaKey: true }).defaultPrevented).toBe(false);
    expect(press(c.root, 'y', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(c.drawings.getAll()).toHaveLength(2);

    c.drawings.setSelection([a.id]);
    // Copy and paste leave the key's default to fire the clipboard events; without one, paste runs a task later.
    expect(press(c.root, 'c', { metaKey: true }).defaultPrevented).toBe(false);
    expect(press(c.root, 'v', { ctrlKey: true }).defaultPrevented).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(c.drawings.getAll()).toHaveLength(3);
    expect(press(c.root, 'Backspace').defaultPrevented).toBe(true);
    expect(c.drawings.getAll()).toHaveLength(2);
    c.drawings.setLocked(true);
    expect(press(c.root, 'v', { ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it('lets an app rebind undo', () => {
    const c = chart();
    c.drawings.add(hline(5));
    c.actions.setKeys('undo', ['Alt+Backspace']);
    expect(press(c.root, 'z', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press(c.root, 'Backspace', { altKey: true }).defaultPrevented).toBe(true);
    expect(c.drawings.getAll()).toHaveLength(0);
  });
});
