import { backgroundFill, type Chart, type ChartOptions, type ScreenshotOptions } from './chart';
import type { RenderBackend } from './gl/backend';
import { drawLegend, type LegendFrame } from './legend';
import { darkTheme, lightTheme, resolveTheme, type ChartTheme } from './theme';
import type { Timeline } from './timeline';
import { fillText, fontCss, resolveFont } from './typography';
import { isColor } from './util/color';

// `chart.captureImage`: every layer of the chart drawn into one image, with an optional caption,
// padding, background and theme. The `imageCapture()` plugin gives the chart this, so a chart
// without it leaves it out.

/** @internal The chart's own steps a capture needs, which plugin code cannot reach. */
export interface CaptureHost {
  /** Draw the layers with `theme`, without the side effects of `applyOptions`. */
  useTheme(theme: ChartTheme): void;
  /** Size the canvases for `dpr`, and the GPU layer for `glDpr`. */
  sizeCanvases(dpr: number, glDpr: number): void;
  /** The legend as drawn at bar `index` (default: the one the legend shows). */
  legendFrame(index?: number): LegendFrame;
  /** Lay the panes and axes out again. */
  layout(): void;
  /** The crosshair layer needs drawing. */
  cursorDirty(): void;
  /** Draw the attribution in chart css px, where the badge sits (`features.attributionLogo`). */
  drawAttribution(ctx: CanvasRenderingContext2D): void;
}

/** The chart members a capture reads and sets: TypeScript-private, so reached through this view. */
interface CaptureChart {
  destroyed: boolean;
  width: number;
  height: number;
  dpr: number;
  theme: ChartTheme;
  options: ChartOptions;
  timeline: Timeline;
  renderer: RenderBackend;
  paused: boolean;
  settle(): void;
  axisWidths: { left: number; right: number };
  axisMeasured: boolean;
  glDprCap: number;
  hideCrosshair: boolean;
  capture: { watermark: boolean; drawings: boolean; annotations: boolean; background: string; dpr: number } | null;
  sceneDirty: boolean;
  overlayDirty: boolean;
  render(dt: number): boolean;
  bottom: HTMLCanvasElement;
  glCanvas: HTMLCanvasElement;
  top: HTMLCanvasElement;
  cursorLayer: HTMLCanvasElement | null;
  crosshair: unknown;
}

/** A screenshot's header line: its text, CSS font and height in CSS pixels. */
interface CaptionLayout {
  text: string;
  font: string;
  height: number;
}

/** The caption across `width` CSS pixels, vertically centred and squeezed to fit rather than cut. */
function drawCaption(ctx: CanvasRenderingContext2D, caption: CaptionLayout, width: number, color: string): void {
  const inset = 8;
  ctx.font = caption.font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  fillText(ctx, caption.text, inset, caption.height / 2, Math.max(1, width - 2 * inset));
}

/** Longest side of a screenshot in pixels; larger requests are scaled down to fit. */
const MAX_SCREENSHOT_SIDE = 8192;

/** Image pixels per CSS pixel for a screenshot of `width` by `height` CSS pixels. */
function screenshotRatio(scale: number | undefined, dpr: number, width: number, height: number): number {
  const wanted = scale !== undefined && Number.isFinite(scale) && scale > 0 ? scale : dpr;
  return Math.min(wanted, MAX_SCREENSHOT_SIDE / Math.max(1, width, height));
}

/** @internal All layers of `chart` drawn into one fresh canvas, in the current task (`chart.captureImage`). */
export function compositeImage(chart: Chart, host: CaptureHost, options: ScreenshotOptions): HTMLCanvasElement | null {
  const c = chart as unknown as CaptureChart;
  if (c.destroyed || c.width === 0 || c.height === 0 || c.renderer.isLost) return null;
  // A paused chart shows animations nobody watched at their end, as it will when shown.
  if (c.paused) c.settle();
  const pad = options.padding !== undefined && Number.isFinite(options.padding) && options.padding > 0 ? options.padding : 0;
  // Another theme's fonts may widen the auto axes; the screen gets its own widths back after.
  const live = { theme: c.theme, dpr: c.dpr, axisWidths: { ...c.axisWidths }, axisMeasured: c.axisMeasured };
  const theme = options.theme === undefined ? live.theme : captureTheme(c.theme, options.theme);
  const swap = theme !== live.theme;
  const caption = captionLayout(chart, options.caption, theme);
  const fullWidth = c.width + 2 * pad;
  const fullHeight = c.height + 2 * pad + (caption?.height ?? 0);
  const ratio = screenshotRatio(options.scale, live.dpr, fullWidth, fullHeight);
  const out = document.createElement('canvas');
  out.width = Math.round(fullWidth * ratio);
  out.height = Math.round(fullHeight * ratio);
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  // With padding, a caption or another background the image paints the background once, under
  // transparent layers, so a translucent one is not doubled where the chart is.
  const paint = pad > 0 || caption !== null || options.background !== undefined;
  const background = screenshotBackground(options.background, theme);
  // Above the screen's ratio the layers are redrawn larger, then sized back for the screen.
  // Low-power mode caps only the screen's GPU layer, so the image gets the ratio it would without it.
  const glRatio = ratio > live.dpr ? ratio : Math.min(ratio, c.options.maxGlDpr);
  const boost = ratio > live.dpr || glRatio > Math.min(live.dpr, c.glDprCap);
  // The GL buffer is not preserved after it is shown, so redraw and copy it in this same task.
  // Rendering may emit pending view and price scale events, as a frame would.
  // Without the crosshair the image shows the newest bar, as an idle chart does.
  const hide = !options.crosshair;
  c.hideCrosshair = hide;
  c.capture = {
    watermark: options.watermark ?? true,
    drawings: options.drawings ?? true,
    annotations: options.annotations ?? true,
    background: paint ? 'transparent' : theme.background,
    dpr: live.dpr,
  };
  try {
    if (swap) host.useTheme(theme);
    if (boost) host.sizeCanvases(ratio, glRatio);
    c.sceneDirty = true;
    c.render(0);
    if (paint && background !== 'transparent') {
      ctx.fillStyle = backgroundFill(ctx, background, theme, out.height);
      ctx.fillRect(0, 0, out.width, out.height);
    }
    const left = Math.round(pad * ratio);
    const top = Math.round((pad + (caption?.height ?? 0)) * ratio);
    if (caption) {
      ctx.setTransform(ratio, 0, 0, ratio, left, Math.round(pad * ratio));
      drawCaption(ctx, caption, c.width, theme.text);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    const width = Math.round(c.width * ratio);
    const height = Math.round(c.height * ratio);
    for (const layer of [c.bottom, c.glCanvas, c.top, c.cursorLayer]) {
      if (layer) ctx.drawImage(layer, left, top, width, height);
    }
    if (options.legend ?? c.options.legend.visible) {
      ctx.setTransform(ratio, 0, 0, ratio, left, top);
      drawLegend(ctx, hide ? { ...host.legendFrame(c.timeline.lastIndex), idle: true } : host.legendFrame());
    }
    // The badge is a link, not part of a layer: an image names the site instead.
    if (c.capture.watermark && c.options.features.attributionLogo) {
      ctx.setTransform(ratio, 0, 0, ratio, left, top);
      host.drawAttribution(ctx);
    }
  } finally {
    c.hideCrosshair = false;
    c.capture = null;
    if (swap) {
      host.useTheme(live.theme);
      c.axisWidths = live.axisWidths;
      c.axisMeasured = live.axisMeasured;
      host.layout();
    }
    if (boost) host.sizeCanvases(live.dpr, Math.min(live.dpr, c.glDprCap));
  }
  // Put the screen back before the browser paints: its canvas sizes, background, theme and
  // watermark need the whole scene, drawings and annotations the overlay, the crosshair only its layer.
  if (boost || paint || swap || options.watermark === false) {
    c.sceneDirty = true;
    c.render(0);
  } else if (options.drawings === false || options.annotations === false) {
    c.overlayDirty = true;
    c.render(0);
  } else if (hide && c.crosshair) {
    if (c.cursorLayer) host.cursorDirty();
    else c.overlayDirty = true;
    c.render(0);
  }
  return out;
}

/** The theme a screenshot's `theme` option asks for; the named ones keep the chart's fonts. */
function captureTheme(live: ChartTheme, option: ChartTheme | 'light' | 'dark'): ChartTheme {
  if (option !== 'light' && option !== 'dark') return resolveTheme(option);
  const { fontFamily, fontSize, typography } = live;
  return { ...(option === 'light' ? lightTheme : darkTheme), fontFamily, fontSize, typography };
}

/** The caption a screenshot's `caption` option asks for, with its font and height, or null. */
function captionLayout(chart: Chart, option: boolean | string | undefined, theme: ChartTheme): CaptionLayout | null {
  if (option === undefined || option === false) return null;
  const text = typeof option === 'string' ? option : captionText(chart);
  if (text === '') return null;
  const font = resolveFont(theme, 'legend');
  return { text, font: fontCss(font, font.fontSize, 600), height: Math.ceil(font.fontSize * 2.2) };
}

/** The default caption: symbol, interval, the newest bar's values and the time now, in the chart timezone. */
function captionText(chart: Chart): string {
  const data = chart.data;
  const main = chart.main;
  const parts: string[] = [];
  const symbol = data?.symbol?.name || main?.options.title;
  if (symbol) parts.push(symbol);
  if (data?.interval) parts.push(data.interval);
  const values = main?.legend(chart.timeline.lastIndex)?.parts ?? [];
  if (values.length > 0) parts.push(values.map((p) => (p.label ? `${p.label} ${p.text}` : p.text)).join(' '));
  const zone = chart.zone;
  const now = Math.floor(Date.now() / 1000);
  parts.push(`${chart.localization.dateTime(zone.date(now), false)} ${zone.isUtc ? 'UTC' : zone.name}`);
  return parts.join(' · ');
}

/** The color a screenshot fills behind the chart: `'transparent'`, a readable color, else the theme's. */
function screenshotBackground(background: string | undefined, theme: ChartTheme): string {
  if (background === 'transparent') return background;
  return background !== undefined && isColor(background) ? background : theme.background;
}
