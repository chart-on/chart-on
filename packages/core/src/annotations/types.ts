import type { Series } from '../series';
import type { Point, Time } from '../types';
import type { AlertLine, DraftLine, PriceLine, TradeLine } from './lines';

/** Method key of `AnnotationManager`'s data source marks setter; not exported from the package. */
export const SET_SOURCE_MARKS: unique symbol = Symbol('setSourceMarks');

/** Method key of `AnnotationManager`'s time-axis marks setter; not exported from the package. */
export const SET_TIME_MARKS: unique symbol = Symbol('setTimeMarks');

/** `label` draws only the text, in a filled box. `cross` is upright (+), `x-cross` diagonal. */
export type MarkerShape =
  | 'arrow-up'
  | 'arrow-down'
  | 'arrow-left'
  | 'arrow-right'
  | 'triangle-up'
  | 'triangle-down'
  | 'circle'
  | 'square'
  | 'diamond'
  | 'cross'
  | 'x-cross'
  | 'flag'
  | 'label';
/**
 * `atPrice` places the shape at the marker's `price` instead of next to the
 * bar. `top` and `bottom` are lanes along the pane's edge, for events without
 * a price: they stay put while the price scale pans and stack inwards.
 */
export type MarkerPosition = 'above' | 'below' | 'inside' | 'atPrice' | 'top' | 'bottom';

/**
 * A glyph drawn instead of the marker's shape, in a square of the marker's
 * size. The host supplies it; the chart never fetches anything.
 */
export type MarkerIcon =
  | {
      /** SVG path data (a path's `d` attribute), filled with the marker colour. */
      svgPath: string;
      /** Side of the square the path is drawn in. Default 24. */
      viewBox?: number;
    }
  | {
      /** Drawn as is. A Blob is decoded once; the marker shows once it is ready. A Blob image of more than 32 megapixels is refused, and the marker draws without it. */
      image: CanvasImageSource | Blob;
    };

/** Severity of an event marker, from 1 (low) to 3 (high). */
export type MarkerSeverity = 1 | 2 | 3;

/** Which bar markers draw, from `annotations.setMarkerFilter`; markers stay in their sets. */
export interface MarkerFilter {
  /** Only markers of these kinds. Markers without a `kind` always pass. */
  kinds?: readonly string[];
  /** Only markers at least this severe. Markers without a `severity` always pass. */
  minSeverity?: MarkerSeverity;
}

/** Folding crowded bars of markers into one, from `annotations.applyOptions({ markerCluster })`. */
export interface MarkerClusterOptions {
  /** Default false. */
  enabled: boolean;
  /**
   * Markers of one kind and position on one bar fold into one once there are
   * more than this. The folded marker shows the count; its tooltip lists the
   * members. Default 1.
   */
  maxPerBar: number;
}

/** A shape pinned to a bar, e.g. an execution or a signal. Users cannot move it. */
export interface BarMarker {
  /** Identifies the marker in events, `updateMarker` and `removeMarker`. Unique within its series' set. */
  id?: string;
  /** Bar time (unix seconds). A time between two bars lands on the bar that contains it. */
  time: Time;
  shape: MarkerShape;
  /** Default: `below` for `arrow-up` and `triangle-up`, `above` for every other shape. */
  position?: MarkerPosition;
  /**
   * Price of an `atPrice` marker, on its series' scale. Required for `atPrice`,
   * ignored otherwise. As the data source sends it: on the main pane it draws
   * at its bar's adjusted price under the chart's `adjustment` option.
   */
  price?: number;
  /**
   * Default: the theme's up colour for `arrow-up` and `triangle-up`, down for
   * `arrow-down` and `triangle-down`, line colour otherwise.
   */
  color?: string;
  /** Short label next to the shape; the content of a `label`. */
  text?: string;
  /** Size multiplier (default 1). */
  size?: number;
  /** Text shown while hovering the marker; several strings are several lines. */
  tooltip?: string | string[];
  /** Drawn instead of the shape; the shape still sets the default position and colour. Kept by reference. */
  icon?: MarkerIcon;
  /** Event category, e.g. `news`: what clustering groups by and `setMarkerFilter` selects. */
  kind?: string;
  severity?: MarkerSeverity;
}

/** The pointer on a bar marker, from the `marker:hover` and `marker:click` events. */
export interface MarkerPointerEvent {
  /** A copy of the marker. */
  marker: BarMarker;
  /** The series whose set holds the marker. */
  series: Series;
  /** Pointer position in chart-root css px, like `chart.pointAt` takes. */
  point: Point;
  /** On a folded cluster: copies of its markers, in set order. */
  members?: BarMarker[];
}

/** The pointer left a bar marker, from `marker:hover-end`. */
export interface MarkerLeaveEvent {
  /** A copy of the marker. */
  marker: BarMarker;
  series: Series;
}

/** Stroke pattern of an annotation line. */
export type LineStyle = 'solid' | 'dashed' | 'dotted';

/** Where a line's label block sits across the plot. */
export type LabelAnchor = 'left' | 'center' | 'right';

/** The pointer over or on a line. */
export interface LinePointerEvent<L> {
  line: L;
  /** `entry` for price and alert lines. */
  part: TradeLinePart;
  /** The part's price. */
  price: number;
  /** Pointer position in chart-root css px, like `chart.pointAt` takes. */
  point: Point;
}

/**
 * Pointer callbacks and a tooltip for a line. Lines with none of them are not
 * hit-tested unless they are draggable or have buttons, so they never block
 * panning.
 */
export interface LineInteractionOptions<L> {
  /** The pointer moved onto the line or its label block. Once per enter. */
  onHover?: (e: LinePointerEvent<L>) => void;
  /** The pointer left the line and its block. Once per leave. */
  onHoverEnd?: () => void;
  /** Pressed and released on the line or its block without dragging it. Never after a drag. */
  onClick?: (e: LinePointerEvent<L>) => void;
  /** Text shown while hovering the line; several strings are several lines. */
  tooltip?: string | string[];
}

/** Label and density options of trade and alert lines. */
export interface LineLabelOptions {
  /** Where the label block sits: `right` (default, next to the price axis), `center` or `left`. Brackets follow their order. */
  labelAnchor?: LabelAnchor;
  /** The price label on the axis. Default true. */
  priceAxisLabel?: boolean;
  /** Only the line: no label block, no hit testing. For dense ladders of many orders. */
  lineOnly?: boolean;
}

/**
 * Options of a price line: a horizontal line at a fixed price with an optional
 * title and price axis label, following a series' price scale and pane.
 */
export interface PriceLineOptions extends LineInteractionOptions<PriceLine> {
  price: number;
  /** Default: the theme line colour. */
  color?: string;
  lineWidth: number;
  lineStyle: LineStyle;
  /** Text above the line at the right edge of the pane. */
  title: string;
  /** Show the price on the price axis. */
  axisLabel: boolean;
  /** Only the line: no title and no hit testing, whatever the pointer callbacks. */
  lineOnly?: boolean;
  /** Series whose price scale and pane the line follows. Default: the main series. */
  series?: Series;
}

/** Direction of an order, position or fill. */
export type OrderSide = 'buy' | 'sell';

/** `order`: a working order whose entry can be dragged. `position`: an open position; its entry is fixed and shows P&L. */
export type TradeLineKind = 'order' | 'position';

/** One line of an order or position: its entry, or a linked take-profit / stop-loss. */
export type TradeLinePart = 'entry' | 'takeProfit' | 'stopLoss';

/** A button in a trade line's label block. */
export type TradeAction = 'cancel' | 'close' | 'reverse';

/** A trade line part being dragged, with the snapped price under the pointer. */
export interface TradeLineDragEvent {
  part: TradeLinePart;
  /** Price at the pointer, read from the price scale and snapped to the tick size. */
  price: number;
}

/** A trade line part released at a new price, with the price it had before. */
export interface TradeLineChangeEvent extends TradeLineDragEvent {
  /** Price before the drag. */
  from: number;
}

/** A button pressed in a trade line's label block, and the part it belongs to. */
export interface TradeActionEvent {
  action: TradeAction;
  part: TradeLinePart;
}

/** A take-profit or stop-loss: the parts a bracket handle creates. */
export type BracketPart = 'takeProfit' | 'stopLoss';

/** A take-profit or stop-loss proposed by dragging the bracket handle off an entry. */
export interface BracketCreateEvent {
  part: BracketPart;
  /** Price where the handle was released, snapped to the tick size. */
  price: number;
}

/** Which controls of a trade line users cannot use; `readOnly` covers all three. */
export interface TradeLineReadOnly {
  /** No dragging, no buttons and no bracket handle. */
  readOnly?: boolean;
  /** No dragging of the entry, take-profit or stop-loss. */
  dragReadOnly?: boolean;
  /** No bracket handle. */
  bracketReadOnly?: boolean;
  /** No action buttons. */
  actionsReadOnly?: boolean;
}

/**
 * Options of an order or position line. Interaction is opt-in: a line can be
 * dragged only with `onDrag` or `onChange`, and buttons appear only with
 * `onAction`.
 */
export interface TradeLineOptions extends LineInteractionOptions<TradeLine>, LineLabelOptions, TradeLineReadOnly {
  kind: TradeLineKind;
  price: number;
  side: OrderSide;
  /** Shown in the label block; a number also feeds the position P&L. */
  quantity?: number | string;
  /** First segment of the label block. Default: Buy / Sell for orders, Long / Short for positions. */
  label?: string;
  /** Default: the theme's up colour for buys, down for sells. */
  color?: string;
  lineWidth: number;
  /** Default: `dashed` for orders, `solid` for positions. */
  lineStyle: LineStyle;
  /** Linked take-profit price; `null` or omitted hides the line. */
  takeProfit?: number | null;
  /** Linked stop-loss price; `null` or omitted hides the line. */
  stopLoss?: number | null;
  /** Series whose price scale and pane the line follows. Default: the main series. */
  series?: Series;
  /** Dragged prices snap to multiples of this. Default: one unit of the series precision. */
  tickSize?: number;
  /** Positions: show profit / loss against the series' last price. */
  pnl: boolean;
  /** Format the P&L, e.g. to apply a contract multiplier or a currency. Default: signed price format. */
  formatPnl?: (pnl: number) => string;
  /** Buttons on the entry block, left to right. Default: `['cancel']` for orders, `['reverse', 'close']` for positions. */
  actions: TradeAction[];
  /** Buttons on the take-profit and stop-loss blocks. Default: `['cancel']`. */
  bracketActions: TradeAction[];
  /** While dragging, whenever the snapped price changes (and once more after Escape). */
  onDrag?: (e: TradeLineDragEvent) => void;
  /**
   * A drag released at a new price waits for confirmation: the part shows the
   * new price with confirm and discard buttons, and `onChange` fires only on
   * confirm. Discard or Escape restores the price. Default: true for orders,
   * false for positions.
   */
  confirmChanges?: boolean;
  /**
   * Drag released at a new price (confirmed, with `confirmChanges`). The line
   * keeps the new price.
   */
  onChange?: (e: TradeLineChangeEvent) => void;
  /** A button was pressed. Without it, no buttons are shown. */
  onAction?: (e: TradeActionEvent) => void;
  /**
   * The entry block gets a handle while a take-profit or stop-loss is unset:
   * dragging it away from the entry proposes one (above a buy is a take-profit,
   * below a stop-loss; the other way round for a sell). The proposal shows
   * until the next `applyOptions` on the line, which answers it.
   */
  onBracketCreate?: (e: BracketCreateEvent) => void;
}

/** How an order executes: at a limit price, on a stop trigger, or at market. */
export type OrderType = 'limit' | 'stop' | 'market';

/** A segment of a draft's label block that the user edits by clicking it. */
export type DraftSegment = 'quantity' | 'type';

/**
 * Options of an order draft (`annotations.startOrderDraft`): an order the user
 * is still composing. Its price, take-profit and stop-loss drag freely; nothing
 * reaches the app until `commit()`.
 */
export interface DraftLineOptions extends Pick<LineLabelOptions, 'labelAnchor' | 'priceAxisLabel'> {
  price: number;
  side: OrderSide;
  /** Omitted until the user sets one. */
  quantity?: number;
  type: OrderType;
  takeProfit?: number | null;
  stopLoss?: number | null;
  /** Default: the theme's up colour for buys, down for sells. */
  color?: string;
  lineWidth: number;
  lineStyle: LineStyle;
  /** Series whose price scale and pane the draft follows. Default: the main series. */
  series?: Series;
  /** Dragged prices snap to multiples of this. Default: one unit of the series precision. */
  tickSize?: number;
}

/** A click on a draft's quantity or type segment. */
export interface DraftEditEvent {
  draft: DraftLine;
  segment: DraftSegment;
  /** The segment's bottom centre, in chart-root css px. */
  anchor: Point;
  /** Stop the UI package's default keypad or type menu. */
  preventDefault(): void;
  readonly defaultPrevented: boolean;
}

/** A committed draft: the order the user asked to place. */
export interface OrderCreateEvent {
  side: OrderSide;
  type: OrderType;
  price: number;
  quantity?: number;
  takeProfit?: number;
  stopLoss?: number;
}

/** An alert line being dragged, with the snapped price under the pointer. */
export interface AlertLineDragEvent {
  /** Price at the pointer, read from the price scale and snapped to the tick size. */
  price: number;
}

/** An alert line released at a new price, with the price it had before. */
export interface AlertLineChangeEvent extends AlertLineDragEvent {
  /** Price before the drag. */
  from: number;
}

/**
 * Options of an alert line. The chart only shows and edits alerts; checking
 * them against live prices is the application's job (see `alertsCrossed`).
 * A line can be dragged only with `onDrag` or `onChange`, and has a remove
 * button only with `onRemove`.
 */
export interface AlertLineOptions extends LineInteractionOptions<AlertLine>, LineLabelOptions {
  price: number;
  /** First segment of the label block. Default: `Alert`. */
  label: string;
  /** Optional text after the label, e.g. the alert's condition or a note. */
  title?: string;
  /** Default: the theme's alert colour. */
  color?: string;
  lineWidth: number;
  /** Default: `dotted`, so alerts read differently from order and position lines. */
  lineStyle: LineStyle;
  /** Series whose price scale and pane the line follows. Default: the main series. */
  series?: Series;
  /** Dragged prices snap to multiples of this. Default: one unit of the series precision. */
  tickSize?: number;
  /** While dragging, whenever the snapped price changes (and once more after Escape). */
  onDrag?: (e: AlertLineDragEvent) => void;
  /** Drag released at a new price. The line keeps the new price. */
  onChange?: (e: AlertLineChangeEvent) => void;
  /** The remove button was pressed. Without it, no button is shown. */
  onRemove?: () => void;
}

/** Which way a price moved through a level. */
export type CrossDirection = 'up' | 'down';

/** Overlapping order labels folded into one, from `annotations.applyOptions({ overlap: 'cluster' })`. */
export interface ClusterOptions {
  /** Labels closer than this (css px between blocks; negative = overlapping) fold together. Default 0. */
  mergeGapPx: number;
  /** A folded cluster splits only once its labels are this far apart, so it does not flicker. Default 6. */
  splitGapPx: number;
  /** Fewest lines that form a cluster. Default 2. */
  minLines: number;
}

/**
 * A click on a cluster's summary label: the folded trade lines and where the
 * label sits. Call `preventDefault()` to replace the UI package's order list.
 */
export interface ClusterClickEvent {
  /** The trade lines in the cluster, top to bottom. */
  lines: TradeLine[];
  /** The summary label's centre, in chart-root css px. */
  anchor: Point;
  /** Stop the UI package's default list of the clustered orders. */
  preventDefault(): void;
  readonly defaultPrevented: boolean;
}

/** Options of the annotation layer as a whole. */
export interface AnnotationOptions {
  /** `cluster` folds overlapping order labels into one summary label. Default `none`. */
  overlap: 'none' | 'cluster';
  cluster: ClusterOptions;
  /** The summary label of a cluster was clicked. */
  onClusterClick?: (e: ClusterClickEvent) => void;
  /** Bar markers: fold crowded bars into one marker with a count. */
  markerCluster: MarkerClusterOptions;
}
