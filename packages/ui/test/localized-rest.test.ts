import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chart, createDepthLane, createLocalizer, createSessionBands, type IndicatorDef, type SessionLane, type SessionLaneState } from '@charton/core';
import { dispatch, fakeContainer, installFakeDom } from '../../core/test/fake-dom';
import { createChartSettings } from '../src/chart-settings';
import { createDepthLadder } from '../src/depth-ladder';
import { createChartGrid, type ChartGrid } from '../src/grid';
import { matchRank, searchIndicators } from '../src/indicator-picker-model';
import { indicatorSettingsForm } from '../src/indicator-settings';
import { createSessionChip, sessionChipLabel, sessionStatusText } from '../src/session-chip';
import { chosenLabel } from './listbox';

type El = HTMLElement & { children: El[]; textContent: string; className: string };
const all = (root: unknown): El[] => (root as El).children.flatMap((c) => [c, ...all(c)]);
const find = (root: unknown, test: (el: El) => boolean) => all(root).find(test);
const byClass = (root: unknown, cls: string) => all(root).filter((el) => el.className.split(' ').includes(cls));

const german = {
  sessions: 'Marktsitzungen',
  sessionsList: 'Marktsitzungen: {list}',
  sessionsNone: 'Marktsitzungen: keine',
  sessionLaneOpen: '{name} geöffnet',
  sessionLaneClosed: '{name} geschlossen',
  sessionOpen: 'Geöffnet',
  sessionClosesIn: 'Geöffnet · schließt in {time}',
  sessionOpensIn: 'Geschlossen · öffnet in {time}',
  measureDays: '{n} T.',
  measureHours: '{n} Std.',
  ladderTitle: 'Orderbuch',
  seriesPrice: 'Preis',
  ladderSize: 'Menge',
  gridLabel: 'Diagramme',
  gridCellOf: 'Diagramm {n} von {count}',
  gridResizeColumns: 'Spalten {n} und {next} anpassen',
  timezoneLocal: 'Lokal ({zone}, {offset})',
  'indicator.test/avg': 'Gleitender Durchschnitt',
  'input.test/avg.length': 'Länge',
  'input.test/avg.mode.simple': 'Einfach',
  'inputGroup.test/avg.Smoothing': 'Glättung',
  'plot.test/avg.upper': 'Oben',
};
const de = createLocalizer({ locale: 'de-DE', messages: german });

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function chart(messages: Record<string, string> = german) {
  const c = new Chart(fakeContainer(), { timezone: 'local', localization: { locale: 'de-DE', messages } });
  charts.push(c);
  return c;
}

const lane = (over: Partial<SessionLane> = {}): SessionLane => ({
  id: 'ny',
  name: 'New York',
  timezone: 'America/New_York',
  hours: { weekly: { fri: [{ start: '09:30', end: '16:00' }] } },
  color: '#ff0000',
  ...over,
});
const state = (over: Partial<SessionLaneState>): SessionLaneState => ({ lane: lane(), open: true, next: null, remaining: null, ...over });

describe('session chip text', () => {
  it('stays English without a language', () => {
    expect(sessionStatusText(state({ open: false, remaining: 86400 }))).toBe('Closed · opens in 1d 0h');
    expect(sessionChipLabel([state({ open: false })], { localization: createLocalizer() })).toBe('Market sessions: New York closed');
  });

  it('follows the language, with its countdown units', () => {
    expect(sessionStatusText(state({ open: true, remaining: 3600 }), { localization: de })).toBe('Geöffnet · schließt in 01:00:00');
    expect(sessionStatusText(state({ open: false, remaining: 28 * 3600 }), { localization: de })).toBe('Geschlossen · öffnet in 1 T. 4 Std.');
    expect(sessionStatusText(state({ open: true }), { localization: de })).toBe('Geöffnet');
    expect(sessionStatusText(state({ open: false }), { localization: de })).toBe('Closed');
    expect(sessionChipLabel([state({ open: true })], { localization: de })).toBe('Marktsitzungen: New York geöffnet');
    expect(sessionChipLabel([], { localization: de })).toBe('Marktsitzungen: keine');
  });

  it('reads the chart language on every refresh', () => {
    installFakeDom();
    vi.useFakeTimers();
    const c = chart();
    const now = Date.UTC(2024, 2, 8, 15) / 1000; // a Friday, open until 21:00 UTC
    const chip = createSessionChip(createSessionBands({ lanes: [lane()] }), () => now, {
      get localization() {
        return c.localization;
      },
    });
    const trigger = byClass(chip.el, 'pc-sessions-trigger')[0]!;
    expect(byClass(chip.el, 'pc-session-status').map((n) => n.textContent)).toEqual(['Geöffnet · schließt in 06:00:00']);
    expect(trigger.getAttribute('data-tip')).toBe('Marktsitzungen');
    c.applyOptions({ localization: { messages: {} } });
    chip.refresh();
    expect(trigger.getAttribute('data-tip')).toBe('Market sessions');
    expect(trigger.getAttribute('aria-label')).toBe('Market sessions: New York open');
    chip.destroy();
  });
});

describe('depth ladder text', () => {
  const head = (el: HTMLElement) => byClass(el, 'pc-ladder-head')[0]!.children.map((c) => c.textContent);

  it('names its heading and columns in the language, and keeps a title the app set', () => {
    const lane = createDepthLane();
    const english = createDepthLadder(fakeContainer(), lane);
    expect(english.el.getAttribute('aria-label')).toBe('Order book');
    expect(head(english.el)).toEqual(['Price', 'Size']);
    const local = createDepthLadder(fakeContainer(), lane, { localization: de });
    expect(local.el.getAttribute('aria-label')).toBe('Orderbuch');
    expect(head(local.el)).toEqual(['Preis', 'Menge']);
    expect(createDepthLadder(fakeContainer(), lane, { localization: de, title: 'Book' }).el.getAttribute('aria-label')).toBe('Book');
  });
});

describe('chart grid text', () => {
  const grids: ChartGrid[] = [];
  beforeEach(() => {
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
    vi.stubGlobal(
      'MutationObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
  });
  afterEach(() => grids.splice(0).forEach((g) => g.destroy()));

  const bare = { rail: false, bottomBar: false, appearance: false } as const;
  const labels = (g: ChartGrid) => {
    const body = find(g.el, (el) => el.className === 'pc-grid-cells')!;
    return [body, ...body.children].map((el) => el.getAttribute('aria-label'));
  };

  it('names the grid, its cells and resizers in the first chart language', () => {
    const english = createChartGrid(fakeContainer(), { layout: '2x1', cell: bare });
    grids.push(english);
    expect(labels(english)).toEqual(['Charts', 'Chart 1 of 2', 'Chart 2 of 2', 'Resize columns 1 and 2']);
    const g = createChartGrid(fakeContainer(), { layout: '2x1', cell: { ...bare, chart: { localization: { messages: german } } } });
    grids.push(g);
    expect(labels(g)).toEqual(['Diagramme', 'Diagramm 1 von 2', 'Diagramm 2 von 2', 'Spalten 1 und 2 anpassen']);
    g.charts[0]!.applyOptions({ localization: { messages: {} } });
    expect(labels(g)).toEqual(['Charts', 'Chart 1 of 2', 'Chart 2 of 2', 'Resize columns 1 and 2']);
  });

  it('follows the active cell, also when the active cell goes', () => {
    // Only the second cell's chart is in German.
    const g = createChartGrid(fakeContainer(), {
      layout: '2x1',
      cell: (index) => ({ ...bare, chart: index === 1 ? { localization: { messages: german } } : {} }),
    });
    grids.push(g);
    expect(labels(g)[0]).toBe('Charts');
    g.setActive(1);
    expect(labels(g)).toEqual(['Diagramme', 'Diagramm 1 von 2', 'Diagramm 2 von 2', 'Spalten 1 und 2 anpassen']);
    g.charts[0]!.applyOptions({ localization: { messages: { gridLabel: 'Other' } } });
    expect(labels(g)[0]).toBe('Diagramme');
    g.setLayout('1x1');
    expect(labels(g)).toEqual(['Other', 'Chart 1 of 1']);
  });
});

describe('chart settings timezone', () => {
  it('shows the local entry in the language', () => {
    const c = chart();
    const settings = createChartSettings(c, fakeContainer(), { storage: null });
    const dialog = settings.open('time')!;
    const row = find(dialog.el, (el) => el.getAttribute('data-field') === 'timezone')!;
    const trigger = find(row, (el) => el.tagName === 'BUTTON' || el.tagName === 'button')!;
    expect(chosenLabel(trigger)).toMatch(/^Lokal \(.+, UTC/);
    dispatch(find(dialog.el, (el) => el.getAttribute('data-action') === 'cancel')!, 'click');
    c.applyOptions({ localization: { messages: {} } });
    const english = settings.open('time')!;
    const again = find(english.el, (el) => el.getAttribute('data-field') === 'timezone')!;
    expect(chosenLabel(find(again, (el) => el.tagName === 'BUTTON' || el.tagName === 'button')!)).toMatch(/^Local \(.+, UTC/);
  });
});

const avg: IndicatorDef = {
  id: 'test/avg',
  name: 'Moving average',
  placement: 'overlay',
  inputs: [
    { id: 'length', label: 'Length', type: 'number', default: 5 },
    { id: 'mode', label: 'Mode', type: 'select', default: 'simple', options: [{ value: 'simple', label: 'Simple' }, { value: 'weighted', label: 'Weighted' }] },
    { id: 'smooth', label: 'Smooth', type: 'boolean', default: false, group: 'Smoothing' },
  ],
  plots: [
    { id: 'upper', type: 'line', title: 'Upper' },
    { id: 'lower', type: 'line', title: 'Lower' },
  ],
  compute: (src) => ({ upper: Float64Array.from(src.close), lower: Float64Array.from(src.close) }),
};

describe('indicator text', () => {
  const labelsOf = (form: ReturnType<typeof indicatorSettingsForm>) =>
    form.schema.sections.flatMap((s) => s.groups.flatMap((g) => [g.label, ...g.inputs.map((i) => i.label)]));
  const modeOptions = (form: ReturnType<typeof indicatorSettingsForm>) => {
    const input = form.schema.sections[0]!.groups[0]!.inputs.find((i) => i.id === 'input.mode')!;
    return input.kind === 'select' ? input.options.map((o) => o.label) : [];
  };

  it('keeps the definition text without a language', () => {
    const form = indicatorSettingsForm(avg, { inputs: {}, visible: true });
    expect(form.schema.title).toBe('Moving average');
    expect(labelsOf(form)).toEqual(expect.arrayContaining(['Length', 'Mode', 'Smoothing', 'Smooth', 'Upper', 'Lower']));
    expect(modeOptions(form)).toEqual(['Simple', 'Weighted']);
  });

  it('translates names, inputs, groups, choices and plots by keys made from ids', () => {
    const form = indicatorSettingsForm(avg, { inputs: {}, visible: true }, chart());
    expect(form.schema.title).toBe('Gleitender Durchschnitt');
    // Keys the language lacks keep the definition's text.
    expect(labelsOf(form)).toEqual(expect.arrayContaining(['Länge', 'Mode', 'Glättung', 'Smooth', 'Oben', 'Lower']));
    expect(modeOptions(form)).toEqual(['Einfach', 'Weighted']);
  });

  it('keeps an empty plot title or group name blank', () => {
    const blank: IndicatorDef = { ...avg, id: 'test/blank', inputs: [{ id: 'length', type: 'number', default: 5, group: '' }], plots: [{ id: 'upper', type: 'line', title: '' }] };
    const groups = indicatorSettingsForm(blank, { inputs: {}, visible: true }, chart()).schema.sections.flatMap((s) => s.groups);
    expect(groups.find((g) => g.id === 'plot-upper')?.label).toBe('');
    expect(groups.find((g) => g.inputs.some((i) => i.id === 'input.length'))?.label).toBeUndefined();
  });

  it('searches the shown name as well as the definition name', () => {
    const nameOf = (def: IndicatorDef) => de.text(`indicator.${def.id}`, undefined, def.name);
    expect(searchIndicators([avg], 'gleit', { nameOf })).toEqual([avg]);
    expect(searchIndicators([avg], 'moving', { nameOf })).toEqual([avg]);
    expect(searchIndicators([avg], 'gleit')).toEqual([]);
    expect(matchRank(avg, 'moving average')).toBe(0);
  });
});
