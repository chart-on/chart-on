import type { IntervalRange } from '../data/types';
import type { ChartTheme, ThemeColorKey } from '../theme';
import type { Bar, Point, Rect, Time } from '../types';
import type { Localizer } from '../util/locale';

/** An anchor of a drawing in data space: a time (unix seconds) and a price. */
export interface DrawingPoint {
  time: Time;
  price: number;
}

/** One level of a level-based tool such as a Fibonacci retracement. */
export interface DrawingLevel {
  /** Fraction of the measured move. */
  value: number;
  /**
   * A CSS color, the name of a theme color (`'up'`, `'levelGreen'`; see
   * `ThemeColorKey`) to follow the theme, or `'auto'` for the shared level
   * color rule (`levelColor`), which the built-in tools' default levels use.
   * Unset takes the drawing's `color`.
   */
  color?: string;
  visible?: boolean;
}

/** Look of a drawing: colors, line, fill and text, levels, line extensions, and which labels and stats show. */
export interface DrawingStyle {
  color?: string;
  lineWidth?: number;
  lineStyle?: 'solid' | 'dashed' | 'dotted';
  fill?: string;
  fontSize?: number;
  /**
   * Levels of level-based tools; Fibonacci tools default to 0, 0.236, …, 0.786, 1,
   * colored by the shared level rule (`levelColor`), with 0.618 in the theme's accent.
   */
  levels?: DrawingLevel[];
  /** Extend lines past their left anchor to the pane edge. */
  extendLeft?: boolean;
  /** Extend lines (or level lines) past their right anchor to the pane edge. */
  extendRight?: boolean;
  /** Show the tool's label (price, level, name). A long or short position with `false` shows its labels only while hovered or selected. */
  showLabel?: boolean;
  /**
   * Side of a level tool's lines or box its labels sit on, on screen. The
   * Fib retracement, extension and channel label left of their lines unless
   * `'right'`; the Gann box and squares and the Fib speed resistance fan put
   * their price labels beside the box's right edge unless `'left'`; the Fib
   * time zone and trend-based Fib time label right of each line unless `'left'`.
   */
  labelSide?: 'left' | 'right';
  /**
   * What a level tool's labels show: the level (`'level'`), its price
   * (`'price'`), the level with the price in brackets (`'both'`), or the level
   * as a percent of the move (`'percent'`, 0.618 shows 61.8%). Labels that mark
   * a time or a radius have no price and show the level for `'price'` and
   * `'both'`. Unset, the Fib retracement and extension show `'both'` and the
   * other level tools `'level'`.
   */
  labelContent?: 'level' | 'price' | 'both' | 'percent';
  /** Show measurements such as price change, percent, bars and angle. */
  showStats?: boolean;
  /** Color of a position's zone and label on the profitable side (default the theme's `up`). */
  profitColor?: string;
  /** Color of a position's zone and label on the losing side (default the theme's `down`). */
  lossColor?: string;
  /** `false` turns off the background a tool fills (its bands, zone or tint, and `fill` with them); default true. */
  showFill?: boolean;
  bold?: boolean;
  italic?: boolean;
  /** Text color when it differs from the line color. */
  textColor?: string;
  /** Draw the dashed middle line of a parallel channel (default true). */
  middleLine?: boolean;
  /**
   * Distance of the outer lines from the centre line in standard deviations:
   * a regression channel's (default 2) or an anchored VWAP's bands (default 0, no bands).
   */
  deviation?: number;
  /** Price rows of a fixed-range volume profile; unset or 0 follows its height on screen, one row per 10 css px. */
  rows?: number;
  /** Share of a volume profile's volume inside its value area, in percent (default 70). */
  valueArea?: number;
  /** Length of a volume profile's longest row, in percent of the range width (default 50, so it ends at the middle). */
  profileWidth?: number;
  /** Rotation in degrees, clockwise, of tools drawn at a fixed angle such as `emoji` (default 0). */
  angle?: number;
}

/**
 * The main series bars a data-aware tool reads, without copying: `bars` is the
 * series' own array, and `[start, end)` the indices of the bars asked for.
 * Read it only during the call and never change it. The array stays the same
 * object while live bars update or append, and is replaced when the data is
 * reloaded or history is prepended, so tools can cache results on it.
 */
export interface BarSpan {
  readonly bars: readonly Readonly<Bar>[];
  readonly start: number;
  readonly end: number;
}

/** The text fields of a drawing style, for tools that draw text; `DrawingStyle` fits. */
export interface DrawingTextStyle {
  /** Size in css px; tools fall back to their own default (labels use the theme font size). */
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  /** Text color over the tool's own. */
  textColor?: string;
}

/** Serializable drawing. Points are stored in time/price so they survive data reloads. */
export interface Drawing {
  id: string;
  type: string;
  /** Index of the pane the drawing lives in. */
  pane: number;
  points: DrawingPoint[];
  style: DrawingStyle;
  text?: string;
  locked?: boolean;
  /** `false` keeps the drawing out of hit testing: no selection, dragging or click events. Default true. */
  selectable?: boolean;
  /** `false` leaves the drawing out of `serialize()`, e.g. for app-generated drawings. Default true. */
  persist?: boolean;
  /**
   * `false` keeps the drawing's changes out of undo and redo, e.g. for
   * drawings the app moves itself: they add no undo step, and undoing other
   * changes leaves the drawing as it is. Default true.
   */
  history?: boolean;
  /**
   * `true` keeps the drawing's prices in view: while its time span overlaps
   * the visible bars, its pane's autoscale fits them too, e.g. a target
   * line above the data. Open price sides (vertical lines) add nothing.
   * Default false.
   */
  autoscale?: boolean;
  /**
   * `true` draws the drawing under the series (over the grid), e.g. a zone
   * the candles stay readable over. Its selection handles stay on top.
   * Default false.
   */
  below?: boolean;
  /** Stacking layer within `below` and the other drawings: higher draws on top. Ties keep their order. Default 0. */
  zIndex?: number;
  /** Not drawn and not hit-tested; `setVisible(id, true)` shows it again. */
  hidden?: boolean;
  /**
   * Bar intervals the drawing shows on; on other intervals it is not drawn
   * or hit-tested, like `hidden`. Missing means every interval. See
   * `DrawingManager.setVisibleOn`.
   */
  visibleOn?: IntervalRange[];
  /**
   * Name of the group the drawing is in: a click on any drawing of a group
   * selects them all, so they move, copy and delete as one. See
   * `DrawingManager.group`.
   */
  group?: string;
  /** Name the user gave the drawing, e.g. in an object list; tools do not draw it. */
  name?: string;
  /**
   * Id of the indicator the drawing belongs to (see `Indicator.id`); a
   * drawing started on an indicator's pane ties to it. It shows only while
   * the indicator shows (not while it is hidden, off its intervals, pending
   * or missing), is on the indicator's pane, follows it to another one, and
   * goes when the indicator is removed. Its prices are on the indicator's
   * price scale (e.g. its own left or overlay scale), while the indicator is
   * on the drawing's pane; else on the pane's main scale. The magnet only
   * snaps drawings on the price pane's main scale.
   */
  indicator?: string;
}

/** Time and price box a drawing covers; an infinite side is open. See `DrawingToolDef.modelBounds`. */
export interface DrawingModelBounds {
  from: Time;
  to: Time;
  low: number;
  high: number;
}

/**
 * Prices and times a selected drawing labels on the price and time axes; the
 * band between the outermost ones is highlighted. See `DrawingToolDef.axisMarks`.
 */
export interface DrawingAxisMarks {
  prices?: readonly number[];
  times?: readonly Time[];
}

/**
 * The part of a drawing under the pointer: one of its anchors (an index into
 * its points), one of the tool's extra `handles`, or the drawing itself.
 * Anchors and handles count only while the drawing is selected.
 */
export type DrawingPart = { kind: 'anchor'; index: number } | { kind: 'handle'; index: number } | { kind: 'body' };

/** A drawing projected to pane-local css pixels for rendering / hit testing. */
export interface ScreenDrawing {
  drawing: Drawing;
  points: Point[];
  selected: boolean;
  hovered: boolean;
}

/**
 * What a drawing tool gets to render and hit test: the pane size, theme and
 * pixel ratio, price formatting, conversions between data and pane-local
 * coordinates, and the main series bars.
 */
export interface DrawingEnv {
  width: number;
  height: number;
  theme: ChartTheme;
  /** Device pixels per css pixel. */
  pixelRatio: number;
  formatPrice(price: number): string;
  /** `time` as the chart labels it on the time axis under the crosshair. Missing (e.g. a host made by hand): tools draw no time. */
  formatTime?(time: Time): string;
  /**
   * The chart's language for readouts: `localization.text(key, params)` and
   * its number formats. Missing (e.g. a host made by hand): built-in English.
   */
  localization?: Localizer;
  /** Pane-local y of a price on the pane's price scale (follows log/percent mode). */
  priceToY(price: number): number;
  yToPrice(y: number): number;
  /** Pane-local x of a time; times between bars are interpolated. */
  timeToX(time: Time): number;
  xToTime(x: number): Time;
  /** Bars between two drawing points (signed). */
  barsBetween(a: DrawingPoint, b: DrawingPoint): number;
  /** Main series bars with `from <= time <= to`, for data-aware tools. */
  bars(from: Time, to: Time): readonly Bar[];
  /**
   * Main series bars with `from <= time <= to` as indices into the series'
   * array, without copying it, so tools can cache what they compute from it.
   * Missing on hosts that only offer `bars`.
   */
  barSpan?(from: Time, to: Time): BarSpan;
  /** Width in css px of `text` drawn at `fontSize` px, bold and italic as `style` sets them (see `drawingFont`). */
  measureText(text: string, fontSize: number, style?: DrawingTextStyle): number;
  /**
   * Ask for the drawings to be drawn again, e.g. once an image a tool waits
   * for has loaded. The same function on every call for one chart, so tools
   * can keep it in a set. Missing on hosts that only draw on demand.
   */
  redraw?(): void;
}

/** A style field the drawing settings UI should offer. */
export type DrawingSettingDef =
  | { key: string; label: string; type: 'color' | 'boolean' | 'text' | 'levels' }
  | { key: string; label: string; type: 'number'; min?: number; max?: number; step?: number }
  | { key: string; label: string; type: 'select'; options: { value: string; label: string }[] };

/** Plugin contract for a drawing tool. Register with `chart.drawings.register`. */
export interface DrawingToolDef {
  type: string;
  label: string;
  /** Rail group id: one of the built-in 'lines', 'annotate', 'parallels', 'ratios', 'time', 'patterns' and 'measure', or your own; tools of a group share a flyout. */
  group?: string;
  /**
   * Anchor points placed by the user: a count (1 = single click), `'n'` to keep
   * adding points until double-click or Enter, or `'free'` for a freehand
   * press-drag-release stroke.
   */
  points: number | 'n' | 'free';
  /**
   * Makes the tool act instead of placing a drawing; `points`, `render` and
   * `hitTest` then go unused. `'erase'`: a press removes the unlocked drawing
   * under it and a drag every one its stroke crosses, as one undo step.
   * `'zoom'`: a drag zooms the view to the time and price range of the box.
   */
  action?: 'erase' | 'zoom';
  /**
   * `'data'` (default) pins anchors to time and price. `'screen'` pins them to
   * the pane: `time` and `price` then hold x and y as fractions (0..1) of the
   * pane width and height, so the drawing stays put while the chart scrolls.
   */
  anchoring?: 'data' | 'screen';
  /**
   * How placed and dragged anchors snap. `'ohlc'` puts the price on the
   * nearest open, high, low or close of the bar, whatever the magnet;
   * `'time'` snaps only the time to the bar and ignores the magnet. Default:
   * time to the bar, and the price to the bar's values while the magnet is on.
   * The price snaps only in the main pane, where the bars are.
   */
  snap?: 'ohlc' | 'time';
  /**
   * For `'free'` tools: when the stroke ends, drop points that change the
   * drawn line by less than this many css px (`true` = 1 px), so strokes save
   * compactly. The tolerance applies at the zoom level the stroke ended at.
   */
  simplify?: number | boolean;
  /**
   * Prompt for text after placement and on double click. With `true` the text
   * is required: a new drawing left without text is removed. With
   * `'optional'` it stays without text, and an empty entry clears the text
   * of an existing drawing.
   */
  editableText?: boolean | 'optional';
  defaultStyle?: DrawingStyle;
  /**
   * Theme color `render` draws in while the style sets no `color` (default
   * `'drawing'`), for style editors to show as the color, or a function of
   * the drawing for a tool whose color depends on its points. Unlike a
   * `defaultStyle` color it is not saved with the drawing, so it follows the theme.
   */
  themeColor?: ThemeColorKey | ((drawing: Drawing) => ThemeColorKey);
  /**
   * The `DrawingStyle` fields (and the tool's own style keys) `render`
   * honors, most important first, so a style editor offers only those. The
   * first four that hold plain values are the toolbar's quick fields unless
   * `registerToolQuickFields` sets others. Without it, editors offer color,
   * line width, line style and the `settings` keys.
   */
  styleFields?: readonly string[];
  /**
   * Opacity of the tint of the drawing's color the tool fills with when the
   * style sets no `fill` (default 0.14), so a settings UI can show the fill
   * the tool draws. Level tools fill alternate bands at this opacity and half
   * of it, each in its level's color.
   */
  fillAlpha?: number;
  /** Extra style fields for the settings UI. */
  settings?: DrawingSettingDef[];
  /**
   * Adjust points while anchor `anchor` is placed or dragged, e.g. to keep a
   * channel parallel. Return the full point list.
   */
  constrain?(points: DrawingPoint[], anchor: number): DrawingPoint[];
  /** Draggable handles that are not anchors, in pane-local css px. */
  handles?(d: ScreenDrawing, env: DrawingEnv): Point[];
  /**
   * The drawing after dragging handle `index` to `to` (time and price,
   * snapped like an anchor) or `at` (the pointer, unsnapped, in pane-local
   * css px; `env` projects the drawing's points to compare): its new points,
   * or `{ points, style }` with either left out to keep it, e.g. a size or
   * angle in the style. `drawing` is a copy. Required for `handles` to be
   * draggable.
   */
  moveHandle?(
    drawing: Drawing,
    index: number,
    to: DrawingPoint,
    at: Point,
    env: DrawingEnv,
  ): DrawingPoint[] | { points?: DrawingPoint[]; style?: DrawingStyle };
  /**
   * Screen-space extent of the drawing in pane-local css px, when it reaches
   * beyond its anchors and handles (a circle around its centre). The selection
   * bounds cover this box as well as the anchors and handles.
   */
  bounds?(d: ScreenDrawing, env: DrawingEnv): Rect | null;
  /**
   * Time and price box the drawing covers, for tools whose points do not
   * describe it: lines that reach the pane edge, levels past the anchors.
   * Infinite values leave a side open. The chart neither draws nor hit-tests
   * a drawing whose box is well out of view, so a box that is too small makes
   * the drawing vanish near the edges. Default: the box of the points, open
   * on the sides `extendLeft` and `extendRight` extend; a tool with `bounds`
   * and no `modelBounds` is checked by its projected anchors and `bounds`.
   */
  modelBounds?(drawing: Drawing): DrawingModelBounds;
  /**
   * Prices and times to label on the axes while the drawing is selected or
   * being placed, with the band between the outermost ones highlighted; null
   * labels nothing. Default: every anchor's price and time; for `'free'`
   * tools the stroke's extremes; for `'screen'` tools nothing.
   */
  axisMarks?(drawing: Drawing): DrawingAxisMarks | null;
  /**
   * CSS cursor while the pointer is over `part` of the drawing (`p` in
   * pane-local css px), e.g. `'ns-resize'` for a part that only moves up and
   * down. Return nothing for the default: `'move'` on anchors and handles,
   * `'pointer'` on the drawing. Not asked while the drawing or all drawings
   * are locked, or during a drag.
   */
  cursor?(d: ScreenDrawing, part: DrawingPart, p: Point, env: DrawingEnv): string | undefined;
  /**
   * Take an image file pasted on the chart: the reference to keep in the new
   * drawing's `text`, and the image's size in pixels, which the drawing's box
   * gets (shrunk to fit half the pane); null declines the file. A paste goes
   * to the first registered tool that has this, as a two-point drawing
   * centred on the crosshair.
   */
  pasteImage?(file: Blob): Promise<{ text: string; width: number; height: number } | null>;
  render(ctx: CanvasRenderingContext2D, d: ScreenDrawing, env: DrawingEnv): void;
  hitTest(d: ScreenDrawing, p: Point, env: DrawingEnv): boolean;
}

/** The drawings of a chart as `serialize()` returns them and `load()` takes them, with a format version. */
export interface SerializedDrawings {
  version: 1;
  drawings: Drawing[];
}

/**
 * A problem `load()` found in a saved drawing: its index in the payload and
 * why. Without `field` the drawing was skipped; with it the drawing loaded
 * and only that field (e.g. `locked`, `style.lineWidth`, `style.levels[2]`)
 * was dropped.
 */
export interface DrawingLoadError {
  index: number;
  field?: string;
  reason: string;
}

/** What `load()` restored: how many drawings, and the problems it found. */
export interface DrawingLoadResult {
  loaded: number;
  errors: DrawingLoadError[];
}

/**
 * Turns a saved payload of `fromVersion` into one `load()` understands: the
 * current version, or an older one the built-in steps continue from.
 */
export type DrawingMigration = (data: Record<string, unknown>, fromVersion: unknown) => unknown;
