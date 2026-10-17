import type { AccessRule } from '../access';
import type { Pane } from '../pane';
import type { Series } from '../series';
import type { Bar } from '../types';
import type { DataSource } from '../data/types';
import { ExternalFeed, type FeedContext } from './external';
import { IntervalFeed } from './intervals';
import type { HistoryStep, UndoSteps } from '../history';
import { Indicator, indicatorTitle, validateIndicatorDef, type IndicatorEdits, type IndicatorOwner } from './indicator';
import { IndicatorRunner, resolveInputs, salvageInputs, syncRunners, type BarColumns } from './runner';
import type { IndicatorSeries } from './series';
import type { IndicatorDef, IndicatorState, IndicatorStatus, InputValue, IntervalRange } from './types';
import {
  INDICATOR_SET_VERSION,
  parseIndicatorSet,
  setScope,
  type IndicatorSet,
  type IndicatorSetApplyOptions,
  type IndicatorSetResult,
  type IndicatorSetSkip,
} from './sets';
import { isRecord, isScaleId, parseIndicatorStates } from './state';
import { errorText } from '../errors';
import type { Localizer } from '../util/locale';
import { searchIndicators } from './search';
import { isDev } from '../util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** Events emitted by the indicator manager, by name: indicators added, removed, changed or refused, compute errors, and external data status. */
export interface IndicatorEvents {
  'indicator:add': { indicator: Indicator };
  'indicator:remove': { indicator: Indicator };
  /**
   * Inputs or visibility changed through the handle, or the indicator went
   * live or pending because its definition was registered or unregistered.
   */
  'indicator:change': { indicator: Indicator };
  /**
   * `compute` or `update` threw (the plots show no values), or restored state
   * did not fit the definition and defaults replaced the parts that didn't.
   */
  'indicator:error': { indicator: Indicator; error: unknown };
  /** The load state of an indicator's external data, or its message, changed (see `Indicator.status`). */
  'indicator:status': { indicator: Indicator; status: IndicatorStatus; message: string | null };
  /**
   * `add()` or `duplicate()` refused an indicator: the access rule
   * (`access.allow`) said no (`'blocked'`), or the chart already holds
   * `limit` indicators (`'limit'`).
   * The call throws after this fires; apps show an upgrade prompt or a notice here.
   */
  'indicator:refuse': { type: string; reason: IndicatorRefusal };
  /** `setAccess()` or `setLimit()` was called: which indicators may be added changed. */
  'indicators:access-change': { allow: AccessRule | null; limit: number | null };
}

/**
 * Why an indicator would be refused: the access rule said no (`'blocked'`),
 * or the chart is at its indicator limit (`'limit'`). `access.refused` is
 * how built-in UI shows either; this is why.
 */
export type IndicatorRefusal = 'blocked' | 'limit';

/** Options for adding an indicator: its price scale, whether it shows in the legend and is saved, whether limits apply, and where it draws. */
export interface IndicatorAddOptions {
  /**
   * Price scale id in the indicator's pane, overriding the definition's
   * `priceScale` (default `'right'`). Kept in saved state.
   */
  priceScale?: string;
  /** `false` leaves the indicator out of the legend. Default true. */
  legend?: boolean;
  /**
   * Where a definition with `placement: 'either'` draws: on the price pane
   * (`'overlay'`, the default) or in a new pane (`'pane'`). Ignored for
   * definitions with a fixed placement.
   */
  placement?: 'overlay' | 'pane';
  /** `false` leaves it out of `serialize()` and saved layouts, e.g. for indicators the app adds itself. Default true. */
  persist?: boolean;
  /**
   * `false` skips the access rule and the indicator limit, for indicators the
   * app adds itself. The indicator still counts towards the limit. Default true.
   */
  restricted?: boolean;
  /**
   * Where line plots and the fills between them are drawn (default
   * `'gpu'`). `'gpu'` draws them with WebGL2, which costs the CPU far less
   * with many indicators, long histories or frequent redraws. They then draw
   * below every series drawn on the canvas, like candles do; `'canvas'`
   * strokes them with the 2D canvas instead. Copies made by `duplicate` keep
   * it; saved state does not.
   */
  renderer?: 'canvas' | 'gpu';
}

/** What the indicator manager needs from its chart. */
export interface IndicatorHost {
  /**
   * Attach the series drawing `runner`'s plots, in a new pane for `pane`
   * placement. `options.placement` is always set, resolved from the definition.
   */
  createSeries(def: IndicatorDef, runner: IndicatorRunner, title: string, options: IndicatorAddOptions): IndicatorSeries;
  /** Remove `indicator`'s series, and its pane when that is now empty and not the main pane. */
  removeSeries(series: IndicatorSeries, indicator: Indicator): void;
  paneIndex(pane: Pane): number;
  /** The main series' bars. */
  bars(): readonly Bar[];
  /** Bar columns shared by every indicator's runner; each runner keeps its own without. */
  readonly barColumns?: BarColumns;
  /** The data source's symbol and interval once loaded, for indicators with external data. */
  context(): FeedContext | null;
  /** The chart's data source, if any. */
  source(): DataSource | null;
  invalidate(): void;
  emit<K extends keyof IndicatorEvents>(event: K, payload: IndicatorEvents[K]): void;
  /** `indicator` has a new series on the chart (it was added, or registered again). */
  seriesAdded?(series: IndicatorSeries, indicator: Indicator): void;
  /** Nominal length of the bar interval in seconds, or null while unknown. */
  intervalSeconds?(): number | null;
  /** A bar replay is running, so the main series hides its newer bars. */
  replaying?(): boolean;
  /** Put `copy`, just added by `duplicate`, next to `original`'s series. */
  placeCopy?(copy: IndicatorSeries, original: IndicatorSeries): void;
  /** Move `series` onto price scale `id` of its pane (see `Indicator.setPriceScale`). */
  setPriceScale(series: IndicatorSeries, def: IndicatorDef, id: string): void;
  /** Pane operations for indicator sets. */
  readonly sets: IndicatorSetPanes;
  /** The chart's undo history: adding, removing and editing indicators are steps in it. */
  readonly history?: UndoSteps;
  /** The chart's language, for legend titles. */
  localization?(): Localizer;
  /** `indicator` leaves the chart (not by `load`): remove what goes with it, its drawings, in the same undo step. */
  removing?(indicator: Indicator): void;
}

/** What `serializeSet` and `applySet` need from the chart's panes. */
export interface IndicatorSetPanes {
  readonly panes: readonly Pane[];
  /** Append an empty pane. */
  addPane(): Pane;
  /** Remove `pane` unless it is the main pane or holds series, drawings or primitives. */
  removeIfEmpty(pane: Pane): void;
  movePane(pane: Pane, index: number): void;
  moveSeries(series: Series, pane: Pane): void;
  heights(): number[];
  setHeights(weights: readonly number[]): void;
  /** Report the one `state:change` of an applied set. */
  changed(): void;
}

/**
 * Registered indicator definitions and the indicators on the chart. Saved
 * indicators whose definition is not registered stay as pending placeholders
 * and go live once it is.
 */
export class IndicatorManager {
  readonly #defs = new Map<string, IndicatorDef>();
  /**
   * @internal True while `load` replaces the indicators, or a definition
   * (un)registers and its placeholders switch state: the saved states don't
   * change, so the chart does not report a `state:change`.
   */
  loading = false;
  readonly #items: Indicator[] = [];
  readonly #owner: IndicatorOwner;
  #allow: AccessRule | null = null;
  #maxCount: number | null = null;
  /** Each indicator's edits as last seen, the state an undo step of the next edit goes back to. */
  readonly #edits = new WeakMap<Indicator, IndicatorEdits>();
  /** Where each removed indicator was: its place in the list, and whether its series had its pane to itself. */
  readonly #gone = new WeakMap<Indicator, [index: number, alone: boolean, stretch?: number]>();
  /** The indicator whose edits join one undo step (see `mergeEdits`), and that step once recorded. */
  #merging: Indicator | null = null;
  #merged: { step: HistoryStep; before: IndicatorEdits; after: IndicatorEdits } | null = null;
  /** Number of the next indicator id (`ind-<n>`); never goes back, so an id is not given twice. */
  #nextId = 1;

  constructor(private readonly host: IndicatorHost) {
    this.#owner = {
      remove: (indicator) => this.remove(indicator),
      paneIndex: (pane) => host.paneIndex(pane),
      changed: (indicator) => {
        this.#edited(indicator);
        host.emit('indicator:change', { indicator });
      },
      edited: (indicator) => this.#edited(indicator),
      statusChanged: (indicator) =>
        host.emit('indicator:status', { indicator, status: indicator.status, message: indicator.message }),
      intervalSeconds: () => host.intervalSeconds?.() ?? null,
      setPriceScale: (series, def, id) => host.setPriceScale(series, def, id),
      title: (def, inputs) => indicatorTitle(def, inputs, host.localization?.()),
    };
  }

  /**
   * @internal Retitle the live indicators' legend rows in the chart's language
   * after it changed from `previous`. Only titles still as `previous` named
   * them change, so a title the app set stays.
   */
  relabel(previous: Localizer): void {
    for (const { live, inputs } of this.#items) {
      if (!live || live.series.options.title !== indicatorTitle(live.def, inputs, previous)) continue;
      const title = this.#owner.title(live.def, inputs);
      if (title !== live.series.options.title) live.series.applyOptions({ title });
    }
  }

  /**
   * Make a definition available by id, and bring pending indicators of that id
   * to life. Throws when the id is taken by a different definition; registering
   * the same object again does nothing.
   */
  register<I extends Record<string, InputValue>>(def: IndicatorDef<I>): void {
    const generic = def as unknown as IndicatorDef;
    const existing = this.#defs.get(generic.id);
    if (existing === generic) return;
    if (existing) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator id "${generic.id}" is already registered by another definition` : '');
    validateIndicatorDef(generic);
    this.#defs.set(generic.id, generic);
    this.#quietly(() => {
      for (const indicator of [...this.#items]) {
        // An event handler may have removed it meanwhile.
        if (!indicator.pending || indicator.type !== generic.id || !this.#items.includes(indicator)) continue;
        const problems = this.#revive(indicator, generic);
        this.host.emit('indicator:change', { indicator });
        this.#feed(indicator);
        this.#report(indicator, problems);
      }
    });
  }

  /** Run `fn` with `loading` set, restoring it after (loads may nest through event handlers). */
  #quietly(fn: () => void): void {
    const was = this.loading;
    this.loading = true;
    try {
      fn();
    } finally {
      this.loading = was;
    }
  }

  /** Forget a definition. Its indicators stay on the chart as pending placeholders. */
  unregister(id: string): void {
    if (!this.#defs.delete(id)) return;
    this.#quietly(() => {
      for (const indicator of [...this.#items]) {
        if (indicator.live?.def.id !== id) continue;
        indicator.state = indicator.serialize();
        this.#teardown(indicator);
        this.host.emit('indicator:change', { indicator });
      }
    });
  }

  /** Registered definitions in registration order, e.g. for an indicator picker. */
  getDefinitions(): IndicatorDef[] {
    return [...this.#defs.values()];
  }

  /**
   * Registered definitions matching `query`, best first, ranked by `matchRank`
   * (name, aliases, id, acronym, one typo, description, then category); ties keep
   * registration order and an empty query returns them all. Access rules do not filter it.
   */
  search(query: string): IndicatorDef[] {
    return searchIndicators(this.getDefinitions(), query);
  }

  /**
   * Limit the indicators `add()` and `duplicate()` accept: `allow` is the
   * same rule as the chart's `access.allow` option, asked with
   * `{ kind: 'indicator', id }`; `null` allows every indicator. Indicators
   * already on the chart stay, and saved layouts (`load()`) are not
   * restricted. The option sets this too.
   */
  setAccess(allow: AccessRule | null): void {
    if (allow !== null && typeof allow !== 'function') throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Indicator access must be a function or null' : '');
    this.#allow = allow;
    this.#emitAccess();
  }

  /** The rule `setAccess()` set, or `null` when every indicator is allowed. */
  get access(): AccessRule | null {
    return this.#allow;
  }

  /** Whether indicator id `type` passes the access rule, the limit aside. */
  isAllowed(type: string): boolean {
    return !this.#allow || this.#allow({ kind: 'indicator', id: type });
  }

  /**
   * Cap how many indicators the chart holds, pending ones included: `add()`
   * and `duplicate()` refuse more. `null` removes the cap. Indicators already
   * past a lowered cap stay. Throws unless `null` or a non-negative integer.
   */
  setLimit(limit: number | null): void {
    if (limit !== null && !(Number.isInteger(limit) && limit >= 0)) {
      throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator limit must be a non-negative integer or null, got ${String(limit)}` : '');
    }
    this.#maxCount = limit;
    this.#emitAccess();
  }

  /** Most indicators the chart may hold, or `null` for no cap. */
  get limit(): number | null {
    return this.#maxCount;
  }

  /** Why `add(type)` would be refused now, or `null` when it would be accepted. */
  refusal(type: string): IndicatorRefusal | null {
    if (!this.isAllowed(type)) return 'blocked';
    if (this.#maxCount !== null && this.#items.length >= this.#maxCount) return 'limit';
    return null;
  }

  /**
   * Add an indicator computed from the main series, by registered id or by
   * definition (registered on first use). `overlay` indicators draw on the
   * price pane; `pane` indicators get a new pane they own; `either`
   * indicators follow `options.placement`. Throws on an unknown id, on
   * unknown or invalid inputs, and when the access rule or the indicator
   * limit refuses it (after `indicator:refuse`).
   */
  add<I extends Record<string, InputValue>>(
    def: IndicatorDef<I> | string,
    inputs: Partial<I> = {},
    options: IndicatorAddOptions = {},
  ): Indicator<I> {
    if (options.priceScale !== undefined && !isScaleId(options.priceScale)) {
      throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator priceScale must be a non-empty string, got ${String(options.priceScale)}` : '');
    }
    if (options.renderer !== undefined && options.renderer !== 'canvas' && options.renderer !== 'gpu') {
      throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator renderer must be 'canvas' or 'gpu', got ${String(options.renderer)}` : '');
    }
    let generic: IndicatorDef;
    if (typeof def === 'string') {
      const found = this.#defs.get(def);
      if (!found) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Unknown indicator "${def}": register its definition first` : '');
      generic = found;
      if (options.restricted !== false) this.#enforce(def);
    } else {
      if (options.restricted !== false) this.#enforce(def.id);
      this.register(def);
      generic = def as unknown as IndicatorDef;
    }
    const resolved = resolveInputs(generic.inputs, inputs as Record<string, InputValue>);
    const state: IndicatorState = { id: this.#newId(), type: generic.id, version: generic.version ?? 1, inputs: resolved, pane: 0, visible: true };
    const placement = resolvePlacement(generic, options.placement);
    const indicator = new Indicator<I>(state, { ...options, placement }, this.#owner);
    this.#items.push(indicator);
    this.#activate(indicator, generic, resolved);
    indicator.syncInterval();
    this.host.emit('indicator:add', { indicator });
    this.#feed(indicator);
    this.#record(indicator, true);
    return indicator;
  }

  /**
   * Add a copy of `indicator`: the same inputs, visibility, intervals, plot
   * styles, label switches and add options. An overlay's copy goes into the
   * original's pane; a pane indicator's copy gets a new pane right below the
   * original's.
   * A pending indicator gets a pending copy. Throws when `indicator` is not
   * on this chart, and when the access rule or the indicator limit refuses
   * the copy (after `indicator:refuse`), whatever the original's `restricted`.
   */
  duplicate<I extends Record<string, InputValue>>(indicator: Indicator<I>): Indicator<I> {
    if (!this.#items.includes(indicator as unknown as Indicator)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'duplicate: indicator is not on this chart' : '');
    this.#enforce(indicator.type);
    const state = indicator.serialize();
    const copy = new Indicator<I>({ ...state, id: this.#newId(), inputs: { ...state.inputs } }, { ...indicator.options }, this.#owner);
    copy.applyLabelOptions(indicator.labelOptions);
    const generic = copy as unknown as Indicator;
    this.#items.push(generic);
    const def = indicator.def as unknown as IndicatorDef | null;
    if (def) {
      this.#activate(generic, def, { ...indicator.inputs });
      const series = generic.live!.series;
      if (!state.visible) series.setVisible(false);
      const original = indicator.series;
      if (original) this.host.placeCopy?.(series, original);
      generic.syncInterval();
    }
    this.host.emit('indicator:add', { indicator: generic });
    this.#feed(generic);
    this.#record(generic, true);
    return copy;
  }

  /** @internal The bar interval may have changed: show or hide indicators limited to some intervals. */
  intervalChanged(): void {
    for (const indicator of [...this.#items]) indicator.syncInterval();
  }

  /** Remove an indicator with the drawings tied to it, and its pane when it owns one. */
  remove(indicator: Indicator): void {
    this.#remove(indicator, false);
  }

  /** Remove `indicator`; its drawings too unless `alone` (a `load` replacing it). */
  #remove(indicator: Indicator, alone: boolean): void {
    const i = this.#items.indexOf(indicator);
    if (i < 0) return;
    const history = this.host.history;
    history?.begin();
    if (!alone) this.host.removing?.(indicator);
    const pane = indicator.pane;
    this.#gone.set(indicator, [i, !pane || pane.series.length === 1, pane?.stretch]);
    this.#items.splice(i, 1);
    // Snapshot first, so the handle keeps reporting its last state.
    if (indicator.live) indicator.state = indicator.serialize();
    indicator.removed = true;
    this.#teardown(indicator);
    this.host.emit('indicator:remove', { indicator });
    this.#record(indicator, false);
    history?.commit();
  }

  /** Indicators in the order they were added, pending placeholders included. */
  getAll(): Indicator[] {
    return [...this.#items];
  }

  /** The indicator with `id` (see `Indicator.id`), pending ones included. */
  getById(id: string): Indicator | undefined {
    return this.#items.find((indicator) => indicator.id === id);
  }

  /** States to save; indicators added with `persist: false` are left out. */
  serialize(): IndicatorState[] {
    return this.#items.filter((indicator) => indicator.options.persist !== false).map((indicator) => indicator.serialize());
  }

  /**
   * Replace every indicator with saved `states`. Throws, changing nothing, when
   * the payload is not a list of indicator states. Unknown ids become pending
   * placeholders; older versions go through the definition's `migrate`; inputs
   * that still don't fit take their defaults and emit `indicator:error`.
   */
  load(states: unknown): void {
    const parsed = parseIndicatorStates(states);
    const load = () =>
      this.#quietly(() => {
        for (const indicator of [...this.#items]) this.#remove(indicator, true);
        const ids = new Set<string>();
        for (const saved of parsed) {
          // Saved ids stay, so tied drawings find their indicator; a missing or repeated one is replaced.
          const id = saved.id && !ids.has(saved.id) ? saved.id : this.#newId();
          ids.add(id);
          const n = /^ind-(\d+)$/.exec(id);
          if (n) this.#nextId = Math.max(this.#nextId, Number(n[1]) + 1);
          const state = { ...saved, id };
          const indicator = new Indicator(state, state.priceScale ? { priceScale: state.priceScale } : {}, this.#owner);
          this.#items.push(indicator);
          this.#edits.set(indicator, indicator.edits);
          const def = this.#defs.get(state.type);
          const problems = def ? this.#revive(indicator, def) : [];
          this.host.emit('indicator:add', { indicator });
          this.#feed(indicator);
          this.#report(indicator, problems);
        }
      });
    const history = this.host.history;
    if (!history) return load();
    // The old indicators' steps would bring them back: the history starts over for indicators.
    history.mute(load);
    history.drop(this);
  }

  /**
   * The saved indicators as a set to keep as a template: their states, the
   * panes they share and those panes' heights relative to the price pane.
   * `appliesOn` scopes the set to some intervals (see `indicatorSetFits`);
   * throws when it is not a non-empty list of valid interval ranges.
   */
  serializeSet(options: { appliesOn?: IntervalRange[] } = {}): IndicatorSet {
    const appliesOn = setScope(options.appliesOn);
    return { ...this.#setOf(this.serialize()), ...(appliesOn ? { appliesOn } : {}) };
  }

  /** @internal `indicator` alone as a set, for the clipboard: on the price pane, or in a pane of its own. */
  copySet(indicator: Indicator): IndicatorSet {
    return this.#setOf([indicator.serialize()]);
  }

  /** `states` as a set: the panes they use renumbered from 1 in chart order, with their heights. */
  #setOf(states: IndicatorState[]): IndicatorSet {
    const panes = [...new Set(states.map((s) => s.pane).filter((p) => p > 0))].sort((a, b) => a - b);
    const heights = this.host.sets.heights();
    return {
      version: INDICATOR_SET_VERSION,
      // Templates and copies hold no ids: what is added from them gets new ones.
      indicators: states.map(({ id: _id, ...s }) => ({ ...s, pane: panes.indexOf(s.pane) + 1 })),
      ...(panes.length > 0 ? { paneHeights: panes.map((p) => (heights[p] ?? 0) / (heights[0] || 1)) } : {}),
    };
  }

  /**
   * Add the indicators of a set made by `serializeSet`, replacing the saved
   * ones unless `replace` is false. Each of the set's panes becomes one new
   * pane, with its saved height. Entries that are unknown, malformed, refused
   * or (when adding) already on the chart with the same inputs are skipped
   * and returned, not thrown. Throws, changing nothing, when `set` is not a
   * valid indicator set, and when adding its indicators fails (those added
   * are removed again). Fires one `state:change` for the whole set.
   */
  applySet(set: unknown, options: IndicatorSetApplyOptions = {}): IndicatorSetResult {
    return this.#apply(set, options.replace !== false, false);
  }

  /**
   * @internal Add the indicators of a copied set (`copySet`) to the chart,
   * also when it already shows them: a paste duplicates.
   */
  pasteSet(set: unknown): IndicatorSetResult {
    return this.#apply(set, false, true);
  }

  #apply(set: unknown, replace: boolean, copies: boolean): IndicatorSetResult {
    const entries = parseIndicatorSet(set);
    const ops = this.host.sets;
    const main = ops.panes[0]!;
    const old = replace ? this.#items.filter((ind) => ind.options.persist !== false) : [];
    const result: IndicatorSetResult = { added: [], skipped: [] };
    // Decide every entry before changing anything; the limit counts the chart as it will be.
    let count = this.#items.length - old.length;
    const accepted: { state: IndicatorState; def: IndicatorDef; height?: number }[] = [];
    entries.forEach(({ state, type, height }, index) => {
      const def = state && this.#defs.get(state.type);
      let reason: IndicatorSetSkip | null = !state
        ? 'invalid'
        : !def
          ? 'unknown'
          : !this.isAllowed(state.type)
            ? 'blocked'
            : this.#maxCount !== null && count >= this.#maxCount
              ? 'limit'
              : null;
      if (!reason && !replace && !copies) {
        const inputs = JSON.stringify(restoreInputs(def!, state!).inputs);
        if (this.#items.some((ind) => ind.type === type && JSON.stringify(ind.inputs) === inputs)) reason = 'exists';
      }
      if (reason === 'blocked' || reason === 'limit') this.host.emit('indicator:refuse', { type, reason });
      if (reason) result.skipped.push({ index, type, reason });
      else {
        count++;
        accepted.push({ state: state!, def: def!, height });
      }
    });
    const targets = new Map<number, Pane>();
    const heights = new Map<number, number>();
    // One undo step for the whole set, with the pane heights from before and after it.
    const history = accepted.length + old.length > 0 ? this.host.history : undefined;
    const before = ops.heights();
    history?.begin();
    history?.record({ owner: this, undo: () => ops.setHeights(before), redo: () => {} });
    this.#quietly(() => {
      try {
        for (const { state, def, height } of accepted) {
          const indicator = new Indicator({ ...state, id: this.#newId() }, state.priceScale ? { priceScale: state.priceScale } : {}, this.#owner);
          this.#items.push(indicator);
          result.added.push(indicator);
          const problems = this.#revive(indicator, def);
          const series = indicator.live!.series;
          const p = state.pane;
          const target = p === 0 ? main : targets.get(p);
          if (target) {
            if (series.pane !== target) ops.moveSeries(series, target);
          } else {
            if (series.pane === main) ops.moveSeries(series, ops.addPane());
            targets.set(p, series.pane);
          }
          if (height) heights.set(p, height);
          this.host.emit('indicator:add', { indicator });
          this.#feed(indicator);
          this.#report(indicator, problems);
          this.#record(indicator, true);
        }
      } catch (error) {
        // Undo, so the chart keeps the indicators it had, and the history no step of the set.
        history?.cancel();
        const undo = () => {
          for (const ind of result.added) this.remove(ind);
          for (const pane of targets.values()) ops.removeIfEmpty(pane);
        };
        if (history) history.mute(undo);
        else undo();
        throw error;
      }
      // Panes the old indicators shared (e.g. an overlay moved into an oscillator's pane) outlive them.
      const shared = new Set(old.flatMap((ind) => (ind.pane ? [ind.pane] : [])));
      for (const ind of old) this.remove(ind);
      for (const pane of shared) ops.removeIfEmpty(pane);
      // New panes were appended: order them as in the set, then size them.
      const placed = [...targets].sort(([a], [b]) => a - b);
      const first = ops.panes.length - placed.length;
      placed.forEach(([, pane], k) => ops.movePane(pane, first + k));
      if (heights.size > 0) {
        const weights = ops.heights();
        for (const [p, pane] of placed) {
          const ratio = heights.get(p);
          if (ratio) weights[ops.panes.indexOf(pane)] = weights[0]! * ratio;
        }
        ops.setHeights(weights);
      }
    });
    const after = ops.heights();
    history?.record({ owner: this, undo: () => {}, redo: () => ops.setHeights(after) });
    history?.commit();
    if (result.added.length + old.length > 0) ops.changed();
    return result;
  }

  /** Most bars any live indicator needs before its first valid value. */
  get lookback(): number {
    return this.#items.reduce((most, indicator) => Math.max(most, indicator.lookback), 0);
  }

  /**
   * @internal Main data loaded (a new symbol or interval, or older history):
   * external data follows, fetching what the new bars need.
   */
  dataLoaded(): void {
    for (const indicator of [...this.#items]) indicator.live?.feed?.sync();
  }

  /**
   * @internal The data source corrected bars it had sent (`data:loaded` kind
   * `reset`): external rows may be stale too, so fetch them again.
   */
  dataReset(): void {
    for (const indicator of [...this.#items]) indicator.live?.feed?.refetch();
  }

  /** @internal Runners of the live indicators. */
  runners(): IndicatorRunner[] {
    return this.#items.flatMap((indicator) => (indicator.live ? [indicator.live.runner] : []));
  }

  /** @internal The main bars changed by `change`: hand them to the live indicators' runners. */
  syncBars(bars: readonly Bar[], change: 'reset' | 'append' | 'tick' | 'prepend', count = 0): void {
    syncRunners(this.runners(), bars, change, count);
  }

  /**
   * @internal The chart removed an indicator's series itself (`removeSeries`,
   * or with its pane): drop the indicator without touching the chart again.
   */
  seriesRemoved(series: Series): void {
    const i = this.#items.findIndex((indicator) => indicator.live?.series === series);
    if (i < 0) return;
    const indicator = this.#items[i]!;
    const history = this.host.history;
    history?.begin();
    this.host.removing?.(indicator);
    this.#items.splice(i, 1);
    this.#gone.set(indicator, [i, series.pane.series.length === 0, series.pane.stretch]);
    // A pane already gone from the chart keeps the last known index.
    const last = indicator.serialize();
    indicator.state = last.pane < 0 ? { ...last, pane: indicator.state.pane } : last;
    indicator.removed = true;
    indicator.live!.runner.dispose();
    indicator.live = null;
    this.#releaseColumns();
    indicator.setFeedStatus('idle', null);
    this.host.emit('indicator:remove', { indicator });
    this.#record(indicator, false);
    history?.commit();
  }

  /**
   * @internal Record the edits of `indicator` as one undo step until called
   * with another indicator or null, e.g. while its settings dialog is open.
   * Edits that end where they began (a cancelled dialog) leave no step.
   */
  mergeEdits(indicator: Indicator | null): void {
    this.#merging = indicator;
    this.#merged = null;
  }

  /** `indicator` may have been edited: record an undo step from its last seen edits, unless nothing undo keeps changed. */
  #edited(indicator: Indicator): void {
    const before = this.#edits.get(indicator);
    const after = indicator.edits;
    this.#edits.set(indicator, after);
    const history = this.host.history;
    if (!history || !before || sameJson(before, after)) return;
    const merged = this.#merged;
    if (merged && indicator === this.#merging && history.last === merged.step) {
      merged.after = after;
      if (sameJson(merged.before, after)) {
        history.drop(merged.step);
        this.#merged = null;
      }
      return;
    }
    const edit = { before, after, step: { owner: this, undo: () => indicator.restoreEdits(edit.before), redo: () => indicator.restoreEdits(edit.after) } };
    if (history.record(edit.step) && indicator === this.#merging) this.#merged = edit;
  }

  /** A new indicator id, `ind-<n>`. */
  #newId(): string {
    return `ind-${this.#nextId++}`;
  }

  /** Record adding (`added`) or removing `indicator` as an undo step. */
  #record(indicator: Indicator, added: boolean): void {
    const remove = () => this.remove(indicator);
    const restore = () => this.#restore(indicator);
    this.host.history?.record({ owner: this, undo: added ? remove : restore, redo: added ? restore : remove });
  }

  /** Put a removed indicator back where it was, as the same handle with the state it had. */
  #restore(indicator: Indicator): void {
    const gone = this.#gone.get(indicator);
    if (!gone || !indicator.removed) return;
    this.#gone.delete(indicator);
    const [index, alone, stretch] = gone;
    indicator.removed = false;
    this.#items.splice(Math.min(index, this.#items.length), 0, indicator);
    const def = this.#defs.get(indicator.type);
    if (def) {
      this.#revive(indicator, def);
      this.#place(indicator.live!.series, indicator.state.pane, alone, stretch);
    }
    this.host.emit('indicator:add', { indicator });
    this.#feed(indicator);
  }

  /**
   * Move a restored indicator's series to pane `p`: into the pane there, or
   * into a new pane there, `stretch` high, when it had one to itself.
   */
  #place(series: IndicatorSeries, p: number, alone: boolean, stretch?: number): void {
    const ops = this.host.sets;
    const there = ops.panes[p];
    const target = p === 0 ? there : there && there !== series.pane && (!alone || there.series.length === 0) ? there : undefined;
    if (target) {
      if (target !== series.pane) ops.moveSeries(series, target);
      return;
    }
    if (series.pane === ops.panes[0]) ops.moveSeries(series, ops.addPane());
    ops.movePane(series.pane, p);
    if (!stretch) return;
    // Sparse: the other panes keep their heights.
    const weights: number[] = [];
    weights[ops.panes.indexOf(series.pane)] = stretch;
    ops.setHeights(weights);
  }

  /** Make a pending indicator live from its saved state; returns what had to be replaced. */
  #revive(indicator: Indicator, def: IndicatorDef): string[] {
    const { inputs, problems } = restoreInputs(def, indicator.state);
    // Saved state has no placement: an `either` indicator saved below the price pane had its own.
    indicator.options.placement = resolvePlacement(def, indicator.state.pane > 0 ? 'pane' : 'overlay');
    this.#activate(indicator, def, inputs);
    if (!indicator.state.visible) indicator.live!.series.setVisible(false);
    indicator.syncInterval();
    return problems;
  }

  #activate(indicator: Indicator, def: IndicatorDef, inputs: Record<string, InputValue>): void {
    let runner: IndicatorRunner | null = null;
    // Fetched rows and other intervals' bars may load side by side: show the more telling status.
    const shown: FeedStatus[] = [
      ['idle', null],
      ['idle', null],
    ];
    const status = (i: number) => (s: IndicatorStatus, message: string | null) => {
      shown[i] = [s, message];
      indicator.setFeedStatus(...(statusRank(shown[1]!) < statusRank(shown[0]!) ? shown[1]! : shown[0]!));
    };
    const feed =
      def.fetch || def.subscribe
        ? new ExternalFeed(def, {
            context: () => this.host.context(),
            source: () => this.host.source(),
            times: () => runner?.src.time ?? [],
            inputs: () => runner?.inputs ?? inputs,
            changed: (time) => runner?.externalChanged(time),
            status: status(0),
            error: (error) => this.host.emit('indicator:error', { indicator, error }),
          })
        : null;
    const intervals = def.intervals
      ? new IntervalFeed(def, {
          context: () => this.host.context(),
          source: () => this.host.source(),
          lower: () => runner!.src,
          replaying: () => this.host.replaying?.() ?? false,
          inputs: () => runner?.inputs ?? inputs,
          changed: () => runner?.intervalsChanged(),
          status: status(1),
          error: (error) => this.host.emit('indicator:error', { indicator, error }),
        })
      : null;
    runner = new IndicatorRunner(
      def,
      inputs,
      {
        change: (from) => {
          indicator.live?.series.refresh(from);
          this.host.invalidate();
        },
        error: (error) => this.host.emit('indicator:error', { indicator, error }),
      },
      feed,
      this.host.barColumns,
      intervals,
    );
    const series = this.host.createSeries(def, runner, this.#owner.title(def, inputs), indicator.options);
    series.setPlotStyles(indicator.adoptPlotStyles(def));
    this.host.seriesAdded?.(series, indicator);
    // Label switches set while pending (or before re-registering) carry over.
    series.applyOptions({ ...indicator.labelOptions });
    const both = feed && intervals && {
      sync: () => (feed.sync(), intervals.sync()),
      refetch: () => (feed.refetch(), intervals.refetch()),
    };
    indicator.live = { def, runner, series, feed: both || feed || intervals };
    indicator.refreshStatus();
    this.#edits.set(indicator, indicator.edits);
  }

  /**
   * Compute over the current bars (after listeners heard about the
   * indicator), then fetch external data for them.
   */
  #feed(indicator: Indicator): void {
    indicator.live?.runner.setBars(this.host.bars());
    indicator.live?.feed?.sync();
  }

  #teardown(indicator: Indicator): void {
    const live = indicator.live;
    if (!live) return;
    // Cleared first, so the chart's removeSeries no longer finds this indicator.
    indicator.live = null;
    live.runner.dispose();
    this.#releaseColumns();
    indicator.setFeedStatus('idle', null);
    this.host.removeSeries(live.series, indicator);
  }

  /** The last live indicator went: free the shared bar columns until another arrives. */
  #releaseColumns(): void {
    if (!this.#items.some((indicator) => indicator.live)) this.host.barColumns?.clear();
  }

  /** Throw, after `indicator:refuse`, when the access rule or the limit refuses `type`. */
  #enforce(type: string): void {
    const reason = this.refusal(type);
    if (!reason) return;
    this.host.emit('indicator:refuse', { type, reason });
    const count = `${this.#maxCount} indicator${this.#maxCount === 1 ? '' : 's'}`;
    throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? reason === 'blocked' ? `Indicator "${type}" is not allowed` : `Indicator limit reached: the chart holds ${count}` : '');
  }

  #emitAccess(): void {
    this.host.emit('indicators:access-change', { allow: this.#allow, limit: this.#maxCount });
  }

  #report(indicator: Indicator, problems: string[]): void {
    if (problems.length === 0) return;
    const error = new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Indicator "${indicator.type}" restored with changes: ${problems.join('; ')}` : '');
    this.host.emit('indicator:error', { indicator, error });
  }
}

/** A data feed's load status and message. */
type FeedStatus = [IndicatorStatus, string | null];

/** Rank of a feed status, the most telling lowest: a reason it shows nothing, then errors, loads and data. */
function statusRank([status, message]: FeedStatus): number {
  return status === 'idle' && message !== null ? -1 : ['error', 'loading', 'loaded', 'empty', 'idle'].indexOf(status);
}

/** Whether `a` and `b` are the same as JSON. */
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Where `def` draws when `requested` is asked for: its fixed placement, or the request for `either`. */
export function resolvePlacement(def: IndicatorDef, requested: 'overlay' | 'pane' | undefined): 'overlay' | 'pane' {
  if (def.placement !== 'either') return def.placement;
  return requested === 'pane' ? 'pane' : 'overlay';
}

/**
 * Inputs for `def` from saved state: migrated when saved at an older version,
 * then validated, with unknown inputs dropped and invalid ones at their defaults.
 */
export function restoreInputs(
  def: IndicatorDef,
  state: IndicatorState,
): { inputs: Record<string, InputValue>; problems: string[] } {
  const problems: string[] = [];
  const from = state.version ?? 1;
  const to = def.version ?? 1;
  let values: Record<string, unknown> = state.inputs;
  if (from > to) {
    problems.push(`saved at version ${from}, newer than the definition's version ${to}`);
  } else if (from < to && def.migrate) {
    try {
      const migrated: unknown = def.migrate({ ...state.inputs }, from);
      if (isRecord(migrated)) values = migrated;
      else problems.push(`migrate from version ${from} returned no inputs`);
    } catch (err) {
      problems.push(`migrate from version ${from} threw: ${errorText(err)}`);
    }
  }
  const salvaged = salvageInputs(def.inputs, values);
  return { inputs: salvaged.inputs, problems: problems.concat(salvaged.problems) };
}

