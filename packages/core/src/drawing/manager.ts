import type { AccessRule } from '../access';
import { devCheck } from '../options-schema';
import { ChartError } from '../errors';
import { inIntervalRanges, intervalRangeOf } from '../data/interval';
import type { IntervalRange } from '../data/types';
import { migrateVersions } from '../util/records';
import type { ChartTheme } from '../theme';
import type { Pane } from '../pane';
import { RangeBuilder, type PriceScale, type TimeScale } from '../scales';
import type { Timeline } from '../timeline';
import type { Bar, Point, Rect, Time } from '../types';
import type { Localizer } from '../util/locale';
import { UndoSteps, type HistoryStep } from '../history';
import { builtinToolLabels } from './builtin-labels';
import type { PasteScaling, PriceWindow } from './clipboard';
import { drawingFont, drawingWeight, labelPill, pillWidth } from './draw';
import { fontCss, resolveFont } from '../typography';
import { constrainAngle, simplifyPolyline } from './geometry';
import { pointBounds } from './model-bounds';
import { isScribble, recognizeSketch, type SketchCandidate } from './sketch';
import { deriveQuickFields, toolStyleFields } from './quick-fields';
import type {
  BarSpan,
  Drawing,
  DrawingAxisMarks,
  DrawingEnv,
  DrawingLevel,
  DrawingLoadError,
  DrawingLoadResult,
  DrawingMigration,
  DrawingPart,
  DrawingPoint,
  DrawingStyle,
  DrawingToolDef,
  ScreenDrawing,
  SerializedDrawings,
} from './types';
import { isDev } from '../util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** What a `drawing:update` changed. */
export type DrawingChange = 'points' | 'style' | 'text' | 'lock' | 'visibility' | 'order' | 'pane' | 'flags' | 'name';

/**
 * How strongly placed and dragged anchors snap to the bar's open, high, low
 * or close: `'strong'` always, `'weak'` only within a few pixels of one,
 * `'off'` never.
 */
export type MagnetMode = 'off' | 'weak' | 'strong';

/**
 * Keys held during a pointer event. `shift` adds to the selection on a
 * press and, while placing or dragging, keeps the drag horizontal, vertical
 * or at 45°; `ctrl` (Ctrl, or Cmd on macOS) turns the magnet on fully while
 * held.
 */
export interface DrawingModifiers {
  shift?: boolean;
  ctrl?: boolean;
}

/** A named group of drawings: the drawings that share a `group`. See `DrawingManager.groups`. */
export interface DrawingGroup {
  name: string;
  /** Its drawings' ids, bottom to top. */
  ids: string[];
}

/** Options of `drawings.setTool()`. */
export interface SetToolOptions {
  /**
   * Keep the tool active after each drawing, until the user picks another
   * tool or the cursor, presses Escape or picks this tool again. Applies to
   * this activation only; `stayInDrawingMode` is left as it is.
   */
  keep?: boolean;
}

/**
 * Events emitted by the drawing manager, by name: tool, magnet and access
 * changes, selection and clicks, drawings created, edited or removed, and undo
 * history.
 */
export interface DrawingEvents {
  /** The active tool changed (`null` = cursor); `kept` is `toolKept`. */
  'tool:change': { tool: string | null; kept: boolean };
  /** `setMagnetMode()` or `setMagnet()` changed the magnet; `mode` is the new `magnetMode`. */
  'magnet:change': { mode: MagnetMode };
  /** `setAccess()` changed which tools are allowed; `allow` is the new rule, `null` for all. */
  'access:change': { allow: AccessRule | null };
  /**
   * `setTool()` refused a tool `setAccess()` denies, e.g. a press on a
   * disabled rail button. The call throws after this fires; apps show an
   * upgrade prompt or a notice here.
   */
  'tool:refuse': { tool: string };
  /**
   * The selection changed: `ids` in the order they were selected, `id` the
   * last of them (the one `selected` returns), or null when nothing is.
   */
  'drawing:select': { id: string | null; ids: string[] };
  /**
   * The selected drawing's on-screen box (plot-space css px) changed while
   * rendering; `rect` is null when it is out of view or nothing is selected.
   */
  'drawing:bounds': { id: string | null; rect: Rect | null };
  /** Any create/update/remove — persist on this. */
  'drawings:change': { drawings: Drawing[] };
  /** `setHidden()` hid or showed every drawing; `hidden` is the new `drawings.hidden`. */
  'drawings:visibility': { hidden: boolean };
  /** `load()` skipped saved drawings that were malformed; the valid ones loaded. */
  'drawings:invalid': { errors: DrawingLoadError[] };
  /** A drawing was added, by the user, `add()`, `clone()`, undo or redo. */
  'drawing:create': { drawing: Drawing };
  /** A drawing changed; `changes` lists every kind of change, `change` is the first. */
  'drawing:update': { drawing: Drawing; change: DrawingChange; changes: DrawingChange[] };
  /**
   * A drawing changed on screen but the change is not committed yet: the user
   * is dragging it, an anchor or a handle, or `preview()` was called. Fires on
   * every step; the `drawing:update` at the end commits.
   */
  'drawing:update-progress': { id: string };
  /** A drawing was removed, by the user, `remove()`, `clear()`, undo, redo or removing its pane. */
  'drawing:remove': { id: string };
  /** A press and release on a drawing without dragging it. */
  'drawing:click': { id: string };
  'drawing:dblclick': { id: string };
  /** The undo/redo history changed — refresh undo/redo buttons on this. */
  'history:change': { canUndo: boolean; canRedo: boolean };
  /**
   * The style new drawings of `tool` start with changed, through
   * `setToolDefaults`, `loadToolDefaults` or a remembered style edit.
   * `defaults` is the new `toolDefaults(tool)`.
   */
  'tool:defaults-change': { tool: string; defaults: DrawingStyle };
}

export interface DrawingHost {
  readonly theme: ChartTheme;
  readonly timeline: Timeline;
  readonly time: TimeScale;
  readonly panes: readonly Pane[];
  /** Snap price to the nearest OHLC value of the bar at `index`. */
  magnetPrice(index: number, price: number): number;
  /** `price` rounded to the tick size of the price format of `scale` (default the pane's primary scale). */
  roundPrice?(pane: number, price: number, scale?: PriceScale): number;
  /** Zoom the view to the box from `a` to `b` (plot-space css px) on pane `pane`; see `DrawingToolDef.action`. */
  zoomTo?(pane: number, a: Point, b: Point): void;
  /** `price` as text in the format of `scale` (default the pane's primary scale). */
  formatPrice(pane: number, price: number, scale?: PriceScale): string;
  /** `time` as the time axis labels it; see `DrawingEnv.formatTime`. */
  formatTime?(time: Time): string;
  /** The chart's language for tool names and readouts; built-in English when missing. */
  readonly localization?: Localizer;
  requestOverlay(): void;
  /** The registered tools changed (`register`, `unregister`). */
  toolsChange?(): void;
  /** Inline text editor; `done(null)` on cancel. Point is plot-space css px. */
  editText(at: Point, initial: string, done: (text: string | null) => void): void;
  /** The default name of a new group, `n` counting from 1 (e.g. 'Group 3'). Default: `Group n`. */
  groupName?(n: number): string;
  /** Main series bars with `from <= time <= to` (for data-aware tools), as indices into its array; see `DrawingEnv.barSpan`. */
  barSpan?(from: Time, to: Time): BarSpan;
  /** Device pixels per css pixel. */
  readonly pixelRatio?: number;
  /** Length in seconds of the chart's bar interval, or null while it is unknown; see `Drawing.visibleOn`. */
  intervalSeconds?(): number | null;
  /**
   * What prices on pane `pane` at `time` show multiplied by, e.g. for a
   * corporate-action adjustment of the bars; 1 when missing. `serialize`
   * divides drawing prices by it and `load` multiplies them; see `reprice`.
   */
  priceFactor?(pane: number, time: Time): number;
  /** `copy()` kept drawings, replacing what was copied before. */
  copied?(): void;
  /** The chart's undo history, which drawing edits join; the manager keeps its own without one. */
  readonly history?: UndoSteps;
  /**
   * Pane index of indicator `id`, whether it shows now and the price scale it
   * is drawn on; null while it is pending or not on the chart. See `Drawing.indicator`.
   */
  indicator?(id: string): { pane: number; shown: boolean; scale?: PriceScale } | null;
  /** Id of the indicator a drawing started on pane `pane` ties to, or null. */
  paneIndicator?(pane: number): string | null;
  emit<K extends keyof DrawingEvents>(event: K, payload: DrawingEvents[K]): void;
}

type Gesture =
  | { kind: 'create'; drawing: Drawing; placed: number; down: Point; dragged: boolean }
  | { kind: 'free'; drawing: Drawing; last: Point }
  | {
      kind: 'move';
      /** The drawing pressed; `members` are it and the other unlocked selected drawings, which move along. */
      drawing: Drawing;
      start: Point;
      /** Fractional bar index of the press. */
      startIndex: number;
      /** Per price scale of a member, the price at the press height. */
      startPrices: Map<PriceScale, number>;
      members: { drawing: Drawing; origin: DrawingPoint[] }[];
    }
  /** A selection box, or with `zoom` a zoom box, dragged from `start` (plot-space css px) on pane `pane`. */
  | { kind: 'box'; pane: number; start: Point; end: Point; zoom?: boolean }
  | { kind: 'anchor'; drawing: Drawing; anchor: number }
  | { kind: 'handle'; drawing: Drawing; handle: number }
  /** A freehand stroke (plot-space css px) that becomes a drawing on release (see `sketch`), or with `erase` removes the drawings it crosses. */
  | { kind: 'sketch'; pane: number; points: Point[]; erase?: boolean };

/** Fields `update()` and `preview()` change; omitted fields stay, `style` is merged. */
export interface DrawingPatch {
  points?: DrawingPoint[];
  style?: DrawingStyle;
  text?: string;
  locked?: boolean;
  selectable?: boolean;
  persist?: boolean;
  history?: boolean;
  autoscale?: boolean;
  below?: boolean;
  zIndex?: number;
  hidden?: boolean;
  group?: string;
  name?: string;
  /** Id of the indicator the drawing belongs to; `''` unties it. */
  indicator?: string;
  /** Intervals the drawing shows on; `null` or `[]` shows it on every interval. */
  visibleOn?: IntervalRange[] | null;
}

/** What the chart labels on its axes for the selected drawing; see `DrawingManager.axisMarks`. */
export interface SelectionAxisMarks {
  /** The drawing's id. */
  id: string;
  pane: number;
  /** The drawing's color, for the labels and the highlighted band. */
  color: string;
  prices: number[];
  times: Time[];
}

/** A problem `loadToolDefaults()` found: without `field` the tool's entry was skipped, with it only that field was dropped. */
export interface ToolDefaultsLoadError {
  tool: string;
  /** The style field dropped, e.g. `lineWidth` or `levels[2]`. */
  field?: string;
  reason: string;
}

/** A drawing a sketch placed, the tools its stroke fits (best first) and which one it is now. */
interface Sketched {
  id: string;
  fits: SketchCandidate[];
  at: number;
}

/** Optional flags and the value each has when absent. */
const FLAG_DEFAULTS = { locked: false, selectable: true, persist: true, history: true, autoscale: false, below: false, zIndex: 0, hidden: false, group: '', name: '', indicator: '' } as const;
type FlagKey = keyof typeof FLAG_DEFAULTS;
const FLAG_KEYS = Object.keys(FLAG_DEFAULTS) as FlagKey[];

/** Scratch builder for `fitRange`, reused so autoscale makes none per frame. */
const fitBuilder = new RangeBuilder();

const ANCHOR_RADIUS = 5;
/**
 * Css px around a drawing's box that still count as covered by it, for its
 * line width, labels and stats boxes: drawings further out of view are
 * neither drawn nor hit-tested.
 */
const CULL_MARGIN = 160;
const DRAG_CREATE_PX = 4;
/** Minimum distance between recorded points of a freehand stroke (css px). */
const FREE_STEP_PX = 2;
/** Simplification tolerance (css px) of a `'free'` tool with `simplify: true`. */
const SIMPLIFY_PX = 1;
/** Distance (css px) within which the weak magnet pulls a price onto a bar value. */
const WEAK_MAGNET_PX = 12;
/** Arrow-key nudge with Shift held: bars left and right, css px up and down. */
const NUDGE_LARGE = 10;
/** Undo steps kept; the oldest are dropped first. */
const MAX_HISTORY = 100;
let counter = 0;

/** Drawing registry, state and pointer handling. Coordinates are plot-space css px. */
export class DrawingManager {
  #tools = new Map<string, DrawingToolDef>();
  #list: Drawing[] = [];
  /** `list` bottom to top, built on first use after a change; see `ordered`. */
  #order: Drawing[] | null = null;
  #gesture: Gesture | null = null;
  /**
   * Drawing pressed by the last pointer down, for `drawing:click`; `collapse`
   * when a click (no drag) should leave only it selected.
   */
  #press: { id: string; at: Point; collapse: boolean } | null = null;
  #allow: AccessRule | null = null;
  /** Selected drawings in the order they were selected; the last is `selected`. */
  #selectedIds: string[] = [];
  /** Drawings `copy()` took, as they were then, bottom to top. */
  #clipboard: Drawing[] = [];
  /** @internal True while `load` replaces the drawings, so the chart does not report it as a `state:change`. */
  loading = false;
  #hoveredId: string | null = null;
  #activeTool: string | null = null;
  #measureCtx: CanvasRenderingContext2D | null = null;
  /** `DrawingEnv.redraw`: one function for the manager's life, so tools can keep it in a set. */
  readonly #redraw = (): void => this.#host.requestOverlay();
  /** The host theme with its font keys set to the drawings font, for `drawingTheme`. */
  #themeFor: { source: ChartTheme; theme: ChartTheme } | null = null;
  /** Last emitted `drawing:bounds`, to emit only on change. */
  #boundsKey = '';
  /** Per pane (or scale, when `fitRange` was given one), the price span `fitRange` last returned; kept while a gesture runs. */
  #fits = new Map<number | PriceScale, [number, number] | null>();
  /** Snapshot of the last committed state; gestures edit `items` in place until they commit. */
  #committed: Drawing[] = [];
  /** `preview()` edits are pending in `items` and not yet committed. */
  #previewing = false;
  /** New text drawings whose first text is still being entered; not committed until it is. */
  #drafts = new Set<string>();
  #undoStack: Drawing[][] = [];
  #redoStack: Drawing[][] = [];
  #magnetState: MagnetMode = 'off';
  /** The mode `setMagnet(true)` turns back on. */
  #magnetOn: Exclude<MagnetMode, 'off'> = 'strong';
  /** Keys held at the last pointer event. */
  #modifiers: DrawingModifiers = {};
  /**
   * The drawings the last commit nudged with the arrow keys, newline-joined;
   * a held key's repeats merge into that commit's undo step.
   */
  #nudged: string | null = null;
  /**
   * The drawing a sketch just placed and the tools its stroke fits, while its
   * hint shows: Tab swaps it for the next fit, Escape takes it back. Any
   * commit, undo or press ends it.
   */
  #sketched: Sketched | null = null;
  /** Open `batch()` calls; changes made inside commit once, when the outermost ends. */
  #batchDepth = 0;
  #batchDirty = false;
  /** Prevent moving/editing drawings. */
  locked = false;
  hidden = false;
  /** Label the selected drawing's prices and times on the axes; see `setAxisLabels`. */
  axisLabels = true;
  /** Keep the tool active after finishing a drawing. */
  stayInDrawingMode = false;
  /**
   * How drawings pasted from another chart through the system clipboard are
   * placed; see `PasteScaling`. Default null: at their own times and prices.
   */
  pasteScaling: PasteScaling | null = null;
  /** The active tool was set with `{ keep: true }`; see `toolKept`. */
  #kept = false;
  /**
   * A style edit committed with `update()` becomes the default of the
   * drawing's tool for the fields it changed, so the next drawing of that
   * tool looks the same. Default true; turn off when the app restyles
   * drawings from code and the defaults should stay put.
   */
  rememberStyle = true;
  /** Per tool, the style set with `setToolDefaults` or remembered from edits, over the tool's `defaultStyle`. */
  #styleDefaults = new Map<string, DrawingStyle>();
  /** Per tool, the style fields `registerToolQuickFields` set for the toolbar. */
  #quickFieldKeys = new Map<string, string[]>();
  /**
   * Upgrades saved payloads `load()` cannot read as they are: an unknown
   * version, or an app's own older format. Called at most once per load.
   */
  migrate: DrawingMigration | null = null;
  /** Format `load()` reads and its upgrade steps; replaced in tests to exercise a future version. */
  private formatVersion = DRAWINGS_VERSION;
  private migrations: Readonly<Record<number, DrawingMigration>> = MIGRATIONS;

  /** The drawings in insertion order. Assigning a new list resets the z-order cache. */
  get #items(): Drawing[] {
    return this.#list;
  }

  set #items(list: Drawing[]) {
    this.#list = list;
    this.#order = null;
  }

  /** Add a drawing on top of its `zIndex` layer. */
  private append(d: Drawing): void {
    this.#list.push(d);
    this.#order = null;
  }

  readonly #host: DrawingHost;
  readonly #history: UndoSteps;
  /** What every drawing step in the history runs: one entry of the undo and redo stacks. */
  readonly #step: HistoryStep = {
    undo: () => this.#travel(this.#undoStack, this.#redoStack),
    redo: () => this.#travel(this.#redoStack, this.#undoStack),
  };

  /** Starts without tools; the `drawingTools()` plugin or `register` adds them. */
  constructor(host: DrawingHost) {
    this.#host = host;
    this.#history = host.history ?? new UndoSteps(() => this.#emitHistory());
    // During a gesture or preview, undo and redo only cancel it.
    this.#history.interrupt = () => (this.#gesture !== null || this.#previewing) && this.#abortGesture();
  }

  register(tool: DrawingToolDef): void {
    const n = tool.points;
    if (n !== 'n' && n !== 'free' && !(Number.isInteger(n) && n >= 1)) {
      throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Tool "${tool.type}" needs at least one point, 'n' or 'free'` : '');
    }
    if (tool.snap !== undefined && tool.snap !== 'ohlc' && tool.snap !== 'time') {
      throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Tool "${tool.type}" snap must be 'ohlc' or 'time'` : '');
    }
    this.#tools.set(tool.type, tool);
    // Saved drawings of this type may be waiting for it.
    this.#host.requestOverlay();
    this.#host.toolsChange?.();
  }

  /**
   * Remove a tool, e.g. when the plugin that added it is uninstalled. Its
   * drawings stay in the data but are not drawn until a tool of that type is
   * registered again; while it is the active tool, the cursor tool takes over.
   */
  unregister(type: string): void {
    if (!this.#tools.delete(type)) return;
    if (this.#activeTool === type) this.setTool(null);
    this.#host.requestOverlay();
    this.#host.toolsChange?.();
  }

  getTools(): DrawingToolDef[] {
    return [...this.#tools.values()];
  }

  /**
   * The name of tool `type` in the chart's language: the message `tool.<type>`
   * (e.g. `tool.trendline`) when the `localization` option has one, else the
   * tool's `label`; `type` itself for a tool that is not registered. A
   * built-in tool registered with a label of the app's own keeps that label in
   * every language; tools of the app's own types take `tool.<type>` too.
   */
  toolLabel(type: string): string {
    const label = this.#tools.get(type)?.label ?? type;
    const english = builtinToolLabels.get(type);
    if (english !== undefined && english !== label) return label;
    return this.#host.localization?.text(`tool.${type}`, undefined, label) ?? label;
  }

  /**
   * The style a new drawing of tool `type` starts with: the tool's
   * `defaultStyle` under the defaults set with `setToolDefaults` or
   * remembered from style edits. A copy; `{}` for a tool without either.
   */
  toolDefaults(type: string): DrawingStyle {
    return copyStyle({ ...this.#tools.get(type)?.defaultStyle, ...this.#styleDefaults.get(type) });
  }

  /**
   * Set the style new drawings of tool `type` start with, over the tool's own
   * `defaultStyle`; it replaces the defaults set or remembered before, and
   * `null` goes back to the tool's own. Drawings already made keep their
   * style; `add()` style still wins. The tool need not be registered yet.
   * Throws on an ill-typed style field. Emits `tool:defaults-change`.
   */
  setToolDefaults(type: string, style: DrawingStyle | null): void {
    if (typeof type !== 'string') throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Drawing tool type must be a string' : '');
    devCheck('drawings.setToolDefaults', style ?? undefined, 'drawingStyle');
    if (style !== null) checkFields({ style });
    this.#putDefaults(type, style ? definedStyle(style) : {});
  }

  /** The defaults set or remembered per tool, for saving; tools at their own `defaultStyle` are left out. */
  serializeToolDefaults(): Record<string, DrawingStyle> {
    const out: Record<string, DrawingStyle> = {};
    for (const [type, style] of this.#styleDefaults) out[type] = copyStyle(style);
    return out;
  }

  /**
   * Replace every tool's defaults with saved ones, from
   * `serializeToolDefaults()`. Tolerant like `load()`: ill-typed style fields
   * and entries that are not objects are dropped and returned; the rest load.
   * Throws, changing nothing, when `data` is not an object. Emits
   * `tool:defaults-change` for each tool whose defaults changed.
   */
  loadToolDefaults(data: unknown): ToolDefaultsLoadError[] {
    if (!isPlainRecord(data)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Tool defaults must be an object of styles by tool type' : '');
    const errors: ToolDefaultsLoadError[] = [];
    const next = new Map<string, DrawingStyle>();
    for (const [tool, raw] of Object.entries(data)) {
      if (!isPlainRecord(raw)) {
        errors.push({ tool, reason: 'must be an object' });
        continue;
      }
      const { style, problems } = cleanStyle(raw);
      for (const { field, reason } of problems) errors.push({ tool, field: field.replace(/^style\./, ''), reason });
      next.set(tool, style);
    }
    for (const type of [...this.#styleDefaults.keys()]) if (!next.has(type)) this.#putDefaults(type, {});
    for (const [type, style] of next) this.#putDefaults(type, definedStyle(style));
    return errors;
  }

  /**
   * Style fields the floating toolbar shows for tool `type`, in order (at
   * most four are shown), instead of the ones `quickFields` derives. `null`
   * goes back to deriving them.
   */
  registerToolQuickFields(type: string, keys: readonly string[] | null): void {
    if (keys === null) {
      this.#quickFieldKeys.delete(type);
      return;
    }
    if (!Array.isArray(keys) || !keys.every((k) => typeof k === 'string')) {
      throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Quick fields must be an array of style field names' : '');
    }
    this.#quickFieldKeys.set(type, [...keys]);
  }

  /**
   * The style fields a drawing's tool honors, for a style editor: its tool's
   * `styleFields`, or else color, line width, line style and the keys its
   * `settings` declare. `[]` for an unknown id.
   */
  styleFields(id: string): string[] {
    const d = this.#items.find((x) => x.id === id);
    if (!d) return [];
    return toolStyleFields(this.#tools.get(d.type));
  }

  /**
   * Up to four style fields the floating toolbar offers for a drawing: the
   * ones registered for its tool with `registerToolQuickFields`, else the
   * first four plain-valued ones of its tool's `styleFields`, else the fields
   * its style carries and its tool's `settings` declare, colours first,
   * topped up with color, line width and line style. `[]` for an unknown id.
   */
  quickFields(id: string): string[] {
    const d = this.#items.find((x) => x.id === id);
    if (!d) return [];
    return deriveQuickFields(d.style, this.#tools.get(d.type), this.#quickFieldKeys.get(d.type));
  }

  get tool(): string | null {
    return this.#activeTool;
  }

  /**
   * The active tool stays active after each drawing because it was set with
   * `setTool(type, { keep: true })`. False for the cursor, and for a tool
   * kept only by `stayInDrawingMode`.
   */
  get toolKept(): boolean {
    return this.#kept;
  }

  /**
   * Activate drawing tool `type`, or the cursor with `null`. The tool goes back
   * to the cursor after one drawing, unless `keep` is set (or
   * `stayInDrawingMode`). Throws for an unknown tool, and for one `setAccess()`
   * denies after firing `tool:refuse`.
   */
  setTool(type: string | null, options: SetToolOptions = {}): void {
    if (type !== null && !this.#tools.has(type)) this.#unknownTool('drawings.setTool', type);
    if (type !== null && !this.isToolAllowed(type)) {
      this.#host.emit('tool:refuse', { tool: type });
      throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Drawing tool "${type}" is not allowed` : '');
    }
    this.#cancelCreate();
    this.#activeTool = type;
    this.#kept = type !== null && options.keep === true;
    if (type) this.select(null);
    this.#host.emit('tool:change', { tool: type, kept: this.#kept });
    this.#host.requestOverlay();
  }

  /**
   * Limit the tools the user can pick: the rail hides the others and
   * `setTool` refuses them. `allow` is the same rule as the chart's
   * `access.allow` option, asked with `{ kind: 'drawing', id }` per tool;
   * `null` allows every tool. Drawings added from code with `add()` are not
   * restricted. The option sets this too.
   */
  setAccess(allow: AccessRule | null): void {
    if (allow !== null && typeof allow !== 'function') throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Drawing access must be a function or null' : '');
    this.#allow = allow;
    if (this.#activeTool && !this.isToolAllowed(this.#activeTool)) this.setTool(null);
    this.#host.emit('access:change', { allow });
  }

  /** The rule `setAccess()` set, or `null` when every tool is allowed. */
  get access(): AccessRule | null {
    return this.#allow;
  }

  isToolAllowed(type: string): boolean {
    return !this.#allow || this.#allow({ kind: 'drawing', id: type });
  }

  /** The selected drawing, or with several selected the last one selected. */
  get selected(): Drawing | null {
    return this.#items.find((d) => d.id === this.#selectedId) ?? null;
  }

  /** Ids of the selected drawings, in the order they were selected; the last is `selected`. */
  get selection(): string[] {
    return [...this.#selectedIds];
  }

  /**
   * Select these drawings, replacing the selection; `[]` clears it. Unknown,
   * hidden and unselectable drawings and repeated ids are left out. The last
   * one becomes `selected`. Emits `drawing:select` when the selection changed.
   */
  setSelection(ids: readonly string[]): void {
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
      throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Drawing selection must be an array of drawing ids' : '');
    }
    this.#setSelected(ids.filter((id, i) => ids.indexOf(id) === i && this.#isSelectable(this.#items.find((d) => d.id === id))));
  }

  /**
   * Keep copies of these drawings (default: the selection) for `paste()`,
   * replacing what was copied before; later edits do not change them. Returns
   * how many were copied; with none, what was copied before stays.
   */
  copy(ids: readonly string[] = this.#selectedIds): number {
    const wanted = new Set(ids);
    const list = this.ordered().filter((d) => wanted.has(d.id));
    if (list.length === 0) return 0;
    this.#clipboard = list.map(clone);
    this.#host.copied?.();
    return list.length;
  }

  /**
   * Add unlocked copies of the drawings `copy()` kept, in place and on top,
   * and select them, as one undo step. The copies of a group form a new group.
   * Copies for a pane the chart no longer has are left out. Returns the
   * copies; `[]` when nothing was copied.
   */
  paste(): Drawing[] {
    return this.#addCopies(this.#clipboard);
  }

  /**
   * Copy these drawings (default: the selection) in place, like `copy()`
   * then `paste()` but leaving what `copy()` kept alone: unlocked copies on
   * top, selected, the copies of a group in a new group, as one undo step.
   * Returns the copies.
   */
  duplicate(ids: readonly string[] = this.#selectedIds): Drawing[] {
    const wanted = new Set(ids);
    return this.#addCopies(this.ordered().filter((d) => wanted.has(d.id)));
  }

  /**
   * @internal What `copy()` kept, priced as the data source sent the bars
   * (like `serialize()`), for the system clipboard.
   */
  clipboardItems(): Drawing[] {
    return this.#repriced(this.#clipboard.map(clone), (pane, time, price) => price / this.#factor(pane, time));
  }

  /**
   * @internal Paste drawings from the system clipboard, priced as the data
   * source sent the bars, like `paste()`: unlocked copies on top, selected,
   * as one undo step. Drawings of tools this chart lacks are left out. `place`
   * moves the points of those anchored to data, given the crosshair `at`.
   */
  pasteItems(
    items: readonly Drawing[],
    place: ((list: Drawing[], at: (DrawingPoint & { pane: number }) | null) => void) | null = null,
    at: (Point & { pane: number }) | null = null,
  ): Drawing[] {
    const known = items.filter((d) => this.#tools.has(d.type)).map(clone);
    const list = this.#repriced(known, (pane, time, price) => price * this.#factor(pane, time));
    const draft: Drawing = { id: '', type: '', pane: at?.pane ?? 0, points: [], style: {} };
    place?.(
      list.filter((d) => !this.#isScreen(d) && d.pane < this.#host.panes.length),
      at && { pane: at.pane, ...this.#toModel(draft, at, false) },
    );
    return this.#addCopies(list);
  }

  /** @internal The prices the main scale of each pane shows, for the system clipboard. */
  priceRanges(): PriceWindow[] {
    return this.#host.panes.map(({ primary: s }) => ({ min: s.minPrice, max: s.maxPrice, log: s.isLog }));
  }

  /**
   * @internal Paste plain text as a selected text drawing at plot point `at`,
   * or in the middle of the main pane. Null without a text tool.
   */
  pasteText(text: string, at: (Point & { pane: number }) | null): Drawing | null {
    return this.#pasteAt('text', text, at, () => [{ x: 0, y: 0 }]);
  }

  /**
   * @internal Paste an image as a selected drawing of `type` over a box of
   * `width` by `height` css px, shrunk to fit half the pane, centred on plot
   * point `at` or the middle of the main pane. Null without the tool.
   */
  pasteImage(type: string, text: string, width: number, height: number, at: (Point & { pane: number }) | null): Drawing | null {
    return this.#pasteAt(type, text, at, (pane) => {
      const k = Math.min(1, this.#host.time.width / 2 / width, pane.height / 2 / height) / 2;
      return [
        { x: -width * k, y: -height * k },
        { x: width * k, y: height * k },
      ];
    });
  }

  /** Add a selected drawing of `type` with `text`, its points `offsets` from plot point `at` or the middle of the main pane. */
  #pasteAt(type: string, text: string, at: (Point & { pane: number }) | null, offsets: (pane: { height: number }) => Point[]): Drawing | null {
    if (!this.#tools.has(type) || this.#host.panes.length === 0 || this.#host.timeline.length === 0) return null;
    const pane = at && at.pane < this.#host.panes.length ? at.pane : 0;
    const p = this.#host.panes[pane]!;
    const { x, y } = at ?? { x: this.#host.time.width / 2, y: p.top + p.height / 2 };
    const draft: Drawing = { id: '', type, pane, points: [], style: {} };
    const points = offsets(p).map((o) => this.#toModel(draft, { x: x + o.x, y: y + o.y }, false));
    const drawing = this.add({ type, pane, points, text, style: {} });
    this.setSelection([drawing.id]);
    return drawing;
  }

  /** Add copies of `source` on top and select them, as one undo step; see `paste`. */
  #addCopies(source: readonly Drawing[]): Drawing[] {
    // The copies of each group form a new group of their own.
    const taken = this.#groupNames();
    const renamed = new Map<string, string>();
    const copies = source
      .filter((d) => d.pane < this.#host.panes.length)
      .map((d) => {
        const copy: Drawing = { ...clone(d), id: newId() };
        delete copy.locked;
        // A copy of a drawing tied to an indicator this chart lacks is a plain drawing.
        if (copy.indicator && !this.#host.indicator?.(copy.indicator)) delete copy.indicator;
        if (copy.group) {
          let name = renamed.get(copy.group);
          if (name === undefined) {
            name = this.#freeGroupName(taken);
            taken.add(name);
            renamed.set(copy.group, name);
          }
          copy.group = name;
        }
        return copy;
      });
    if (copies.length === 0) return [];
    for (const copy of copies) this.append(copy);
    this.setSelection(copies.map((d) => d.id));
    this.#changed();
    return copies.map(clone);
  }

  /** Every drawing, bottom to top. */
  getAll(): Drawing[] {
    return this.ordered().map(clone);
  }

  getById(id: string): Drawing | undefined {
    const d = this.#items.find((x) => x.id === id);
    return d ? clone(d) : undefined;
  }

  /** @internal The price scale drawing `id` reads prices on (see `Drawing.indicator`), or null when there is no such drawing. */
  priceScaleOf(id: string): PriceScale | null {
    const d = this.#items.find((x) => x.id === id);
    return d ? this.#scaleOf(d) : null;
  }

  add(input: Omit<Drawing, 'id'> & { id?: string }): Drawing {
    if (!this.#tools.has(input.type)) this.#unknownTool('drawings.add', input.type);
    checkFields(input);
    devCheck('drawings.add', input.style, 'drawingStyle');
    const drawing: Drawing = { ...clone(input as Drawing), id: input.id ?? newId() };
    drawing.pane = this.#tiedPane(drawing) ?? drawing.pane;
    if (!Number.isInteger(drawing.pane) || drawing.pane < 0) throw new ChartError('invalid-drawings', /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? '"pane" must be a pane index' : '');
    setRanges(drawing, input.visibleOn);
    // Explicit style over the tool's defaults; the theme fills in what neither sets.
    drawing.style = { ...this.toolDefaults(drawing.type), ...drawing.style };
    this.append(drawing);
    this.#changed();
    return clone(drawing);
  }

  update(id: string, patch: DrawingPatch): void {
    devCheck('drawings.update', patch.style, 'drawingStyle');
    if (!this.#applyPatch(id, patch)) return;
    this.#pruneSelection();
    this.#changed();
    if (this.rememberStyle && patch.style) {
      const type = this.#items.find((d) => d.id === id)?.type;
      if (type !== undefined) this.#putDefaults(type, { ...this.#styleDefaults.get(type), ...definedStyle(patch.style) });
    }
  }

  /** Show or hide one drawing. */
  setVisible(id: string, visible: boolean): void {
    this.update(id, { hidden: !visible });
  }

  /**
   * Show a drawing only on bar intervals inside `ranges` (null or `[]`:
   * every interval), e.g. `[{ from: '1m', to: '15m' }]`. Elsewhere it stays
   * in the list and in saved drawings but is not drawn, hit-tested or
   * selectable. One undo step; throws on an invalid range, like `update()`.
   */
  setVisibleOn(id: string, ranges: readonly IntervalRange[] | null): void {
    this.update(id, { visibleOn: ranges ? [...ranges] : null });
  }

  /** True while the drawing's `visibleOn` excludes the chart's current interval, so it is not drawn. */
  hiddenByInterval(id: string): boolean {
    const d = this.#items.find((x) => x.id === id);
    const seconds = this.#barSeconds();
    return d !== undefined && seconds !== null && !inIntervalRanges(d.visibleOn, seconds);
  }

  /**
   * @internal The bar interval or the indicators may have changed: drawings
   * limited to some intervals, or tied to an indicator, show or hide, and
   * tied drawings follow their indicator's pane.
   */
  intervalChanged(): void {
    this.#follow();
    const hovered = this.#items.find((d) => d.id === this.#hoveredId);
    if (hovered && !this.#isShown(hovered)) this.#hoveredId = null;
    this.#pruneSelection();
    this.#host.requestOverlay();
  }

  /**
   * The named groups, ordered by their lowest drawing. A group is the
   * drawings that share a `group`; a click on one of them selects them all.
   */
  get groups(): DrawingGroup[] {
    const groups = new Map<string, string[]>();
    for (const d of this.ordered()) {
      if (!d.group) continue;
      const ids = groups.get(d.group);
      if (ids) ids.push(d.id);
      else groups.set(d.group, [d.id]);
    }
    return [...groups].map(([name, ids]) => ({ name, ids }));
  }

  /**
   * Put these drawings (default: the selection) into one group named `name`,
   * by default a new name such as 'Group 3', taking them out of the groups
   * they were in. One undo step. Returns the name, or null when no id is
   * known. Throws for an empty name.
   */
  group(ids: readonly string[] = this.#selectedIds, name?: string): string | null {
    if (name !== undefined && (typeof name !== 'string' || name === '')) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'A drawing group name must be a non-empty string' : '');
    const wanted = new Set(ids);
    const members = this.#items.filter((d) => wanted.has(d.id));
    if (members.length === 0) return null;
    const groupName = name ?? this.#freeGroupName(this.#groupNames());
    this.#setGroup(members, groupName);
    return groupName;
  }

  /**
   * Dissolve the groups of these drawings (default: the selection): every
   * drawing of those groups leaves its group. One undo step. Returns how many
   * drawings left a group. To take out one drawing only, `update` its `group`
   * to `''`.
   */
  ungroup(ids: readonly string[] = this.#selectedIds): number {
    const wanted = new Set(ids);
    const names = new Set(this.#items.flatMap((d) => (wanted.has(d.id) && d.group ? [d.group] : [])));
    const members = this.#items.filter((d) => d.group !== undefined && names.has(d.group));
    this.#setGroup(members, '');
    return members.length;
  }

  /**
   * Rename group `name` to `to`; with a group of that name already there,
   * the two become one. One undo step. False when no drawing is in `name` or
   * the name is the same; throws for an empty `to`.
   */
  renameGroup(name: string, to: string): boolean {
    if (typeof to !== 'string' || to === '') throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'A drawing group name must be a non-empty string' : '');
    const members = this.#items.filter((d) => d.group === name);
    if (members.length === 0 || name === to) return false;
    this.#setGroup(members, to);
    return true;
  }

  /** Draw a drawing above every other one. */
  bringToFront(id: string): void {
    this.#reorder(id, (list) => list.length - 1);
  }

  /** Draw a drawing below every other one. */
  sendToBack(id: string): void {
    this.#reorder(id, () => 0);
  }

  /** Move a drawing one step up, past the next drawing of its pane. */
  bringForward(id: string): void {
    this.#reorder(id, (list, i) => {
      const pane = list[i]!.pane;
      const next = list.findIndex((d, k) => k > i && d.pane === pane);
      return next < 0 ? i : next;
    });
  }

  /** Move a drawing one step down, below the previous drawing of its pane. */
  sendBackward(id: string): void {
    this.#reorder(id, (list, i) => {
      const pane = list[i]!.pane;
      for (let k = i - 1; k >= 0; k--) if (list[k]!.pane === pane) return k;
      return i;
    });
  }

  /**
   * Move a drawing to position `index` among the drawings of its pane, bottom
   * (0) to top; out-of-range indices clamp. One undo step, like the other
   * reorders, and the drawing takes the layer of the drawing it passes.
   */
  moveTo(id: string, index: number): void {
    if (!Number.isFinite(index)) return;
    this.#reorder(id, (list, i) => {
      const pane = list[i]!.pane;
      const own = list.flatMap((d, k) => (d.pane === pane ? [k] : []));
      return own[Math.max(0, Math.min(own.length - 1, Math.round(index)))]!;
    });
  }

  /**
   * Run `fn` and record every change it makes as one undo step, with one
   * `drawings:change` at the end, e.g. to hide or remove several drawings at
   * once. Nested calls join the outer one. Granular events (`drawing:update`
   * and the like) fire at the end too, once per changed drawing.
   */
  batch(fn: () => void): void {
    this.#batchDepth++;
    try {
      fn();
    } finally {
      this.#batchDepth--;
      if (this.#batchDepth === 0 && this.#batchDirty) {
        this.#batchDirty = false;
        this.#changed();
      }
    }
  }

  /**
   * Show `patch` on screen without recording it: no undo step and no
   * `drawings:change`. Use it for live feedback while the user is still
   * choosing (e.g. dragging across a color picker), then call `update()` with
   * the final value; that records one undo step from the state before the
   * first preview. `undo()`/`redo()` before then discard the preview.
   */
  preview(id: string, patch: DrawingPatch): void {
    if (!this.#applyPatch(id, patch)) return;
    this.#previewing = true;
    this.#host.emit('drawing:update-progress', { id });
    this.#host.requestOverlay();
  }

  /**
   * Drop the `preview()` edits not committed yet and show the drawings as
   * they were, e.g. when the user cancels a settings dialog. Adds no undo
   * step. Returns false when nothing was being previewed (or a pointer
   * gesture is in progress, which undo cancels instead).
   */
  cancelPreview(): boolean {
    if (!this.#previewing || this.#gesture) return false;
    return this.#abortGesture();
  }

  /**
   * Copy a drawing (unlocked, outside any group) and select the copy, unless
   * it is hidden or unselectable. Returns it, or null for an unknown id.
   */
  clone(id: string): Drawing | null {
    const source = this.#items.find((d) => d.id === id);
    if (!source) return null;
    const copy: Drawing = { ...clone(source), id: newId() };
    delete copy.locked;
    delete copy.group;
    this.append(copy);
    this.select(copy.id);
    this.#changed();
    return clone(copy);
  }

  remove(id: string): void {
    const before = this.#items.length;
    this.#items = this.#items.filter((d) => d.id !== id);
    if (this.#items.length === before) return;
    this.#pruneSelection();
    this.#changed();
  }

  clear(): void {
    this.#items = [];
    this.select(null);
    this.#changed();
  }

  /**
   * Drawings to save; those with `persist: false` are left out. Prices are
   * taken back to the bars as the data source sent them (see the chart's
   * `adjustment` option), so they load onto the same bars under any mode.
   */
  serialize(): SerializedDrawings {
    const drawings = this.#repriced(
      this.getAll().filter((d) => d.persist !== false),
      (pane, time, price) => price / this.#factor(pane, time),
    );
    return { version: DRAWINGS_VERSION, drawings };
  }

  /**
   * Replace all drawings and start a fresh undo history. Malformed drawings
   * are skipped and reported (also through `drawings:invalid`); the rest load.
   * Ill-typed optional fields and style are dropped from the drawings that
   * load, and reported with their `field`.
   * Throws, changing nothing, when `data` is not a drawings payload at all or
   * has a version neither the built-in steps nor `migrate` can upgrade.
   * Emits `drawings:change`.
   */
  load(data: unknown): DrawingLoadResult {
    const payload = migrateDrawings(data, this.formatVersion, this.migrations, this.migrate);
    const { drawings, errors } = readDrawings(payload, this.#tools);
    const was = this.loading;
    this.loading = true;
    try {
      this.#items = this.#repriced(drawings, (pane, time, price) => price * this.#factor(pane, time));
      this.select(null);
      this.#resetHistory();
      this.notify();
    } finally {
      this.loading = was;
    }
    if (errors.length > 0) this.#host.emit('drawings:invalid', { errors });
    return { loaded: drawings.length, errors };
  }

  /** Same as `chart.history.canUndo`: drawings share the chart's undo history. */
  get canUndo(): boolean {
    return this.#history.canUndo;
  }

  /** Same as `chart.history.canRedo`. */
  get canRedo(): boolean {
    return this.#history.canRedo;
  }

  /**
   * Same as `chart.history.undo()`: revert the last change, which may be an
   * indicator's; during a gesture or preview, only cancel it. Returns false if nothing changed.
   */
  undo(): boolean {
    return this.#history.undo();
  }

  /** Same as `chart.history.redo()`: reapply the last undone change; during a gesture or preview, only cancel it. */
  redo(): boolean {
    return this.#history.redo();
  }

  /** @internal The drawings leave the chart: take their steps out of the shared history. */
  leaveHistory(): void {
    this.#history.interrupt = null;
    if (!this.#history.drop(this.#step)) this.#emitHistory();
  }

  /** Go back or forward one entry of the stacks: pop `from`, keeping the current state on `to`. */
  #travel(from: Drawing[][], to: Drawing[][]): void {
    const saved = from.pop();
    if (!saved) return;
    to.push(this.#committed);
    this.#restore(saved);
  }

  /**
   * Follow a pane reorder or removal: `map[oldIndex]` is the new index, or -1
   * when the pane is gone (its drawings are dropped). Applies to the undo
   * history too, and adds no undo step.
   */
  remapPanes(map: readonly number[]): void {
    // Tied drawings stay, hidden: their indicator is gone with the pane (removing it removed them) or comes back, e.g. loaded again, and they follow it.
    const moved = this.#mapPanes((d) => {
      const pane = map[d.pane] ?? d.pane;
      return pane < 0 && d.indicator ? d.pane : pane;
    });
    if (!moved) this.notify();
  }

  /** Move tied drawings to their indicator's pane, also in the undo history. */
  #follow(): void {
    this.#mapPanes((d) => this.#tiedPane(d) ?? d.pane);
  }

  /** The pane index of `d`'s indicator, if it is tied to one on the chart. */
  #tiedPane(d: Drawing): number | undefined {
    return d.indicator ? this.#host.indicator?.(d.indicator)?.pane : undefined;
  }

  /**
   * Move each drawing to pane `to(d)`, dropping it for -1, also in the undo
   * history. Adds no undo step. Returns whether the drawings on the chart
   * changed (and reports it).
   */
  #mapPanes(to: (d: Drawing) => number): boolean {
    const map = (list: Drawing[]) => {
      let moved = false;
      const out = list.flatMap((d) => {
        const pane = to(d);
        if (pane === d.pane) return [d];
        moved = true;
        return pane < 0 ? [] : [{ ...d, pane }];
      });
      return moved ? out : list;
    };
    const before = this.#committed;
    const items = map(this.#items);
    this.#committed = map(before);
    this.#undoStack = this.#undoStack.map(map);
    this.#redoStack = this.#redoStack.map(map);
    if (items === this.#items && this.#committed === before) return false;
    this.#items = items;
    this.#pruneSelection();
    this.#emitDiff(before, this.#committed);
    this.notify();
    return true;
  }

  /**
   * Follow a change of the prices shown, e.g. a new adjustment of the bars:
   * each point of a data-anchored drawing gets the price `price(pane, time,
   * price)` returns. Applies to the undo history and the clipboard too, adds no
   * undo step, and drops an unfinished gesture.
   */
  reprice(price: (pane: number, time: Time, price: number) => number): void {
    const map = (list: Drawing[]) => this.#repriced(list, price);
    const moved = (list: Drawing[]) => map(list).some((d, i) => d !== list[i]);
    if ((this.#gesture || this.#previewing) && moved(this.#items)) this.#abortGesture();
    const shown = moved(this.#items);
    const before = this.#committed;
    this.#items = map(this.#items);
    this.#committed = map(this.#committed);
    this.#undoStack = this.#undoStack.map(map);
    this.#redoStack = this.#redoStack.map(map);
    this.#clipboard = map(this.#clipboard);
    if (!shown) return;
    this.#emitDiff(before, this.#committed);
    this.notify();
  }

  /**
   * `drawing` of chart drawings `source` with its prices moved onto the same
   * bars here, where the prices shown may be adjusted differently (see
   * `DrawingHost.priceFactor`); `drawing` itself when they are alike.
   */
  pricedFrom(drawing: Drawing, source: DrawingManager): Drawing {
    return this.#repriced([drawing], (pane, time, price) => {
      const from = source.#factor(pane, time);
      const to = this.#factor(pane, time);
      return from === to ? price : (price * to) / from;
    })[0]!;
  }

  setHidden(hidden: boolean): void {
    const changed = hidden !== this.hidden;
    this.hidden = hidden;
    if (hidden) this.select(null);
    this.#host.requestOverlay();
    if (changed) this.#host.emit('drawings:visibility', { hidden });
  }

  setLocked(locked: boolean): void {
    this.locked = locked;
    this.#host.requestOverlay();
  }

  /** Whether the magnet is on, weak or strong; see `magnetMode`. */
  get magnet(): boolean {
    return this.#magnetState !== 'off';
  }

  /** Same as `setMagnet()`. */
  set magnet(magnet: boolean) {
    this.setMagnet(magnet);
  }

  /** How placed and dragged anchors snap to bar values; see `setMagnetMode`. */
  get magnetMode(): MagnetMode {
    return this.#magnetState;
  }

  /**
   * Turn the magnet off, or on in the mode it last had (strong at first).
   * Emits `magnet:change` when the mode changes.
   */
  setMagnet(magnet: boolean): void {
    this.setMagnetMode(magnet ? (this.magnet ? this.#magnetState : this.#magnetOn) : 'off');
  }

  /**
   * Snap placed and dragged anchor prices in the main pane to the bar's
   * open, high, low or close: `'strong'` always, `'weak'` only within a few
   * pixels of one, `'off'` never. Holding Ctrl (Cmd on macOS) snaps as
   * `'strong'` whatever the mode. Tools with their own `snap` keep it. Emits
   * `magnet:change` when the mode changes.
   */
  setMagnetMode(mode: MagnetMode): void {
    if (mode !== 'off' && mode !== 'weak' && mode !== 'strong') {
      throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Magnet mode must be 'off', 'weak' or 'strong', got ${JSON.stringify(mode)}` : '');
    }
    if (mode === this.#magnetState) return;
    this.#magnetState = mode;
    if (mode !== 'off') this.#magnetOn = mode;
    this.#host.emit('magnet:change', { mode });
  }

  /**
   * Label the selected drawing's prices and times on the axes and highlight
   * the range between them (default on); see `DrawingToolDef.axisMarks`.
   */
  setAxisLabels(show: boolean): void {
    this.axisLabels = show;
    this.#host.requestOverlay();
  }

  /**
   * The prices and times the selected drawing, or the one being placed,
   * labels on the axes, with its pane and color. Null when there are none,
   * axis labels are off or drawings are hidden. The chart draws these.
   */
  axisMarks(): SelectionAxisMarks | null {
    if (!this.axisLabels || this.hidden) return null;
    // With several drawings selected, labelling one of them would mislead.
    const d = this.#isCreating ? this.#creating : this.#selectedIds.length === 1 ? this.selected : null;
    const tool = d && this.#isShown(d) && d.points.length > 0 ? this.#toolFor(d) : undefined;
    if (!d || !tool) return null;
    const marks = tool.axisMarks ? tool.axisMarks(clone(d)) : defaultAxisMarks(tool, d);
    if (!marks) return null;
    const prices = distinctFinite(marks.prices);
    const times = distinctFinite(marks.times);
    if (prices.length === 0 && times.length === 0) return null;
    return { id: d.id, pane: d.pane, color: d.style.color ?? this.#host.theme.drawing, prices, times };
  }

  /* -------------------------- pointer input -------------------------- */

  /**
   * @internal Start a sketch at `p` (plot space) on pane `paneIndex`: the
   * stroke follows `pointerMove`, and `pointerUp` places the drawing it reads
   * as. False while another gesture or a tool is active, or drawings are hidden.
   */
  sketch(paneIndex: number, p: Point): boolean {
    if (this.hidden || this.#gesture || this.#activeTool) return false;
    this.#sketched = null;
    this.#gesture = { kind: 'sketch', pane: paneIndex, points: [p] };
    return true;
  }

  /**
   * Returns true when the drawing layer consumed the press (no panning).
   * With `shift`, a press on a drawing adds it to the selection or takes it
   * out, and a press elsewhere on a pane with drawings starts a selection box.
   */
  pointerDown(paneIndex: number, p: Point, modifiers: DrawingModifiers = {}): boolean {
    this.#modifiers = modifiers;
    this.#endHint();
    const g = this.#gesture;
    if (g?.kind === 'create') {
      this.#placePoint(g, p);
      return true;
    }
    if (this.#activeTool) {
      const action = this.#tools.get(this.#activeTool)!.action;
      // The press point twice: a click without a move is a stroke that erases what it hits.
      if (action === 'erase') this.#gesture = { kind: 'sketch', pane: paneIndex, points: [p, p], erase: true };
      else if (action === 'zoom') this.#gesture = { kind: 'box', pane: paneIndex, start: p, end: p, zoom: true };
      else this.#startCreate(this.#activeTool, paneIndex, p);
      return true;
    }
    if (this.hidden) return false;
    const shift = modifiers.shift === true;
    const hit = this.hitTest(p);
    if (!hit) {
      if (shift && this.#items.some((d) => d.pane === paneIndex && this.#isSelectable(d))) {
        this.#gesture = { kind: 'box', pane: paneIndex, start: p, end: p };
        return true;
      }
      if (this.#selectedIds.length > 0) this.select(null);
      return false;
    }
    const id = hit.drawing.id;
    // A grouped drawing is selected with its whole group.
    const unit = this.#withGroup(id);
    const wasSelected = this.#isSelected(id);
    if (shift && wasSelected) {
      this.#setSelected(this.#selectedIds.filter((x) => !unit.includes(x)));
      this.#press = { id, at: p, collapse: false };
      return true;
    }
    if (shift) this.#setSelected([...this.#selectedIds.filter((x) => !unit.includes(x)), ...unit]);
    else if (!wasSelected) this.#setSelected(unit);
    // A click on one of several selected drawings leaves only it (and its group) selected; a drag moves them all.
    this.#press = { id, at: p, collapse: !shift && wasSelected && this.#selectedIds.some((x) => !unit.includes(x)) };
    if (this.locked || hit.drawing.locked) return true;
    const anchor = this.#anchorAt(hit, p);
    const handle = anchor < 0 ? this.#handleAt(hit, p) : -1;
    if (anchor >= 0) {
      this.#gesture = { kind: 'anchor', drawing: hit.drawing, anchor };
    } else if (handle >= 0) {
      this.#gesture = { kind: 'handle', drawing: hit.drawing, handle };
    } else {
      const members = this.#items.filter((d) => d === hit.drawing || (this.#isSelected(d.id) && !d.locked));
      const startPrices = new Map<PriceScale, number>();
      for (const d of members) {
        const scale = this.#scaleOf(d);
        if (!startPrices.has(scale)) startPrices.set(scale, scale.yToPrice(p.y - this.#paneOf(d).top));
      }
      this.#gesture = {
        kind: 'move',
        drawing: hit.drawing,
        start: p,
        startIndex: this.#host.time.xToIndex(p.x),
        startPrices,
        members: members.map((d) => ({ drawing: d, origin: d.points.map((q) => ({ ...q })) })),
      };
    }
    return true;
  }

  /**
   * Returns true when the drawing layer is handling the gesture. With
   * `shift` held, the drag keeps horizontal, vertical or at 45°.
   */
  pointerMove(p: Point, modifiers: DrawingModifiers = {}): boolean {
    this.#modifiers = modifiers;
    const g = this.#gesture;
    if (!g) {
      this.#updateHover(p);
      return false;
    }
    if (g.kind === 'box' || g.kind === 'sketch') {
      if (g.kind === 'box') g.end = p;
      else g.points.push(p);
      this.#host.requestOverlay();
      return true;
    }
    if (g.kind === 'create') {
      if (Math.hypot(p.x - g.down.x, p.y - g.down.y) > DRAG_CREATE_PX) g.dragged = true;
      const q = this.#pointFor(g.drawing, g.placed - 1, p);
      for (let i = g.placed; i < g.drawing.points.length; i++) g.drawing.points[i] = { ...q };
      this.#constrain(g.drawing, Math.min(g.placed, g.drawing.points.length - 1));
    } else if (g.kind === 'free') {
      if (Math.hypot(p.x - g.last.x, p.y - g.last.y) >= FREE_STEP_PX) {
        g.drawing.points.push(this.#toModel(g.drawing, p));
        g.last = p;
      }
    } else if (g.kind === 'anchor') {
      g.drawing.points[g.anchor] = this.#pointFor(g.drawing, g.anchor > 0 ? g.anchor - 1 : 1, p);
      this.#constrain(g.drawing, g.anchor);
    } else if (g.kind === 'handle') {
      const pane = this.#paneOf(g.drawing);
      const env = this.#envOf(g.drawing, this.#host.time.width, pane.height);
      const moved = this.#tools.get(g.drawing.type)?.moveHandle?.(clone(g.drawing), g.handle, this.#toModel(g.drawing, p), { x: p.x, y: p.y - pane.top }, env);
      if (moved) Object.assign(g.drawing, Array.isArray(moved) ? { points: moved } : moved);
    } else {
      const to = this.#modifiers.shift ? constrainAngle(g.start, p) : p;
      for (const m of g.members) {
        m.drawing.points = this.#movedPoints(g, m.drawing, m.origin, to);
        this.#host.emit('drawing:update-progress', { id: m.drawing.id });
      }
    }
    // Edits of an existing drawing are in flight until pointerUp commits them; creation is not an edit.
    if (g.kind === 'anchor' || g.kind === 'handle') this.#host.emit('drawing:update-progress', { id: g.drawing.id });
    this.#host.requestOverlay();
    return true;
  }

  /** `cancelled` is a press the browser took over (pointercancel): it is no click. */
  pointerUp(p: Point, cancelled = false, modifiers: DrawingModifiers = {}): void {
    this.#modifiers = modifiers;
    const press = this.#press;
    this.#press = null;
    const g = this.#gesture;
    if (g?.kind === 'create') {
      // Press-drag-release places the next point; a plain click waits for another click.
      if (g.dragged) this.#placePoint(g, p);
      return;
    }
    if (g?.kind === 'free') {
      if (g.drawing.points.length < 2) this.#cancelCreate();
      else {
        this.#simplify(g.drawing);
        this.#finishCreate(g.drawing);
      }
      return;
    }
    if (g?.kind === 'sketch') {
      this.#gesture = null;
      if (!cancelled) {
        if (!g.erase) this.#placeSketch(g);
        else if (!this.locked && !this.hidden && this.#erase(g.points)) this.#toolUsed();
      }
      this.#host.requestOverlay();
      return;
    }
    if (g?.kind === 'box') {
      this.#gesture = null;
      if (!cancelled) {
        if (!g.zoom) this.#selectInBox(g.pane, g.start, p);
        else if (Math.abs(p.x - g.start.x) > DRAG_CREATE_PX && Math.abs(p.y - g.start.y) > DRAG_CREATE_PX) {
          this.#host.zoomTo?.(g.pane, g.start, p);
          this.#toolUsed();
        }
      }
      this.#host.requestOverlay();
      return;
    }
    if (g) {
      this.#gesture = null;
      this.#changed();
    }
    if (press && !cancelled && Math.hypot(p.x - press.at.x, p.y - press.at.y) <= DRAG_CREATE_PX) {
      if (press.collapse) this.#setSelected(this.#withGroup(press.id));
      this.#host.emit('drawing:click', { id: press.id });
    }
  }

  doubleClick(p: Point): boolean {
    if (this.#gesture?.kind === 'create' && this.#tools.get(this.#gesture.drawing.type)?.points === 'n') {
      this.#finishMulti(this.#gesture, true);
      return true;
    }
    if (this.hidden) return false;
    const hit = this.hitTest(p);
    if (!hit) return false;
    this.#host.emit('drawing:dblclick', { id: hit.drawing.id });
    if (this.locked || !this.#tools.get(hit.drawing.type)?.editableText) return false;
    this.editText(hit.drawing);
    return true;
  }

  /** Gesture keys (Enter, Escape) and the arrow-key nudge; returns true when the key was handled. */
  keyDown(e: KeyboardEvent): boolean {
    const g = this.#gesture;
    const s = this.#sketched;
    if (s && !e.ctrlKey && !e.metaKey && !e.altKey && ((e.key === 'Tab' && s.fits.length > 1) || e.key === 'Escape')) {
      if (e.key === 'Tab') this.#swapSketch(s, e.shiftKey ? -1 : 1);
      // Only while the sketch is still the last step, or undo would take back something else.
      else if (this.#history.last === this.#step) this.undo();
      else this.#endHint();
      return true;
    }
    if (e.key === 'Enter' && g?.kind === 'create' && this.#tools.get(g.drawing.type)?.points === 'n') {
      this.#finishMulti(g, false);
      return true;
    }
    if (e.key === 'Escape') {
      if (this.#isCreating || g?.kind === 'sketch' || g?.kind === 'box') this.#cancelCreate();
      else if (this.#activeTool) this.setTool(null);
      else if (this.#selectedIds.length > 0) this.select(null);
      else return false;
      return true;
    }
    // Delete, copy, paste, undo and redo are actions on `chart.actions`, with rebindable keys.
    // Arrows nudge the selection; with nothing to move they stay the chart's (panning).
    if (e.key.startsWith('Arrow') && !e.ctrlKey && !e.metaKey && !e.altKey && !g && !this.locked) {
      return this.#nudge(e.key, e.shiftKey ? NUDGE_LARGE : 1, e.repeat === true);
    }
    return false;
  }

  /** Remove the selected drawings, as one undo step. False when none are selected or drawings are locked. */
  deleteSelection(): boolean {
    if (this.#selectedIds.length === 0 || this.locked) return false;
    this.#removeSelection();
    return true;
  }

  cursor(p: Point): string | null {
    if (this.#activeTool || this.#gesture?.kind === 'create' || this.#gesture?.kind === 'box') return 'crosshair';
    if (this.#gesture) return 'grabbing';
    if (this.hidden) return null;
    const hit = this.hitTest(p);
    if (!hit) return null;
    if (this.locked || hit.drawing.locked) return 'pointer';
    const anchor = this.#anchorAt(hit, p);
    const handle = anchor < 0 ? this.#handleAt(hit, p) : -1;
    const part: DrawingPart =
      anchor >= 0 ? { kind: 'anchor', index: anchor } : handle >= 0 ? { kind: 'handle', index: handle } : { kind: 'body' };
    const tool = this.#tools.get(hit.drawing.type);
    const pane = this.#paneOf(hit.drawing);
    const env = this.#envOf(hit.drawing, this.#host.time.width, pane.height);
    return tool?.cursor?.(hit, part, { x: p.x, y: p.y - pane.top }, env) || (part.kind === 'body' ? 'pointer' : 'move');
  }

  /** Id of the drawing under plot-space `p`, or null (also while drawings are hidden). */
  drawingAt(p: Point): string | null {
    return this.hidden ? null : (this.hitTest(p)?.drawing.id ?? null);
  }

  /** Whether the pointer is over a drawing (as of the last move). */
  get isHovering(): boolean {
    return this.#hoveredId !== null;
  }

  get isBusy(): boolean {
    return this.#gesture !== null;
  }

  /* ----------------------------- render ------------------------------ */

  /**
   * Draw drawings of one pane; ctx is translated to the pane's top-left.
   * With `below`, only the `below` drawings' bodies, under the series;
   * without, the other drawings and every selected drawing's handles.
   */
  render(ctx: CanvasRenderingContext2D, paneIndex: number, width: number, height: number, below = false): void {
    if (this.hidden) return;
    const paneEnv = this.env(paneIndex, width, height);
    const seconds = this.#barSeconds();
    for (const d of this.ordered()) {
      if (d.pane !== paneIndex || d.hidden || (below && !d.below) || !this.#onInterval(d, seconds)) continue;
      const tool = this.#toolFor(d);
      if (!tool || !this.#mayCover(d, tool, 0, 0, width, height)) continue;
      const sd = this.#project(d);
      // Drawings tied to an indicator on another scale of the pane get an env of their own.
      const env = d.indicator ? this.#envOf(d, width, height) : paneEnv;
      if (below || !d.below) {
        ctx.save();
        ctx.font = fontCss(resolveFont(env.theme, 'drawings'));
        tool.render(ctx, sd, env);
        ctx.restore();
      }
      if (!below && sd.selected) {
        this.#drawAnchors(ctx, sd, tool, env, d.style.color ?? env.theme.drawing);
        // Bound anchors, extra handles and the tool's own extent so the toolbar keeps clear of all.
        if (d.id === this.#selectedId) this.#emitBounds(d.id, anchorBox(this.#grips(sd, tool, env), width, height, this.#paneOf(d).top));
      }
    }
    if (below) return;
    const g = this.#gesture;
    const top = this.#host.panes[paneIndex]!.top;
    if (g?.kind === 'box' && g.pane === paneIndex) this.#drawBox(ctx, g, top);
    if (g?.kind === 'sketch' && g.pane === paneIndex) {
      ctx.save();
      ctx.beginPath();
      for (const q of g.points) ctx.lineTo(q.x, q.y - top);
      ctx.strokeStyle = this.#host.theme.drawing;
      ctx.lineWidth = 2;
      ctx.lineJoin = ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();
    }
    const s = this.#sketched;
    const d = s && this.#items.find((x) => x.id === s.id);
    if (d && d.pane === paneIndex) {
      // Below and right of the last anchor, kept inside the pane.
      const at = this.#project(d).points.at(-1)!;
      const n = s!.fits.length;
      const text = this.toolLabel(d.type) + (n > 1 ? ` · ${s!.at + 1}/${n} · Tab` : '');
      ctx.save();
      labelPill(ctx, paneEnv, text, Math.max(0, Math.min(at.x + 12, width - pillWidth(paneEnv, text))), Math.max(12, Math.min(at.y + 20, height - 12)));
      ctx.restore();
    }
  }

  /* ---------------------------- internals ---------------------------- */

  #startCreate(type: string, paneIndex: number, p: Point): void {
    const tool = this.#tools.get(type)!;
    const drawing: Drawing = {
      id: newId(),
      type,
      pane: paneIndex,
      points: [],
      style: this.toolDefaults(type),
      ...this.#tie(paneIndex),
    };
    const first = this.#toModel(drawing, p);
    this.append(drawing);
    if (tool.points === 'free') {
      drawing.points = [first];
      this.#gesture = { kind: 'free', drawing, last: p };
      this.#host.requestOverlay();
      return;
    }
    // 'n' tools start with the placed point plus a preview that follows the pointer.
    const count = tool.points === 'n' ? 2 : tool.points;
    drawing.points = Array.from({ length: count }, () => ({ ...first }));
    this.#gesture = { kind: 'create', drawing, placed: 1, down: p, dragged: false };
    if (count === 1) this.#finishCreate(drawing);
    this.#host.requestOverlay();
  }

  #placePoint(g: Extract<Gesture, { kind: 'create' }>, p: Point): void {
    g.drawing.points[g.placed] = this.#pointFor(g.drawing, g.placed - 1, p);
    this.#constrain(g.drawing, g.placed);
    g.placed++;
    g.down = p;
    g.dragged = false;
    if (this.#tools.get(g.drawing.type)?.points === 'n') g.drawing.points.push({ ...g.drawing.points[g.placed - 1]! });
    else if (g.placed >= g.drawing.points.length) this.#finishCreate(g.drawing);
    this.#host.requestOverlay();
  }

  /**
   * End an 'n'-point drawing: drop the preview and, after a double click, the
   * point its second press placed. Each press of a double click places a
   * point, and the two rarely land on the same pixel, so comparing them would
   * leave an extra anchor.
   */
  #finishMulti(g: Extract<Gesture, { kind: 'create' }>, doubleClick: boolean): void {
    const points = g.drawing.points.slice(0, doubleClick ? g.placed - 1 : g.placed);
    if (points.length < 2) {
      this.#cancelCreate();
      return;
    }
    g.drawing.points = points;
    this.#finishCreate(g.drawing);
  }

  /** Drop stroke points within the tool's `simplify` tolerance, for tools that opt in. */
  #simplify(drawing: Drawing): void {
    const opt = this.#tools.get(drawing.type)?.simplify;
    if (!opt) return;
    const tolerance = opt === true ? SIMPLIFY_PX : opt;
    const keep = simplifyPolyline(this.#project(drawing).points, tolerance);
    drawing.points = keep.map((i) => drawing.points[i]!);
  }

  #constrain(drawing: Drawing, anchor: number): void {
    const tool = this.#tools.get(drawing.type);
    if (tool?.constrain) drawing.points = tool.constrain(drawing.points.map((q) => ({ ...q })), anchor);
  }

  #finishCreate(drawing: Drawing): void {
    this.#gesture = null;
    this.#toolUsed();
    this.select(drawing.id);
    if (this.#tools.get(drawing.type)?.editableText) this.editText(drawing, true);
    else this.#changed();
  }

  /** The active tool did its job: back to the cursor unless the tool is kept. */
  #toolUsed(): void {
    if (!this.stayInDrawingMode && !this.#kept) this.setTool(null);
  }

  /** The new drawing being placed, anchor by anchor or as a freehand stroke, or null. */
  get #creating(): Drawing | null {
    const g = this.#gesture;
    return g?.kind === 'create' || g?.kind === 'free' ? g.drawing : null;
  }

  /** A new drawing is being placed. */
  get #isCreating(): boolean {
    return this.#creating !== null;
  }

  /**
   * Place the drawing a finished sketch reads as best, among the tools that
   * are registered and allowed, like one placed with the tool: selected and
   * one undo step. Nothing for a stroke that fits no tool. A scribble over
   * drawings erases them instead.
   */
  #placeSketch(g: Extract<Gesture, { kind: 'sketch' }>): void {
    if (!this.locked && isScribble(g.points) && this.#erase(g.points)) return;
    const fits = recognizeSketch(g.points, { plotWidth: this.#host.time.width }).filter((c) => this.#tools.has(c.tool) && this.isToolAllowed(c.tool));
    if (!fits[0]) return;
    const drawing: Drawing = { id: newId(), type: '', pane: g.pane, points: [], style: {}, ...this.#tie(g.pane) };
    this.#fitSketch(drawing, fits[0]);
    this.append(drawing);
    this.select(drawing.id);
    this.#changed();
    this.#sketched = { id: drawing.id, fits, at: 0 };
  }

  /** Make `d` the drawing `fit` describes: its tool, default style and anchors. */
  #fitSketch(d: Drawing, fit: SketchCandidate): void {
    d.type = fit.tool;
    d.style = this.toolDefaults(fit.tool);
    d.points = fit.points.map((q) => this.#toModel(d, q));
  }

  /** Swap the sketched drawing for the fit `step` places on, in the undo step that placed it. */
  #swapSketch(s: Sketched, step: number): void {
    const d = this.#items.find((x) => x.id === s.id);
    if (!d) return this.#endHint();
    s.at = (s.at + step + s.fits.length) % s.fits.length;
    this.#fitSketch(d, s.fits[s.at]!);
    if (this.#commit(true)) this.notify();
    this.#sketched = s;
  }

  /** Hide the sketch hint, if it shows. */
  #endHint(): void {
    if (!this.#sketched) return;
    this.#sketched = null;
    this.#host.requestOverlay();
  }

  /** Remove the unlocked drawings the stroke through `points` (plot space) crosses, as one undo step. False when it crosses none. */
  #erase(points: readonly Point[]): boolean {
    const ids = new Set<string>();
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      // Every few px along the stroke, so a fast stroke still crosses thin lines.
      const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4);
      for (let k = 0; k <= n; k++) {
        const d = this.hitTest({ x: a.x + ((b.x - a.x) * k) / (n || 1), y: a.y + ((b.y - a.y) * k) / (n || 1) })?.drawing;
        if (d && !d.locked) ids.add(d.id);
      }
    }
    if (ids.size === 0) return false;
    this.#items = this.#items.filter((d) => !ids.has(d.id));
    this.#pruneSelection();
    this.#changed();
    return true;
  }

  /** Drop the drawing being placed, or the sketch or box being drawn, if any. */
  #cancelCreate(): void {
    const g = this.#gesture;
    if (g?.kind !== 'create' && g?.kind !== 'free' && g?.kind !== 'sketch' && g?.kind !== 'box') return;
    if (g.kind === 'create' || g.kind === 'free') this.#items = this.#items.filter((d) => d !== g.drawing);
    this.#gesture = null;
    this.#host.requestOverlay();
  }

  private editText(drawing: Drawing, isNew = false): void {
    // At the last point: where a callout's text box sits; a text drawing has only one.
    const at = this.#project(drawing).points.at(-1)!;
    const pane = this.#paneOf(drawing);
    if (isNew) this.#drafts.add(drawing.id);
    const optional = this.#tools.get(drawing.type)?.editableText === 'optional';
    this.#host.editText({ x: at.x, y: at.y + pane.top }, drawing.text ?? '', (text) => {
      if (isNew) this.#drafts.delete(drawing.id);
      // By id: an undo while the editor was open may have replaced the object.
      if (text !== null && text.trim() !== '') this.update(drawing.id, { text });
      else if (!optional) {
        if (isNew) this.remove(drawing.id);
      } else if (isNew) this.#changed(); // Optional text: the new drawing stays without it.
      else if (text !== null && this.#items.find((x) => x.id === drawing.id)?.text) this.update(drawing.id, { text: '' });
    });
  }

  /**
   * Select one drawing by id, replacing the selection, or clear it with null.
   * Unknown, hidden (also by `visibleOn`) and unselectable drawings are ignored.
   */
  select(id: string | null): void {
    if (id === null) this.#setSelected([]);
    else if (this.#isSelectable(this.#items.find((x) => x.id === id))) this.#setSelected([id]);
  }

  /** Make `ids` (checked by the caller) the selection; emits only on change. */
  #setSelected(ids: string[]): void {
    const before = this.#selectedIds;
    if (ids.length === before.length && ids.every((id, i) => id === before[i])) return;
    this.#selectedIds = ids;
    this.#host.emit('drawing:select', { id: this.#selectedId, ids: [...ids] });
    if (ids.length === 0) this.#emitBounds(null, null);
    this.#host.requestOverlay();
  }

  /** The last drawing selected, or null. */
  get #selectedId(): string | null {
    return this.#selectedIds.at(-1) ?? null;
  }

  #isSelected(id: string): boolean {
    return this.#selectedIds.includes(id);
  }

  #isSelectable(d: Drawing | undefined): d is Drawing {
    return d !== undefined && this.#isShown(d) && d.selectable !== false;
  }

  /** `id` and the selectable drawings of its group, bottom to top with `id` last; just `id` outside a group. */
  #withGroup(id: string): string[] {
    const name = this.#items.find((d) => d.id === id)?.group;
    if (!name) return [id];
    const others = this.ordered().filter((d) => d.group === name && d.id !== id && this.#isSelectable(d));
    return [...others.map((d) => d.id), id];
  }

  /** Names of the groups in use. */
  #groupNames(): Set<string> {
    return new Set(this.#items.flatMap((d) => (d.group ? [d.group] : [])));
  }

  /** The first default group name not in `taken`. */
  #freeGroupName(taken: ReadonlySet<string>): string {
    // One of `taken.size + 1` distinct names is free; a host repeating names falls back to the plain ones.
    const named = this.#host.groupName;
    for (const name of [named, (n: number) => `Group ${n}`]) {
      for (let n = 1; name && n <= taken.size + 1; n++) {
        const text = name(n);
        if (!taken.has(text)) return text;
      }
    }
    return `Group ${taken.size + 1}`;
  }

  /** Put `members` into group `name` (`''`: no group), as one undo step. */
  #setGroup(members: readonly Drawing[], name: string): void {
    this.batch(() => {
      for (const d of members) this.update(d.id, { group: name });
    });
  }

  /** Drop drawings from the selection that are gone, hidden or no longer selectable. */
  #pruneSelection(): void {
    this.#setSelected(this.#selectedIds.filter((id) => this.#isSelectable(this.#items.find((d) => d.id === id))));
  }

  /** Remove every selected drawing, as one undo step. */
  #removeSelection(): void {
    const ids = new Set(this.#selectedIds);
    this.#items = this.#items.filter((d) => !ids.has(d.id));
    this.#setSelected([]);
    this.#changed();
  }

  /**
   * Points of `d` moved from `origin` by the move gesture `g` to `p`: by
   * whole bars (fractional for freehand strokes) and, in coordinates of its
   * own price scale, by the pointer's height change, so the shape holds on log
   * scales. Screen-anchored drawings shift by pane fractions.
   */
  #movedPoints(g: Extract<Gesture, { kind: 'move' }>, d: Drawing, origin: DrawingPoint[], p: Point): DrawingPoint[] {
    if (this.#isScreen(d)) return this.#shiftedScreen(d, origin, p.x - g.start.x, p.y - g.start.y);
    const scale = this.#scaleOf(d);
    const index = this.#host.time.xToIndex(p.x);
    const dIndex = this.#isFree(d) ? index - g.startIndex : Math.round(index) - Math.round(g.startIndex);
    const dCoord = scale.toCoord(scale.yToPrice(p.y - this.#paneOf(d).top)) - scale.toCoord(g.startPrices.get(scale)!);
    return this.#shiftedPoints(d, origin, dIndex, dCoord);
  }

  /**
   * `origin` of a screen-anchored drawing shifted by `dx`, `dy` css px,
   * stopping where its anchors or its tool's `bounds` box (a note's box)
   * meet the pane edges, so it keeps its shape and stays on the pane.
   */
  #shiftedScreen(d: Drawing, origin: DrawingPoint[], dx: number, dy: number): DrawingPoint[] {
    const width = this.#host.time.width;
    const height = this.#paneOf(d).height;
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    const xs = origin.map((q) => q.time);
    const ys = origin.map((q) => q.price);
    const bounds = this.#host.panes[d.pane] && this.#toolFor(d)?.bounds;
    const box = bounds && bounds(this.#project({ ...d, points: origin }), this.#envOf(d, width, height));
    if (box) {
      xs.push(box.x / w, (box.x + box.width) / w);
      ys.push(box.y / h, (box.y + box.height) / h);
    }
    const fx = clampShift(dx / w, xs);
    const fy = clampShift(dy / h, ys);
    return origin.map((q) => ({ time: q.time + fx, price: q.price + fy }));
  }

  /** `origin` shifted by `dIndex` bars (whole bars but for freehand strokes) and by `dCoord` in its price scale's coordinates. */
  #shiftedPoints(d: Drawing, origin: DrawingPoint[], dIndex: number, dCoord: number): DrawingPoint[] {
    const scale = this.#scaleOf(d);
    const free = this.#isFree(d);
    const tl = this.#host.timeline;
    return origin.map((q) => ({
      time: free ? this.#timeAt(tl.indexFromTime(q.time) + dIndex) : tl.timeFromIndex(Math.round(tl.indexFromTime(q.time)) + dIndex),
      price: scale.fromCoord(scale.toCoord(q.price) + dCoord),
    }));
  }

  /**
   * Move the unlocked selected drawings by `step` bars (left and right) or
   * css px (up and down; also left and right for screen-anchored drawings),
   * as one undo step. The repeats of a held key (`repeat`) join the step its
   * first press made, so holding a key is undone at once. False when no
   * selected drawing can move.
   */
  #nudge(key: string, step: number, repeat: boolean): boolean {
    const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
    const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
    const members = this.#items.filter((d) => this.#isSelected(d.id) && !d.locked);
    if ((dx === 0 && dy === 0) || members.length === 0) return false;
    for (const d of members) {
      if (this.#isScreen(d)) {
        d.points = this.#shiftedScreen(d, d.points, dx, dy);
        continue;
      }
      const scale = this.#scaleOf(d);
      const mid = this.#paneOf(d).height / 2;
      const dCoord = scale.toCoord(scale.yToPrice(mid + dy)) - scale.toCoord(scale.yToPrice(mid));
      d.points = this.#shiftedPoints(d, d.points, dx, dCoord);
    }
    const ids = members.map((d) => d.id).join('\n');
    if (this.#commit(repeat && this.#nudged === ids)) this.notify();
    this.#nudged = ids;
    return true;
  }

  /**
   * Add to the selection the drawings of pane `paneIndex` whose anchors all
   * lie in the box from `a` to `b` (plot-space css px), with their groups. A
   * box too small to be a drag selects nothing.
   */
  #selectInBox(paneIndex: number, a: Point, b: Point): void {
    if (Math.abs(b.x - a.x) <= DRAG_CREATE_PX && Math.abs(b.y - a.y) <= DRAG_CREATE_PX) return;
    const top = this.#host.panes[paneIndex]?.top ?? 0;
    const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
    const [y0, y1] = [Math.min(a.y, b.y) - top, Math.max(a.y, b.y) - top];
    const inside = this.ordered().filter((d) => {
      if (d.pane !== paneIndex || !this.#isSelectable(d) || !this.#tools.has(d.type) || d.points.length === 0) return false;
      return this.#project(d).points.every((q) => q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1);
    });
    const added = [...new Set(inside.flatMap((d) => this.#withGroup(d.id)))].filter((id) => !this.#isSelected(id));
    if (added.length > 0) this.#setSelected([...this.#selectedIds, ...added]);
  }

  /** Anchors, extra handles and the tool's own extent of a projected drawing, pane-local. */
  #grips(sd: ScreenDrawing, tool: DrawingToolDef, env: DrawingEnv): Point[] {
    const grips = [...sd.points, ...(tool.handles?.(sd, env) ?? [])];
    const extent = tool.bounds?.(sd, env);
    if (extent) grips.push({ x: extent.x, y: extent.y }, { x: extent.x + extent.width, y: extent.y + extent.height });
    return grips;
  }

  /** The selection box of `g`; ctx is translated to the top of its pane, at `top` in plot space. */
  #drawBox(ctx: CanvasRenderingContext2D, g: Extract<Gesture, { kind: 'box' }>, top: number): void {
    const x = Math.min(g.start.x, g.end.x);
    const y = Math.min(g.start.y, g.end.y) - top;
    const w = Math.abs(g.end.x - g.start.x);
    const h = Math.abs(g.end.y - g.start.y);
    ctx.save();
    ctx.fillStyle = this.#host.theme.drawing;
    ctx.strokeStyle = this.#host.theme.drawing;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.globalAlpha = 0.08;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
    ctx.restore();
  }

  /** Make `style` the defaults set over tool `type`'s own (`{}` clears them); emits only on change. */
  #putDefaults(type: string, style: DrawingStyle): void {
    const before = this.#styleDefaults.get(type) ?? {};
    if (same(before, style)) return;
    if (Object.keys(style).length === 0) this.#styleDefaults.delete(type);
    else this.#styleDefaults.set(type, copyStyle(style));
    this.#host.emit('tool:defaults-change', { tool: type, defaults: this.toolDefaults(type) });
  }

  #emitBounds(id: string | null, rect: Rect | null): void {
    const key = rect ? `${id}:${rect.x}:${rect.y}:${rect.width}:${rect.height}` : `${id}:-`;
    if (key === this.#boundsKey) return;
    this.#boundsKey = key;
    this.#host.emit('drawing:bounds', { id, rect });
  }

  #applyPatch(id: string, patch: DrawingPatch): boolean {
    checkFields(patch);
    const d = this.#items.find((x) => x.id === id);
    if (!d) return false;
    if (patch.points) d.points = patch.points.map((p) => ({ ...p }));
    if (patch.style) d.style = { ...d.style, ...patch.style };
    if (patch.text !== undefined) d.text = patch.text;
    if (patch.visibleOn !== undefined) setRanges(d, patch.visibleOn);
    const flags = d as unknown as Record<FlagKey, unknown>;
    for (const key of FLAG_KEYS) {
      const value = patch[key];
      // Setting a flag to the value it already has is no change, so it must not alter the stored keys.
      if (value === undefined || value === (flags[key] ?? FLAG_DEFAULTS[key])) continue;
      if (value === FLAG_DEFAULTS[key]) delete flags[key];
      else flags[key] = value;
    }
    if (patch.zIndex !== undefined || patch.below !== undefined) this.#order = null;
    if (patch.indicator) d.pane = this.#tiedPane(d) ?? d.pane;
    return true;
  }

  /**
   * Drawings bottom to top: `below` ones first, then by `zIndex`, ties in
   * insertion order. Cached until the list, a `zIndex` or `below` changes, so
   * frames and pointer moves sort nothing. Callers that change the result
   * must assign it back to `items`.
   */
  private ordered(): Drawing[] {
    return (this.#order ??= [...this.#list].sort((a, b) => +!a.below - +!b.below || (a.zIndex ?? 0) - (b.zIndex ?? 0)));
  }

  /** @internal Whether a drawing redraw must repaint the scene: some drawing is `below`. */
  get below(): boolean {
    return this.#list.some((d) => d.below);
  }

  /**
   * @internal Price span the `autoscale` drawings of pane `pane` keep in view
   * over the bars from time `from` to `to`, or null; with `scale`, only those
   * drawn on that price scale (see `Drawing.indicator`). During a gesture the
   * last span stays, so a drawing dragged near the edge does not move the
   * scale under the pointer. `positiveOnly` skips prices a log scale cannot show.
   */
  fitRange(pane: number, from: Time, to: Time, positiveOnly: boolean, scale?: PriceScale): [number, number] | null {
    const key = scale ?? pane;
    let r = this.#gesture ? this.#fits.get(key) : undefined;
    if (r === undefined) {
      const out = fitBuilder.reset(positiveOnly);
      for (const d of this.hidden ? [] : this.#list) {
        const on = d.autoscale && d.pane === pane && (!scale || this.#scaleOf(d) === scale);
        const tool = on && this.#isShown(d) ? this.#toolFor(d) : undefined;
        if (!tool || tool.anchoring === 'screen') continue;
        const box = tool.modelBounds ? tool.modelBounds(d) : pointBounds(d);
        if (box.from > to || box.to < from) continue;
        if (Number.isFinite(box.low)) out.add(box.low);
        if (Number.isFinite(box.high)) out.add(box.high);
      }
      this.#fits.set(key, (r = out.range));
    }
    // A copy: autoscale widens the range it is handed in place.
    return r && [r[0], r[1]];
  }

  /**
   * Whether `d` may show in the pane-local box `[left, right] × [top, bottom]`
   * (css px), widened by `CULL_MARGIN`. Answers yes for drawings the chart
   * must always handle: selected, hovered or being edited, pinned to the pane,
   * or with a position the conversions cannot place.
   */
  #mayCover(d: Drawing, tool: DrawingToolDef, left: number, top: number, right: number, bottom: number): boolean {
    const g = this.#gesture;
    if (this.#isSelected(d.id) || d.id === this.#hoveredId || (g && 'drawing' in g && d === g.drawing)) return true;
    if (tool.anchoring === 'screen' || d.points.length === 0) return true;
    let x0: number;
    let x1: number;
    let y0: number;
    let y1: number;
    if (!tool.modelBounds && tool.bounds) {
      // Only the tool knows its extent beyond the anchors, and only on screen.
      const sd = this.#project(d);
      const pane = this.#paneOf(d);
      const extent = tool.bounds(sd, this.#envOf(d, this.#host.time.width, pane.height));
      x0 = y0 = Infinity;
      x1 = y1 = -Infinity;
      for (const q of sd.points) {
        x0 = Math.min(x0, q.x);
        x1 = Math.max(x1, q.x);
        y0 = Math.min(y0, q.y);
        y1 = Math.max(y1, q.y);
      }
      if (extent) {
        x0 = Math.min(x0, extent.x);
        x1 = Math.max(x1, extent.x + extent.width);
        y0 = Math.min(y0, extent.y);
        y1 = Math.max(y1, extent.y + extent.height);
      }
    } else {
      const box = tool.modelBounds ? tool.modelBounds(d) : pointBounds(d);
      const tl = this.#host.timeline;
      const time = this.#host.time;
      const scale = this.#scaleOf(d);
      const x = (t: number) => (Number.isFinite(t) ? time.indexToX(tl.indexFromTime(t)) : t);
      x0 = x(box.from);
      x1 = x(box.to);
      if (Number.isFinite(box.low) && Number.isFinite(box.high)) {
        const ya = scale.priceToY(box.low);
        const yb = scale.priceToY(box.high);
        y0 = Math.min(ya, yb);
        y1 = Math.max(ya, yb);
      } else {
        // An open price side may point up or down (inverted scales): treat the height as open.
        y0 = -Infinity;
        y1 = Infinity;
      }
    }
    // NaN (a price a log scale cannot place) compares false: keep the drawing.
    return !(
      x1 < left - CULL_MARGIN ||
      x0 > right + CULL_MARGIN ||
      y1 < top - CULL_MARGIN ||
      y0 > bottom + CULL_MARGIN
    );
  }

  /**
   * Move a drawing to position `to(list, i)` of the bottom-to-top list. It
   * takes the `zIndex` of the drawing it passes, so the sort keeps it there.
   */
  #reorder(id: string, to: (list: Drawing[], i: number) => number): void {
    const list = this.ordered();
    const i = list.findIndex((d) => d.id === id);
    if (i < 0) return;
    const j = to(list, i);
    if (j === i) return;
    const [d] = list.splice(i, 1);
    const passed = list[j > i ? j - 1 : j]!;
    const z = passed.zIndex ?? 0;
    if ((d!.zIndex ?? 0) !== z) {
      if (z === 0) delete d!.zIndex;
      else d!.zIndex = z;
    }
    list.splice(j, 0, d!);
    this.#items = list;
    this.#changed();
  }

  /** Commit the current drawings as one undo step and notify listeners, if anything changed. */
  #changed(): void {
    if (this.#batchDepth > 0) {
      this.#batchDirty = true;
      this.#host.requestOverlay();
      return;
    }
    if (this.#commit()) this.notify();
    else this.#host.requestOverlay();
  }

  private notify(): void {
    this.#host.emit('drawings:change', { drawings: this.snapshot() });
    this.#host.requestOverlay();
  }

  /** Every drawing but those not yet finished: one being drawn, or a new text drawing awaiting its text. */
  private snapshot(): Drawing[] {
    const drawing = this.#creating?.id ?? null;
    if (drawing === null && this.#drafts.size === 0) return this.getAll();
    return this.getAll().filter((d) => d.id !== drawing && !this.#drafts.has(d.id));
  }

  /**
   * Push the previous committed state. No-op commits (e.g. a click that only
   * selects) add no step and return false; changes only to drawings kept out
   * of history (`history: false`) return true but add no step either.
   */
  #commit(merge = false): boolean {
    this.#previewing = false;
    this.#nudged = null;
    this.#sketched = null;
    const next = this.snapshot();
    const previous = this.#committed;
    if (sameDrawings(next, previous)) return false;
    const skip = untrackedIds(previous, next);
    const tracked = (list: Drawing[]) => (skip.size === 0 ? list : list.filter((d) => !skip.has(d.id)));
    let step = false;
    if (!sameDrawings(tracked(next), tracked(previous))) {
      step = !merge;
      if (step) this.#undoStack.push(previous);
      if (this.#undoStack.length > MAX_HISTORY) this.#undoStack.shift();
      this.#redoStack = [];
    }
    this.#committed = next;
    // A history that takes no step (while it undoes) leaves the stack as it was.
    if (!step) this.#emitHistory();
    else if (!this.#history.record(this.#step)) this.#undoStack.pop();
    this.#emitDiff(previous, next);
    return true;
  }

  /** Go back or forward to `saved`, keeping drawings out of history as they are now. */
  #restore(saved: Drawing[]): void {
    this.#previewing = false;
    this.#nudged = null;
    this.#sketched = null;
    const previous = this.#committed;
    const snapshot = keepUntracked(saved, previous);
    this.#committed = snapshot;
    this.#items = snapshot.map(clone);
    this.#pruneSelection();
    this.#emitDiff(previous, snapshot);
    this.notify();
  }

  /** Granular events between two committed states (both bottom to top). */
  #emitDiff(before: Drawing[], after: Drawing[]): void {
    const old = new Map(before.map((d) => [d.id, d]));
    const ids = new Set(after.map((d) => d.id));
    // Stacking rank among the drawings present in both states.
    const rank = (list: Drawing[]) => new Map(list.filter((d) => old.has(d.id) && ids.has(d.id)).map((d, i) => [d.id, i]));
    const rankBefore = rank(before);
    const rankAfter = rank(after);
    for (const d of before) if (!ids.has(d.id)) this.#host.emit('drawing:remove', { id: d.id });
    for (const d of after) {
      const prev = old.get(d.id);
      if (!prev) {
        this.#host.emit('drawing:create', { drawing: clone(d) });
        continue;
      }
      const changes = changesBetween(prev, d);
      if (rankBefore.get(d.id) !== rankAfter.get(d.id) && !changes.includes('order')) changes.push('order');
      if (changes.length > 0) this.#host.emit('drawing:update', { drawing: clone(d), change: changes[0]!, changes });
    }
  }

  /** Drop an unfinished gesture or preview and its uncommitted edits. */
  #abortGesture(): boolean {
    this.#gesture = null;
    this.#previewing = false;
    this.#items = this.#committed.map(clone);
    this.#host.requestOverlay();
    return true;
  }

  #resetHistory(): void {
    this.#previewing = false;
    this.#nudged = null;
    this.#committed = this.snapshot();
    this.#undoStack = [];
    this.#redoStack = [];
    if (!this.#history.drop(this.#step)) this.#emitHistory();
  }

  #emitHistory(): void {
    this.#host.emit('history:change', { canUndo: this.canUndo, canRedo: this.canRedo });
  }

  #updateHover(p: Point): void {
    const id = this.hidden ? null : (this.hitTest(p)?.drawing.id ?? null);
    if (id !== this.#hoveredId) {
      this.#hoveredId = id;
      this.#host.requestOverlay();
    }
  }

  #paneOf(d: Drawing): Pane {
    const pane = this.#host.panes[d.pane] ?? this.#host.panes[0];
    if (!pane) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Chart has no panes' : '');
    return pane;
  }

  /** The price scale `d` reads prices on: its indicator's, while that is on its pane, else the pane's primary scale. */
  #scaleOf(d: Drawing): PriceScale {
    const pane = this.#paneOf(d);
    const tie = d.indicator ? this.#host.indicator?.(d.indicator) : null;
    return (tie?.scale && this.#host.panes[tie.pane] === pane && tie.scale) || pane.primary;
  }

  /** The tool env of `d`: on its pane, at its price scale. */
  #envOf(d: Drawing, width: number, height: number): DrawingEnv {
    return this.env(d.pane, width, height, this.#scaleOf(d));
  }

  /**
   * The tool that draws `d`, or undefined while there is none: no tool of its
   * type, or fewer points than the tool needs. A drawing saved while its tool
   * was missing was only checked for one point, so it waits here instead of
   * making the tool throw on every frame.
   */
  #toolFor(d: Drawing): DrawingToolDef | undefined {
    const tool = this.#tools.get(d.type);
    return tool && (typeof tool.points !== 'number' || d.points.length >= tool.points) ? tool : undefined;
  }

  /** Throw for a tool this chart does not have, listing the ones it has. */
  #unknownTool(call: string, type: string): never {
    const available = [...this.#tools.keys()];
    const hint =
      available.length > 0
        ? `this chart has ${available.map((t) => `"${t}"`).join(', ')}`
        : 'this chart has no drawing tools: create it with the drawingTools() plugin (or builtins())';
    throw new ChartError('not-registered', /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Unknown drawing tool "${type}": ${hint}` : '', {
      context: { call, tool: type, available },
    });
  }

  /** The tie of a drawing started on pane `pane`: to the indicator there, if any. */
  #tie(pane: number): { indicator?: string } {
    const id = this.#host.paneIndicator?.(pane);
    return id ? { indicator: id } : {};
  }

  /** Whether `d` shows: not `hidden`, its `visibleOn` covers the chart's interval, and its indicator shows. */
  #isShown(d: Drawing): boolean {
    return !d.hidden && this.#onInterval(d, this.#barSeconds());
  }

  /**
   * Whether `d`'s `visibleOn` covers an interval of `seconds` (an unknown
   * interval shows every drawing), and its indicator, if any, shows.
   */
  #onInterval(d: Drawing, seconds: number | null): boolean {
    return (seconds === null || inIntervalRanges(d.visibleOn, seconds)) && (!d.indicator || this.#host.indicator?.(d.indicator)?.shown === true);
  }

  /** Length of the chart's bar interval in seconds, or null while unknown. */
  #barSeconds(): number | null {
    return this.#host.intervalSeconds?.() ?? null;
  }

  #isScreen(d: Drawing): boolean {
    return this.#tools.get(d.type)?.anchoring === 'screen';
  }

  /** The host's `priceFactor`, 1 without one. */
  #factor(pane: number, time: Time): number {
    return this.#host.priceFactor?.(pane, time) ?? 1;
  }

  /** `list` with each point priced by `price`; screen-anchored drawings and those it leaves alone are kept as they are. */
  #repriced(list: Drawing[], price: (pane: number, time: Time, price: number) => number): Drawing[] {
    return list.map((d) => {
      if (this.#isScreen(d)) return d;
      let points: DrawingPoint[] | null = null;
      d.points.forEach((p, i) => {
        const next = price(d.pane, p.time, p.price);
        if (next === p.price) return;
        points ??= d.points.slice();
        points[i] = { ...p, price: next };
      });
      return points ? { ...d, points } : d;
    });
  }

  #isFree(d: Drawing): boolean {
    return this.#tools.get(d.type)?.points === 'free';
  }

  /**
   * Plot-space `p` as a point of `d` placed or dragged from its point `ref`:
   * with Shift held, on a horizontal, vertical or 45° line from `ref` on
   * screen, and without the magnet. Horizontal keeps `ref`'s price exactly
   * and vertical its time.
   */
  #pointFor(d: Drawing, ref: number, p: Point): DrawingPoint {
    const from = d.points[ref];
    if (!this.#modifiers.shift || !from || this.#isFree(d)) return this.#toModel(d, p);
    const r = this.#screenPoint(d, from);
    const origin = { x: r.x, y: r.y + this.#paneOf(d).top };
    const q = constrainAngle(origin, p);
    const m = this.#toModel(d, q, false);
    const ohlc = this.#tools.get(d.type)?.snap === 'ohlc';
    return { time: q.x === origin.x ? from.time : m.time, price: q.y === origin.y && !ohlc ? from.price : m.price };
  }

  /**
   * How `toModel` snaps the price of `d`: by a tool's own `snap` first, then
   * fully while Ctrl/Cmd is held, then by the magnet. Only in the main pane,
   * where the bars are.
   */
  #magnetFor(d: Drawing, magnet: boolean): MagnetMode {
    const snap = this.#tools.get(d.type)?.snap;
    // The magnet snaps to the main series, on the price pane's primary scale.
    if (d.pane !== 0 || snap === 'time' || this.#scaleOf(d) !== this.#paneOf(d).primary) return 'off';
    if (snap === 'ohlc') return 'strong';
    if (!magnet) return 'off';
    return this.#modifiers.ctrl ? 'strong' : this.#magnetState;
  }

  /**
   * Plot-space point to a stored point: bar time and price, pane fractions,
   * or exact time for freehand. `magnet: false` leaves the magnet out (a
   * tool's `'ohlc'` snap still applies).
   */
  #toModel(d: Drawing, p: Point, magnet = true): DrawingPoint {
    const pane = this.#paneOf(d);
    const y = p.y - pane.top;
    if (this.#isScreen(d)) return { time: clamp01(p.x / Math.max(1, this.#host.time.width)), price: clamp01(y / Math.max(1, pane.height)) };
    const exact = this.#host.time.xToIndex(p.x);
    const scale = this.#scaleOf(d);
    if (this.#isFree(d)) return { time: this.#timeAt(exact), price: scale.yToPrice(y) };
    const index = Math.round(exact);
    const raw = scale.yToPrice(y);
    let price = this.#host.roundPrice?.(d.pane, raw, scale) ?? raw;
    const mode = this.#magnetFor(d, magnet);
    if (mode !== 'off') {
      const snapped = this.#host.magnetPrice(index, price);
      if (mode === 'strong' || Math.abs(scale.priceToY(snapped) - y) <= WEAK_MAGNET_PX) price = snapped;
    }
    return { time: this.#host.timeline.timeFromIndex(index), price };
  }

  /** Time at a fractional index, interpolated between bars. */
  #timeAt(index: number): Time {
    const tl = this.#host.timeline;
    const i = Math.floor(index);
    const t0 = tl.timeFromIndex(i);
    return t0 + (index - i) * (tl.timeFromIndex(i + 1) - t0);
  }

  /** Pane-local screen position of a point of `d`. */
  #screenPoint(d: Drawing, q: DrawingPoint): Point {
    const pane = this.#paneOf(d);
    if (this.#isScreen(d)) return { x: q.time * this.#host.time.width, y: q.price * pane.height };
    return { x: this.#host.time.indexToX(this.#host.timeline.indexFromTime(q.time)), y: this.#scaleOf(d).priceToY(q.price) };
  }

  /** Pane-local screen projection. */
  #project(d: Drawing): ScreenDrawing {
    const pane = this.#paneOf(d);
    const scale = this.#scaleOf(d);
    const tl = this.#host.timeline;
    const screen = this.#isScreen(d);
    return {
      drawing: d,
      points: d.points.map((q) =>
        screen
          ? { x: q.time * this.#host.time.width, y: q.price * pane.height }
          : { x: this.#host.time.indexToX(tl.indexFromTime(q.time)), y: scale.priceToY(q.price) },
      ),
      selected: this.#isSelected(d.id),
      hovered: d.id === this.#hoveredId,
    };
  }

  private hitTest(p: Point): ScreenDrawing | null {
    const list = this.ordered();
    const seconds = this.#barSeconds();
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i]!;
      if (d.hidden || d.selectable === false || !this.#onInterval(d, seconds)) continue;
      const tool = this.#toolFor(d);
      const pane = this.#host.panes[d.pane];
      if (!tool || !pane || p.y < pane.top || p.y > pane.top + pane.height) continue;
      const local = { x: p.x, y: p.y - pane.top };
      if (!this.#mayCover(d, tool, local.x, local.y, local.x, local.y)) continue;
      const sd = this.#project(d);
      if (this.#hits(sd, tool, p, local, this.#envOf(d, this.#host.time.width, pane.height))) return sd;
    }
    return null;
  }

  /** Whether plot-space `p` (`local` in the drawing's pane) grabs `sd`: an anchor or handle while selected, or the tool's own hit test. */
  #hits(sd: ScreenDrawing, tool: DrawingToolDef, p: Point, local: Point, env: DrawingEnv): boolean {
    return (sd.selected && (this.#anchorAt(sd, p) >= 0 || this.#handleAt(sd, p) >= 0)) || tool.hitTest(sd, local, env);
  }

  /**
   * @internal Where the pointer would grab each drawing, sampled at the centre
   * of every `step` css px cell of its pane: runs of hit cells as flat
   * `[x, y, width]` triples in plot space, each `step` px tall. Every drawing
   * the pointer can hit is sampled on its own, so overlaps repeat. For the
   * `renderStatsOverlay` bounds; costs a hit test per cell per visible drawing.
   */
  hitRuns(step: number): number[] {
    const runs: number[] = [];
    if (this.hidden) return runs;
    const width = this.#host.time.width;
    const seconds = this.#barSeconds();
    for (const d of this.ordered()) {
      if (d.hidden || d.selectable === false || !this.#onInterval(d, seconds)) continue;
      const tool = this.#toolFor(d);
      const pane = this.#host.panes[d.pane];
      if (!tool || !pane || pane.height <= 0 || !this.#mayCover(d, tool, 0, 0, width, pane.height)) continue;
      const sd = this.#project(d);
      const env = this.#envOf(d, width, pane.height);
      for (let top = 0; top < pane.height; top += step) {
        const y = top + step / 2;
        let start = -1;
        for (let left = 0; left < width; left += step) {
          const x = left + step / 2;
          const hit = this.#hits(sd, tool, { x, y: y + pane.top }, { x, y }, env);
          if (hit && start < 0) start = left;
          if (!hit && start >= 0) {
            runs.push(start, pane.top + top, left - start);
            start = -1;
          }
        }
        if (start >= 0) runs.push(start, pane.top + top, width - start);
      }
    }
    return runs;
  }

  /** Anchor under `p` of a selected drawing; freehand strokes have none (they only move). */
  #anchorAt(sd: ScreenDrawing, p: Point): number {
    if (!sd.selected || this.#isFree(sd.drawing)) return -1;
    const top = this.#paneOf(sd.drawing).top;
    return sd.points.findIndex((a) => Math.hypot(a.x - p.x, a.y + top - p.y) <= ANCHOR_RADIUS + 3);
  }

  /** Draggable extra handle under `p` of a selected drawing. */
  #handleAt(sd: ScreenDrawing, p: Point): number {
    const tool = this.#tools.get(sd.drawing.type);
    if (!sd.selected || !tool?.handles || !tool.moveHandle) return -1;
    const pane = this.#paneOf(sd.drawing);
    const handles = tool.handles(sd, this.#envOf(sd.drawing, this.#host.time.width, pane.height));
    return handles.findIndex((h) => Math.hypot(h.x - p.x, h.y + pane.top - p.y) <= ANCHOR_RADIUS + 3);
  }

  #drawAnchors(ctx: CanvasRenderingContext2D, sd: ScreenDrawing, tool: DrawingToolDef, env: DrawingEnv, color: string): void {
    ctx.save();
    ctx.setLineDash([]);
    ctx.lineWidth = 1.5;
    ctx.fillStyle = this.#host.theme.background;
    ctx.strokeStyle = color;
    if (!this.#isFree(sd.drawing)) {
      for (const a of sd.points) {
        ctx.beginPath();
        ctx.arc(a.x, a.y, ANCHOR_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    // Extra handles are squares so they read differently from anchors.
    const r = ANCHOR_RADIUS - 1;
    for (const h of tool.handles?.(sd, env) ?? []) {
      ctx.beginPath();
      ctx.rect(h.x - r, h.y - r, r * 2, r * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * The theme tools see: the host's, with `fontFamily` and `fontSize` set to the
   * drawings font, so tools that read the theme font follow `typography.drawings`.
   */
  #drawingTheme(): ChartTheme {
    const source = this.#host.theme;
    if (this.#themeFor?.source !== source) {
      const font = resolveFont(source, 'drawings');
      const same = font.fontFamily === source.fontFamily && font.fontSize === source.fontSize;
      this.#themeFor = { source, theme: same ? source : { ...source, fontFamily: font.fontFamily, fontSize: font.fontSize } };
    }
    return this.#themeFor.theme;
  }

  private env(paneIndex: number, width: number, height: number, scale?: PriceScale): DrawingEnv {
    const theme = this.#drawingTheme();
    const tl = this.#host.timeline;
    const time = this.#host.time;
    const price = scale ?? this.#host.panes[paneIndex]!.primary;
    const span = (from: Time, to: Time): BarSpan => this.#host.barSpan?.(from, to) ?? { bars: [], start: 0, end: 0 };
    return {
      width,
      height,
      theme,
      pixelRatio: this.#host.pixelRatio ?? 1,
      formatPrice: (p) => this.#host.formatPrice(paneIndex, p, scale),
      formatTime: (t) => this.#host.formatTime?.(t) ?? '',
      localization: this.#host.localization,
      priceToY: (p) => price.priceToY(p),
      yToPrice: (y) => price.yToPrice(y),
      timeToX: (t) => time.indexToX(tl.indexFromTime(t)),
      xToTime: (x) => this.#timeAt(time.xToIndex(x)),
      barsBetween: (a, b) => Math.round(tl.indexFromTime(b.time) - tl.indexFromTime(a.time)),
      barSpan: span,
      // An arrow, not a method: tools may call it detached (`const { bars } = env`).
      bars: (from, to) => {
        const { bars, start, end } = span(from, to);
        return bars.slice(start, end);
      },
      measureText: (text, fontSize, style) => {
        this.#measureCtx ??= document.createElement('canvas').getContext('2d');
        if (!this.#measureCtx) return text.length * fontSize * 0.6;
        this.#measureCtx.font = drawingFont(fontSize, theme.fontFamily, style, drawingWeight({ theme }));
        return this.#measureCtx.measureText(text).width;
      },
      redraw: this.#redraw,
    };
  }
}

/** Ids of drawings kept out of history (`history: false`) in either list. */
function untrackedIds(a: Drawing[], b: Drawing[]): Set<string> {
  const ids = new Set<string>();
  for (const list of [a, b]) for (const d of list) if (d.history === false) ids.add(d.id);
  return ids;
}

/**
 * `saved` with the drawings kept out of history as they are in `current`:
 * in their saved place, or, when added since, above the drawing below them
 * now. Those gone now stay gone.
 */
function keepUntracked(saved: Drawing[], current: Drawing[]): Drawing[] {
  const skip = untrackedIds(saved, current);
  if (skip.size === 0) return saved;
  const now = new Map(current.filter((d) => skip.has(d.id)).map((d) => [d.id, d]));
  const out = saved.flatMap((d) => (!skip.has(d.id) ? [d] : now.has(d.id) ? [now.get(d.id)!] : []));
  const present = new Set(out.map((d) => d.id));
  let below: string | null = null;
  for (const d of current) {
    if (skip.has(d.id) && !present.has(d.id)) {
      out.splice(below === null ? 0 : out.findIndex((x) => x.id === below) + 1, 0, d);
      present.add(d.id);
    }
    if (present.has(d.id)) below = d.id;
  }
  return out;
}

/** Every anchor's price and time; a freehand stroke's extremes; nothing for screen-anchored tools. */
function defaultAxisMarks(tool: DrawingToolDef, d: Drawing): DrawingAxisMarks | null {
  if (tool.anchoring === 'screen') return null;
  const prices = d.points.map((p) => p.price);
  const times = d.points.map((p) => p.time);
  if (tool.points !== 'free') return { prices, times };
  return { prices: [Math.min(...prices), Math.max(...prices)], times: [Math.min(...times), Math.max(...times)] };
}

/** The finite values of `list`, each once. */
function distinctFinite(list: readonly number[] | undefined): number[] {
  return list ? [...new Set(list.filter(Number.isFinite))] : [];
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * `shift` limited so every value of `values` (pane fractions) plus it stays
 * in 0..1. Values already outside, from saved or `add()`ed drawings, may
 * still move back in; a drawing wider than the pane moves freely.
 */
function clampShift(shift: number, values: readonly number[]): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  if (!(hi - lo <= 1)) return shift;
  return Math.min(Math.max(shift, Math.min(0, -lo)), Math.max(0, 1 - hi));
}

/** Box around anchors in plot space, or null when it lies outside the pane. */
function anchorBox(points: Point[], width: number, height: number, top: number): Rect | null {
  if (points.length === 0) return null;
  // One pass: spreading a long stroke into Math.min/max overflows the call stack.
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  if (x1 < 0 || x0 > width || y1 < 0 || y0 > height) return null;
  return { x: Math.round(x0), y: Math.round(y0 + top), width: Math.round(x1 - x0), height: Math.round(y1 - y0) };
}

function newId(): string {
  return `d${Date.now().toString(36)}${(counter++).toString(36)}`;
}

function clone(d: Drawing): Drawing {
  const copy = { ...d, points: d.points.map((p) => ({ ...p })), style: { ...d.style } };
  if (d.visibleOn) copy.visibleOn = d.visibleOn.map((r) => ({ ...r }));
  return copy;
}

/** Store checked copies of `ranges` on `d`; none (null, undefined or `[]`) removes the field. */
function setRanges(d: Drawing, ranges: readonly IntervalRange[] | null | undefined): void {
  const kept = (ranges ?? []).map((r) => intervalRangeOf(r)!);
  if (kept.length > 0) d.visibleOn = kept;
  else delete d.visibleOn;
}

/** A copy of `style` that shares no levels with it. */
function copyStyle(style: DrawingStyle): DrawingStyle {
  const copy = { ...style };
  if (Array.isArray(copy.levels)) copy.levels = copy.levels.map((l) => ({ ...l }));
  return copy;
}

/** `style` without its `undefined` fields: those mean "no default", not a default of undefined. */
function definedStyle(style: DrawingStyle): DrawingStyle {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(style)) if (value !== undefined) out[key] = value;
  return copyStyle(out as DrawingStyle);
}

function sameDrawings(a: Drawing[], b: Drawing[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Kinds of change from `a` to `b`, the same drawing in two states. */
function changesBetween(a: Drawing, b: Drawing): DrawingChange[] {
  const changes: DrawingChange[] = [];
  if (!same(a.points, b.points)) changes.push('points');
  if (!same(a.style, b.style)) changes.push('style');
  if (a.text !== b.text) changes.push('text');
  const differs = (key: FlagKey) => (a[key] ?? FLAG_DEFAULTS[key]) !== (b[key] ?? FLAG_DEFAULTS[key]);
  if (differs('locked')) changes.push('lock');
  if (differs('hidden') || !same(a.visibleOn ?? [], b.visibleOn ?? [])) changes.push('visibility');
  if (differs('zIndex') || differs('below')) changes.push('order');
  if (a.pane !== b.pane) changes.push('pane');
  if (differs('selectable') || differs('persist') || differs('history') || differs('autoscale') || differs('group') || differs('indicator')) changes.push('flags');
  if (differs('name')) changes.push('name');
  return changes;
}

/** A field `load()` dropped from a drawing it kept, or `add()`/`update()` reject. */
interface FieldProblem {
  field: string;
  reason: string;
}

const RANGE_ERROR = 'must be { from, to } with valid intervals and from no longer than to';

/** Optional drawing fields with a fixed type, in the order they are checked. */
const FIELD_KEYS = ['text', ...FLAG_KEYS] as const;

/** Why `value` cannot be the optional drawing field `key`, or null when it can. */
function fieldError(key: (typeof FIELD_KEYS)[number], value: unknown): string | null {
  if (key === 'text' || key === 'group' || key === 'name' || key === 'indicator') return typeof value === 'string' ? null : 'must be a string';
  if (key === 'zIndex') return Number.isFinite(value) ? null : 'must be a finite number';
  return typeof value === 'boolean' ? null : 'must be a boolean';
}

/**
 * Throw on optional fields or style of the wrong type. The same rules
 * `load()` applies; there they drop the field instead.
 */
function checkFields(d: DrawingPatch): void {
  for (const key of FIELD_KEYS) {
    const error = d[key] === undefined ? null : fieldError(key, d[key]);
    if (error) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Drawing "${key}" ${error}` : '');
  }
  const ranges = d.visibleOn;
  if (ranges !== undefined && ranges !== null) {
    if (!Array.isArray(ranges)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Drawing "visibleOn" must be an array of interval ranges' : '');
    const bad = ranges.findIndex((r) => intervalRangeOf(r) === null);
    if (bad >= 0) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Drawing "visibleOn[${bad}]" ${RANGE_ERROR}` : '');
  }
  if (d.style === undefined) return;
  if (!isPlainRecord(d.style)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Drawing "style" must be an object' : '');
  const problem = cleanStyle(d.style).problems[0];
  if (problem) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Drawing "${problem.field}" ${problem.reason}` : '');
}

const STYLE_STRINGS: readonly string[] = ['color', 'fill', 'textColor', 'profitColor', 'lossColor'];
const STYLE_SIZES: readonly string[] = ['lineWidth', 'fontSize'];
const STYLE_COUNTS: readonly string[] = ['deviation', 'rows', 'valueArea', 'profileWidth'];
const STYLE_FLAGS: readonly string[] = ['extendLeft', 'extendRight', 'showLabel', 'showStats', 'showFill', 'bold', 'italic', 'middleLine'];
/** Fields that take one of a few strings, and those strings. */
const STYLE_CHOICES: Readonly<Record<string, readonly unknown[]>> = {
  lineStyle: ['solid', 'dashed', 'dotted'],
  labelSide: ['left', 'right'],
  labelContent: ['level', 'price', 'both', 'percent'],
};

/** Why `value` cannot be the style field `key`, or null when it can (always for keys the chart does not know). */
function styleError(key: string, value: unknown): string | null {
  if (STYLE_STRINGS.includes(key)) return typeof value === 'string' ? null : 'must be a string';
  if (STYLE_COUNTS.includes(key)) return Number.isFinite(value) && (value as number) >= 0 ? null : 'must be a finite number >= 0';
  if (STYLE_SIZES.includes(key)) return Number.isFinite(value) && (value as number) >= 0 ? null : 'must be a finite number >= 0';
  if (STYLE_FLAGS.includes(key)) return typeof value === 'boolean' ? null : 'must be a boolean';
  const choices = Object.hasOwn(STYLE_CHOICES, key) ? STYLE_CHOICES[key] : undefined;
  if (choices) return choices.includes(value) ? null : `must be ${choices.map((c) => `"${c}"`).join(', ').replace(/, (?=[^,]*$)/, ' or ')}`;
  if (key === 'levels') return Array.isArray(value) ? null : 'must be an array';
  if (key === 'angle') return Number.isFinite(value) ? null : 'must be a finite number';
  return null;
}

/**
 * `raw` with ill-typed known fields removed, so the tool's defaults apply,
 * and what was removed. Keys the chart does not know, top-level or on a
 * level, are kept for plugin tools. `undefined` values are left alone.
 */
function cleanStyle(raw: Record<string, unknown>): { style: DrawingStyle; problems: FieldProblem[] } {
  const style: Record<string, unknown> = {};
  const problems: FieldProblem[] = [];
  for (const [key, value] of Object.entries(raw)) {
    const reason = value === undefined ? null : styleError(key, value);
    if (reason) problems.push({ field: `style.${key}`, reason });
    else style[key] = key === 'levels' && value !== undefined ? cleanLevels(value as unknown[], problems) : value;
  }
  return { style: style as DrawingStyle, problems };
}

function cleanLevels(levels: unknown[], problems: FieldProblem[]): DrawingLevel[] {
  const kept: DrawingLevel[] = [];
  levels.forEach((raw, i) => {
    const field = `style.levels[${i}]`;
    if (!isPlainRecord(raw) || !Number.isFinite(raw.value)) {
      problems.push({ field, reason: 'needs a finite "value"' });
      return;
    }
    const level: Record<string, unknown> = { ...raw };
    for (const [key, type] of [
      ['color', 'string'],
      ['visible', 'boolean'],
    ] as const) {
      if (level[key] === undefined || typeof level[key] === type) continue;
      problems.push({ field: `${field}.${key}`, reason: `must be a ${type}` });
      delete level[key];
    }
    kept.push(level as unknown as DrawingLevel);
  });
  return kept;
}

/** Version `serialize()` writes. */
export const DRAWINGS_VERSION = 1;

/** Built-in upgrades: `MIGRATIONS[v]` turns a version `v` payload into version `v + 1`. */
const MIGRATIONS: Record<number, DrawingMigration> = {};

/**
 * Upgrade a saved payload to `current`, step by step through `steps`. A
 * version the steps don't cover goes through `hook` once, which may return
 * the current version or an older one the steps continue from. A payload
 * already at `current` is returned as it is. Throws when neither applies, or
 * when a step does not return a newer version.
 */
export function migrateDrawings(
  data: unknown,
  current: number,
  steps: Readonly<Record<number, DrawingMigration>>,
  hook: DrawingMigration | null = null,
): Record<string, unknown> {
  return migrateVersions(data, current, steps, hook, isRecord, 'invalid-drawings', /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Invalid drawings payload: expected { version, drawings: [] }' : '', 'Drawings');
}

/**
 * Read every valid drawing of a current-version payload; skip and report the
 * rest. `tools` sets how many points a registered tool's drawing needs.
 */
export function readDrawings(
  data: Record<string, unknown>,
  tools: ReadonlyMap<string, DrawingToolDef> = new Map(),
): { drawings: Drawing[]; errors: DrawingLoadError[] } {
  if (!Array.isArray(data.drawings)) throw new ChartError('invalid-drawings', /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Invalid drawings payload: expected { version, drawings: [] }' : '');
  const drawings: Drawing[] = [];
  const errors: DrawingLoadError[] = [];
  const ids = new Set<string>();
  data.drawings.forEach((raw: unknown, index) => {
    const result = readDrawing(raw, tools);
    if (typeof result === 'string') errors.push({ index, reason: result });
    else if (ids.has(result.drawing.id)) errors.push({ index, reason: `duplicate id "${result.drawing.id}"` });
    else {
      ids.add(result.drawing.id);
      drawings.push(result.drawing);
      for (const { field, reason } of result.problems) errors.push({ index, field, reason });
    }
  });
  return { drawings, errors };
}

/** One saved drawing and the ill-typed optional fields dropped from it, or why it cannot load. */
function readDrawing(
  raw: unknown,
  tools: ReadonlyMap<string, DrawingToolDef>,
): { drawing: Drawing; problems: FieldProblem[] } | string {
  if (!isRecord(raw)) return 'not an object';
  if (typeof raw.id !== 'string') return '"id" must be a string';
  if (typeof raw.type !== 'string') return '"type" must be a string';
  if (!Number.isInteger(raw.pane) || (raw.pane as number) < 0) return '"pane" must be a pane index';
  if (!Array.isArray(raw.points)) return '"points" must be an array';
  if (!raw.points.every((p) => isRecord(p) && Number.isFinite(p.time) && Number.isFinite(p.price))) {
    return 'every point needs a finite "time" and "price"';
  }
  // Tools index points freely; too few would throw on every frame.
  const count = tools.get(raw.type)?.points;
  const min = typeof count === 'number' ? count : 1;
  if (raw.points.length < min) return `needs at least ${min} point${min === 1 ? '' : 's'}`;

  const problems: FieldProblem[] = [];
  let style: DrawingStyle = {};
  if (isPlainRecord(raw.style)) {
    const cleaned = cleanStyle(raw.style);
    style = cleaned.style;
    problems.push(...cleaned.problems);
  } else if (raw.style !== undefined) {
    problems.push({ field: 'style', reason: 'must be an object' });
  }
  const valid = (key: (typeof FIELD_KEYS)[number]): boolean => {
    if (raw[key] === undefined) return false;
    const reason = fieldError(key, raw[key]);
    if (reason) problems.push({ field: key, reason });
    return reason === null;
  };
  const fields: Record<string, unknown> = {};
  for (const key of FIELD_KEYS) {
    // `locked` and `hidden` are stored only when set; the rest as saved.
    if (valid(key) && ((key !== 'locked' && key !== 'hidden') || raw[key] === true)) fields[key] = raw[key];
  }
  const visibleOn = readRanges(raw.visibleOn, problems);
  const drawing: Drawing = {
    id: raw.id,
    type: raw.type,
    pane: raw.pane as number,
    points: (raw.points as DrawingPoint[]).map((p) => ({ time: p.time, price: p.price })),
    style,
    ...fields,
    ...(visibleOn ? { visibleOn } : {}),
  };
  return { drawing, problems };
}

/** Saved `visibleOn` ranges, invalid ones dropped and reported; null when none are left (every interval). */
function readRanges(value: unknown, problems: FieldProblem[]): IntervalRange[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) {
    problems.push({ field: 'visibleOn', reason: 'must be an array' });
    return null;
  }
  const kept: IntervalRange[] = [];
  value.forEach((raw, i) => {
    const range = intervalRangeOf(raw);
    if (range) kept.push(range);
    else problems.push({ field: `visibleOn[${i}]`, reason: RANGE_ERROR });
  });
  return kept.length > 0 ? kept : null;
}

/**
 * Validate untrusted serialized drawings (e.g. from storage), strictly:
 * throws on the first malformed drawing. Ill-typed optional fields and
 * style are dropped, as `load()` does. `DrawingManager.load` is the tolerant
 * path.
 */
export function parseSerialized(data: unknown): SerializedDrawings {
  if (!isRecord(data) || data.version !== DRAWINGS_VERSION || !Array.isArray(data.drawings)) {
    throw new ChartError('invalid-drawings', /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Invalid drawings payload: expected { version: 1, drawings: [] }' : '');
  }
  const { drawings, errors } = readDrawings(data);
  const skipped = errors.find((e) => e.field === undefined);
  if (skipped) {
    throw new ChartError('invalid-drawings', /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Invalid drawing at index ${skipped.index}: ${skipped.reason}` : '', { context: { index: skipped.index } });
  }
  return { version: DRAWINGS_VERSION, drawings };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return isRecord(v) && !Array.isArray(v);
}
