import type { Chart, Region } from './chart';
import { CandleSeries, type BaseLevel } from './series';
import type { Pane } from './pane';
import { clampNum } from './util/math';

/** Payload of `baseline:change`. */
export interface BaselineChangeEvent {
  series: CandleSeries;
  /** The series' new `baseLevel` option. */
  baseLevel: BaseLevel;
  /** The price the base now sits at. */
  price: number;
}

/** The events of the base level handle of a `baseline` series, part of `ChartEvents`. */
export interface BaselineEvents {
  /** The user dragged a `baseline` series' base handle on the price axis. */
  'baseline:change': BaselineChangeEvent;
}

/** How close (css px) to the base level the price axis grabs it. */
const HANDLE_HIT = 5;

/**
 * Base level handles of `baseline` style series on the price axis: hit
 * testing, dragging, and which series label their base level on the axis
 * (the hovered one and the one whose handle is in use).
 */
export class BaselineHandles {
  /** Series under the pointer in the plot. */
  #hovered: CandleSeries | null = null;
  /** Series whose handle is under the pointer or being dragged. */
  #active: CandleSeries | null = null;
  #dragging = false;
  private readonly off: () => void;

  readonly #chart: Chart;

  constructor(chart: Chart) {
    this.#chart = chart;
    this.off = chart.on('series:hover', ({ series }) => {
      this.#hovered = series instanceof CandleSeries ? series : null;
      this.#sync();
    });
  }

  destroy(): void {
    this.off();
  }

  /** The `baseline` series whose base handle is at plot-coordinate `y` in `region`, or null. */
  at(region: Region | null, y: number): CandleSeries | null {
    if (region?.kind !== 'priceAxis' || !region.scale) return null;
    const pane = this.#chart.panes[region.pane];
    if (!pane || pane.collapsed || pane.height <= 0) return null;
    for (const s of pane.series) {
      if (!(s instanceof CandleSeries) || !s.visible || s.options.style !== 'baseline' || s.basePrice === null) continue;
      if (this.#chart.labelScale(pane, s.scale) !== region.scale) continue;
      if (Math.abs(pane.top + s.scale.priceToY(s.basePrice) - y) <= HANDLE_HIT) return s;
    }
    return null;
  }

  /** Hover without a gesture; true when the pointer is over a handle. */
  pointerMove(region: Region | null, y: number): boolean {
    if (this.#dragging) return true;
    this.#active = this.at(region, y);
    this.#sync();
    return this.#active !== null;
  }

  /** Start dragging the handle under the pointer; false when there is none. */
  pointerDown(region: Region | null, y: number): boolean {
    const s = this.at(region, y);
    if (!s) return false;
    this.#active = s;
    this.#dragging = true;
    this.#sync();
    return true;
  }

  /** Move the dragged base to plot-coordinate `y` and emit `baseline:change`. */
  drag(y: number): void {
    const s = this.#active;
    if (!this.#dragging || !s) return;
    const pane = s.pane;
    if (!pane.series.includes(s) || pane.height <= 0) return;
    const local = clampNum(y - pane.top, 0, pane.height);
    const { baseLevel, price } = draggedLevel(s, pane, local);
    // Only the level changes: no rebuild of the series' buffers on every move.
    s.options = { ...s.options, baseLevel };
    this.#chart.requestRender();
    // Holds until the next frame resolves the level again.
    s.basePrice = price;
    this.#chart.emit('baseline:change', { series: s, baseLevel, price });
  }

  /**
   * End the drag. A pointer still over a handle (`region` and `y` of a mouse
   * release) keeps that handle active, so its label stays until the pointer
   * leaves. True when the pointer is over a handle.
   */
  pointerUp(region: Region | null = null, y = 0): boolean {
    this.#dragging = false;
    this.#active = this.at(region, y);
    this.#sync();
    return this.#active !== null;
  }

  /** The series showing their base level on the axis. */
  #sync(): void {
    let changed = false;
    for (const pane of this.#chart.panes) {
      for (const s of pane.series) {
        if (!(s instanceof CandleSeries)) continue;
        const show = s === this.#hovered || s === this.#active;
        if (s.showBaseLevel !== show) {
          s.showBaseLevel = show;
          changed = true;
        }
      }
    }
    if (changed) this.#chart.redrawOverlay('series');
  }
}

/**
 * The base level after dragging to pane-local `y`. A height level stays a
 * height; a price or first-visible level becomes a price, rounded to the
 * series' tick size.
 */
export function draggedLevel(series: CandleSeries, pane: Pane, y: number): { baseLevel: BaseLevel; price: number } {
  const scale = series.scale;
  const current = series.options.baseLevel;
  if (!current || current.kind === 'height') {
    const percent = (1 - y / pane.height) * 100;
    return { baseLevel: { kind: 'height', percent }, price: scale.yToPrice(y) };
  }
  const price = series.formatModel.round(scale.yToPrice(y));
  return { baseLevel: { kind: 'price', price }, price };
}
