import type { Chart, PlusButtonEvent, Region } from './chart';
import type { PriceScale } from './scales';
import type { Series } from './series';
import type { DrawingModifiers } from './drawing/manager';
import type { Point } from './types';
import { actionLabelKey } from './actions';
import { BaselineHandles } from './baseline-handle';
import { setRootStyle } from './root-style';
import { clampLow, clampNum } from './util/math';

type Drag =
  /** `row`: the series whose legend row was pressed, which a click selects. */
  | { kind: 'pan'; pane: number; last: Point; start: Point; moved: boolean; row?: Series | null }
  | { kind: 'drawing' }
  | { kind: 'annotation' }
  | { kind: 'baseline' }
  | { kind: 'priceAxis'; pane: number; scale: PriceScale; lastY: number }
  /** `press`: where a press on a time-mark badge started; it is a click unless the pointer travels past the slop. */
  | { kind: 'timeAxis'; lastX: number; startX: number; press: Point | null }
  | { kind: 'separator'; pane: number; lastY: number }
  | { kind: 'pinch'; distance: number; mid: number }
  /** A long-press on touch: the crosshair follows the finger and the chart does not pan; `start` is where it began. */
  | { kind: 'inspect'; pane: number; start: Point }
  /** A press on the "+" button; `event` is its payload at the press. */
  | { kind: 'plus'; event: PlusButtonEvent; start: Point };

/** How long a touch must stay put to start inspecting (ms). */
const LONG_PRESS_MS = 450;

interface Sample {
  t: number;
  x: number;
}

/** Inertia velocity decay time constant (ms). */
const DECAY_MS = 325;
const MIN_VELOCITY = 0.02;
const ZOOM_EASE_MS = 70;
/** Max pointer travel (css px) for a press to still count as a click. */
const CLICK_SLOP_MOUSE = 3;
const CLICK_SLOP_TOUCH = 8;

/** The CSS pointer over an empty plot for each `crosshair.cursor`. */
const PLOT_CURSORS = { cross: 'crosshair', pointer: 'default' } as const;

/** A built-in view command's id. */
export type ViewActionId =
  | 'scroll-older'
  | 'scroll-newer'
  | 'page-older'
  | 'page-newer'
  | 'oldest-bar'
  | 'newest-bar'
  | 'zoom-in'
  | 'zoom-out'
  | 'reset-view'
  | 'crosshair-prev'
  | 'crosshair-next';

/**
 * The view commands `Interaction` registers, with their default shortcuts; labels come from `actionLabelKey`.
 * Rules for the defaults (#863): no Alt, which types a character on some layouts and reaches the browser
 * menu on others; and no letter or digit, which a symbol can start with, so typing on a focused chart
 * stays free for type-to-search. That leaves the named keys (arrows, pages, Home, End), `+`, `-` and
 * `=`, and Shift or Ctrl with them. `Shift+End` resets the view: End goes to the newest bar, and Shift
 * also brings back the default zoom and autoscale. The keys act where `keyboard.scope` lets the chart
 * take them: while it has focus by default, and page-wide with `'global'`, which is what that scope is for.
 */
const VIEW_ACTIONS: readonly { id: ViewActionId; keys: readonly string[] }[] = [
  { id: 'scroll-older', keys: ['ArrowLeft'] },
  { id: 'scroll-newer', keys: ['ArrowRight'] },
  { id: 'page-older', keys: ['PageUp'] },
  { id: 'page-newer', keys: ['PageDown'] },
  { id: 'oldest-bar', keys: ['Home'] },
  { id: 'newest-bar', keys: ['End'] },
  { id: 'zoom-in', keys: ['+', '='] },
  { id: 'zoom-out', keys: ['-'] },
  { id: 'reset-view', keys: ['Shift+End'] },
  { id: 'crosshair-prev', keys: ['Ctrl+ArrowLeft'] },
  { id: 'crosshair-next', keys: ['Ctrl+ArrowRight'] },
];

/** The keys held during a pointer event that drawings read; Cmd counts as Ctrl. */
function drawingModifiers(e: Pick<PointerEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>): DrawingModifiers {
  return { shift: e.shiftKey === true, ctrl: e.ctrlKey === true || e.metaKey === true };
}

/** Key events a focused chart (`focus` scope) used, so page-wide charts leave them alone. */
const claimed = new WeakSet<object>();
/** Key events any chart used: their `defaultPrevented` came from a chart, not the page. */
const taken = new WeakSet<object>();

/** Elements whose keys are their own: dialogs and widgets with an interactive role. */
const KEY_OWNERS = ['dialog', ...['dialog', 'listbox', 'tablist', 'slider', 'menu', 'grid', 'textbox', 'combobox'].map((r) => `[role="${r}"]`)].join(', ');

/** Open modal dialogs in the chart's document; `:modal` leaves out dialogs opened with `show()`. */
function openModals(chart: HTMLElement): ArrayLike<Element> {
  const doc = chart.ownerDocument as Document | null | undefined;
  if (!doc) return [];
  try {
    return doc.querySelectorAll('dialog:modal, [role="dialog"][aria-modal="true"]');
  } catch {
    // Browsers without `:modal`.
    return doc.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]');
  }
}

/**
 * Keys typed into a field, an editable element, a dialog or an interactive
 * widget belong to it, not to the chart; so do all keys while a modal dialog
 * without the chart is open.
 */
function typingElsewhere(target: EventTarget | null, chart: HTMLElement): boolean {
  if (Array.from(openModals(chart)).some((m) => !m.contains(chart)) || inField(target)) return true;
  // The nearest owner decides: if it holds the chart, so do all further ancestors.
  const owner = (target as { closest?: (s: string) => Element | null } | null)?.closest?.(KEY_OWNERS);
  return !!owner && !owner.contains(chart);
}

/** Whether `target` is a field or an editable element, which keys typed into belong to. */
export function inField(target: EventTarget | null): boolean {
  const el = target as { tagName?: unknown; isContentEditable?: boolean } | null;
  if (!el || typeof el !== 'object') return false;
  const tag = typeof el.tagName === 'string' ? el.tagName.toLowerCase() : '';
  return tag === 'input' || tag === 'textarea' || tag === 'select' || !!el.isContentEditable;
}

/** Pointer, wheel, touch and keyboard handling plus pan/zoom animation. */
export class Interaction {
  #drag: Drag | null = null;
  #pointers = new Map<number, Point>();
  #samples: Sample[] = [];
  private velocity = 0;
  private zoomTarget: number | null = null;
  private zoomAnchor = 0;
  /** The current pointer gesture comes from a touch screen. */
  #touch = false;
  /** Pending long-press: becomes inspection unless the finger moves or lifts first. */
  #pressTimer: ReturnType<typeof setTimeout> | null = null;
  /** `touchInspect: 'tap'` keeps the crosshair after the finger lifts, until the next tap. */
  #sticky = false;
  /** The current touch is the tap that ends a kept crosshair. */
  #endSticky = false;
  /** The pointer is over the chart, for `keyboard.scope: 'hover'`. */
  #hovered = false;
  /** Keys are read from the document (`hover` and `global` scopes) rather than the chart. */
  #documentKeys = false;
  /** The root's client rect, measured at most once per frame or gesture; see `local`. */
  #rect: DOMRect | null = null;
  /** The root's window, which reports the scrolls and resizes that move the rect. */
  private readonly view: Window | null;
  readonly #el: HTMLElement;
  readonly #unsubscribe: (() => void)[];
  readonly #baselines: BaselineHandles;

  readonly #chart: Chart;

  constructor(chart: Chart) {
    this.#chart = chart;
    this.#el = chart.root;
    this.#baselines = new BaselineHandles(chart);
    this.#el.addEventListener('pointerdown', this.onDown);
    this.#el.addEventListener('pointermove', this.onMove);
    this.#el.addEventListener('pointerup', this.onUp);
    this.#el.addEventListener('pointercancel', this.onUp);
    this.#el.addEventListener('pointerleave', this.#onLeave);
    this.#el.addEventListener('wheel', this.#onWheel, { passive: false });
    this.#el.addEventListener('dblclick', this.#onDoubleClick);
    this.#el.addEventListener('keydown', this.#onKey);
    this.#el.addEventListener('contextmenu', this.#onContextMenu);
    // Scrolling any ancestor moves the chart without a frame, so capture scrolls page-wide.
    this.view = this.#el.ownerDocument?.defaultView ?? null;
    this.view?.addEventListener('scroll', this.#dropRect, { capture: true, passive: true });
    this.view?.addEventListener('resize', this.#dropRect);
    // Drawing needs every touch move, even while touch panning is off.
    this.#unsubscribe = [
      chart.on('tool:change', this.#syncTouchAction),
      chart.on('drawing:select', this.#syncTouchAction),
      chart.on('chart:resize', this.#dropRect),
    ];
    this.#syncTouchAction();
    this.#syncKeyScope();
    this.#registerActions();
  }

  /**
   * Make the view commands actions on `chart.actions`. A change takes effect
   * at once: it cancels running motion and redraws.
   */
  #registerActions(): void {
    const chart = this.#chart;
    for (const { id, keys } of VIEW_ACTIONS) {
      const label = actionLabelKey(id);
      chart.actions.register({
        id,
        keys,
        label: () => chart.localization.text(label),
        enabled: () => this.#enabled(id),
        run: () => {
          if (!this.run(id)) return false;
          // The key's step wins over a running animation; resetView's own animation replaces it instead.
          if (id !== 'reset-view') chart.time.cancelAnimation();
          chart.redraw('view');
          return true;
        },
      });
    }
  }

  /** Whether the feature flags and the chart's state allow a view command. */
  #enabled(action: ViewActionId): boolean {
    switch (action) {
      case 'zoom-in':
      case 'zoom-out':
        return this.#canZoom();
      case 'reset-view':
        // Resetting moves and zooms the view.
        return this.#canPan() && this.#canZoom();
      case 'crosshair-prev':
      case 'crosshair-next':
        // A locked crosshair stays put; the key is left to the page.
        return this.#chart.time.barCount > 0 && !this.#chart.crosshairLocked;
      default:
        return this.#canPan();
    }
  }

  destroy(): void {
    this.#cancelLongPress();
    this.#el.removeEventListener('pointerdown', this.onDown);
    this.#el.removeEventListener('pointermove', this.onMove);
    this.#el.removeEventListener('pointerup', this.onUp);
    this.#el.removeEventListener('pointercancel', this.onUp);
    this.#el.removeEventListener('pointerleave', this.#onLeave);
    this.#el.removeEventListener('wheel', this.#onWheel);
    this.#el.removeEventListener('dblclick', this.#onDoubleClick);
    this.#el.removeEventListener('keydown', this.#onKey);
    if (this.#documentKeys) this.#el.ownerDocument.removeEventListener('keydown', this.#onDocumentKey);
    this.#el.removeEventListener('contextmenu', this.#onContextMenu);
    this.view?.removeEventListener('scroll', this.#dropRect, { capture: true });
    this.view?.removeEventListener('resize', this.#dropRect);
    this.#unsubscribe.forEach((off) => off());
    this.#baselines.destroy();
  }

  /** A touch long-press drives the crosshair, or `touchInspect: 'tap'` keeps the crosshair it left. */
  get inspecting(): boolean {
    return this.#drag?.kind === 'inspect' || this.#sticky;
  }

  /** Apply changed feature flags: end gestures and motion that were just turned off. */
  featuresChanged(): void {
    if (!this.#canPan(this.#touch)) this.velocity = 0;
    if (!this.#canZoom()) this.zoomTarget = null;
    if (this.#drag && !this.#allows(this.#drag.kind)) {
      if (this.#drag.kind === 'baseline') this.#baselines.pointerUp();
      this.#drag = null;
    }
    this.#syncTouchAction();
    this.#syncKeyScope();
  }

  /** Listen for keys on the chart (`focus` scope) or on the document (`hover`, `global`). */
  #syncKeyScope(): void {
    const scope = this.#chart.options.keyboard?.scope;
    const onDocument = scope === 'hover' || scope === 'global';
    if (onDocument === this.#documentKeys) return;
    this.#documentKeys = onDocument;
    if (onDocument) {
      this.#el.removeEventListener('keydown', this.#onKey);
      this.#el.ownerDocument.addEventListener('keydown', this.#onDocumentKey);
    } else {
      this.#el.ownerDocument.removeEventListener('keydown', this.#onDocumentKey);
      this.#el.addEventListener('keydown', this.#onKey);
    }
  }

  /** Advance animations by dt ms; returns true while still animating. */
  step(dt: number): boolean {
    // Layout may have changed since the last frame; measure again on the next event.
    this.#rect = null;
    const time = this.#chart.time;
    let active = false;
    if (this.velocity !== 0) {
      // An edge stops the fling instead of absorbing it frame after frame.
      const stopped = dt > 0 && !time.pan(this.velocity * dt);
      this.velocity *= Math.exp(-dt / DECAY_MS);
      if (stopped || Math.abs(this.velocity) < MIN_VELOCITY) this.velocity = 0;
      else active = true;
    }
    if (this.zoomTarget !== null) {
      const current = Math.log(time.barSpacing);
      const k = 1 - Math.exp(-dt / ZOOM_EASE_MS);
      const next = Math.abs(this.zoomTarget - current) < 1e-3 ? this.zoomTarget : current + (this.zoomTarget - current) * k;
      time.zoom(Math.exp(next - current), this.zoomAnchor);
      // A fixed edge can hold the spacing short of the target.
      const held = next !== current && Math.log(time.barSpacing) === current;
      if (next === this.zoomTarget || held) this.zoomTarget = null;
      else active = true;
    }
    return active;
  }

  /** Jump a fling and an eased zoom to where they would come to rest. */
  finish(): void {
    const time = this.#chart.time;
    if (this.velocity !== 0) {
      // The decaying velocity integrates to velocity × decay time.
      time.pan(this.velocity * DECAY_MS);
      this.velocity = 0;
    }
    if (this.zoomTarget !== null) {
      time.zoom(Math.exp(this.zoomTarget - Math.log(time.barSpacing)), this.zoomAnchor);
      this.zoomTarget = null;
    }
  }

  /**
   * The plot x a zoom keeps fixed under the `zoomAnchor` option for `input`;
   * `pointerX` is where the pointer anchor would be.
   */
  #zoomAnchorX(input: 'plot' | 'timeAxis', pointerX: number): number {
    const { time, plotWidth } = this.#chart;
    switch (this.#chart.options.zoomAnchor[input]) {
      case 'right-edge':
        return plotWidth;
      case 'newest': {
        const x = time.barCount > 0 ? time.indexToX(time.barCount - 1) : NaN;
        return x >= 0 && x <= plotWidth ? x : pointerX;
      }
      default:
        return pointerX;
    }
  }

  /** Pointer position in plot coordinates: x from the plot's left edge, y from the chart top. */
  #local(e: { clientX: number; clientY: number }): Point {
    // Measuring forces layout, so pointer moves and wheel ticks within a frame share one rect.
    const r = (this.#rect ??= this.#el.getBoundingClientRect());
    return { x: e.clientX - r.left - this.#chart.plotLeft, y: e.clientY - r.top };
  }

  /** Forget the measured rect after a scroll or resize moved the chart. */
  #dropRect = () => {
    this.#rect = null;
  };

  /** Panning is on for this kind of input. */
  #canPan(touch = false): boolean {
    const f = this.#chart.features;
    return f.scroll && (!touch || f.touchScroll);
  }

  /** Zooming is on for this kind of input. */
  #canZoom(touch = false): boolean {
    const f = this.#chart.features;
    return f.zoom && (!touch || f.touchZoom);
  }

  /** The feature flags still allow a gesture of this kind. */
  #allows(kind: Drag['kind']): boolean {
    switch (kind) {
      case 'pinch':
        return this.#canPan(this.#touch) || this.#canZoom(this.#touch);
      case 'priceAxis':
      case 'timeAxis':
      case 'baseline':
        return this.#chart.features.axisDragScale;
      default:
        // A plot press stays tracked while panning is off, so it can still end in a `click`; `onMove` skips the pan.
        return true;
    }
  }

  /** Leave vertical swipes, and pinches the chart does not use, to the page. */
  #syncTouchAction = () => {
    const d = this.#chart.drawingLayer;
    const scaling = this.#chart.options.plotDragScale && this.#chart.features.axisDragScale;
    const own = this.#canPan(true) || scaling || (d !== null && (d.tool !== null || d.selected !== null));
    setRootStyle(this.#el, 'touchAction', own ? 'none' : this.#canZoom(true) ? 'pan-y' : 'pan-y pinch-zoom');
  };

  /** Stop inertia, eased zoom and programmatic view animations. */
  stopMotion(): void {
    this.velocity = 0;
    this.zoomTarget = null;
    this.#chart.time.cancelAnimation();
  }

  private onDown = (e: PointerEvent) => {
    // Set before the right-button return, so a mouse right click after a touch is not taken for touch.
    this.#touch = e.pointerType === 'touch';
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.#el.focus({ preventScroll: true });
    // A new gesture measures afresh.
    this.#rect = null;
    const p = this.#local(e);
    this.#pointers.set(e.pointerId, p);
    this.#el.setPointerCapture(e.pointerId);
    this.stopMotion();

    if (this.#pointers.size === 2) {
      this.#cancelLongPress();
      // A pinch is not the tap that ends a kept crosshair.
      this.#endSticky = false;
      // A second finger turns a line drag into a pinch; put the line back.
      if (this.#drag?.kind === 'annotation') this.#chart.annotationLayer?.cancelGesture();
      if (this.#drag?.kind === 'baseline') this.#baselines.pointerUp();
      const [a, b] = [...this.#pointers.values()] as [Point, Point];
      this.#drag = this.#allows('pinch')
        ? { kind: 'pinch', distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: (a.x + b.x) / 2 }
        : null;
      return;
    }

    // The "+" button wins over everything under it, also over ending a kept crosshair.
    const plus = this.#chart.plusButtonAt(p) ? this.#chart.plusButtonEvent() : null;
    if (plus) {
      this.#drag = { kind: 'plus', event: plus, start: p };
      return;
    }
    // A tap ends a crosshair kept after inspecting; it is used up, not a click or a new crosshair.
    if (this.#sticky && e.pointerType !== 'mouse') {
      this.#sticky = false;
      this.#chart.setCrosshair(null);
      this.#chart.updateHover(null);
      this.#drag = null;
      this.#endSticky = true;
      return;
    }
    const region = this.#chart.regionAt(p.x, p.y);
    if (!region) return;
    const drag = this.#startDrag(region, p, drawingModifiers(e));
    this.#drag = drag && this.#allows(drag.kind) ? drag : null;
    if (this.#drag?.kind === 'baseline') this.#el.style.cursor = 'grabbing';
    // Presses on legend rows reach the chart and pan; a click there picks the row's series.
    const row = this.#drag?.kind === 'pan' ? (this.#drag.row = this.#chart.legendSeriesAt(e.target)) : null;
    this.#samples = [{ t: e.timeStamp, x: p.x }];
    if (e.pointerType !== 'mouse' && region.kind === 'plot') {
      this.#chart.setCrosshair({ ...p, pane: region.pane });
      // A hold on a legend row opens its menu instead of inspecting.
      // A locked crosshair ignores inspection, so a hold stays a pan.
      if (this.#touch && this.#drag?.kind === 'pan' && (row || !this.#chart.crosshairLocked)) this.#armLongPress(this.#drag, e.pointerId, row);
    }
    if (!this.#touch && this.#drag?.kind === 'pan') this.#armSketch(this.#drag, e.pointerId);
  };

  /**
   * With `features.sketch`, turn a still press on the plot into a sketch after
   * the `sketch.holdMs` option: a mouse or pen press, or on touch a long-press (see `armLongPress`).
   */
  #armSketch(drag: Drag & { kind: 'pan' | 'inspect' }, pointerId: number): void {
    if (!this.#chart.features.sketch) return;
    this.#pressTimer = setTimeout(() => {
      this.#pressTimer = null;
      const p = this.#pointers.get(pointerId);
      if (this.#drag !== drag || !p || !this.#chart.drawingLayer?.sketch(drag.pane, p)) return;
      this.stopMotion();
      // The stroke takes over from inspecting: its crosshair follows the finger, the hover does not.
      if (drag.kind === 'inspect') this.#chart.updateHover(null);
      this.#drag = { kind: 'drawing' };
    }, this.#chart.options.sketch.holdMs);
  }

  /**
   * Turn a still touch press into inspection after `LONG_PRESS_MS`, or with
   * `touchInspect: 'off'` into a `contextmenu` event. Held still for longer, it
   * then becomes a sketch (see `armSketch`).
   */
  #armLongPress(drag: Drag & { kind: 'pan' }, pointerId: number, row: Series | null = null): void {
    this.#cancelLongPress();
    const menu = row !== null || this.#chart.options.touchInspect === 'off';
    this.#pressTimer = setTimeout(() => {
      this.#pressTimer = null;
      const p = this.#pointers.get(pointerId);
      if (this.#drag !== drag || !p) return;
      if (menu) {
        const r = this.#el.getBoundingClientRect();
        const x = p.x + this.#chart.plotLeft;
        const opened = row
          ? this.#chart.openLegendMenu(row, r.left + x, r.top + p.y)
          : this.#chart.openContextMenu(x, p.y, r.left + x, r.top + p.y);
        if (opened) {
          this.stopMotion();
          this.#drag = null;
          this.#chart.setCrosshair(null);
        } else this.#armSketch(drag, pointerId);
        return;
      }
      this.stopMotion();
      const inspect = { kind: 'inspect', pane: this.#chart.paneIndexAt(p.y), start: p } as const;
      this.#drag = inspect;
      this.#chart.setCrosshair({ ...p, pane: inspect.pane });
      this.#chart.updateHover(p);
      this.#armSketch(inspect, pointerId);
    }, LONG_PRESS_MS);
  }

  #cancelLongPress(): void {
    if (this.#pressTimer !== null) clearTimeout(this.#pressTimer);
    this.#pressTimer = null;
  }

  #startDrag(region: Region, p: Point, modifiers: DrawingModifiers): Drag | null {
    switch (region.kind) {
      case 'plot':
        // Trade lines win over drawings and panning, but not over placing a drawing.
        if (this.#annotationsActive() && this.#chart.annotationLayer?.pointerDown(p, this.#touch)) return { kind: 'annotation' };
        if (this.#chart.drawingLayer?.pointerDown(region.pane, p, modifiers)) return { kind: 'drawing' };
        return { kind: 'pan', pane: region.pane, last: p, start: p, moved: false };
      case 'priceAxis':
        // A baseline series' base handle wins over scaling the axis; both are axis drags.
        if (this.#chart.features.axisDragScale && this.#baselines.pointerDown(region, p.y)) return { kind: 'baseline' };
        // An empty axis column has nothing to scale.
        return region.scale ? { kind: 'priceAxis', pane: region.pane, scale: region.scale, lastY: p.y } : null;
      case 'timeAxis':
        return {
          kind: 'timeAxis',
          lastX: p.x,
          startX: clampLow(p.x, 0, this.#chart.plotWidth),
          press: this.#annotationsActive() && this.#chart.annotationLayer?.timeMarkDown(p, this.#touch) ? p : null,
        };
      case 'separator':
        return { kind: 'separator', pane: region.pane, lastY: p.y };
    }
  }

  private onMove = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') this.#hovered = true;
    const p = this.#local(e);
    if (this.#pointers.has(e.pointerId)) this.#pointers.set(e.pointerId, p);
    const chart = this.#chart;
    const d = this.#drag;
    // The tap that ends a kept crosshair is used up; its drift must not bring the crosshair back.
    if (this.#endSticky) return;

    if (!d) {
      // Hover: drawing-creation preview, crosshair and cursor.
      chart.drawingLayer?.pointerMove(p, drawingModifiers(e));
      const region = chart.regionAt(p.x, p.y);
      const overPlot = region?.kind === 'plot' && this.#annotationsActive();
      chart.annotationLayer?.pointerMove(overPlot ? p : null);
      const onMark = chart.annotationLayer?.timeMarkMove(region?.kind === 'timeAxis' && this.#annotationsActive() ? p : null);
      const onHandle = this.#baselines.pointerMove(chart.features.axisDragScale ? region : null, p.y);
      this.#el.style.cursor = (overPlot && chart.annotationLayer?.cursor(p)) || (onHandle ? 'grab' : onMark ? 'pointer' : this.#cursorFor(region, p));
      if (region?.kind === 'plot' || region?.kind === 'priceAxis') chart.setCrosshair({ ...p, pane: region.pane });
      else if (chart.crosshair) chart.setCrosshair(null);
      // The "+" button follows the crosshair, so check it once the crosshair has moved.
      if (chart.hoverPlusButton(region?.kind === 'plot' ? p : null)) this.#el.style.cursor = 'pointer';
      chart.updateHover(region?.kind === 'plot' ? p : null);
      return;
    }

    switch (d.kind) {
      case 'pinch': {
        if (this.#pointers.size < 2) return;
        const [a, b] = [...this.#pointers.values()] as [Point, Point];
        const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const mid = (a.x + b.x) / 2;
        if (this.#canPan(this.#touch)) chart.time.pan(mid - d.mid);
        if (this.#canZoom(this.#touch)) chart.time.zoom(distance / d.distance, this.#zoomAnchorX('plot', mid));
        d.distance = distance;
        d.mid = mid;
        break;
      }
      case 'drawing':
        chart.drawingLayer?.pointerMove(p, drawingModifiers(e));
        chart.setCrosshair({ ...p, pane: chart.paneIndexAt(p.y) });
        return;
      case 'annotation':
        chart.annotationLayer?.pointerMove(p);
        // The line's own axis label shows the price; a crosshair would only compete with it.
        if (chart.crosshair) chart.setCrosshair(null);
        return;
      case 'inspect':
        // Moving keeps inspecting instead of turning into a sketch.
        if (this.#beyondSlop(e, d.start, p)) this.#cancelLongPress();
        chart.setCrosshair({ ...p, pane: chart.paneIndexAt(p.y) });
        chart.updateHover(p);
        return;
      case 'plus':
        // The button and its price stay put while pressed.
        return;
      case 'pan': {
        d.moved ||= this.#beyondSlop(e, d.start, p);
        // Moving first makes it a pan, not a long-press.
        if (d.moved) this.#cancelLongPress();
        const pane = chart.panes[d.pane]!;
        const scaling = chart.options.plotDragScale && chart.features.axisDragScale;
        if (!this.#canPan(this.#touch) && !scaling) {
          // Panning is off: the pointer only drives the crosshair.
          chart.setCrosshair({ ...p, pane: chart.paneIndexAt(p.y) });
          return;
        }
        const dy = p.y - d.last.y;
        if (this.#canPan(this.#touch)) {
          chart.time.pan(p.x - d.last.x);
          // Scales the user zoomed by hand pan with the content; the main one rescales with `plotDragScale`.
          for (const scale of pane.scales) if (!scale.autoScale && !(scaling && scale === pane.price)) scale.pan(dy);
        }
        // Like a click, a press that stays within the slop does not scale.
        if (scaling && d.moved && dy !== 0) {
          pane.price.zoom(Math.exp(dy * 0.005), pane.height / 2);
          this.#el.style.cursor = 'ns-resize';
        }
        d.last = p;
        this.#samples.push({ t: e.timeStamp, x: p.x });
        while (this.#samples.length > 2 && e.timeStamp - this.#samples[0]!.t > 100) this.#samples.shift();
        if (e.pointerType === 'mouse') chart.setCrosshair({ ...p, pane: d.pane });
        break;
      }
      case 'baseline':
        this.#baselines.drag(p.y);
        break;
      case 'priceAxis': {
        const pane = chart.panes[d.pane]!;
        d.scale.zoom(Math.exp((p.y - d.lastY) * 0.005), pane.height / 2);
        d.lastY = p.y;
        break;
      }
      case 'timeAxis':
        // A press on a badge stays a click until it travels; then it drags the axis like any other press.
        if (d.press) {
          if (!this.#beyondSlop(e, d.press, p)) return;
          d.press = null;
          chart.annotationLayer?.cancelGesture();
          chart.annotationLayer?.timeMarkMove(null);
        }
        chart.time.zoom(Math.exp((p.x - d.lastX) * 0.005), this.#zoomAnchorX('timeAxis', d.startX));
        d.lastX = p.x;
        break;
      case 'separator':
        chart.moveSeparator(d.pane, p.y - d.lastY);
        d.lastY = p.y;
        break;
    }
    chart.redraw('view');
  };

  private onUp = (e: PointerEvent) => {
    // All mouse buttons share one pointer: releasing another button while the primary is held does not end its press.
    if (e.type === 'pointerup' && e.pointerType === 'mouse' && e.button !== 0 && (e.buttons & 1) !== 0) return;
    // Only the primary button's release can click; any other release just ends the press.
    const released = e.type === 'pointerup' && (e.pointerType !== 'mouse' || e.button === 0);
    const p = this.#local(e);
    this.#pointers.delete(e.pointerId);
    if (this.#el.hasPointerCapture(e.pointerId)) this.#el.releasePointerCapture(e.pointerId);
    const d = this.#drag;
    this.#cancelLongPress();
    if (this.#endSticky) {
      // The tap that ended a kept crosshair.
      this.#endSticky = false;
      this.#chart.setCrosshair(null);
      this.#chart.updateHover(null);
      return;
    }
    if (d?.kind === 'inspect') {
      this.#drag = null;
      if (this.#chart.options.touchInspect === 'tap') this.#sticky = true;
      else {
        this.#chart.setCrosshair(null);
        this.#chart.updateHover(null);
      }
      return;
    }
    if (d?.kind === 'pinch') {
      // Lifting one finger ends the pinch; don't resume panning with the other.
      this.#drag = null;
      return;
    }
    if (d?.kind === 'plus') {
      if (released && !this.#beyondSlop(e, d.start, p)) this.#chart.emit('plus:click', d.event);
      // On touch the kept crosshair it belonged to is used up.
      this.#sticky = false;
    }
    if (d?.kind === 'drawing') this.#chart.drawingLayer?.pointerUp(p, e.type === 'pointercancel', drawingModifiers(e));
    if (d?.kind === 'baseline') {
      // A mouse stays over the axis after release; touch and pen leave no hover behind.
      const region = e.pointerType === 'mouse' ? this.#chart.regionAt(p.x, p.y) : null;
      if (this.#baselines.pointerUp(region, p.y)) this.#el.style.cursor = 'grab';
      else this.#el.style.cursor = this.#cursorFor(region, p);
    }
    if (d?.kind === 'timeAxis' && d.press) {
      if (e.type === 'pointercancel') this.#chart.annotationLayer?.cancelGesture();
      else this.#chart.annotationLayer?.pointerUp(p);
    }
    if (d?.kind === 'annotation') {
      if (e.type === 'pointercancel') this.#chart.annotationLayer?.cancelGesture();
      else this.#chart.annotationLayer?.pointerUp(p);
    }
    if (d?.kind === 'pan') {
      if (this.#el.style.cursor === 'ns-resize') this.#el.style.cursor = this.#cursorFor(this.#chart.regionAt(p.x, p.y), p);
      // Any travel past the slop during the press makes it a pan, even if it ends near the start.
      const moved = d.moved || this.#beyondSlop(e, d.start, p);
      if (!moved && released && e.altKey) this.#toggleCrosshairLock(d.start, d.pane);
      // A tap releases a locked crosshair; it is used up, not a click.
      else if (!moved && released && e.pointerType !== 'mouse' && this.#chart.crosshairLocked) this.#chart.lockCrosshair(false);
      else if (!moved && released) {
        this.#chart.clickSelect(d.start, d.row ?? null);
        this.#emitPointer('plot:click', d.start);
      }
      else if (this.#chart.options.inertia && this.#canPan(this.#touch)) this.#fling(e.timeStamp);
    }
    this.#drag = null;
    if (e.pointerType !== 'mouse') {
      // No hover after a touch or pen lifts: drop the highlight like the crosshair.
      this.#chart.annotationLayer?.pointerMove(null);
      this.#chart.annotationLayer?.timeMarkMove(null);
      this.#chart.setCrosshair(null);
    } else {
      // Hover tracking pauses during drags; catch up with where the pointer ended.
      this.#chart.updateHover(p);
    }
  };

  #beyondSlop(e: PointerEvent, from: Point, to: Point): boolean {
    const slop = e.pointerType === 'mouse' ? CLICK_SLOP_MOUSE : CLICK_SLOP_TOUCH;
    return Math.hypot(to.x - from.x, to.y - from.y) > slop;
  }

  /** Alt+click: hold the crosshair where it is, or let it follow the pointer again. */
  #toggleCrosshairLock(p: Point, pane: number): void {
    const chart = this.#chart;
    if (!chart.crosshairLocked) {
      chart.setCrosshair({ ...p, pane });
      chart.lockCrosshair(true);
      return;
    }
    chart.lockCrosshair(false);
    chart.setCrosshair({ ...p, pane });
  }

  #emitPointer(event: 'plot:click' | 'plot:dblclick', p: Point): void {
    // pointAt and the event payload take chart-root coordinates.
    const at = this.#chart.pointAt(p.x + this.#chart.plotLeft, p.y);
    if (at) this.#chart.emit(event, at);
  }

  #fling(now: number): void {
    const first = this.#samples[0];
    const last = this.#samples[this.#samples.length - 1];
    if (!first || !last || now - last.t > 50) return;
    const dt = last.t - first.t;
    if (dt <= 0) return;
    const v = (last.x - first.x) / dt;
    if (Math.abs(v) > 0.15) {
      this.velocity = v;
      this.#chart.redraw('view');
    }
  }

  #onLeave = (e: PointerEvent) => {
    this.#rect = null;
    // A mouse and a hovering pen leave hover state behind; a touch cleared its own when it lifted.
    if (e.pointerType === 'touch') return;
    this.#chart.hoverPlusButton(null);
    if (e.pointerType === 'mouse') this.#hovered = false;
    if (this.#drag) return;
    this.#baselines.pointerMove(null, 0);
    this.#chart.annotationLayer?.pointerMove(null);
    this.#chart.annotationLayer?.timeMarkMove(null);
    this.#chart.setCrosshair(null);
    this.#chart.updateHover(null);
  };

  /**
   * A touch long-press would open the browser's context menu; inspecting (or
   * the chart's own menu, see `armLongPress`) owns it, also when the browser
   * sends it after the finger lifts. Otherwise the chart's menu replaces the
   * browser's when the app listens for `contextmenu`.
   */
  #onContextMenu = (e: MouseEvent) => {
    if (this.#touch) {
      e.preventDefault();
      return;
    }
    const row = this.#chart.legendSeriesAt(e.target);
    if (row) {
      if (this.#chart.openLegendMenu(row, e.clientX, e.clientY)) e.preventDefault();
      return;
    }
    const p = this.#local(e);
    if (this.#chart.openContextMenu(p.x + this.#chart.plotLeft, p.y, e.clientX, e.clientY)) e.preventDefault();
  };

  #onWheel = (e: WheelEvent) => {
    const chart = this.#chart;
    const p = this.#local(e);
    // Lines have one fixed height; a page is the plot's size along each axis.
    const sx = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? chart.plotWidth : 1;
    const sy = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? chart.plotHeight : 1;
    let dx = e.deltaX;
    let dy = e.deltaY;
    const zoomKey = e.ctrlKey || e.metaKey;
    // Shift+wheel pans along its dominant axis; some browsers already turn it into a horizontal delta.
    // Swap before scaling, so a vertical page becomes a horizontal page (the plot's width).
    if (e.shiftKey && !zoomKey) [dx, dy] = [Math.abs(dy) > Math.abs(dx) ? dy : dx, 0];
    dx *= sx;
    dy *= sy;
    const mode = chart.options.wheel;
    // `'page'` leaves the plain wheel to the page.
    if (mode === 'page' && !zoomKey && !e.shiftKey) return;
    // Ctrl marks a trackpad pinch; Cmd with a horizontal swipe still pans.
    const horizontal = !e.ctrlKey && Math.abs(dx) > Math.abs(dy);
    const pan = horizontal || (mode === 'pan' && !zoomKey);
    // Wheel input the chart does not use scrolls or zooms the page instead.
    if (pan ? !this.#canPan() : !this.#canZoom()) return;
    e.preventDefault();
    this.velocity = 0;
    chart.time.cancelAnimation();
    const anchor = this.#zoomAnchorX('plot', clampLow(p.x, 0, chart.plotWidth));

    if (pan) {
      // Down or right moves towards newer bars, like scrolling a page forward.
      chart.time.pan(-(horizontal ? dx : dy));
    } else if (e.ctrlKey) {
      // Trackpad pinch arrives as ctrl+wheel.
      this.zoomTarget = null;
      chart.time.zoom(Math.exp(-dy * 0.01), anchor);
    } else if (chart.options.smoothZoom && !chart.options.lowPower && Math.abs(dy) >= 40) {
      // Mouse wheel notch: ease towards the target spacing.
      const t = chart.time;
      const base = this.zoomTarget ?? Math.log(t.barSpacing);
      this.zoomTarget = clampNum(base - dy * 0.0025, Math.log(t.floorSpacing), Math.log(t.maxBarSpacing));
      this.zoomAnchor = anchor;
    } else {
      chart.time.zoom(Math.exp(-dy * 0.004), anchor);
    }
    chart.redraw('view');
  };

  #onDoubleClick = (e: MouseEvent) => {
    const p = this.#local(e);
    const region = this.#chart.regionAt(p.x, p.y);
    if (region?.kind === 'plot') {
      // Skip when a drawing edits its text, a tool is active or the pointer is over a drawing.
      if (!this.#chart.drawingLayer?.doubleClick(p) && (this.#chart.drawingLayer?.cursor(p) ?? null) === null) {
        this.#emitPointer('plot:dblclick', p);
        this.#toggleMaximize(region.pane);
      }
    } else if (region?.kind === 'timeAxis') {
      if (this.#canPan()) this.#chart.scrollToRealtime();
    } else if (region?.kind === 'priceAxis' && region.scale && this.#chart.features.axisDragScale) {
      this.#chart.setAutoScale(true, region.pane, region.scale.id);
    }
  };

  /** The pane's maximize button, as a double-click: maximize it, or restore the others. */
  #toggleMaximize(index: number): void {
    const chart = this.#chart;
    if (!chart.options.paneDoubleClickMaximize || chart.panes.length < 2) return;
    const pane = chart.panes[index]!;
    chart.maximizePane(chart.maximizedPane === pane ? null : pane);
  }

  /**
   * `hover` and `global` scopes: keys from anywhere on the page, while hovered
   * or focused for `hover`. Drawing and trade-line keys (Escape, Delete, undo)
   * always need the chart hovered or focused, so the page keeps its own.
   */
  #onDocumentKey = (e: KeyboardEvent) => {
    // A key the page already handled is not the chart's; one another chart took still is.
    if (claimed.has(e) || (e.defaultPrevented && !taken.has(e))) return;
    const active = this.#hovered || this.#el.contains(this.#el.ownerDocument.activeElement);
    if (this.#chart.options.keyboard?.scope === 'hover' && !active) return;
    this.#onKey(e, active);
  };

  #onKey = (e: KeyboardEvent, active = true) => {
    // Keyboard input between gestures (the menu key, Shift+F10) is not touch.
    if (this.#pointers.size === 0) this.#touch = false;
    if (!this.#chart.features.keyboard || typingElsewhere(e.target, this.#el)) return;
    if (active && (this.#chart.annotationLayer?.keyDown(e) || this.#chart.drawingLayer?.keyDown(e))) {
      this.#take(e);
      return;
    }
    // Like drawing keys, Escape on a locked crosshair or a selected indicator needs the chart hovered or focused.
    if (active && e.key === 'Escape' && this.#chart.crosshairLocked) {
      this.#chart.lockCrosshair(false);
      this.#take(e);
      return;
    }
    if (active && e.key === 'Escape' && this.#chart.getSelection()?.kind === 'indicator') {
      this.#chart.setSelection(null);
      this.#take(e);
      return;
    }
    // Copy, cut and paste on the browser's own keys go through its clipboard events, which the key's default fires.
    if (active && this.#chart.drawingClipboardKey(e)) {
      this.#take(e, false);
      return;
    }
    // Shortcuts on `chart.actions`; drawing ones need the chart hovered or focused.
    // A key that changed nothing (a page key at an edge) is left to the page.
    if (this.#chart.actions.handleKey(e, active)) this.#take(e);
  };

  /** Mark a key as used by this chart; `prevent: false` leaves the browser's default to run. */
  #take(e: KeyboardEvent, prevent = true): void {
    if (prevent) e.preventDefault();
    taken.add(e);
    if (!this.#documentKeys) claimed.add(e);
  }

  /** Do a view command; false when the view did not move. */
  private run(action: ViewActionId): boolean {
    const chart = this.#chart;
    const time = chart.time;
    const step = Math.max(1, time.barSpacing) * 4;
    switch (action) {
      case 'scroll-older':
      case 'scroll-newer':
        return time.pan(action === 'scroll-older' ? step : -step);
      case 'page-older':
      case 'page-newer':
        return time.pan(action === 'page-older' ? time.width : -time.width);
      case 'oldest-bar': {
        const before = time.rightOffset;
        // The first bar at the left edge, within the view limits.
        time.rightOffset = time.width / time.barSpacing - (time.barCount - 1);
        time.clamp();
        return time.rightOffset !== before;
      }
      case 'newest-bar': {
        const before = time.rightOffset;
        chart.scrollToRealtime(false);
        return time.rightOffset !== before;
      }
      case 'zoom-in':
      case 'zoom-out': {
        const before = time.barSpacing;
        time.zoom(action === 'zoom-out' ? 1 / 1.2 : 1.2, this.#zoomAnchorX('plot', chart.plotWidth));
        return time.barSpacing !== before;
      }
      case 'reset-view':
        chart.resetView();
        return true;
      case 'crosshair-prev':
      case 'crosshair-next':
        return this.#stepCrosshair(action === 'crosshair-prev' ? -1 : 1);
    }
  }

  /**
   * Move the crosshair one bar, starting from the newest visible bar when it
   * is hidden, and scroll to keep it on screen when panning is on.
   */
  #stepCrosshair(dir: -1 | 1): boolean {
    const chart = this.#chart;
    const time = chart.time;
    // A locked crosshair stays put; the key is left to the page.
    if (time.barCount === 0 || chart.crosshairLocked) return false;
    const c = chart.crosshair;
    const last = time.barCount - 1;
    // With no crosshair, the first step starts on the newest visible bar, in either direction.
    const index = c ? clampLow(Math.round(time.xToIndex(c.x)) + dir, 0, last) : time.visibleRange().to;
    const x = time.indexToX(index);
    const half = time.barSpacing / 2;
    if (this.#canPan()) {
      if (x < half) time.pan(half - x);
      else if (x > time.width - half) time.pan(time.width - half - x);
    }
    const pane = c?.pane ?? 0;
    const y = c?.y ?? chart.panes[pane]!.top + chart.panes[pane]!.height / 2;
    chart.setCrosshair({ x: time.indexToX(index), y, pane });
    return true;
  }

  /** Annotations take pointer input unless a drawing is being placed. */
  #annotationsActive(): boolean {
    const drawings = this.#chart.drawingLayer;
    return !drawings?.tool && !drawings?.isBusy;
  }

  #cursorFor(region: Region | null, p: Point): string {
    if (!region) return 'default';
    switch (region.kind) {
      case 'separator':
        return 'row-resize';
      case 'priceAxis':
        return this.#chart.features.axisDragScale && region.scale ? 'ns-resize' : 'default';
      case 'timeAxis':
        return this.#chart.features.axisDragScale ? 'ew-resize' : 'default';
      case 'plot':
        return this.#chart.drawingLayer?.cursor(p) ?? this.#chart.primitiveAt(p)?.hit.cursor ?? PLOT_CURSORS[this.#chart.crosshairCursor];
    }
  }
}
