import { describe, expect, it } from 'vitest';
import { overflowOrder, toolbarGroups, type ToolbarItem } from '@charton/ui';
import type { Chart } from '@charton/core';
import { cycleToggle, demoToolbar, type DemoToggle } from '../src/toolbar';

const toggle = (value: string): DemoToggle => ({ value, label: value, isOn: () => false, toggle: () => {} });

const items: ToolbarItem[] = demoToolbar({
  intervals: ['1m', '1h', '1d'],
  interval: '1d',
  onInterval: () => {},
  compareSymbol: () => 'OTHER',
  layers: [toggle('heatmap'), toggle('channel')],
  display: [toggle('watermark'), toggle('reference-lines')],
  view: [toggle('data-window')],
  demo: [toggle('live')],
});

const controls = items.filter((item) => item.type !== 'separator' && item.type !== 'spacer');
const groupOf = (id: string) => items.find((item) => item.id === id)?.group;

// The placement standard in roadmap/toolbar-layout.md.
describe('demo top bar', () => {
  it('places every control in a top-bar group', () => {
    for (const item of controls) expect(toolbarGroups, `${item.id}`).toContain(item.group);
  });

  it('keeps to 8 primary items', () => {
    expect(controls.filter((item) => !item.hidden).length).toBeLessThanOrEqual(8);
  });

  it('leaves out bottom-bar, rail and settings-panel controls', () => {
    const ids = controls.map((item) => item.id);
    for (const id of ['timezone', 'session', 'fit', 'rail', 'theme', 'crosshair', 'legend', 'appearance']) {
      expect(ids).not.toContain(id);
    }
  });

  it('lists display switches in the View menu and compare under Layers', () => {
    const menu = (id: string) => {
      const item = items.find((i) => i.id === id);
      return item?.type === 'menu' ? item.options.map((o) => o.value) : [];
    };
    // The templates are on the bar itself now.
    expect(menu('layers')).toEqual(['heatmap', 'channel', 'compare']);
    // Hidden to keep the bar minimal; Customize toolbar adds them back.
    expect(items.filter((i) => ['style', 'layers', 'view'].includes(i.id!)).map((i) => i.hidden ?? false)).toEqual([true, true, false]);
    expect(menu('view')).toEqual(expect.arrayContaining(['display:watermark', 'display:reference-lines']));
    expect(controls.map((item) => item.id)).not.toContain('compare');
  });

  it('gives every View menu entry one of its sections, Demo last, and leaves rail and settings entries out', () => {
    const view = items.find((i) => i.id === 'view');
    const options = view?.type === 'menu' ? view.options : [];
    const sections = [...new Set(options.map((o) => o.section))];
    expect(sections).toEqual(['Panels', 'Display', 'Demo']);
    expect(options.find((o) => o.value === 'live')?.section).toBe('Demo');
    expect(options.map((o) => o.value).filter((v) => /rail|hide/.test(v))).toEqual([]);
    // Theme, accessibility, colours, language and direction are in the settings dialog.
    expect(options.map((o) => o.value).filter((v) => /^(theme|access|colors|locale|direction):/.test(v))).toEqual([]);
  });

  it('shows the default toolbar and the View menu, ending with the view controls', () => {
    const shown = controls.filter((item) => !item.hidden).map((item) => item.id);
    expect(shown).toEqual(['symbol', 'interval', 'indicators', 'indicator-templates', 'replay', 'fullscreen', 'chart-settings', 'view']);
    for (const id of ['indicator-templates', 'replay', 'fullscreen', 'chart-settings', 'view']) expect(groupOf(id)).toBe('view');
    expect(shown).not.toContain('settings');
  });

  it('overflows the view group first and the context group last', () => {
    const groups = overflowOrder(items).map(groupOf);
    const rank = { view: 0, analysis: 1, context: 2 } as const;
    const ranks = groups.map((g) => rank[g!]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(groups[0]).toBe('view');
    expect(groups[groups.length - 1]).toBe('context');
  });
});

describe('cycling View menu entries', () => {
  // Session bands as bands, as columns, or off; the state lives outside the chart.
  const chart = {} as Chart;
  let mode = 'bands';
  const state = (value: string, label: string, on?: boolean) => ({ label, on, is: () => mode === value, apply: () => (mode = value) });
  const bands = cycleToggle('session-bands', [
    state('bands', 'Session bands', true),
    state('columns', 'Session bands as columns', true),
    state('off', 'Session bands'),
  ]);

  it('moves to the next state on each click, naming and checking the current one', () => {
    mode = 'bands';
    expect(bands.label).toBe('Session bands');
    const seen = [0, 1, 2].map(() => {
      bands.toggle(chart);
      return [mode, bands.labelOf?.(chart), bands.isOn(chart)];
    });
    expect(seen).toEqual([
      ['columns', 'Session bands as columns', true],
      ['off', 'Session bands', false],
      ['bands', 'Session bands', true],
    ]);
  });

  it('relabels the View menu after a cycling entry changes, and only then', () => {
    mode = 'bands';
    const relabels: string[][] = [];
    const menu = demoToolbar({
      intervals: ['1d'],
      interval: '1d',
      onInterval: () => {},
      compareSymbol: () => 'OTHER',
      layers: [],
      display: [bands],
      view: [toggle('data-window')],
      demo: [],
      relabel: (id, options) => relabels.push([id, ...options.filter((o) => o.section === 'Display').map((o) => o.label)]),
    }).find((item) => item.id === 'view');
    if (menu?.type !== 'menu') throw new Error('no View menu');
    menu.onSelect('data-window', chart);
    expect(relabels).toEqual([]);
    menu.onSelect('display:session-bands', chart);
    expect(relabels).toEqual([['view', 'Session bands as columns']]);
    expect(menu.isChecked?.('display:session-bands', chart)).toBe(true);
  });
});
