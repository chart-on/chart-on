// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChart, createLocalStorageAdapter, type Chart, type StorageAdapter, type TemplateKind } from '@charton/core';
import { builtinIndicators } from '@charton/indicators';
import { fakeWebgl2 } from '../../core/src/testing/environment';
import {
  createIndicatorTemplates,
  indicatorTemplatesOf,
  indicatorTemplatesToolbarItem,
  registerIndicatorTemplates,
  type IndicatorTemplatesOptions,
} from '../src/indicator-templates';

/** A Canvas2D context whose every call does nothing and returns something callable. */
function context2d(): unknown {
  const sink: unknown = new Proxy(() => sink, {
    get: (_t, key) => (key === 'measureText' ? (text: string) => ({ width: text.length * 6 }) : key === Symbol.toPrimitive ? () => 0 : sink),
    set: () => true,
    apply: () => sink,
  });
  return sink;
}

/** A template store kept in a map, recording every call the UI makes. */
function fakeStorage(): StorageAdapter & { calls: string[]; store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  const calls: string[] = [];
  return {
    calls,
    store,
    async listTemplates(kind: TemplateKind) {
      calls.push(`list ${kind}`);
      return [...store.keys()];
    },
    async loadTemplate(kind: TemplateKind, name: string) {
      calls.push(`load ${kind} ${name}`);
      return store.get(name) ?? null;
    },
    async saveTemplate(kind: TemplateKind, name: string, content: unknown) {
      calls.push(`save ${kind} ${name}`);
      store.set(name, JSON.parse(JSON.stringify(content)));
    },
    async removeTemplate(kind: TemplateKind, name: string) {
      calls.push(`remove ${kind} ${name}`);
      store.delete(name);
    },
  };
}

let container: HTMLElement;
let chart: Chart;
let notices: { message: string; kind: string }[];

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
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
  container = document.createElement('div');
  document.body.append(container);
  chart = createChart(container);
  for (const def of builtinIndicators) chart.indicators.register(def);
  notices = [];
  chart.on('ui:notify', ({ message, kind }) => notices.push({ message, kind }));
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
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const templates = (options: IndicatorTemplatesOptions = {}) => createIndicatorTemplates(chart, { storage: fakeStorage(), ...options });
const rows = () => [...container.querySelectorAll<HTMLElement>('.pc-picker [role="option"]')];
const row = (name: string) => rows().find((o) => o.querySelector('.pc-picker-label')?.textContent === name);
const names = () => rows().map((o) => o.querySelector('.pc-picker-label')!.textContent);
const tabs = () => [...container.querySelectorAll<HTMLElement>('.pc-picker [role="tab"]')].map((t) => t.textContent);
const action = (name: string, id: string) => row(name)?.parentElement?.querySelector<HTMLButtonElement>(`[data-action="${id}"]`) ?? null;
const confirmation = () => container.querySelector<HTMLElement>('[role="alertdialog"]');
const types = () => chart.indicators.getAll().map((i) => i.type);

async function saveAs(name: string): Promise<void> {
  await flush();
  const input = container.querySelector<HTMLInputElement>('.pc-dialog input[type="text"]')!;
  input.value = name;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  container.querySelector<HTMLButtonElement>('[data-action="ok"]')!.click();
  await flush();
}

describe('indicator templates', () => {
  it('saves the chart indicators through a custom adapter and lists them under My templates', async () => {
    const storage = fakeStorage();
    const handle = templates({ storage });
    chart.indicators.add('sma', { length: 20 });
    chart.indicators.add('rsi');
    handle.save();
    await saveAs('Mine');
    expect(storage.calls).toContain('save indicator-set Mine');
    const saved = storage.store.get('Mine') as { indicators: { type: string; pane: number }[] };
    expect(saved.indicators.map((i) => [i.type, i.pane])).toEqual([
      ['sma', 0],
      ['rsi', 1],
    ]);
    expect(notices.at(-1)).toEqual({ message: 'Saved template Mine', kind: 'success' });

    handle.open();
    await flush();
    expect(storage.calls).toContain('load indicator-set Mine');
    expect(tabs()).toEqual(['All', 'My templates', 'Technicals']);
    expect(names()).toEqual(['Mine', 'Trend', 'Momentum', 'Volatility', 'Volume']);
    // One-line summary, grouped by pane.
    expect(row('Mine')!.textContent).toContain('SMA 20 · RSI 14');
  });

  it('refuses a name that is taken', async () => {
    const storage = fakeStorage();
    storage.store.set('Mine', { version: 1, indicators: [] });
    const handle = templates({ storage });
    chart.indicators.add('sma');
    handle.save();
    await saveAs('Mine');
    expect(storage.calls).not.toContain('save indicator-set Mine');
    expect(notices.at(-1)).toEqual({ message: 'A template has this name already.', kind: 'error' });
  });

  it('saves to localStorage by default, so templates survive a reload', async () => {
    const handle = createIndicatorTemplates(chart);
    chart.indicators.add('ema');
    handle.save();
    await saveAs('Kept');
    expect(await createLocalStorageAdapter().listTemplates('indicator-set')).toEqual(['Kept']);
  });

  it('refuses a name another tab saved while the prompt was open, ignoring case', async () => {
    const storage = fakeStorage();
    const handle = templates({ storage });
    chart.indicators.add('sma');
    handle.save();
    await flush();
    storage.store.set('mine', { version: 1, indicators: [] });
    await saveAs('Mine');
    expect(storage.calls).not.toContain('save indicator-set Mine');
    expect(notices.at(-1)).toEqual({ message: 'A template has this name already.', kind: 'error' });
  });

  it('applies a built-in preset on a fresh chart when picked, and cannot delete it', async () => {
    const handle = templates();
    handle.open();
    await flush();
    expect(action('Trend', 'delete')).toBeNull();
    expect(action('Trend', 'rename')).toBeNull();
    row('Trend')!.click();
    expect(handle.isOpen).toBe(false);
    expect(types()).toEqual(['sma', 'sma', 'dmi']);
    expect(notices.at(-1)).toEqual({ message: 'Applied Trend', kind: 'success' });
  });

  it('replaces the indicators and their panes when picked', async () => {
    chart.indicators.add('ema');
    chart.indicators.add('atr');
    const handle = templates();
    handle.open();
    await flush();
    row('Momentum')!.click();
    expect(types()).toEqual(['rsi', 'macd']);
    expect(chart.panes.length).toBe(3);
    expect(notices.at(-1)).toEqual({ message: 'Applied Momentum', kind: 'success' });
    // Applying it again leaves the chart as it is, without duplicates.
    handle.open();
    await flush();
    row('Momentum')!.click();
    expect(types()).toEqual(['rsi', 'macd']);
    expect(chart.panes.length).toBe(3);
  });

  it('adds through the row button and reports what it left out', async () => {
    chart.indicators.add('rsi');
    const handle = templates();
    handle.open();
    await flush();
    const add = action('Momentum', 'add')!;
    expect(add.getAttribute('aria-label')).toBe('Add to chart');
    add.click();
    expect(handle.isOpen).toBe(false);
    expect(types()).toEqual(['rsi', 'macd']);
    expect(notices.at(-1)!.message).toBe('Applied Momentum, left out: rsi (already added)');
    handle.open();
    await flush();
    action('Volatility', 'add')!.click();
    expect(types()).toEqual(['rsi', 'macd', 'bbands', 'atr']);
  });

  it('lists a registered collection in its own category, disabling templates with unknown indicators', async () => {
    const off = registerIndicatorTemplates(
      chart,
      [
        { name: 'Fast', set: { version: 1, indicators: [{ type: 'ema', inputs: { length: 9 }, pane: 0, visible: true }] } },
        { name: 'Exotic', set: { version: 1, indicators: [{ type: 'pkg/unknown', inputs: {}, pane: 1, visible: true }] } },
      ],
      { category: 'Community pack' },
    );
    const handle = templates({ storage: null });
    handle.open();
    await flush();
    expect(tabs()).toEqual(['All', 'Technicals', 'Community pack']);
    const tab = [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === 'Community pack')!;
    tab.click();
    await flush();
    expect(names()).toEqual(['Fast', 'Exotic']);
    expect(row('Exotic')!.getAttribute('aria-disabled')).toBe('true');
    expect(row('Exotic')!.textContent).toContain('Missing: pkg/unknown');
    row('Exotic')!.click();
    expect(types()).toEqual([]);

    // Unregistering while the dialog is open lists it again without the collection.
    off();
    await flush();
    expect(handle.isOpen).toBe(true);
    expect(tabs()).toEqual(['All', 'Technicals']);
    expect(names()).not.toContain('Fast');
  });

  it('keeps rows apart when names repeat across sources', async () => {
    registerIndicatorTemplates(chart, [{ name: 'Trend', set: { version: 1, indicators: [{ type: 'ema', inputs: {}, pane: 0, visible: true }] } }], {
      category: 'Pack',
    });
    const handle = templates();
    handle.open();
    await flush();
    const ids = rows().map((o) => o.getAttribute('data-id'));
    expect(new Set(ids).size).toBe(ids.length);
    rows().filter((o) => o.querySelector('.pc-picker-label')!.textContent === 'Trend')[1]!.click();
    expect(types()).toEqual(['ema']);
  });

  it('searches across every category', async () => {
    const storage = fakeStorage();
    storage.store.set('Momentum scalp', { version: 1, indicators: [{ type: 'rsi', inputs: { length: 7 }, pane: 1, visible: true }] });
    const handle = templates({ storage });
    handle.open();
    await flush();
    const input = container.querySelector<HTMLInputElement>('.pc-picker input')!;
    input.value = 'momentum';
    input.dispatchEvent(new Event('input'));
    await flush();
    expect(names().sort()).toEqual(['Momentum', 'Momentum scalp']);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    // Enter adds the highlighted row: the best match.
    expect(types()).toEqual(['rsi', 'macd']);
  });

  it('shows the interval scope and renames and deletes user templates', async () => {
    const storage = fakeStorage();
    storage.store.set('Scalp', {
      version: 1,
      indicators: [{ type: 'rsi', inputs: {}, pane: 1, visible: true }],
      appliesOn: [{ from: '1m', to: '15m' }],
    });
    const handle = templates({ storage });
    handle.open();
    await flush();
    expect(row('Scalp')!.textContent).toContain('RSI 14 · for 1m–15m');

    action('Scalp', 'rename')!.click();
    await saveAs('Quick');
    expect(storage.calls).toEqual(expect.arrayContaining(['save indicator-set Quick', 'remove indicator-set Scalp']));
    await flush();
    expect(handle.isOpen).toBe(true);
    expect(names()).toContain('Quick');

    // Delete asks first.
    action('Quick', 'delete')!.click();
    await flush();
    expect(storage.store.has('Quick')).toBe(true);
    confirmation()!.querySelector<HTMLButtonElement>('.pc-btn--danger')!.click();
    await flush();
    expect([...storage.store.keys()]).toEqual([]);
    expect(confirmation()).toBeNull();
    expect(handle.isOpen).toBe(true);
    expect(names()).not.toContain('Quick');
  });

  it('asks before deleting, in a confirmation that dismisses alone', async () => {
    const storage = fakeStorage();
    storage.store.set('Scalp', { version: 1, indicators: [{ type: 'rsi', inputs: {}, pane: 1, visible: true }] });
    const handle = templates({ storage });
    handle.open();
    await flush();
    const ask = async () => {
      const trash = action('Scalp', 'delete')!;
      trash.focus();
      trash.click();
      await flush();
      return { trash, panel: confirmation()! };
    };

    let { trash, panel } = await ask();
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(panel.getAttribute('aria-labelledby')!)!.textContent).toBe('Delete template?');
    expect(document.getElementById(panel.getAttribute('aria-describedby')!)!.textContent).toContain('“Scalp”');
    const buttons = [...panel.querySelectorAll<HTMLButtonElement>('.pc-dialog-actions button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Cancel', 'Delete']);
    expect(buttons[1]!.classList.contains('pc-btn--danger')).toBe(true);
    // Cancel is focused, and focus stays in the confirmation rather than the list below it.
    expect(document.activeElement).toBe(buttons[0]);
    trash.focus();
    expect(panel.contains(document.activeElement)).toBe(true);

    buttons[0]!.click();
    expect(confirmation()).toBeNull();
    expect(document.activeElement).toBe(trash);

    ({ trash, panel } = await ask());
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(confirmation()).toBeNull();
    expect(document.activeElement).toBe(trash);

    // A press on the backdrop dismisses the confirmation, not the list under it.
    ({ trash, panel } = await ask());
    panel.parentElement!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(confirmation()).toBeNull();

    await flush();
    expect(handle.isOpen).toBe(true);
    expect(storage.store.has('Scalp')).toBe(true);
    expect(storage.calls.some((c) => c.startsWith('remove'))).toBe(false);

    // Destroying the handle dismisses an open confirmation.
    await ask();
    handle.destroy();
    expect(confirmation()).toBeNull();
  });

  it('keeps one template under the new name after a case-only rename, whether the store matches names exactly or without case', async () => {
    const exact = fakeStorage();
    // Matches names without case: one entry per folded name, listed under the name of its latest save.
    const folded = fakeStorage();
    const key = (name: string) => [...folded.store.keys()].find((n) => n.toLowerCase() === name.toLowerCase());
    folded.saveTemplate = async (_kind, name, content) => {
      folded.calls.push(`save ${name}`);
      folded.store.delete(key(name)!);
      folded.store.set(name, content);
    };
    folded.removeTemplate = async (_kind, name) => {
      folded.calls.push(`remove ${name}`);
      folded.store.delete(key(name)!);
    };
    for (const storage of [exact, folded]) {
      const set = { version: 1, indicators: [{ type: 'rsi', inputs: {}, pane: 1, visible: true }] };
      storage.store.set('Scalp', set);
      const handle = templates({ storage });
      handle.open();
      await flush();
      action('Scalp', 'rename')!.click();
      await saveAs('scalp');
      await flush();
      expect([...storage.store]).toEqual([['scalp', set]]);
      handle.destroy();
    }
    expect(folded.calls).not.toContain('remove Scalp');
  });

  it('keeps the old copy and says so when a rename cannot remove it', async () => {
    const storage = fakeStorage();
    storage.store.set('Old', { version: 1, indicators: [{ type: 'rsi', inputs: {}, pane: 1, visible: true }] });
    storage.removeTemplate = async () => {
      throw new Error('offline');
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const handle = templates({ storage });
    handle.open();
    await flush();
    action('Old', 'rename')!.click();
    await saveAs('New');
    await flush();
    expect(notices.at(-1)).toEqual({ message: 'Saved as New; old copy kept', kind: 'error' });
    expect(handle.isOpen).toBe(true);
    expect(names()).toEqual(expect.arrayContaining(['Old', 'New']));
  });

  it('reports a failing adapter and loads again on Retry', async () => {
    const storage = fakeStorage();
    const list = storage.listTemplates!;
    storage.listTemplates = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(list);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handle = templates({ storage });
    handle.open();
    await flush();
    expect(notices.at(-1)).toEqual({ message: 'Template storage failed', kind: 'error' });
    expect(error).toHaveBeenCalled();
    expect(rows()).toEqual([]);
    [...container.querySelectorAll<HTMLButtonElement>('.pc-picker button')].find((b) => b.textContent === 'Retry')!.click();
    await flush();
    expect(names()).toContain('Trend');
  });

  it('lists an unreadable or malformed template as invalid without losing the others, and keeps it deletable', async () => {
    const storage = fakeStorage();
    storage.store.set('Broken', 'x');
    storage.store.set('Odd', {
      version: 1,
      indicators: [{ type: 'sma', inputs: { length: 'many' }, pane: 0, visible: true }],
      appliesOn: [null, 5, { from: 'soon', to: '1h' }, { from: '1h', to: '4h' }],
    });
    storage.store.set('Fails', {});
    const load = storage.loadTemplate!;
    storage.loadTemplate = (kind, name) => (name === 'Fails' ? Promise.reject(new Error('gone')) : load(kind, name));
    const handle = templates({ storage });
    handle.open();
    await flush();
    expect(names()).toEqual(['Broken', 'Odd', 'Fails', 'Trend', 'Momentum', 'Volatility', 'Volume']);
    for (const name of ['Broken', 'Fails']) {
      expect(row(name)!.getAttribute('aria-disabled')).toBe('true');
      expect(row(name)!.textContent).toContain('Not a valid template');
      expect(action(name, 'delete')).not.toBeNull();
    }
    // A non-number input shows the default; only valid ranges are shown.
    expect(row('Odd')!.textContent).toContain('SMA 20 · for 1h–4h');
  });

  it('does nothing after destroy, also for work still in flight', async () => {
    const storage = fakeStorage();
    let release: (names: string[]) => void = () => {};
    storage.listTemplates = () => new Promise((resolve) => (release = resolve));
    const handle = templates({ storage });
    chart.indicators.add('sma');
    handle.save();
    handle.destroy();
    release([]);
    await flush();
    expect(container.querySelector('.pc-form-dialog')).toBeNull();
    handle.open();
    expect(handle.isOpen).toBe(false);
  });

  it('is destroyed with its chart', async () => {
    const handle = templates();
    handle.open();
    await flush();
    chart.destroy();
    expect(handle.isOpen).toBe(false);
    expect(indicatorTemplatesOf(chart)).toBeUndefined();
  });

  it('follows the chart language', async () => {
    chart.applyOptions({ localization: { messages: { templatesMine: 'Meine Vorlagen', templatesTrend: 'Trendfolge' } } });
    const handle = templates();
    handle.open();
    await flush();
    expect(tabs()).toContain('Meine Vorlagen');
    expect(names()).toContain('Trendfolge');
  });

  it('opens from the toolbar menu', async () => {
    const handle = templates();
    indicatorTemplatesToolbarItem().onSelect('open', chart);
    await flush();
    expect(handle.isOpen).toBe(true);
    handle.destroy();
    expect(handle.isOpen).toBe(false);
  });
});

describe('indicator templates language', () => {
  it('shows the name prompt and the template list in the chart language', async () => {
    chart.applyOptions({ localization: { messages: { dialogClose: 'Schließen', dialogSearch: 'Suchen', formRequired: 'Pflichtfeld.' } } });
    const handle = templates();
    chart.indicators.add('sma');
    handle.save();
    await flush();
    expect(container.querySelector('.pc-dialog [aria-label="Schließen"]')).not.toBeNull();
    const input = container.querySelector<HTMLInputElement>('.pc-dialog input[type="text"]')!;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    container.querySelector<HTMLButtonElement>('[data-action="ok"]')!.click();
    expect(container.querySelector('.pc-dialog')!.textContent).toContain('Pflichtfeld.');
    container.querySelector<HTMLButtonElement>('[data-action="cancel"]')!.click();

    handle.open();
    await flush();
    expect(container.querySelector('.pc-picker [aria-label="Schließen"]')).not.toBeNull();
    handle.destroy();
  });
});
