import type { Chart } from './chart';
import type { DrawingToolDef } from './drawing/types';
import { ChartError } from './errors';
import type { IndicatorDef, InputValue } from './indicators/types';
import type { Primitive, PrimitiveTarget } from './primitives';
import type { CustomSeries, CustomSeriesBaseOptions, CustomSeriesDef } from './series';
import type { Pane } from './pane';
import type { FramePhase, RedrawReason, RenderStats } from './render-stats';
import type { Time } from './types';
import { satisfies } from './util/semver';
import { CORE_VERSION } from './version';
import { isText } from './util/records';
import { isDev } from './util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/**
 * A bundle of extensions installed in one step with `chart.install`: drawing
 * tools, indicators, custom series, primitives. Everything `install` adds
 * through its context is removed again on uninstall.
 */
export interface ChartPlugin {
  /** Unique per chart, e.g. the package name. */
  name: string;
  version: string;
  /** Range of core versions it works with, e.g. `'^0.1.0'`; checked against `CORE_VERSION`. */
  requires?: string;
  /**
   * Add the plugin's contributions through `ctx`. May return a function that
   * undoes anything else it set up; it runs on uninstall, before the
   * contributions are removed.
   */
  install(ctx: PluginContext): void | (() => void);
}

/** What a plugin's `install` gets: the chart's registration calls, remembered so uninstall can undo them. */
export interface PluginContext {
  readonly chart: Chart;
  readonly coreVersion: string;
  /** Add a drawing tool; one with the same type is replaced while the plugin is installed. */
  registerDrawingTool(def: DrawingToolDef): void;
  /** Register an indicator definition, as `chart.indicators.register` does. */
  registerIndicator<I extends Record<string, InputValue>>(def: IndicatorDef<I>): void;
  /** Add a custom series, removed on uninstall. */
  addCustomSeries<D extends { time: Time }, O extends object>(
    def: CustomSeriesDef<D, O>,
    options?: Partial<O & CustomSeriesBaseOptions<D>>,
    pane?: Pane,
  ): CustomSeries<D, O>;
  /** Attach a primitive, detached on uninstall. Returns a function that detaches it earlier. */
  attachPrimitive(primitive: Primitive, target?: PrimitiveTarget): () => void;
  /** Watch the chart's frames, e.g. to time them, until uninstall. */
  onFrame(observer: FrameObserver): void;
  /** Run `fn` on uninstall. */
  onDispose(fn: () => void): void;
  /**
   * What a layer above the chart offers plugins under `name`, e.g. `'shell'`
   * for the UI package's shell (see its `shellOf`); undefined when absent.
   */
  host<T>(name: string): T | undefined;
}

/**
 * Watches the chart's frame loop (`PluginContext.onFrame`). Every member is
 * optional and called synchronously, so keep them cheap: `request` runs on
 * every redraw request, the others on every drawn frame.
 */
export interface FrameObserver {
  /** Something asked for a frame; `reason` says what. */
  request?(reason: RedrawReason): void;
  /** A frame starts drawing. */
  start?(): void;
  /** The frame finished `phase`, or work between phases when null. */
  lap?(phase: FramePhase | null): void;
  /** The frame is drawn; `kind` says which layers it redrew, as `RenderStats.kind`. */
  end?(kind: RenderStats['kind']): void;
}

interface Installed {
  plugin: ChartPlugin;
  /** Undo steps, run last first. */
  undo: (() => void)[];
}

/** The plugins installed in one chart. */
export class PluginRegistry {
  readonly #installed = new Map<string, Installed>();
  /** Hosts offered to plugins by name (see `Chart.setPluginHost`). */
  readonly #hosts = new Map<string, unknown>();
  /** Drawing tools the installed plugins registered. */
  readonly #tools = new Set<DrawingToolDef>();
  /** Indicator definitions the installed plugins registered. */
  readonly #indicators = new Set<IndicatorDef>();

  readonly #chart: Chart;

  constructor(chart: Chart) {
    this.#chart = chart;
  }

  /** Offer `host` to plugins under `name`, or withdraw it with null. */
  setHost(name: string, host: unknown): void {
    if (host === null) this.#hosts.delete(name);
    else this.#hosts.set(name, host);
  }

  /** Names of the installed plugins, in install order. */
  get names(): string[] {
    return [...this.#installed.keys()];
  }

  /** Drawing tools the installed plugins registered, oldest first. */
  get drawingTools(): DrawingToolDef[] {
    return [...this.#tools];
  }

  /** Indicator definitions the installed plugins registered, oldest first. */
  get indicators(): IndicatorDef[] {
    return [...this.#indicators];
  }

  install(plugin: ChartPlugin): () => void {
    const { name } = plugin;
    if (!isText(name)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'A plugin needs a name' : '');
    if (this.#installed.has(name)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Plugin "${name}" is already installed` : '');
    checkRequires(plugin);
    const entry: Installed = { plugin, undo: [] };
    try {
      const dispose = plugin.install(this.context(entry));
      if (typeof dispose === 'function') entry.undo.push(dispose);
    } catch (error) {
      runUndo(entry);
      throw error;
    }
    this.#installed.set(name, entry);
    return () => {
      if (this.#installed.get(name) === entry) this.uninstall(name);
    };
  }

  /** Remove a plugin and everything it added; false when no plugin has that name. */
  uninstall(name: string): boolean {
    const entry = this.#installed.get(name);
    if (!entry) return false;
    this.#installed.delete(name);
    runUndo(entry);
    return true;
  }

  /** Uninstall every plugin, newest first. */
  dispose(): void {
    for (const name of this.names.reverse()) this.uninstall(name);
  }

  private context(entry: Installed): PluginContext {
    const chart = this.#chart;
    const undo = (fn: () => void) => entry.undo.push(fn);
    return {
      chart,
      coreVersion: CORE_VERSION,
      registerDrawingTool: (def) => {
        const previous = chart.drawings.getTools().find((t) => t.type === def.type);
        chart.drawings.register(def);
        // Remembered while the plugin is installed, so drawings installed again get the tool back.
        this.#tools.add(def);
        undo(() => {
          this.#tools.delete(def);
          // Drawings may have gone first: then there is nothing to take the tool from.
          const drawings = chart.drawingLayer;
          if (previous) drawings?.register(previous);
          else drawings?.unregister(def.type);
        });
      },
      registerIndicator: (def) => {
        const id = (def as { id: string }).id;
        const indicators = chart.indicators;
        const had = indicators.getDefinitions().some((d) => d === (def as unknown));
        indicators.register(def);
        // A definition the app registered itself stays when the plugin goes. Remembered while the plugin
        // is installed, so indicators installed again get it back.
        if (had) return;
        const known = def as unknown as IndicatorDef;
        this.#indicators.add(known);
        undo(() => {
          this.#indicators.delete(known);
          chart.indicatorLayer?.unregister(id);
        });
      },
      addCustomSeries: (def, options, pane) => {
        const series = chart.addCustomSeries(def, options, pane);
        undo(() => chart.removeSeries(series));
        return series;
      },
      attachPrimitive: (primitive, target) => {
        const detach = chart.attachPrimitive(primitive, target);
        undo(detach);
        return detach;
      },
      onFrame: (observer) => undo(chart.observeFrames(observer)),
      onDispose: undo,
      host: <T>(name: string) => this.#hosts.get(name) as T | undefined,
    };
  }
}

function checkRequires(plugin: ChartPlugin): void {
  const range = plugin.requires;
  if (range === undefined) return;
  const context = { plugin: plugin.name, version: plugin.version, requires: range, coreVersion: CORE_VERSION };
  let ok: boolean;
  try {
    ok = satisfies(CORE_VERSION, range);
  } catch (cause) {
    throw new ChartError('plugin-incompatible', /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Plugin "${plugin.name}" has an invalid requires range "${range}"` : '', { cause, context });
  }
  if (!ok) {
    throw new ChartError(
      'plugin-incompatible',
      /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Plugin "${plugin.name}" requires core ${range}, but this is ${CORE_VERSION}` : '',
      { context },
    );
  }
}

/** Run a plugin's undo steps, newest first. One that throws is logged; the rest still run. */
function runUndo(entry: Installed): void {
  for (const fn of entry.undo.splice(0).reverse()) {
    try {
      fn();
    } catch (error) {
      console.error(`Uninstalling plugin "${entry.plugin.name}" failed in part`, error);
    }
  }
}
