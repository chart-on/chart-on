import { isColor, withAlpha } from './util/color';
import { resolveCssVars, splitCssList, type CssPropertyReader } from './util/css';
import { typographyFromCss, type ChartTypography } from './typography';

/**
 * Colours and fonts the chart draws with: background, grid, text, crosshair, up
 * and down colours, drawings, annotations and more. See `darkTheme` and
 * `themeFromCss`.
 */
export interface ChartTheme {
  background: string;
  /**
   * Bottom color of a vertical background gradient: the canvas fades from
   * `background` at the top to this at the bottom. Unset, the background is
   * solid. Text halos and label pills keep using `background`.
   */
  backgroundBottom?: string;
  grid: string;
  /** Horizontal and vertical grid lines when they differ from `grid`; optional. */
  gridHorizontal?: string;
  gridVertical?: string;
  separator: string;
  text: string;
  textMuted: string;
  fontFamily: string;
  fontSize: number;
  /**
   * Font weight, numerals and per-surface fonts (axis, legend, labels, drawings,
   * watermark, markers). Optional: unset, every surface uses `fontFamily` and
   * `fontSize` with tabular numerals.
   */
  typography?: ChartTypography;
  crosshair: string;
  labelBackground: string;
  labelText: string;
  up: string;
  down: string;
  /** Candle wicks of rising and falling bars; default to `up` / `down`. */
  upWick?: string;
  downWick?: string;
  /** Candle body outlines; no separate outline when unset. */
  upBorder?: string;
  downBorder?: string;
  /** Default line/area series color. */
  line: string;
  drawing: string;
  drawingSelected: string;
  drawingFill: string;
  /** Previous close and the visible high, low and average lines. */
  referenceLine: string;
  /** Bid line and label. */
  bid: string;
  /** Ask line and label. */
  ask: string;
  /** Depth lane bars on the bid and ask side; default to `bid` and `ask`. */
  depthBid?: string;
  depthAsk?: string;
  /** Price label outside the regular session (pre and post session). */
  extendedHours: string;
  /** Alert lines (`chart.annotations.addAlertLine`). */
  alert: string;
  /** Default colour of the data source's `timeAxis` markers (`DataSource.markers`); default `line`. */
  timeMark?: string;
  /** Default fill of time bands and price zones (`chart.annotations.addTimeBand`, `addPriceZone`); keep it translucent. */
  annotationFill: string;
  /** Heatmap color ramp, low → high intensity. */
  heatmap: string[];
  /** Watermark text, faint enough to sit behind the series. */
  watermark: string;
  /**
   * Named level colors a drawing level can pick (`{ value: 0.618, color: 'levelGreen' }`)
   * to follow the theme. The built-in tools' default levels do not use them:
   * those take the shared level rule (`levelColor`), which derives every
   * level's color from `text`, `drawing` and `background`. The names stay so
   * levels that pick one, such as saved drawings, keep their color. Optional:
   * a level whose color is unset here takes the drawing's color, and a theme
   * without `levelNeutral` draws rule levels in the drawing's color too.
   */
  levelNeutral?: string;
  levelRed?: string;
  levelOrange?: string;
  levelGreen?: string;
  levelBlue?: string;
  levelPurple?: string;
}

/**
 * Heatmap ramps, low → high. Each starts as a faint accent tint of its canvas, so sparse
 * cells fade into the background, and moves steadily away from the canvas in lightness
 * (brighter on dark, darker on light), so intensity still reads in greyscale. The hues
 * pass through the accent and the up color's family and avoid the down color.
 */
const DARK_HEATMAP = ['#211e36', '#493088', '#6656d7', '#2ea4dc', '#48dcc1', '#fced95'];
const LIGHT_HEATMAP = ['#f3f2fe', '#abe6e9', '#51cbbd', '#2c90d7', '#5f3ed8', '#541b81'];
/** The original ramp, kept for the neutral theme. */
const NEUTRAL_HEATMAP = ['#1e1b4b', '#6d28d9', '#0891b2', '#22d3ee', '#a3e635', '#facc15'];
const SANS = 'system-ui, ui-sans-serif, sans-serif';

/** Default dark theme. */
export const darkTheme: ChartTheme = {
  background: '#121217',
  grid: 'rgba(36, 36, 45, 0.6)',
  separator: '#23232b',
  text: '#babac6',
  textMuted: '#8b8b99',
  fontFamily: SANS,
  fontSize: 12,
  crosshair: 'rgba(150, 150, 166, 0.75)',
  labelBackground: '#2f2f39',
  labelText: '#ffffff',
  up: '#3cc4a0',
  down: '#e8574a',
  line: '#8b75ff',
  drawing: '#8b75ff',
  drawingSelected: '#e6e6ec',
  drawingFill: 'rgba(139, 117, 255, 0.12)',
  referenceLine: '#8b8b99',
  bid: '#3d8bfd',
  ask: '#e8574a',
  depthBid: 'rgba(61, 139, 253, 0.35)',
  depthAsk: 'rgba(232, 87, 74, 0.35)',
  extendedHours: '#e0a030',
  alert: '#f0a73a',
  annotationFill: 'rgba(61, 139, 253, 0.12)',
  heatmap: DARK_HEATMAP,
  watermark: 'rgba(186, 186, 198, 0.09)',
  levelNeutral: '#8b8b99',
  levelRed: '#f06a5d',
  levelOrange: '#eda23c',
  levelGreen: '#3fcf6e',
  levelBlue: '#4c9aff',
  levelPurple: '#a98bff',
};

/** Light theme. */
export const lightTheme: ChartTheme = {
  background: '#ffffff',
  grid: 'rgba(241, 241, 245, 1)',
  separator: '#e5e5eb',
  text: '#15151b',
  textMuted: '#696977',
  fontFamily: SANS,
  fontSize: 12,
  crosshair: 'rgba(120, 120, 136, 0.8)',
  labelBackground: '#15151b',
  labelText: '#ffffff',
  up: '#0f8268',
  down: '#c9412f',
  line: '#5f43e6',
  drawing: '#5f43e6',
  drawingSelected: '#15151b',
  drawingFill: 'rgba(95, 67, 230, 0.1)',
  referenceLine: '#696977',
  bid: '#1d63d8',
  ask: '#c9412f',
  depthBid: 'rgba(29, 99, 216, 0.28)',
  depthAsk: 'rgba(201, 65, 47, 0.28)',
  extendedHours: '#a8650a',
  alert: '#a35c00',
  annotationFill: 'rgba(29, 99, 216, 0.1)',
  heatmap: LIGHT_HEATMAP,
  watermark: 'rgba(21, 21, 27, 0.07)',
  levelNeutral: '#6e6e7c',
  levelRed: '#cf3f2e',
  levelOrange: '#b0650a',
  levelGreen: '#17904a',
  levelBlue: '#2563d9',
  levelPurple: '#7a4ee0',
};

/** Neutral graphite palette (the original look). */
export const neutralTheme: ChartTheme = {
  background: '#101010',
  grid: 'rgba(255, 255, 255, 0.05)',
  separator: '#222222',
  text: '#b4b4b4',
  textMuted: '#636363',
  fontFamily: 'ui-monospace, monospace',
  fontSize: 11,
  crosshair: 'rgba(255, 255, 255, 0.32)',
  labelBackground: '#363636',
  labelText: '#ebebeb',
  up: '#10b981',
  down: '#f43f5e',
  line: '#38bdf8',
  drawing: '#38bdf8',
  drawingSelected: '#ebebeb',
  drawingFill: 'rgba(56, 189, 248, 0.12)',
  referenceLine: '#7a7a7a',
  bid: '#60a5fa',
  ask: '#f87171',
  depthBid: 'rgba(96, 165, 250, 0.3)',
  depthAsk: 'rgba(248, 113, 113, 0.3)',
  extendedHours: '#fbbf24',
  alert: '#f59e0b',
  annotationFill: 'rgba(96, 165, 250, 0.12)',
  heatmap: NEUTRAL_HEATMAP,
  watermark: 'rgba(255, 255, 255, 0.07)',
  levelNeutral: '#7a7a7a',
  levelRed: '#f87171',
  levelOrange: '#fbbf24',
  levelGreen: '#4ade80',
  levelBlue: '#60a5fa',
  levelPurple: '#c084fc',
};

/**
 * High-contrast ramps: the same lightness ordering as the default ones (away
 * from the canvas as intensity grows), with bigger steps.
 */
const HIGH_CONTRAST_DARK_HEATMAP = ['#1c1a3d', '#3d2fb0', '#2f6bff', '#00bfff', '#3dffb0', '#ffff70'];
const HIGH_CONTRAST_LIGHT_HEATMAP = ['#eef0ff', '#9fd4ff', '#3a9be6', '#1f58cc', '#3b1fc4', '#1e0559'];

/** Black canvas, white text and stronger lines, for users who need more contrast than `darkTheme`. */
export const highContrastDarkTheme: ChartTheme = {
  background: '#000000',
  grid: 'rgba(255, 255, 255, 0.16)',
  separator: '#6b6b6b',
  text: '#ffffff',
  textMuted: '#d4d4d4',
  fontFamily: SANS,
  fontSize: 12,
  crosshair: 'rgba(255, 255, 255, 0.9)',
  labelBackground: '#ffffff',
  labelText: '#000000',
  up: '#2ee59d',
  down: '#ff6b5e',
  line: '#b8a6ff',
  drawing: '#b8a6ff',
  drawingSelected: '#ffffff',
  drawingFill: 'rgba(184, 166, 255, 0.18)',
  referenceLine: '#d4d4d4',
  bid: '#66b3ff',
  ask: '#ff6b5e',
  depthBid: 'rgba(102, 179, 255, 0.5)',
  depthAsk: 'rgba(255, 107, 94, 0.5)',
  extendedHours: '#ffc04d',
  alert: '#ffb21f',
  annotationFill: 'rgba(102, 179, 255, 0.22)',
  heatmap: HIGH_CONTRAST_DARK_HEATMAP,
  watermark: 'rgba(255, 255, 255, 0.14)',
  levelNeutral: '#d4d4d4',
  levelRed: '#ff6b5e',
  levelOrange: '#ffb84d',
  levelGreen: '#4dea7c',
  levelBlue: '#66b3ff',
  levelPurple: '#c9b0ff',
};

/** White canvas, black text and stronger lines, for users who need more contrast than `lightTheme`. */
export const highContrastLightTheme: ChartTheme = {
  background: '#ffffff',
  grid: 'rgba(0, 0, 0, 0.14)',
  separator: '#7a7a7a',
  text: '#000000',
  textMuted: '#3b3b3b',
  fontFamily: SANS,
  fontSize: 12,
  crosshair: 'rgba(0, 0, 0, 0.85)',
  labelBackground: '#000000',
  labelText: '#ffffff',
  up: '#00694d',
  down: '#b3241b',
  line: '#3b1fc4',
  drawing: '#3b1fc4',
  drawingSelected: '#000000',
  drawingFill: 'rgba(59, 31, 196, 0.12)',
  referenceLine: '#3b3b3b',
  bid: '#0a4fb5',
  ask: '#b3241b',
  depthBid: 'rgba(10, 79, 181, 0.4)',
  depthAsk: 'rgba(179, 36, 27, 0.4)',
  extendedHours: '#7a4a00',
  alert: '#7a4100',
  annotationFill: 'rgba(10, 79, 181, 0.16)',
  heatmap: HIGH_CONTRAST_LIGHT_HEATMAP,
  watermark: 'rgba(0, 0, 0, 0.1)',
  levelNeutral: '#3b3b3b',
  levelRed: '#b3241b',
  levelOrange: '#8a4b00',
  levelGreen: '#0b6b2e',
  levelBlue: '#0a4fb5',
  levelPurple: '#5a2bc4',
};

/**
 * Rising and falling colours that stay apart for the common colour-vision
 * deficiencies (red-green and blue-yellow): blue for up, orange for down,
 * also differing in lightness. Merge the one for your canvas into any theme:
 * `applyOptions({ theme: colorSafeUpDown.dark })`. The ask line takes the
 * down colour, as in the default themes.
 */
export const colorSafeUpDown: Readonly<Record<'dark' | 'light', Partial<ChartTheme>>> = {
  dark: { up: '#4ba3ff', down: '#ff9a1f', ask: '#ff9a1f', depthAsk: 'rgba(255, 154, 31, 0.35)' },
  light: { up: '#1a62c9', down: '#c25a00', ask: '#c25a00', depthAsk: 'rgba(194, 90, 0, 0.28)' },
};

/** The `ChartTheme` keys that hold one color: the names a color field may use to follow the theme. */
export type ThemeColorKey = Exclude<keyof ChartTheme, 'fontFamily' | 'fontSize' | 'heatmap' | 'typography'>;

const NOT_COLORS = new Set<string>(['fontFamily', 'fontSize', 'heatmap']);

/** Whether `name` is a `ThemeColorKey`. */
export function isThemeColorKey(name: string): name is ThemeColorKey {
  return Object.prototype.hasOwnProperty.call(chartThemeTokens, name) && !NOT_COLORS.has(name);
}

/**
 * The color `color` stands for: the theme's value when it names a theme color
 * (`'levelGreen'`, `'up'`), else `color` itself. `undefined` when it is unset or
 * names a theme color the theme leaves unset, so callers fall back with `??`.
 */
export function resolveThemeColor(color: string | undefined, theme: ChartTheme): string | undefined {
  return color !== undefined && isThemeColorKey(color) ? theme[color] : color;
}

/**
 * System colours (CSS `<system-color>` keywords) each theme colour takes in
 * forced-colours mode. Up is `LinkText` and down `CanvasText`, the one pair
 * every high-contrast palette keeps apart; pair them with the `hollowDown`
 * candle option so direction also reads from shape.
 */
const FORCED_COLORS = {
  background: 'Canvas',
  separator: 'CanvasText',
  text: 'CanvasText',
  textMuted: 'CanvasText',
  crosshair: 'CanvasText',
  labelBackground: 'Highlight',
  labelText: 'HighlightText',
  up: 'LinkText',
  down: 'CanvasText',
  line: 'LinkText',
  drawing: 'LinkText',
  drawingSelected: 'Highlight',
  referenceLine: 'GrayText',
  bid: 'LinkText',
  ask: 'CanvasText',
  extendedHours: 'GrayText',
  alert: 'Highlight',
} as const satisfies Partial<Record<keyof ChartTheme, string>>;

/** Theme level colours; forced-colours mode drops them, as no system colour fits each hue. */
const LEVEL_COLORS = ['levelNeutral', 'levelRed', 'levelOrange', 'levelGreen', 'levelBlue', 'levelPurple'] as const;

/** Each system colour as the browser resolves it now, or null without a DOM to ask. */
function readSystemColors(container: Element): Map<string, string> | null {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return null;
  const probe = document.createElement('span');
  // `none`, so the browser does not force the probe's own colour while it is read.
  Object.assign(probe.style, { position: 'absolute', visibility: 'hidden', forcedColorAdjust: 'none' });
  container.append(probe);
  const colors = new Map<string, string>();
  for (const name of new Set(Object.values(FORCED_COLORS))) {
    probe.style.color = name;
    const value = getComputedStyle(probe).color;
    if (value && isColor(value)) colors.set(name, value);
  }
  probe.remove();
  return colors.size > 0 ? colors : null;
}

/**
 * `base` recoloured with the system colours of forced-colours mode (a
 * high-contrast setting of the operating system), resolved to concrete values
 * the canvas can draw: `Canvas` background, `CanvasText` text, scales and
 * falling bars, `LinkText` rising bars and lines, `Highlight` for labels,
 * selection and alerts. Grid, watermark and heatmap are `CanvasText` at lower
 * opacity. Fonts come from `base`; separate wick and outline colours and the
 * drawing level colours are dropped, so levels draw in the drawing colour. Returns null when the colours cannot be read (no DOM). Apply it
 * while `matchMedia('(forced-colors: active)')` matches; the UI shell does.
 * `container` is where the colours are read, default `document.body`.
 */
export function forcedColorsTheme(base: ChartTheme = darkTheme, container?: Element): ChartTheme | null {
  const host = container ?? (typeof document === 'undefined' ? null : document.body);
  const colors = host ? readSystemColors(host) : null;
  if (!colors) return null;
  const theme: ChartTheme = { ...base, upWick: undefined, downWick: undefined, upBorder: undefined, downBorder: undefined };
  for (const key of LEVEL_COLORS) theme[key] = undefined;
  for (const [key, name] of Object.entries(FORCED_COLORS) as [keyof typeof FORCED_COLORS, string][]) {
    const value = colors.get(name);
    if (value) theme[key] = value;
  }
  const ink = colors.get('CanvasText');
  if (ink) {
    theme.grid = withAlpha(ink, 0.25);
    theme.gridHorizontal = undefined;
    theme.gridVertical = undefined;
    theme.watermark = withAlpha(ink, 0.15);
    theme.heatmap = [0.15, 0.45, 0.75, 1].map((alpha) => withAlpha(ink, alpha));
  }
  const highlight = colors.get('Highlight');
  if (highlight) {
    theme.drawingFill = withAlpha(highlight, 0.2);
    theme.annotationFill = withAlpha(highlight, 0.15);
  }
  return theme;
}

/** A complete theme: `partial` laid over `darkTheme`. */
export function resolveTheme(partial?: Partial<ChartTheme>): ChartTheme {
  return { ...darkTheme, ...partial };
}

/**
 * CSS custom property that sets each `ChartTheme` key, read by `themeFromCss`.
 * `typography` has no single token; see `chartTypographyTokens`.
 */
export const chartThemeTokens: Readonly<Record<Exclude<keyof ChartTheme, 'typography'>, string>> = {
  background: '--pc-chart-bg',
  backgroundBottom: '--pc-chart-bg-bottom',
  grid: '--pc-chart-grid',
  gridHorizontal: '--pc-chart-grid-h',
  gridVertical: '--pc-chart-grid-v',
  separator: '--pc-chart-separator',
  text: '--pc-chart-text',
  textMuted: '--pc-chart-text-muted',
  fontFamily: '--pc-chart-font',
  fontSize: '--pc-chart-font-size',
  crosshair: '--pc-chart-crosshair',
  labelBackground: '--pc-chart-label-bg',
  labelText: '--pc-chart-label-text',
  up: '--pc-up',
  down: '--pc-down',
  upWick: '--pc-up-wick',
  downWick: '--pc-down-wick',
  upBorder: '--pc-up-border',
  downBorder: '--pc-down-border',
  line: '--pc-line-series',
  drawing: '--pc-drawing',
  drawingSelected: '--pc-drawing-selected',
  drawingFill: '--pc-drawing-fill',
  referenceLine: '--pc-chart-reference-line',
  bid: '--pc-bid',
  ask: '--pc-ask',
  depthBid: '--pc-depth-bid',
  depthAsk: '--pc-depth-ask',
  extendedHours: '--pc-extended-hours',
  alert: '--pc-alert',
  timeMark: '--pc-time-mark',
  annotationFill: '--pc-annotation-fill',
  heatmap: '--pc-heatmap',
  watermark: '--pc-chart-watermark',
  levelNeutral: '--pc-level-neutral',
  levelRed: '--pc-level-red',
  levelOrange: '--pc-level-orange',
  levelGreen: '--pc-level-green',
  levelBlue: '--pc-level-blue',
  levelPurple: '--pc-level-purple',
};

/**
 * Build a theme from the chart tokens (`chartThemeTokens`) on an element, read through its
 * computed style, or from any `getPropertyValue` reader. A token that is missing or not a
 * usable value keeps the `fallback` theme's value.
 */
export function themeFromCss(source: Element | CssPropertyReader, fallback: ChartTheme = darkTheme): ChartTheme {
  const style = 'getPropertyValue' in source ? source : getComputedStyle(source);
  const theme: ChartTheme = { ...fallback };
  for (const key of Object.keys(chartThemeTokens) as (keyof typeof chartThemeTokens)[]) {
    const value = resolveCssVars(style.getPropertyValue(chartThemeTokens[key]), style);
    if (!value) continue;
    if (key === 'fontFamily') {
      theme.fontFamily = value;
    } else if (key === 'fontSize') {
      const px = /^(\d*\.?\d+)(px)?$/i.exec(value);
      if (px && Number(px[1]) > 0) theme.fontSize = Number(px[1]);
    } else if (key === 'heatmap') {
      const stops = splitCssList(value);
      if (stops.length > 0 && stops.every(isColor)) theme.heatmap = stops;
    } else if (isColor(value)) {
      theme[key] = value;
    }
  }
  const typography = typographyFromCss(style, fallback.typography);
  if (typography) theme.typography = typography;
  return theme;
}

