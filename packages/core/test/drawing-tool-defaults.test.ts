import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { DrawingManager, type DrawingEvents, type DrawingHost } from '../src/drawing/manager';
import { deriveQuickFields } from '../src/drawing/quick-fields';
import type { DrawingToolDef } from '../src/drawing/types';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { Timeline } from '../src/timeline';
import { darkTheme } from '../src/theme';
import { withBuiltinTools } from './builtin-tools';

// x = (index - 99) * 10 + 1000, time = index * 60, price = 500 - y (see drawing.test.ts).
function setup() {
  const timeline = new Timeline();
  timeline.set(Array.from({ length: 100 }, (_, i) => i * 60));
  const time = new TimeScale({ barSpacing: 10, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 0 });
  time.width = 1000;
  time.barCount = 100;
  const pane = new Pane(0, { stretch: 1, marginTop: 0, marginBottom: 0 });
  pane.height = 500;
  pane.price.height = 500;
  pane.price.fit(0, 500);
  const events: { name: keyof DrawingEvents; payload: unknown }[] = [];
  const host: DrawingHost = {
    theme: darkTheme,
    timeline,
    time,
    panes: [pane],
    magnetPrice: (_i, price) => price,
    formatPrice: (_p, price) => price.toFixed(2),
    requestOverlay: () => {},
    editText: (_at, _initial, done) => done(null),
    emit: (name, payload) => events.push({ name, payload }),
  };
  const manager = withBuiltinTools(new DrawingManager(host));
  const of = <K extends keyof DrawingEvents>(name: K) =>
    events.filter((e) => e.name === name).map((e) => e.payload as DrawingEvents[K]);
  const clearEvents = () => (events.length = 0);
  return { manager, of, clearEvents };
}

const line = { type: 'trendline', pane: 0, points: [{ time: 540, price: 100 }, { time: 1740, price: 300 }], style: {} };

/** Draw a trend line by click-move-click from (100, 400) to (300, 200) and return it. */
function drawLine(manager: DrawingManager) {
  manager.setTool('trendline');
  manager.pointerDown(0, { x: 100, y: 400 });
  manager.pointerUp({ x: 100, y: 400 });
  manager.pointerMove({ x: 300, y: 200 });
  manager.pointerDown(0, { x: 300, y: 200 });
  manager.pointerUp({ x: 300, y: 200 });
  return manager.selected!;
}

describe('tool defaults', () => {
  it('starts new drawings from the tool defaults: add() style > tool defaults > the tool own', () => {
    const { manager } = setup();
    manager.register({ type: 'probe', label: 'Probe', points: 2, defaultStyle: { lineWidth: 3, fill: '#111' }, render: () => {}, hitTest: () => true });
    manager.setToolDefaults('probe', { color: '#f00', lineWidth: 1 });
    expect(manager.toolDefaults('probe')).toEqual({ lineWidth: 1, fill: '#111', color: '#f00' });
    const d = manager.add({ ...line, type: 'probe', style: { color: '#0f0' } });
    expect(d.style).toEqual({ lineWidth: 1, fill: '#111', color: '#0f0' });
    // Nothing set: the theme draws what the style leaves out.
    expect(manager.add(line).style).toEqual({});
  });

  it('starts drawings the user draws from the tool defaults', () => {
    const { manager } = setup();
    manager.setToolDefaults('trendline', { color: '#abcdef', lineStyle: 'dashed' });
    expect(drawLine(manager).style).toEqual({ color: '#abcdef', lineStyle: 'dashed' });
  });

  it('copies defaults so drawings and defaults share no levels', () => {
    const { manager } = setup();
    const levels = [{ value: 0 }, { value: 0.5 }, { value: 1 }];
    manager.setToolDefaults('fib-retracement', { levels });
    levels[0]!.value = 9;
    const d = manager.add({ ...line, type: 'fib-retracement' });
    expect(d.style.levels![0]!.value).toBe(0);
    manager.toolDefaults('fib-retracement').levels![1]!.value = 9;
    expect(manager.toolDefaults('fib-retracement').levels![1]!.value).toBe(0.5);
  });

  it('replaces the defaults on each call and resets with null, emitting on change only', () => {
    const { manager, of } = setup();
    manager.setToolDefaults('trendline', { color: '#f00', lineWidth: 2 });
    manager.setToolDefaults('trendline', { lineWidth: 3 });
    expect(manager.toolDefaults('trendline')).toEqual({ lineWidth: 3 });
    manager.setToolDefaults('trendline', { lineWidth: 3 });
    manager.setToolDefaults('trendline', null);
    expect(manager.toolDefaults('trendline')).toEqual({});
    expect(of('tool:defaults-change')).toEqual([
      { tool: 'trendline', defaults: { color: '#f00', lineWidth: 2 } },
      { tool: 'trendline', defaults: { lineWidth: 3 } },
      { tool: 'trendline', defaults: {} },
    ]);
  });

  it('throws on ill-typed fields and keeps the defaults it had', () => {
    const { manager } = setup();
    manager.setToolDefaults('trendline', { color: '#f00' });
    expect(() => manager.setToolDefaults('trendline', { lineWidth: 'wide' as unknown as number })).toThrow(/lineWidth/);
    expect(manager.toolDefaults('trendline')).toEqual({ color: '#f00' });
  });

  it('accepts defaults for a tool registered later', () => {
    const { manager } = setup();
    manager.setToolDefaults('later', { color: '#123456' });
    manager.register({ type: 'later', label: 'Later', points: 1, defaultStyle: { lineWidth: 4 }, render: () => {}, hitTest: () => false });
    expect(manager.toolDefaults('later')).toEqual({ lineWidth: 4, color: '#123456' });
  });
});

describe('remember style', () => {
  it('makes a committed style edit the default of the tool for the edited fields', () => {
    const { manager, of } = setup();
    const d = manager.add({ ...line, style: { lineWidth: 4 } });
    manager.update(d.id, { style: { color: '#ff8800' } });
    expect(manager.toolDefaults('trendline')).toEqual({ color: '#ff8800' });
    expect(of('tool:defaults-change')).toEqual([{ tool: 'trendline', defaults: { color: '#ff8800' } }]);
    expect(drawLine(manager).style).toEqual({ color: '#ff8800' });
    // Other tools keep theirs.
    expect(manager.toolDefaults('hline')).toEqual({});
  });

  it('does not remember previews, other edits, or anything while off', () => {
    const { manager } = setup();
    const d = manager.add(line);
    manager.preview(d.id, { style: { color: '#ff0000' } });
    manager.update(d.id, { text: 'note', locked: true });
    expect(manager.toolDefaults('trendline')).toEqual({});
    manager.rememberStyle = false;
    manager.update(d.id, { style: { color: '#00ff00' } });
    expect(manager.toolDefaults('trendline')).toEqual({});
  });

  it('keeps remembered defaults through undo', () => {
    const { manager } = setup();
    const d = manager.add(line);
    manager.update(d.id, { style: { lineStyle: 'dotted' } });
    manager.undo();
    expect(manager.getById(d.id)!.style).toEqual({});
    expect(manager.toolDefaults('trendline')).toEqual({ lineStyle: 'dotted' });
  });
});

describe('saving tool defaults', () => {
  it('round-trips through serializeToolDefaults and loadToolDefaults', () => {
    const { manager } = setup();
    manager.setToolDefaults('trendline', { color: '#f00', levels: [{ value: 0.5, color: '#0f0' }] });
    const saved = JSON.parse(JSON.stringify(manager.serializeToolDefaults()));
    const other = setup();
    other.manager.setToolDefaults('hline', { color: '#00f' });
    expect(other.manager.loadToolDefaults(saved)).toEqual([]);
    expect(other.manager.serializeToolDefaults()).toEqual(manager.serializeToolDefaults());
    expect(other.manager.toolDefaults('hline')).toEqual({});
    expect(other.of('tool:defaults-change').map((e) => e.tool)).toEqual(['hline', 'hline', 'trendline']);
  });

  it('drops ill-typed fields and entries when loading, and reports them', () => {
    const { manager } = setup();
    const errors = manager.loadToolDefaults({ trendline: { color: '#f00', lineWidth: 'x' }, hline: 5 });
    expect(errors).toEqual([
      { tool: 'trendline', field: 'lineWidth', reason: 'must be a finite number >= 0' },
      { tool: 'hline', reason: 'must be an object' },
    ]);
    expect(manager.serializeToolDefaults()).toEqual({ trendline: { color: '#f00' } });
    expect(() => manager.loadToolDefaults([])).toThrow();
    expect(manager.serializeToolDefaults()).toEqual({ trendline: { color: '#f00' } });
  });
});

describe('update progress', () => {
  it('streams drawing:update-progress while dragging, then commits once', () => {
    const { manager, of, clearEvents } = setup();
    const d = manager.add(line);
    clearEvents();
    // Grab the line in the middle and drag it.
    manager.pointerDown(0, { x: 200, y: 300 });
    manager.pointerMove({ x: 210, y: 300 });
    manager.pointerMove({ x: 220, y: 300 });
    expect(of('drawing:update-progress')).toEqual([{ id: d.id }, { id: d.id }]);
    expect(of('drawing:update')).toEqual([]);
    manager.pointerUp({ x: 220, y: 300 });
    expect(of('drawing:update')).toHaveLength(1);
  });

  it('reports previews as progress but not creation', () => {
    const { manager, of } = setup();
    drawLine(manager);
    expect(of('drawing:update-progress')).toEqual([]);
    const id = manager.selected!.id;
    manager.preview(id, { style: { color: '#fff' } });
    expect(of('drawing:update-progress')).toEqual([{ id }]);
  });
});

describe('quick fields', () => {
  const tool = (settings: DrawingToolDef['settings']): DrawingToolDef => ({
    type: 'custom',
    label: 'Custom',
    points: 2,
    settings,
    render: () => {},
    hitTest: () => false,
  });

  it('falls back to color, line width and line style', () => {
    expect(deriveQuickFields({}, undefined)).toEqual(['color', 'lineWidth', 'lineStyle']);
  });

  it('puts the colours the style carries first and caps at four', () => {
    expect(deriveQuickFields({ fill: '#000', extendRight: true }, undefined)).toEqual(['fill', 'color', 'extendRight', 'lineWidth']);
    expect(deriveQuickFields({ fontSize: 14, textColor: '#fff', bold: true, italic: false }, undefined)).toEqual([
      'textColor',
      'color',
      'fontSize',
      'bold',
    ]);
  });

  it('leaves out levels and other structured values', () => {
    expect(deriveQuickFields({ levels: [{ value: 0.5 }] }, tool([{ key: 'levels', label: 'Levels', type: 'levels' }]))).toEqual([
      'color',
      'lineWidth',
      'lineStyle',
    ]);
  });

  it('includes the settings a custom tool declares, its colours first', () => {
    const t = tool([
      { key: 'risk', label: 'Risk', type: 'number', min: 0 },
      { key: 'profitColor', label: 'Profit', type: 'color' },
    ]);
    expect(deriveQuickFields({}, t)).toEqual(['profitColor', 'color', 'risk', 'lineWidth']);
  });

  it("takes the first four of the tool's styleFields, levels left out", () => {
    const t: DrawingToolDef = { ...tool(undefined), styleFields: ['levels', 'textColor', 'fontSize', 'bold', 'italic', 'fill'] };
    // The style carrying other fields does not matter: the tool says what it draws.
    expect(deriveQuickFields({ color: '#fff', lineWidth: 2 }, t)).toEqual(['textColor', 'fontSize', 'bold', 'italic']);
  });

  it("offers only the fields a built-in tool draws", () => {
    const { manager } = setup();
    const d = manager.add({ ...line, type: 'fib-retracement', style: {} });
    expect(manager.quickFields(d.id)).toEqual(['color', 'fill', 'lineWidth', 'lineStyle']);
    expect(manager.styleFields(d.id)).toContain('levels');
    expect(manager.styleFields(d.id)).toContain('bold');
    const text = manager.add({ type: 'text', pane: 0, points: [{ time: 0, price: 1 }], text: 'hi', style: {} });
    expect(manager.quickFields(text.id)).toEqual(['textColor', 'fontSize', 'bold', 'italic']);
    expect(manager.styleFields('nope')).toEqual([]);
  });

  it('falls back to the base fields and settings keys for a tool without styleFields', () => {
    const { manager } = setup();
    manager.register(tool([{ key: 'risk', label: 'Risk', type: 'number' }]));
    const d = manager.add({ ...line, type: 'custom', style: {} });
    expect(manager.styleFields(d.id)).toEqual(['color', 'lineWidth', 'lineStyle', 'risk']);
  });

  it('uses the fields registered for the tool', () => {
    const { manager } = setup();
    const d = manager.add({ ...line, style: { fill: '#000' } });
    expect(manager.quickFields(d.id)).toEqual(['color', 'lineWidth', 'lineStyle']);
    manager.registerToolQuickFields('trendline', ['lineStyle', 'color', 'extendLeft', 'extendRight', 'showLabel']);
    expect(manager.quickFields(d.id)).toEqual(['lineStyle', 'color', 'extendLeft', 'extendRight']);
    manager.registerToolQuickFields('trendline', null);
    expect(manager.quickFields(d.id)).toEqual(['color', 'lineWidth', 'lineStyle']);
    expect(manager.quickFields('nope')).toEqual([]);
    expect(() => manager.registerToolQuickFields('trendline', [1 as unknown as string])).toThrow();
  });
});

describe('tool defaults in layouts', () => {
  const charts: Chart[] = [];
  afterEach(() => charts.splice(0).forEach((c) => c.destroy()));
  const chart = () => {
    const c = new Chart(fakeContainer());
    charts.push(c);
    c.addCandles().setData(Array.from({ length: 50 }, (_, i) => ({ time: i * 60, open: 10, high: 11, low: 9, close: 10 })));
    return c;
  };

  it('saves and restores them, with or without drawings', () => {
    const a = chart();
    a.drawings.setToolDefaults('trendline', { color: '#ff0000', lineWidth: 2 });
    const saved = JSON.parse(JSON.stringify(a.serializeLayout({ drawings: false })));
    expect(saved.toolDefaults).toEqual({ trendline: { color: '#ff0000', lineWidth: 2 } });
    const b = chart();
    b.drawings.setToolDefaults('hline', { color: '#00ff00' });
    expect(b.loadLayout(saved).errors).toEqual([]);
    expect(b.drawings.serializeToolDefaults()).toEqual({ trendline: { color: '#ff0000', lineWidth: 2 } });
  });

  it('reports ill-typed saved defaults and leaves them alone when the layout has none', () => {
    const c = chart();
    c.drawings.setToolDefaults('hline', { color: '#00ff00' });
    const { errors } = c.loadLayout({ version: 1, toolDefaults: { trendline: { lineStyle: 'wavy' } } });
    expect(errors).toEqual([{ part: 'toolDefaults.trendline.lineStyle', reason: 'must be "solid", "dashed" or "dotted"' }]);
    expect(c.drawings.serializeToolDefaults()).toEqual({});
    c.loadLayout({ version: 1, toolDefaults: 'none' });
    c.drawings.setToolDefaults('hline', { color: '#00ff00' });
    c.loadLayout({ version: 1 });
    expect(c.drawings.toolDefaults('hline')).toEqual({ color: '#00ff00' });
  });
});
