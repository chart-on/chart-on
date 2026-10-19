// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChart, type Chart, type IndicatorDef, type StorageAdapter, type TemplateKind } from '@chart-on/core';
import { fakeWebgl2 } from '../../core/src/testing/environment';
import type { CommandEntry } from '../src/command-palette-model';
import { openDrawingSettings } from '../src/drawing-settings';
import { createIndicatorPicker, type IndicatorPickerOptions } from '../src/indicator-picker';
import { openIndicatorSettings } from '../src/indicator-settings';
import { drawingTemplates, indicatorDefaults, indicatorTemplates } from '../src/templates';

/** A Canvas2D context whose every call does nothing and returns something callable. */
function context2d(): unknown {
  const sink: unknown = new Proxy(() => sink, {
    get: (_t, key) => (key === 'measureText' ? (text: string) => ({ width: text.length * 6 }) : key === Symbol.toPrimitive ? () => 0 : sink),
    set: () => true,
    apply: () => sink,
  });
  return sink;
}

/** A template store kept in a map by scope and name, recording every call the dialog makes. */
function fakeStorage(): StorageAdapter & { calls: string[]; store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  const calls: string[] = [];
  return {
    calls,
    store,
    async listTemplates(kind: TemplateKind, scope?: string) {
      calls.push(`list ${kind} ${scope}`);
      return [...store.keys()].filter((k) => k.startsWith(`${scope}/`)).map((k) => k.slice(String(scope).length + 1));
    },
    async loadTemplate(kind: TemplateKind, name: string, scope?: string) {
      calls.push(`load ${kind} ${scope} ${name}`);
      return store.get(`${scope}/${name}`) ?? null;
    },
    async saveTemplate(kind: TemplateKind, name: string, content: unknown, scope?: string) {
      calls.push(`save ${kind} ${scope} ${name}`);
      store.set(`${scope}/${name}`, JSON.parse(JSON.stringify(content)));
    },
    async removeTemplate(kind: TemplateKind, name: string, scope?: string) {
      calls.push(`remove ${kind} ${scope} ${name}`);
      store.delete(`${scope}/${name}`);
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
  chart.addCandles().setData(Array.from({ length: 50 }, (_, i) => ({ time: i * 60, open: 10, high: 11, low: 9, close: 10 })));
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

const line = (style = {}) =>
  chart.drawings.add({ type: 'trendline', pane: 0, points: [{ time: 600, price: 10 }, { time: 1200, price: 10.5 }], style });
const open = (id: string, storage?: StorageAdapter) => openDrawingSettings(chart, container, id, { headerControl: drawingTemplates({ storage }) })!;
const trigger = () => container.querySelector<HTMLButtonElement>('.pc-dialog-header [aria-label="Template"]');
/** The menu's items as `section: label`, opening it first. */
function items(): string[] {
  if (!container.querySelector('.pc-dialog-header .pc-popover')) trigger()!.click();
  return [...container.querySelectorAll<HTMLElement>('.pc-dialog-header .pc-popover > *')].map((el) => el.textContent!);
}
/** Click the n-th menu item labelled `label` (a name is listed under Apply, then under Delete). */
function pick(label: string, nth = 0): void {
  items();
  const matches = [...container.querySelectorAll<HTMLElement>('.pc-dialog-header .pc-popover-item')].filter((el) => el.textContent === label);
  matches[nth]!.click();
}
async function saveAs(name: string): Promise<void> {
  pick('Save as template…');
  await flush();
  const input = container.querySelector<HTMLInputElement>('[data-form="template-name"] input[type="text"]')!;
  input.value = name;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  container.querySelector<HTMLButtonElement>('[data-form="template-name"] [data-action="ok"]')!.click();
  await flush();
}

describe('drawing style templates', () => {
  it("saves the dialog's style fields as a template of the tool and lists it", async () => {
    const storage = fakeStorage();
    const d = line({ color: '#ff0000', lineWidth: 3 });
    open(d.id, storage);
    await flush();
    expect(items()).toEqual(['Save as template…']);
    await saveAs('Wide red');
    expect(storage.calls).toContain('save drawing trendline Wide red');
    expect(storage.store.get('trendline/Wide red')).toEqual({ color: '#ff0000', lineWidth: 3, lineStyle: 'solid', extendLeft: false, extendRight: false });
    expect(notices.at(-1)).toEqual({ message: 'Saved template Wide red', kind: 'success' });
    expect(items()).toEqual(['Save as template…', 'Apply template', 'Wide red', 'Delete', 'Wide red']);

    // Names compare without case.
    await saveAs('wide RED');
    expect(storage.calls).not.toContain('save drawing trendline wide RED');
    expect(notices.at(-1)).toEqual({ message: 'A template has this name already.', kind: 'error' });
  });

  it('applies a template as a preview: Ok commits it as one undo step, Cancel drops it', async () => {
    const storage = fakeStorage();
    storage.store.set('trendline/Dashed', { lineStyle: 'dashed', lineWidth: 4, color: 7, bogus: true });
    const d = line({ color: '#ff0000' });
    const changes = vi.fn();
    chart.on('drawings:change', changes);

    const dialog = open(d.id, storage);
    await flush();
    pick('Dashed');
    await flush();
    expect(storage.calls).toContain('load drawing trendline Dashed');
    // Only fields the form shows, with a value of the same type.
    expect(chart.drawings.getById(d.id)!.style).toEqual({ color: '#ff0000', lineStyle: 'dashed', lineWidth: 4 });
    expect(dialog.values).toMatchObject({ lineStyle: 'dashed', lineWidth: 4, color: '#ff0000' });
    dialog.cancel();
    expect(chart.drawings.getById(d.id)!.style).toEqual({ color: '#ff0000' });
    expect(changes).not.toHaveBeenCalled();

    const again = open(d.id, storage);
    await flush();
    pick('Dashed');
    await flush();
    again.submit();
    expect(changes).toHaveBeenCalledTimes(1);
    expect(chart.drawings.getById(d.id)!.style).toEqual({ color: '#ff0000', lineStyle: 'dashed', lineWidth: 4 });
    chart.history.undo();
    expect(chart.drawings.getById(d.id)!.style).toEqual({ color: '#ff0000' });
  });

  it('refuses a template with nothing the form shows', async () => {
    const storage = fakeStorage();
    storage.store.set('trendline/Broken', 'not a style');
    const d = line();
    open(d.id, storage);
    await flush();
    pick('Broken');
    await flush();
    expect(notices.at(-1)).toEqual({ message: 'Not a valid template', kind: 'error' });
    expect(chart.drawings.getById(d.id)!.style).toEqual({});
  });

  it('drops levels without a finite value and non-finite numbers', async () => {
    const storage = fakeStorage();
    const fib = chart.drawings.add({ type: 'fib-retracement', pane: 0, points: [{ time: 600, price: 10 }, { time: 1200, price: 10.5 }], style: {} });
    const lineWidth = chart.drawings.getById(fib.id)!.style.lineWidth;
    storage.loadTemplate = async () => ({ levels: [{ value: 0.5 }, 1, {}], lineWidth: Number.NaN });
    storage.store.set('fib-retracement/Bad', null);
    open(fib.id, storage);
    await flush();
    pick('Bad');
    await flush();
    expect(notices.at(-1)).toEqual({ message: 'Not a valid template', kind: 'error' });
    expect(chart.drawings.getById(fib.id)!.style.lineWidth).toBe(lineWidth);
  });

  it('drops values the form would refuse: out of range or not one of the choices', async () => {
    const storage = fakeStorage();
    storage.store.set('trendline/Odd', { lineWidth: 500, lineStyle: 'wavy', color: '#00ff00' });
    storage.store.set('trendline/Bad', { lineWidth: 500, lineStyle: 'wavy' });
    const d = line();
    const dialog = open(d.id, storage);
    await flush();
    pick('Odd');
    await flush();
    expect(chart.drawings.getById(d.id)!.style).toEqual({ color: '#00ff00' });
    pick('Bad');
    await flush();
    expect(notices.at(-1)).toEqual({ message: 'Not a valid template', kind: 'error' });
    expect(dialog.values).toMatchObject({ color: '#00ff00' });
    expect(dialog.values.lineWidth).not.toBe(500);
  });

  it('deletes a template after asking', async () => {
    const storage = fakeStorage();
    storage.store.set('trendline/Old', { lineWidth: 2 });
    open(line().id, storage);
    await flush();
    pick('Old', 1);
    await flush();
    container.querySelector<HTMLButtonElement>('[role="alertdialog"] .pc-btn--danger')!.click();
    await flush();
    expect(storage.calls).toContain('remove drawing trendline Old');
    expect(storage.store.size).toBe(0);
    expect(notices.at(-1)).toEqual({ message: 'Deleted template Old', kind: 'info' });
    expect(items()).toEqual(['Save as template…']);
  });

  it('keeps templates in localStorage by default', async () => {
    open(line().id);
    await flush();
    await saveAs('Mine');
    expect(Object.keys(localStorage).some((k) => k.includes('templates:drawing'))).toBe(true);
  });

  it('shows no menu without the add-on or with an adapter that keeps no templates', () => {
    const d = line();
    openDrawingSettings(chart, container, d.id)!.cancel();
    expect(trigger()).toBeNull();
    open(d.id, { loadDrawings: async () => null, saveDrawings: async () => {} });
    expect(trigger()).toBeNull();
  });

  it('closes its name prompt and delete question with the settings dialog', async () => {
    const storage = fakeStorage();
    storage.store.set('trendline/Old', { lineWidth: 2 });
    const dialog = open(line().id, storage);
    await flush();
    pick('Save as template…');
    pick('Old', 1);
    await flush();
    expect(container.querySelector('[data-form="template-name"]')).not.toBeNull();
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
    dialog.cancel();
    await flush();
    expect(container.querySelector('[data-form="template-name"]')).toBeNull();
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(storage.calls).not.toContain('remove drawing trendline Old');
  });
});

/** A number input with bounds, a choice, a colour and a line plot. */
const bands: IndicatorDef = {
  id: 'test/bands',
  name: 'Bands',
  placement: 'overlay',
  inputs: [
    { id: 'fast', label: 'Fast', type: 'number', default: 5, min: 1, max: 50 },
    { id: 'mode', label: 'Mode', type: 'select', default: 'simple', options: [{ value: 'simple' }, { value: 'weighted' }] },
    { id: 'line', label: 'Line', type: 'color', default: '#2f6bff' },
  ],
  plots: [{ id: 'v', type: 'line', colorInput: 'line' }],
  compute: (src) => ({ v: Float64Array.from(src.close) }),
};

describe('indicator templates', () => {
  const openPanel = (storage?: StorageAdapter) => {
    const ind = chart.indicators.add(bands, { fast: 8 });
    return { ind, dialog: openIndicatorSettings(chart, container, ind, { headerControl: indicatorTemplates({ storage }) })! };
  };

  it("saves the indicator's inputs and plot styles as a template of its id", async () => {
    const storage = fakeStorage();
    openPanel(storage);
    await flush();
    expect(items()).toEqual(['Save as template…']);
    await saveAs('Fast');
    expect(storage.calls).toContain('save indicator test/bands Fast');
    // Not whether it is shown, nor the intervals it shows on.
    expect(storage.store.get('test/bands/Fast')).toEqual({
      'input.fast': 8,
      'input.mode': 'simple',
      'input.line': '#2f6bff',
      'plot.v.visible': true,
      'plot.v.lineWidth': 1.5,
      'plot.v.lineStyle': 'solid',
    });
    expect(items()).toEqual(['Save as template…', 'Apply template', 'Fast', 'Delete', 'Fast']);
    await saveAs('FAST');
    expect(notices.at(-1)).toEqual({ message: 'A template has this name already.', kind: 'error' });
  });

  it('applies a template live: Cancel puts the indicator back, Ok keeps it as one undo step', async () => {
    const storage = fakeStorage();
    storage.store.set('test/bands/Slow', { 'input.fast': 30, 'input.mode': 'weighted', 'plot.v.lineWidth': 3, visible: false, 'show.minutes': false });
    const { ind, dialog } = openPanel(storage);
    await flush();
    pick('Slow');
    await flush();
    expect(storage.calls).toContain('load indicator test/bands Slow');
    expect(ind.inputs).toMatchObject({ fast: 30, mode: 'weighted' });
    expect(ind.getPlotStyle('v')!.lineWidth).toBe(3);
    // Only inputs and plot styles are taken.
    expect(ind.visible).toBe(true);
    expect(ind.visibleOn).toBeNull();
    dialog.cancel();
    expect(ind.inputs).toMatchObject({ fast: 8, mode: 'simple' });
    expect(ind.getPlotStyle('v')!.lineWidth).toBe(1.5);
    // The closed panel slides out; without transitions here it stays in the DOM.
    dialog.el.remove();

    const again = openIndicatorSettings(chart, container, ind, { headerControl: indicatorTemplates({ storage }) })!;
    await flush();
    pick('Slow');
    await flush();
    again.submit();
    expect(ind.inputs).toMatchObject({ fast: 30, mode: 'weighted' });
    chart.history.undo();
    expect(ind.inputs).toMatchObject({ fast: 8, mode: 'simple' });
    expect(ind.getPlotStyle('v')!.lineWidth).toBe(1.5);
  });

  it('drops values the panel would refuse and refuses a template with none left', async () => {
    const storage = fakeStorage();
    storage.store.set('test/bands/Odd', { 'input.fast': 500, 'input.mode': 'bogus', 'plot.v.lineStyle': 'dashed' });
    storage.store.set('test/bands/Bad', { 'input.fast': 0, 'plot.v.lineWidth': 99, 'input.line': 5 });
    const { ind } = openPanel(storage);
    await flush();
    pick('Odd');
    await flush();
    expect(ind.inputs).toMatchObject({ fast: 8, mode: 'simple' });
    expect(ind.getPlotStyle('v')!.lineStyle).toBe('dashed');
    pick('Bad');
    await flush();
    expect(notices.at(-1)).toEqual({ message: 'Not a valid template', kind: 'error' });
    expect(ind.inputs).toMatchObject({ fast: 8, line: '#2f6bff' });
  });

  it('deletes a template after asking, and keeps templates in localStorage by default', async () => {
    const storage = fakeStorage();
    storage.store.set('test/bands/Old', { 'input.fast': 9 });
    const { dialog } = openPanel(storage);
    await flush();
    pick('Old', 1);
    await flush();
    container.querySelector<HTMLButtonElement>('[role="alertdialog"] .pc-btn--danger')!.click();
    await flush();
    expect(storage.calls).toContain('remove indicator test/bands Old');
    dialog.cancel();
    dialog.el.remove();

    openPanel();
    await flush();
    await saveAs('Mine');
    expect(Object.keys(localStorage).some((k) => k.includes('templates:indicator'))).toBe(true);
  });

  it('closes its name prompt with the panel', async () => {
    const { dialog } = openPanel(fakeStorage());
    await flush();
    pick('Save as template…');
    await flush();
    expect(container.querySelector('[data-form="template-name"]')).not.toBeNull();
    dialog.cancel();
    await flush();
    expect(container.querySelector('[data-form="template-name"]')).toBeNull();
  });
});

describe('drawing tool defaults', () => {
  const openWithDefaults = (id: string, storage?: StorageAdapter) =>
    openDrawingSettings(chart, container, id, { headerControl: drawingTemplates({ storage, defaults: true }) })!;

  it('saves the style shown as the tool default, with rememberStyle off, and resets it', async () => {
    chart.drawings.rememberStyle = false;
    const d = line({ color: '#ff0000', lineWidth: 3 });
    const dialog = openWithDefaults(d.id, fakeStorage());
    await flush();
    expect(items()).toEqual(['Save as template…', 'Save as default', 'Reset default']);
    pick('Save as default');
    await flush();
    expect(notices.at(-1)).toEqual({ message: 'Saved as default', kind: 'success' });
    dialog.cancel();
    expect(line().style).toMatchObject({ color: '#ff0000', lineWidth: 3, lineStyle: 'solid' });
    // Kept in the layout's tool defaults.
    expect(chart.drawings.serializeToolDefaults().trendline).toMatchObject({ color: '#ff0000', lineWidth: 3 });

    dialog.el.remove();
    openWithDefaults(d.id, fakeStorage());
    await flush();
    pick('Reset default');
    await flush();
    expect(notices.at(-1)).toEqual({ message: 'Default reset', kind: 'info' });
    expect(chart.drawings.serializeToolDefaults().trendline).toBeUndefined();
    expect(line().style.lineWidth).not.toBe(3);
  });

  it('shows no default items without `defaults`', async () => {
    open(line().id, fakeStorage());
    await flush();
    expect(items()).toEqual(['Save as template…']);
  });
});

describe('indicator defaults', () => {
  const panel = (defaults: ReturnType<typeof indicatorDefaults>, inputs = {}) => {
    const ind = chart.indicators.add(bands, inputs);
    const dialog = openIndicatorSettings(chart, container, ind, { headerControl: indicatorTemplates({ storage: fakeStorage(), defaults }) })!;
    return { ind, dialog };
  };
  /** Add `def` from the picker, as its row's add button does, and wait for it. */
  async function pickerAdd(options: IndicatorPickerOptions, def: IndicatorDef = bands) {
    chart.indicators.register(def);
    const picker = createIndicatorPicker(chart, { debounce: 0, storage: null, openOnSlash: false, ...options });
    const entry = (picker.commandSource.entries('', new AbortController().signal) as readonly CommandEntry[]).find((e) => e.id === def.id)!;
    entry.run();
    await flush();
    picker.destroy();
    return chart.indicators.getAll().at(-1)!;
  }

  it('saves the inputs and plot styles shown as the default and applies it to the next picker add only', async () => {
    const storage = fakeStorage();
    const defaults = indicatorDefaults({ storage });
    const { ind, dialog } = panel(defaults, { fast: 12, mode: 'weighted' });
    ind.setPlotStyle('v', { lineWidth: 3 });
    await flush();
    expect(items()).toEqual(['Save as template…', 'Save as default', 'Reset default']);
    pick('Save as default');
    await flush();
    expect(storage.calls).toContain('save indicator-default test/bands default');
    expect(storage.store.get('test/bands/default')).toEqual({
      version: 1,
      inputs: { fast: 12, mode: 'weighted', line: '#2f6bff' },
      plotStyles: { v: { lineWidth: 3 } },
    });
    expect(notices.at(-1)).toEqual({ message: 'Saved as default', kind: 'success' });
    dialog.submit();
    dialog.el.remove();

    const added = await pickerAdd({ initialState: defaults.initialState });
    expect(added).not.toBe(ind);
    expect(added.inputs).toMatchObject({ fast: 12, mode: 'weighted' });
    expect(added.getPlotStyle('v')!.lineWidth).toBe(3);
    // Code adds and pickers without the hook start from the definition's defaults.
    expect(chart.indicators.add(bands).inputs).toMatchObject({ fast: 5, mode: 'simple' });
    expect((await pickerAdd({})).inputs).toMatchObject({ fast: 5 });

    panel(defaults);
    await flush();
    pick('Reset default');
    await flush();
    expect(storage.calls).toContain('remove indicator-default test/bands default');
    expect(await defaults.initialState(bands)).toBeNull();
    expect((await pickerAdd({ initialState: defaults.initialState })).inputs).toMatchObject({ fast: 5 });
  });

  it('falls back to the definition defaults for a stale default, with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = fakeStorage();
    const defaults = indicatorDefaults({ storage });
    storage.store.set('test/bands/default', { version: 2, inputs: { fast: 12 } });
    expect(await defaults.initialState(bands)).toBeNull();
    storage.store.set('test/bands/default', { version: 1, inputs: { fast: 500 } });
    expect(await defaults.initialState(bands)).toBeNull();
    storage.store.set('test/bands/default', { inputs: { gone: 1 } });
    expect((await pickerAdd({ initialState: defaults.initialState })).inputs).toMatchObject({ fast: 5 });
    expect(warn).toHaveBeenCalledTimes(3);
    // Plot styles the indicator refuses are skipped when it is added.
    storage.store.set('test/bands/default', { inputs: { fast: 7 }, plotStyles: { gone: { lineWidth: 2 }, v: { lineWidth: -1 } } });
    const added = await pickerAdd({ initialState: defaults.initialState });
    expect(added.inputs).toMatchObject({ fast: 7 });
    expect(added.getPlotStyle('v')!.lineWidth).toBe(1.5);
  });

  it('skips refused plot styles, adds with the defaults on a rejected promise, and reports refused inputs like any add', async () => {
    const styled = await pickerAdd({ initialState: async () => ({ plotStyles: { nope: { lineWidth: 2 }, v: { lineWidth: 4 } } }) });
    expect(styled.getPlotStyle('v')!.lineWidth).toBe(4);
    const offline = await pickerAdd({ initialState: () => Promise.reject(new Error('offline')) });
    expect(offline.inputs).toMatchObject({ fast: 5 });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await pickerAdd({ initialState: () => ({ inputs: { fast: -1 } }) });
    expect(chart.indicators.getAll()).toHaveLength(2);
    expect(error).toHaveBeenCalled();
    // A hook resolving undefined adds with the defaults rather than asking again.
    const asked = vi.fn(async () => undefined as never);
    expect((await pickerAdd({ initialState: asked })).inputs).toMatchObject({ fast: 5 });
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it('hides the default items and resolves null with an adapter that keeps no templates', async () => {
    const defaults = indicatorDefaults({ storage: { loadDrawings: async () => null } });
    expect(defaults.save).toBeUndefined();
    expect(defaults.reset).toBeUndefined();
    expect(await defaults.initialState(bands)).toBeNull();
    panel(defaults);
    await flush();
    expect(items()).toEqual(['Save as template…']);
  });

  it('keeps defaults in localStorage by default', async () => {
    const defaults = indicatorDefaults();
    await defaults.save!(chart.indicators.add(bands, { fast: 9 }));
    expect(Object.keys(localStorage).some((k) => k.endsWith('templates:indicator-default'))).toBe(true);
    expect((await defaults.initialState(bands))!.inputs).toMatchObject({ fast: 9 });
  });
});
