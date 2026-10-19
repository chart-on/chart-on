import {
  chartStyle,
  chartStyles,
  chartTypeIcons,
  compare,
  defaultToolbarItems,
  intervals,
  type ChartStyleOption,
  type IconSource,
  type ToolbarButtonItem,
  type ToolbarItem,
  type ToolbarMenuItem,
} from '@chart-on/ui';
import type { CandleSeriesOptions, CandleStyle, Chart, Interval } from '@chart-on/core';
import { Layers, PanelsTopLeft } from 'lucide';

/** A demo on/off switch shown as one entry of a checked menu. */
export interface DemoToggle {
  value: string;
  label: string;
  icon?: IconSource;
  /** Menu section heading; `demoToolbar` sets it on every View menu entry. */
  section?: string;
  /** The label for the chart's current state, when it differs by state (see `cycleToggle`). */
  labelOf?(chart: Chart): string;
  isOn(chart: Chart): boolean;
  toggle(chart: Chart): void;
}

/** One state of a `cycleToggle` entry. */
export interface DemoState {
  label: string;
  /** Show the entry checked in this state. */
  on?: boolean;
  is(chart: Chart): boolean;
  apply(chart: Chart): void;
}

/**
 * One menu entry for the exclusive states of one setting, e.g. session bands
 * as bands, as columns or off. A click moves to the next state, and the label
 * names the current one. The first state is the one the demo starts in.
 */
export function cycleToggle(value: string, states: readonly [DemoState, ...DemoState[]]): DemoToggle {
  const at = (chart: Chart) => states[Math.max(0, states.findIndex((s) => s.is(chart)))]!;
  return {
    value,
    label: states[0].label,
    labelOf: (chart) => at(chart).label,
    isOn: (chart) => at(chart).on ?? false,
    toggle: (chart) => states[(states.indexOf(at(chart)) + 1) % states.length]!.apply(chart),
  };
}

/** What the demo top bar needs from the rest of the demo. */
export interface DemoToolbarContext {
  intervals: readonly Interval[];
  interval: Interval;
  onInterval(key: Interval): void;
  compareSymbol(): string;
  /** Demo-only series and overlays that indicators cannot draw, switched from the Layers menu. */
  layers: readonly DemoToggle[];
  /** Display switches (watermark, reference lines, shading, bar grouping), in the View menu's Display section. */
  display: readonly DemoToggle[];
  /** Panels (data window, object tree, second chart…), in the View menu's Panels section. */
  view: readonly DemoToggle[];
  /** Data simulation and debugging switches, in the View menu's last section, Demo. */
  demo: readonly DemoToggle[];
  /** Show a menu's new labels after a `cycleToggle` entry changes state, e.g. with `toolbar.update`. */
  relabel?(id: string, options: ToolbarMenuItem['options']): void;
}

/**
 * The demo top bar: the shell's default toolbar (`defaultToolbarItems`) plus the
 * View menu. Chart style and the Layers menu are in the list but hidden: users
 * add them back with Customize toolbar. Layers holds compare; View has Panels, Display and Demo sections.
 * Drawing tools and hiding drawings stay on the rail; theme, accessibility,
 * colours, language and direction are in the settings dialog (`demoSettings`).
 * The demo has no bottom bar; the timezone is in the chart settings' Time section.
 */
export function demoToolbar(ctx: DemoToolbarContext): ToolbarItem[] {
  // The demo has one symbol to compare, so the entry turns it on and off.
  const compareToggle = asToggle({
    ...compare((chart) => {
      const current = chart.compared[0];
      if (!current) return ctx.compareSymbol();
      current.remove();
      return null;
    }),
    label: 'Compare with another symbol (percent)',
  });
  const inSection = (section: string, toggles: readonly DemoToggle[]) => toggles.map((t) => ({ ...t, section }));
  const layers = [...ctx.layers, compareToggle];
  const view = [
    ...inSection('Panels', ctx.view),
    ...inSection(
      'Display',
      ctx.display.map((toggle) => ({ ...toggle, value: `display:${toggle.value}` })),
    ),
    ...inSection('Demo', ctx.demo),
  ];
  const byValue = (toggles: readonly DemoToggle[], value: string) => toggles.find((t) => t.value === value);
  const viewOptions = (chart?: Chart) =>
    view.map(({ value, label, labelOf, icon, section }) => ({ value, label: chart && labelOf ? labelOf(chart) : label, icon, section }));

  const layersMenu: ToolbarMenuItem = {
    type: 'menu',
    id: 'layers',
    group: 'analysis',
    label: 'Layers',
    icon: Layers,
    text: 'Layers',
    options: layers.map(({ value, label, icon, section }) => ({ value, label, icon, section })),
    onSelect: (value, chart) => byValue(layers, value)?.toggle(chart),
    isChecked: (value, chart) => byValue(layers, value)?.isOn(chart) ?? false,
  };
  const viewMenu: ToolbarMenuItem = {
    // Panels, display switches and demo switches.
    type: 'menu',
    id: 'view',
    group: 'view',
    label: 'View',
    icon: PanelsTopLeft,
    options: viewOptions(),
    onSelect: (value, chart) => {
      const entry = byValue(view, value);
      entry?.toggle(chart);
      if (entry?.labelOf) ctx.relabel?.('view', viewOptions(chart));
    },
    isChecked: (value, chart) => byValue(view, value)?.isOn(chart) ?? false,
  };

  return [
    // The shell's default toolbar, with the demo's own interval handler (it also updates its title and
    // session profiles on a switch).
    ...defaultToolbarItems().map((item) =>
      item.id === 'interval'
        ? intervals(ctx.intervals, { display: 'menu', value: ctx.interval, onChange: (interval) => ctx.onInterval(interval) })
        : item,
    ),
    // Hidden to keep the bar minimal; Customize toolbar adds them back.
    { ...chartStyle(CHART_TYPES), hidden: true },
    { ...layersMenu, hidden: true },
    // Panels, display and demo switches stay on the bar.
    viewMenu,
  ];
}

/** A preset button as a View menu entry: checked while the button would show pressed. */
function asToggle(item: ToolbarButtonItem): DemoToggle {
  return {
    value: item.id,
    label: item.label,
    icon: item.icon,
    isOn: (chart) => item.isActive?.(chart) ?? false,
    // The presets do not use the button element; a detached one stands in for it.
    toggle: (chart) => item.onClick(chart, document.createElement('button')),
  };
}

/** Series options for a chart type; the outline entries are candles with border colors. */
function candleStyle(value: string): Partial<CandleSeriesOptions> {
  const outline = value === 'outlined' || value === 'bodies';
  return {
    style: (outline ? 'candles' : value) as CandleStyle,
    upBorderColor: outline ? '#e6e6ec' : undefined,
    downBorderColor: outline ? '#e6e6ec' : undefined,
    borders: value !== 'bodies',
    wicks: value !== 'bodies',
  };
}

// The built-in styles in their menu order, with two outline variants of candles in the candles' section.
// Every entry sets borders and wicks, so leaving an outline variant restores them.
const CHART_TYPES: ChartStyleOption[] = chartStyles
  .flatMap((style) =>
    style.value === 'candles'
      ? [
          style,
          // Outlined candles, and the same with outlines and wicks turned off.
          { ...style, value: 'outlined', label: 'Outlined candles', labelKey: undefined, icon: chartTypeIcons.outlined! },
          { ...style, value: 'bodies', label: 'Candles, no outline or wicks', labelKey: undefined, icon: chartTypeIcons.bodies! },
        ]
      : [style],
  )
  .map((entry) => ({ ...entry, options: candleStyle(entry.value) }));

