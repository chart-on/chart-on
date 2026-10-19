// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChart, type Chart } from '@chart-on/core';
import { fakeWebgl2 } from '../../core/src/testing/environment';
import { createChartSettings, type ChartSettingsStorage } from '../src/chart-settings';
import { createShortcutSettings, isReservedShortcut, recordedShortcut, type ShortcutSettingsOptions } from '../src/shortcut-settings';

/** A Canvas2D context whose every call does nothing and returns something callable. */
function context2d(): unknown {
  const sink: unknown = new Proxy(() => sink, {
    get: (_t, key) => (key === 'measureText' ? (text: string) => ({ width: text.length * 6 }) : key === Symbol.toPrimitive ? () => 0 : sink),
    set: () => true,
    apply: () => sink,
  });
  return sink;
}

const memory = (initial: Record<string, unknown> | null = null) => {
  let data = initial;
  const storage: ChartSettingsStorage & { data: () => typeof data } = {
    load: () => data,
    save: vi.fn((values) => (data = values)),
    data: () => data,
  };
  return storage;
};

// Charts are slow to build when the machine is busy.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let container: HTMLElement;
let chart: Chart;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((type: string) =>
    type === 'webgl2' ? fakeWebgl2() : context2d()) as never);
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal('matchMedia', (query: string) => ({ media: query, matches: true, addEventListener() {}, removeEventListener() {} }));
  container = document.createElement('div');
  document.body.append(container);
  chart = createChart(container);
  chart.actions.register({ id: 'app-alpha', label: 'Alpha', keys: ['A'], run: () => {} });
  chart.actions.register({ id: 'app-beta', label: 'Beta', keys: ['B'], run: () => {} });
});

afterEach(() => {
  chart.destroy();
  container.remove();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

const open = (options: ShortcutSettingsOptions = {}) => {
  const storage = memory();
  const handle = createShortcutSettings(chart, container, { storage, ...options });
  handle.open();
  return { handle, storage };
};
const byKey = (key: string) => container.querySelector<HTMLButtonElement>(`.pc-shortcuts [data-key="${key}"]`);
const recorder = () => byKey('recording');
const status = () => container.querySelector('.pc-shortcuts [role="status"]')!.textContent;
const confirmation = () => container.querySelector<HTMLElement>('[role="alertdialog"]');
const press = (target: Element, key: string, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));

describe('recordedShortcut', () => {
  const ev = (key: string, init: Partial<KeyboardEvent> = {}) => ({ key, code: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...init });

  it('writes Ctrl (or Cmd on Apple) as Mod and canonicalizes the rest', () => {
    expect(recordedShortcut(ev('z', { ctrlKey: true }), false)).toBe('Mod+Z');
    expect(recordedShortcut(ev('z', { metaKey: true }), true)).toBe('Mod+Z');
    expect(recordedShortcut(ev('z', { metaKey: true }), false)).toBe('Meta+Z');
    expect(recordedShortcut(ev('Z', { shiftKey: true, ctrlKey: true }), false)).toBe('Mod+Shift+Z');
    expect(recordedShortcut(ev('ArrowLeft', { altKey: true }), false)).toBe('Alt+ArrowLeft');
    expect(recordedShortcut(ev(' '), false)).toBe('Space');
  });

  it('waits for a key while only modifiers are held', () => {
    for (const key of ['Shift', 'Control', 'Alt', 'Meta', 'Dead']) expect(recordedShortcut(ev(key))).toBeNull();
  });

  it('reads letters from the physical key under modifiers, and keeps the typed character otherwise', () => {
    expect(recordedShortcut(ev('®', { altKey: true, code: 'KeyR' }), false)).toBe('Alt+R');
    expect(recordedShortcut(ev('?', { shiftKey: true, code: 'Slash' }), false)).toBe('?');
  });
});

describe('isReservedShortcut', () => {
  it('refuses the browser and system combinations under Ctrl and Cmd', () => {
    for (const keys of ['Mod+W', 'Ctrl+T', 'Meta+N', 'Mod+Q', 'Mod+Tab', 'Mod+L', 'Alt+F4']) expect(isReservedShortcut(keys)).toBe(true);
    for (const keys of ['Mod+Z', 'W', 'Alt+W', 'Shift+T']) expect(isReservedShortcut(keys)).toBe(false);
  });
});

describe('createShortcutSettings', () => {
  it('lists every action with its shortcuts, grouped', () => {
    open();
    const labels = [...container.querySelectorAll('.pc-shortcut-label')].map((el) => el.textContent);
    for (const action of chart.actions.list()) expect(labels).toContain(action.label);
    expect([...container.querySelectorAll('.pc-shortcut-heading')].map((el) => el.textContent)).toContain('General');
    // The chart's own editing actions are not filed under General with the app's.
    const editing = [...container.querySelectorAll('.pc-shortcut-group')].find((s) => s.querySelector('h3')?.textContent === 'Editing');
    for (const id of ['copy', 'cut', 'paste']) expect(editing?.querySelector(`[data-key="${id}:add"]`)).not.toBeNull();
    expect(byKey('app-alpha:0')!.textContent).toBe('A');
    expect(byKey('app-alpha:0')!.getAttribute('aria-label')).toBe('Change A of Alpha');
  });

  it('records an added shortcut, applies it at once, announces and saves it', async () => {
    const { storage } = open();
    byKey('app-alpha:add')!.click();
    expect(document.activeElement).toBe(recorder());
    expect(status()).toContain('Alpha');
    press(recorder()!, 'Shift');
    expect(recorder()).not.toBeNull();
    press(recorder()!, 'x');
    await flush();
    expect(chart.actions.keys('app-alpha')).toEqual(['A', 'X']);
    expect(recorder()).toBeNull();
    expect(status()).toBe('Alpha: X');
    expect(storage.data()).toEqual({ 'app-alpha': ['A', 'X'] });
    expect(document.activeElement).toBe(byKey('app-alpha:1'));
  });

  it('replaces the pressed shortcut', () => {
    open();
    byKey('app-alpha:0')!.click();
    press(recorder()!, 'q');
    expect(chart.actions.keys('app-alpha')).toEqual(['Q']);
  });

  it('cancels recording on Escape without closing the dialog', () => {
    const { handle } = open();
    byKey('app-alpha:0')!.click();
    press(recorder()!, 'Escape');
    expect(handle.isOpen).toBe(true);
    expect(recorder()).toBeNull();
    expect(chart.actions.keys('app-alpha')).toEqual(['A']);
    expect(status()).toBe('Shortcut not changed.');
  });

  it('refuses reserved combinations with a message and keeps recording', () => {
    open();
    byKey('app-alpha:add')!.click();
    press(recorder()!, 'w', { ctrlKey: true, code: 'KeyW' });
    expect(status()).toContain('The browser or system keeps');
    expect(recorder()).not.toBeNull();
    expect(chart.actions.keys('app-alpha')).toEqual(['A']);
  });

  it('asks before taking a shortcut from another action: Cancel keeps both', async () => {
    const { storage } = open();
    byKey('app-alpha:add')!.click();
    press(recorder()!, 'b');
    expect(confirmation()!.textContent).toContain('B already runs Beta. Move it to Alpha?');
    confirmation()!.querySelector<HTMLButtonElement>('.pc-btn--ghost')!.click();
    await flush();
    expect(chart.actions.keys('app-alpha')).toEqual(['A']);
    expect(chart.actions.keys('app-beta')).toEqual(['B']);
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('asks before taking a shortcut from another action: Reassign moves it', async () => {
    const { storage } = open();
    byKey('app-alpha:add')!.click();
    press(recorder()!, 'b');
    confirmation()!.querySelector<HTMLButtonElement>('.pc-btn--primary')!.click();
    await flush();
    expect(chart.actions.keys('app-alpha')).toEqual(['A', 'B']);
    expect(chart.actions.keys('app-beta')).toEqual([]);
    expect(chart.actions.conflicts()).toEqual([]);
    expect(storage.data()).toEqual({ 'app-alpha': ['A', 'B'], 'app-beta': [] });
  });

  it('removes a shortcut, resets one action and resets all', async () => {
    const { storage } = open();
    byKey('app-alpha:0:remove')!.click();
    expect(chart.actions.keys('app-alpha')).toEqual([]);
    expect(container.querySelector('.pc-shortcut-none')).not.toBeNull();
    byKey('app-beta:0')!.click();
    press(recorder()!, 'c');
    expect(byKey('app-alpha:reset')!.disabled).toBe(false);
    byKey('app-alpha:reset')!.click();
    await flush();
    expect(chart.actions.keys('app-alpha')).toEqual(['A']);
    expect(chart.actions.keys('app-beta')).toEqual(['C']);
    expect(byKey('app-alpha:reset')!.disabled).toBe(true);
    [...container.querySelectorAll<HTMLButtonElement>('.pc-shortcuts .pc-btn')].find((b) => b.textContent === 'Reset all')!.click();
    expect(chart.actions.keys('app-beta')).toEqual(['B']);
    expect(storage.data()).toEqual({});
  });

  it('restores saved shortcuts on top of the app keymap, unless they now clash', () => {
    chart.actions.setKeys('app-beta', ['Shift+B']);
    createShortcutSettings(chart, container, { storage: memory({ 'app-alpha': ['Q'] }) });
    expect(chart.actions.keys('app-alpha')).toEqual(['Q']);
    expect(chart.actions.keys('app-beta')).toEqual(['Shift+B']);
    chart.actions.setKeymap({ 'app-alpha': ['Q'] });
    createShortcutSettings(chart, container, { storage: memory({ 'app-beta': ['Q'] }) });
    expect(chart.actions.keys('app-beta')).toEqual(['B']);
    expect(chart.actions.conflicts()).toEqual([]);
  });

  it('saves to localStorage by default', () => {
    open({ storage: undefined, storageKey: 'test:keys' });
    byKey('app-alpha:0')!.click();
    press(recorder()!, 'q');
    expect(JSON.parse(localStorage.getItem('test:keys')!)).toEqual({ 'app-alpha': ['Q'] });
  });

  it('adds a button to the chart settings while it exists', () => {
    chart.addCandles({ title: 'ABC' }).setData([{ time: 0, open: 1, high: 2, low: 0.5, close: 1.5 }]);
    const settings = createChartSettings(chart, container, { storage: null });
    const shortcutsButton = () => container.querySelector<HTMLButtonElement>('[data-action="shortcuts"]');
    settings.open();
    expect(shortcutsButton()).toBeNull();
    settings.close();
    const shortcuts = createShortcutSettings(chart, container, { storage: null });
    settings.open();
    shortcutsButton()!.click();
    expect(shortcuts.isOpen).toBe(true);
    shortcuts.destroy();
    settings.close();
    settings.open();
    expect(shortcutsButton()).toBeNull();
  });
});
