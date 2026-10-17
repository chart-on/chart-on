import type { Primitive, PrimitiveEnv, PrimitiveLayer } from '../primitives';
import type { Series } from '../series';
import type { ChartTheme } from '../theme';
import type { Timeline } from '../timeline';
import { fillText } from '../typography';
import type { Time } from '../types';
import { parseColor } from '../util/color';
import { OptionsHandle } from './lines';
import { isDev } from '../util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** Shades the full pane height between two bars, e.g. an earnings or news window. */
export interface TimeBandOptions {
  /** Time of the first bar (unix seconds). A time between two bars lands on the bar that contains it. */
  from: Time;
  /** Time of the last bar. Omitted: the band covers the bar of `from` only. */
  to?: Time;
  /** Fill colour. Default: the theme's `annotationFill`. */
  color?: string;
  /** Text at the top of the band. */
  label?: string;
  /** Colour of the label text. Default: the theme's muted text colour. */
  labelColor?: string;
  /** Series whose pane the band shades. Default: the main series. */
  series?: Series;
}

/** Shades a horizontal band between two prices, e.g. a supply or demand zone. */
export interface PriceZoneOptions {
  /** One edge of the zone. */
  from: number;
  /** The other edge; either may be the higher one. */
  to: number;
  /** Start the zone at this bar instead of the left edge of the pane. */
  fromTime?: Time;
  /**
   * End the zone at this bar instead of the right edge of the pane. On the
   * main pane its prices then draw adjusted like this bar's under the chart's
   * `adjustment` option; zones reaching the latest bar keep their prices.
   */
  toTime?: Time;
  /** Fill colour. Default: the theme's `annotationFill`. */
  color?: string;
  /** Text in the top-left corner of the zone. */
  label?: string;
  /** Colour of the label text. Default: the theme's muted text colour. */
  labelColor?: string;
  /** Show both edge prices on the price axis, in the zone colour made opaque. Default false. */
  axisLabel: boolean;
  /** Series whose price scale and pane the zone follows. Default: the main series. */
  series?: Series;
}

/** Where a text label's box sits horizontally against its anchor. */
export type TextLabelAlign = 'left' | 'center' | 'right';

/** A text box pinned to a time and a price, e.g. a note on a bar. */
export interface TextLabelOptions {
  /** Bar time of the anchor (unix seconds); the anchor sits at the centre of that bar. */
  time: Time;
  /** Price of the anchor; on the main pane it draws at its bar's adjusted price under the chart's `adjustment` option. */
  price: number;
  text: string;
  /** Text colour. Default: the theme's `labelText`. */
  color?: string;
  /** Box colour. Default: the theme's `labelBackground`. */
  background?: string;
  /** Font size in css px. Default: the theme's font size. */
  fontSize?: number;
  /** `left`: the box starts at the anchor, `right`: it ends there, `center` (default): centred on it. */
  align: TextLabelAlign;
  /**
   * Length in css px of a pointer line from the anchor to the box. Positive
   * puts the box above the anchor, negative below it, 0 (default) centres
   * the box on the anchor with no line.
   */
  pointerLength: number;
  /** Series whose price scale and pane the label follows. Default: the main series. */
  series?: Series;
}

/** What a band, zone or label handle needs from the annotation layer. */
export interface ZoneOwner {
  /** Options or visibility changed. */
  changed(item: ZoneItem): void;
  remove(item: ZoneItem): void;
  /** Takes checked options before they replace the current ones; throwing rejects them. */
  prepare(item: ZoneItem, next: { series?: Series }): void;
}

/** Handle shared by time bands, price zones and text labels. */
abstract class ZoneHandle<O extends { series?: Series }> extends OptionsHandle<O, ZoneOwner> {
  protected override prepare(next: O): void {
    this.owner.prepare(this as unknown as ZoneItem, next);
  }
}

function checkTime(value: unknown, name: string): void {
  if (!Number.isFinite(value)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `${name} must be a finite number` : '');
}

/** Handle returned by `chart.annotations.addTimeBand`. */
export class TimeBand extends ZoneHandle<TimeBandOptions> {
  protected check(o: TimeBandOptions): void {
    checkTime(o.from, 'Time band from');
    if (o.to !== undefined) checkTime(o.to, 'Time band to');
  }
}

/** Handle returned by `chart.annotations.addPriceZone`. */
export class PriceZone extends ZoneHandle<PriceZoneOptions> {
  /** @internal Opaque axis-label colour, cached for the fill colour it was made from. */
  axisColor: { from: string; solid: string } | null = null;

  protected check(o: PriceZoneOptions): void {
    if (!Number.isFinite(o.from) || !Number.isFinite(o.to)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Price zone prices must be finite numbers' : '');
    if (o.fromTime !== undefined) checkTime(o.fromTime, 'Price zone fromTime');
    if (o.toTime !== undefined) checkTime(o.toTime, 'Price zone toTime');
  }
}

const ALIGNS: readonly TextLabelAlign[] = ['left', 'center', 'right'];

/** Handle returned by `chart.annotations.addTextLabel`. */
export class TextLabel extends ZoneHandle<TextLabelOptions> {
  /** @internal Font string and text width, cached for the font they were measured in. */
  metrics: { font: string; size: number; family: string; width: number } | null = null;

  protected check(o: TextLabelOptions): void {
    checkTime(o.time, 'Text label time');
    if (!Number.isFinite(o.price)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Text label price must be a finite number' : '');
    if (typeof o.text !== 'string') throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Text label text must be a string' : '');
    if (o.fontSize !== undefined && !(o.fontSize > 0)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Text label fontSize must be positive' : '');
    if (!ALIGNS.includes(o.align)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Unknown text label align "${String(o.align)}"` : '');
    if (!Number.isFinite(o.pointerLength)) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'Text label pointerLength must be a finite number' : '');
  }

  protected override optionsChanged(): void {
    this.metrics = null;
  }
}

export type ZoneItem = TimeBand | PriceZone | TextLabel;

/* ------------------------------ projection ------------------------------ */

/** Mapping a band, zone or label needs: the parts of a primitive's env it reads. */
export type ZoneEnv = Pick<PrimitiveEnv, 'width' | 'height' | 'barSpacing' | 'indexToX' | 'priceToY'>;

/** A projected area in pane-local css px, clipped to the pane. Reused between frames. */
export interface ZoneRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function zoneRect(): ZoneRect {
  return { left: 0, right: 0, top: 0, bottom: 0 };
}

/**
 * Index of the bar containing `time`: a time between two bars lands on the
 * earlier one, and times outside the data extrapolate by the bar interval.
 * NaN without bars.
 */
export function barSlot(timeline: Timeline, time: Time): number {
  if (timeline.times.length === 0) return NaN;
  // The epsilon keeps an exact bar time on its bar despite float error.
  return Math.floor(timeline.indexFromTime(time) + 1e-9);
}

/** Clip `out` to the pane; false when nothing of it is visible. */
function clip(out: ZoneRect, env: ZoneEnv): boolean {
  if (!(out.right > 0 && out.left < env.width && out.bottom > 0 && out.top < env.height)) return false;
  out.left = Math.max(0, out.left);
  out.right = Math.min(env.width, out.right);
  out.top = Math.max(0, out.top);
  out.bottom = Math.min(env.height, out.bottom);
  return true;
}

/** Left edge of the bar of `from` to the right edge of the bar of `to`. */
function barSpan(timeline: Timeline, env: ZoneEnv, from: Time, to: Time, out: ZoneRect): boolean {
  const a = barSlot(timeline, Math.min(from, to));
  const b = barSlot(timeline, Math.max(from, to));
  if (Number.isNaN(a)) return false;
  const half = env.barSpacing / 2;
  out.left = env.indexToX(a) - half;
  out.right = env.indexToX(b) + half;
  return true;
}

/**
 * Project a time band into `out`, clipped to the pane. Returns false when it
 * is off screen or there are no bars to place it on.
 */
export function projectTimeBand(o: TimeBandOptions, timeline: Timeline, env: ZoneEnv, out: ZoneRect): boolean {
  if (!barSpan(timeline, env, o.from, o.to ?? o.from, out)) return false;
  out.top = 0;
  out.bottom = env.height;
  return clip(out, env);
}

/**
 * What a zone's prices draw multiplied by, given the factor of a bar time: a
 * zone ending at a bar (`toTime`) is priced like that bar; one reaching the
 * live edge is a level of the live price, which no adjustment changes.
 */
export function zoneFactor(o: PriceZoneOptions, factorAt: (time: Time) => number): number {
  return o.toTime === undefined ? 1 : factorAt(o.toTime);
}

/**
 * Project a price zone into `out`, clipped to the pane. Prices go through the
 * scale, so log and percent modes work, multiplied by `factor` (an adjustment
 * mode). Returns false when it is off screen.
 */
export function projectPriceZone(o: PriceZoneOptions, timeline: Timeline, env: ZoneEnv, out: ZoneRect, factor = 1): boolean {
  const y0 = env.priceToY(o.from * factor);
  const y1 = env.priceToY(o.to * factor);
  if (!Number.isFinite(y0) || !Number.isFinite(y1)) return false;
  out.top = Math.min(y0, y1);
  out.bottom = Math.max(y0, y1);
  out.left = 0;
  out.right = env.width;
  if (o.fromTime !== undefined || o.toTime !== undefined) {
    const half = env.barSpacing / 2;
    if (o.fromTime !== undefined) {
      const slot = barSlot(timeline, o.fromTime);
      if (Number.isNaN(slot)) return false;
      out.left = env.indexToX(slot) - half;
    } else {
      out.left = -Infinity;
    }
    if (o.toTime !== undefined) {
      const slot = barSlot(timeline, o.toTime);
      if (Number.isNaN(slot)) return false;
      out.right = env.indexToX(slot) + half;
    } else {
      out.right = Infinity;
    }
    if (out.right < out.left) return false;
  }
  return clip(out, env);
}

/** Box height of a text label: the font size plus padding. */
const LABEL_PAD_X = 6;
const LABEL_PAD_Y = 3;

/**
 * Project a text label's box (`out`) for an anchor at the centre of its bar,
 * its price multiplied by `factor` (an adjustment mode). `anchor` receives the
 * anchor point. Returns false when the box and its pointer are off screen.
 * The box is not clipped: it is drawn whole.
 */
export function projectTextLabel(
  o: TextLabelOptions,
  textWidth: number,
  fontSize: number,
  timeline: Timeline,
  env: ZoneEnv,
  out: ZoneRect,
  anchor: { x: number; y: number },
  factor = 1,
): boolean {
  const slot = barSlot(timeline, o.time);
  if (Number.isNaN(slot)) return false;
  const x = env.indexToX(slot);
  const y = env.priceToY(o.price * factor);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  anchor.x = x;
  anchor.y = y;
  const width = textWidth + LABEL_PAD_X * 2;
  const height = fontSize + LABEL_PAD_Y * 2;
  out.left = o.align === 'left' ? x : o.align === 'right' ? x - width : x - width / 2;
  out.right = out.left + width;
  const p = o.pointerLength;
  out.top = p > 0 ? y - p - height : p < 0 ? y - p : y - height / 2;
  out.bottom = out.top + height;
  const top = Math.min(out.top, y);
  const bottom = Math.max(out.bottom, y);
  return out.right > 0 && out.left < env.width && bottom > 0 && top < env.height;
}

/* -------------------------------- layer -------------------------------- */

/** What the zone layer needs from the annotation layer. */
export interface ZoneHost {
  readonly theme: ChartTheme;
  readonly timeline: Timeline;
  /** The main series: default target. */
  readonly main: Series | null;
  /** Attach a primitive to `series`, or to the main pane when null. Returns the detach function. */
  attachPrimitive(primitive: Primitive, series: Series | null): () => void;
  /** Redraw everything: bands and zones are on the layer below the series. */
  requestRedraw(): void;
  /** What prices at `time` on the pane of `series` (the main one when null) draw multiplied by; default 1. */
  priceFactor?(series: Series | null, time: Time): number;
}

/** One primitive drawing every band and zone (or every label) of a target. */
interface Group {
  detach: () => void;
}

/** Band and zone label inset from the area's corner. */
const INSET = 4;

/**
 * Time bands, price zones and text labels. Each target series gets one
 * primitive on the `below` layer for its bands and zones and one on the `top`
 * layer for its labels, however many there are; their drawing allocates
 * nothing per frame. Nothing here is hit-tested, so panning passes through.
 */
export class ZoneLayer {
  #bandList: TimeBand[] = [];
  #zoneList: PriceZone[] = [];
  #labelList: TextLabel[] = [];
  readonly #groups: Record<'below' | 'top', Map<Series | null, Group>> = { below: new Map(), top: new Map() };
  /** Scratch geometry, reused every frame. */
  readonly #rect = zoneRect();
  readonly #anchor = { x: 0, y: 0 };
  readonly owner: ZoneOwner = {
    changed: () => {
      // A new series may leave the old one's primitive unused.
      this.#prune();
      this.#host.requestRedraw();
    },
    remove: (item) => this.remove(item),
    prepare: (item, next) => {
      // Only a new series needs a primitive; one that went away keeps the handle editable.
      if (this.#listed(item) && next.series !== item.options.series) this.#ensure(layerOf(item), this.#key(next.series));
    },
  };

  readonly #host: ZoneHost;

  constructor(host: ZoneHost) {
    this.#host = host;
  }

  get bands(): readonly TimeBand[] {
    return this.#bandList;
  }

  get zones(): readonly PriceZone[] {
    return this.#zoneList;
  }

  get labels(): readonly TextLabel[] {
    return this.#labelList;
  }

  addBand(options: TimeBandOptions): TimeBand {
    const band = new TimeBand({ ...options }, this.owner);
    return this.add(band, this.#bandList);
  }

  addZone(options: Partial<PriceZoneOptions> & Pick<PriceZoneOptions, 'from' | 'to'>): PriceZone {
    const zone = new PriceZone({ axisLabel: false, ...options }, this.owner);
    return this.add(zone, this.#zoneList);
  }

  addLabel(options: Partial<TextLabelOptions> & Pick<TextLabelOptions, 'time' | 'price' | 'text'>): TextLabel {
    const label = new TextLabel({ align: 'center', pointerLength: 0, ...options }, this.owner);
    return this.add(label, this.#labelList);
  }

  /** Remove every band, zone and label. */
  clear(): void {
    this.#bandList = [];
    this.#zoneList = [];
    this.#labelList = [];
    this.#prune();
    this.#host.requestRedraw();
  }

  /** The main series changed: items without a series follow it. */
  mainChanged(): void {
    this.#sync();
  }

  private add<T extends ZoneItem>(item: T, list: T[]): T {
    // Attach first: a series not on the chart throws before the item is listed.
    this.#ensure(layerOf(item), this.#key(item.options.series));
    list.push(item);
    this.#host.requestRedraw();
    return item;
  }

  private remove(item: ZoneItem): void {
    const before = this.#bandList.length + this.#zoneList.length + this.#labelList.length;
    this.#bandList = this.#bandList.filter((b) => b !== item);
    this.#zoneList = this.#zoneList.filter((z) => z !== item);
    this.#labelList = this.#labelList.filter((l) => l !== item);
    if (this.#bandList.length + this.#zoneList.length + this.#labelList.length === before) return;
    this.#prune();
    this.#host.requestRedraw();
  }

  #listed(item: ZoneItem): boolean {
    if (item instanceof TimeBand) return this.#bandList.includes(item);
    if (item instanceof PriceZone) return this.#zoneList.includes(item);
    return this.#labelList.includes(item);
  }

  /** The target an item draws on: its series, else the main series, else the main pane (null). */
  #key(series: Series | undefined): Series | null {
    return series ?? this.#host.main ?? null;
  }

  /** Attach the group primitive of `key` on `layer` unless it is there. Throws for a series not on the chart. */
  #ensure(layer: 'below' | 'top', key: Series | null): void {
    const groups = this.#groups[layer];
    if (groups.has(key)) return;
    const group: Group = { detach: () => {} };
    const primitive: Primitive = {
      layer: layer satisfies PrimitiveLayer,
      drawPlot: layer === 'below' ? (ctx, env) => this.#drawAreas(ctx, env, key) : (ctx, env) => this.#drawLabels(ctx, env, key),
      // The chart detaches it when its series or pane goes away.
      detached: () => {
        if (groups.get(key) === group) groups.delete(key);
      },
    };
    group.detach = this.#host.attachPrimitive(primitive, key);
    groups.set(key, group);
  }

  /** Attach the primitives items need and detach those nothing uses. */
  #sync(): void {
    for (const item of this.#items()) {
      try {
        this.#ensure(layerOf(item), this.#key(item.options.series));
      } catch {
        // Its series left the chart: it stays listed but is not drawn.
      }
    }
    this.#prune();
  }

  #prune(): void {
    for (const layer of ['below', 'top'] as const) {
      const used = new Set<Series | null>();
      for (const item of this.#items()) if (layerOf(item) === layer) used.add(this.#key(item.options.series));
      for (const [key, group] of [...this.#groups[layer]]) {
        if (used.has(key)) continue;
        this.#groups[layer].delete(key);
        group.detach();
      }
    }
  }

  #items(): ZoneItem[] {
    return [...this.#bandList, ...this.#zoneList, ...this.#labelList];
  }

  /* ------------------------------- drawing ------------------------------- */

  /** Bands, then zones, of target `key`: under the series. */
  #drawAreas(ctx: CanvasRenderingContext2D, env: PrimitiveEnv, key: Series | null): void {
    const theme = env.theme;
    const tl = this.#host.timeline;
    const r = this.#rect;
    let font = false;
    for (const band of this.#bandList) {
      if (!band.visible || this.#key(band.options.series) !== key) continue;
      const o = band.options;
      if (!projectTimeBand(o, tl, env, r)) continue;
      ctx.fillStyle = o.color ?? theme.annotationFill;
      ctx.fillRect(r.left, r.top, r.right - r.left, r.bottom - r.top);
      if (o.label) font = this.#areaLabel(ctx, theme, o.label, o.labelColor, font);
    }
    for (const zone of this.#zoneList) {
      if (!zone.visible || this.#key(zone.options.series) !== key) continue;
      const o = zone.options;
      // Priced like the bar it ends on (see `zoneFactor`), without a closure per frame.
      const factor = o.toTime === undefined ? 1 : this.#factor(key, o.toTime);
      if (!projectPriceZone(o, tl, env, r, factor)) continue;
      ctx.fillStyle = o.color ?? theme.annotationFill;
      ctx.fillRect(r.left, r.top, r.right - r.left, r.bottom - r.top);
      if (o.label) font = this.#areaLabel(ctx, theme, o.label, o.labelColor, font);
    }
  }

  /** The label of the area in the scratch rect, in its top-left corner. Returns that the font is set. */
  #areaLabel(ctx: CanvasRenderingContext2D, theme: ChartTheme, text: string, color: string | undefined, font: boolean): boolean {
    const r = this.#rect;
    if (!font) {
      ctx.font = this.#themeFont(theme);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.left, r.top, r.right - r.left, r.bottom - r.top);
    ctx.clip();
    ctx.fillStyle = color ?? theme.textMuted;
    fillText(ctx, text, r.left + INSET, r.top + INSET);
    ctx.restore();
    return true;
  }

  #themeFontCache: { theme: ChartTheme; font: string } | null = null;

  #themeFont(theme: ChartTheme): string {
    const c = this.#themeFontCache;
    if (c?.theme === theme) return c.font;
    const font = `${theme.fontSize}px ${theme.fontFamily}`;
    this.#themeFontCache = { theme, font };
    return font;
  }

  /** The host's price factor at `time` for target `key`, 1 without one. */
  #factor(key: Series | null, time: Time): number {
    return this.#host.priceFactor?.(key, time) ?? 1;
  }

  /** Text labels of target `key`: above the series and drawings. */
  #drawLabels(ctx: CanvasRenderingContext2D, env: PrimitiveEnv, key: Series | null): void {
    const theme = env.theme;
    const tl = this.#host.timeline;
    const r = this.#rect;
    const a = this.#anchor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const label of this.#labelList) {
      if (!label.visible || this.#key(label.options.series) !== key) continue;
      const o = label.options;
      const m = this.#measure(ctx, label, theme);
      if (!projectTextLabel(o, m.width, m.size, tl, env, r, a, this.#factor(key, o.time))) continue;
      const background = o.background ?? theme.labelBackground;
      if (o.pointerLength !== 0) {
        ctx.strokeStyle = background;
        ctx.lineWidth = 1;
        ctx.beginPath();
        // A pixel-aligned vertical line from the anchor to the box.
        const x = Math.round(a.x * env.pixelRatio) / env.pixelRatio + 0.5 / env.pixelRatio;
        ctx.moveTo(x, a.y);
        ctx.lineTo(x, o.pointerLength > 0 ? r.bottom : r.top);
        ctx.stroke();
      }
      ctx.fillStyle = background;
      ctx.fillRect(r.left, r.top, r.right - r.left, r.bottom - r.top);
      ctx.font = m.font;
      ctx.fillStyle = o.color ?? theme.labelText;
      fillText(ctx, o.text, r.left + LABEL_PAD_X, (r.top + r.bottom) / 2);
    }
  }

  /** Font and text width of a label, measured once per text and font. */
  #measure(ctx: CanvasRenderingContext2D, label: TextLabel, theme: ChartTheme): NonNullable<TextLabel['metrics']> {
    const size = label.options.fontSize ?? theme.fontSize;
    const m = label.metrics;
    if (m && m.size === size && m.family === theme.fontFamily) return m;
    const font = `${size}px ${theme.fontFamily}`;
    ctx.font = font;
    const next = { font, size, family: theme.fontFamily, width: ctx.measureText(label.options.text).width };
    label.metrics = next;
    return next;
  }

  /** The zone colour made opaque, so its axis labels read; cached per colour. */
  axisColor(zone: PriceZone): string {
    const color = zone.options.color ?? this.#host.theme.annotationFill;
    const c = zone.axisColor;
    if (c?.from === color) return c.solid;
    let solid = color;
    try {
      const [r, g, b] = parseColor(color);
      solid = `rgb(${r}, ${g}, ${b})`;
    } catch {
      // Not a colour the parser knows: use it as given.
    }
    zone.axisColor = { from: color, solid };
    return solid;
  }
}

function layerOf(item: ZoneItem): 'below' | 'top' {
  return item instanceof TextLabel ? 'top' : 'below';
}

export type { ZoneHandle };
