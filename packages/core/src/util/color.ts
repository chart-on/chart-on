import { clampNum } from './math';
import { isDev } from './dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };
/** RGBA with each channel in 0..255. */
export type Rgba = [number, number, number, number];

const cache = new Map<string, Rgba>();
/** Entries before the parse cache starts over: per-bar colours can bring any number of strings. */
const CACHE_LIMIT = 1024;
let probe: CanvasRenderingContext2D | null | undefined;

function parseHex(hex: string): Rgba | null {
  const h = hex.slice(1);
  const expand = h.length === 3 || h.length === 4;
  const full = expand ? [...h].map((c) => c + c).join('') : h;
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(full)) return null;
  const n = (i: number) => parseInt(full.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), full.length === 8 ? n(6) : 255];
}

function parseRgb(color: string): Rgba | null {
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(color);
  if (!m) return null;
  const alphaRaw = m[4];
  let alpha = 1;
  if (alphaRaw !== undefined) {
    alpha = alphaRaw.endsWith('%') ? parseFloat(alphaRaw) / 100 : parseFloat(alphaRaw);
  }
  return [Number(m[1]), Number(m[2]), Number(m[3]), Math.round(clampNum(alpha, 0, 1) * 255)];
}

/** Resolve named/other CSS colors through a canvas when running in a browser. */
function parseViaCanvas(color: string): Rgba | null {
  if (probe === undefined) {
    probe = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  }
  if (!probe) return null;
  probe.fillStyle = '#000';
  probe.fillStyle = color;
  const normalized = String(probe.fillStyle);
  return normalized.startsWith('#') ? parseHex(normalized) : parseRgb(normalized);
}

/**
 * RGBA channels (0..255) of a CSS colour: hex or `rgb()` / `rgba()`, or in
 * browsers any colour a canvas reads. Throws when it cannot read the colour; in
 * browsers an unreadable one can come back black, so validate with `isColor`.
 */
export function parseColor(color: string): Rgba {
  const cached = cache.get(color);
  if (cached) return cached;
  const trimmed = color.trim();
  const rgba =
    (trimmed.startsWith('#') ? parseHex(trimmed) : parseRgb(trimmed)) ?? parseViaCanvas(trimmed);
  if (!rgba) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Unsupported color: ${color}` : '');
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(color, rgba);
  return rgba;
}

/**
 * Colors that depend on where they are used, which a canvas resolves to
 * black: `currentColor`, `light-dark()`, custom properties and CSS-wide keywords.
 */
const CONTEXT_COLOR = /currentcolor|light-dark\(|var\(|^\s*(inherit|initial|unset|revert|revert-layer)\s*$/i;

/** True for a color both the canvas and the WebGL layer can use, e.g. to validate saved or user input. */
export function isColor(value: string): boolean {
  if (CONTEXT_COLOR.test(value)) return false;
  // In browsers `parseColor` maps anything it cannot read to black, so ask CSS first.
  const css = typeof CSS === 'undefined' ? undefined : CSS;
  if (css?.supports && !css.supports('color', value)) return false;
  try {
    parseColor(value);
    return true;
  } catch {
    return false;
  }
}

/** A colour as straight RGBA in 0..1, for shader uniforms. */
export function unitColor(color: string): [number, number, number, number] {
  const [r, g, b, a] = parseColor(color);
  return [r / 255, g / 255, b / 255, a / 255];
}

/** `color` as an `rgba()` string with its own alpha multiplied by `alpha` (0 to 1). */
export function withAlpha(color: string, alpha: number): string {
  const [r, g, b, a] = parseColor(color);
  return `rgba(${r}, ${g}, ${b}, ${((a / 255) * alpha).toFixed(3)})`;
}

/**
 * The opaque colour `t` of the way from `from` to `to` (0 is `from`, 1 is `to`),
 * mixed per sRGB channel, as `#rrggbb`. Opacity is ignored.
 */
export function mixColors(from: string, to: string, t: number): string {
  const a = parseColor(from);
  const b = parseColor(to);
  const f = clampNum(t, 0, 1);
  const channel = (i: number) => Math.round(a[i]! + (b[i]! - a[i]!) * f).toString(16).padStart(2, '0');
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

/** Black or white, whichever contrasts more with `background` (WCAG relative luminance). */
export function contrastText(background: string): string {
  const [r, g, b] = parseColor(background);
  // Contrast with black, (L + 0.05) / 0.05, beats white, 1.05 / (L + 0.05), above L ≈ 0.179.
  return luminance(r, g, b) > 0.179 ? '#000000' : '#ffffff';
}

/**
 * WCAG contrast ratio of `foreground` on `background`, from 1 to 21. A
 * translucent foreground is blended over the background first; the
 * background's own opacity is ignored, as nothing is known about what is under it.
 * Throws, like `parseColor`, for a colour it cannot read; check with `isColor` first.
 */
export function contrastRatio(foreground: string, background: string): number {
  const [br, bg, bb] = parseColor(background);
  const [fr, fg, fb, fa] = parseColor(foreground);
  const a = fa / 255;
  const mix = (f: number, b: number) => f * a + b * (1 - a);
  const lf = luminance(mix(fr, br), mix(fg, bg), mix(fb, bb));
  const lb = luminance(br, bg, bb);
  return (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
}

/** WCAG relative luminance of an sRGB colour, channels 0..255 (out-of-range channels are clamped). */
function luminance(r: number, g: number, b: number): number {
  const c = (v: number) => linear(clampNum(v, 0, 255));
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}

function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Linear-interpolated RGBA lookup table from evenly spaced color stops. */
export function buildLut(stops: readonly string[], size = 256): Uint8Array {
  if (stops.length === 0) throw new Error(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'buildLut needs at least one color stop' : '');
  const colors = stops.map(parseColor);
  const lut = new Uint8Array(size * 4);
  const segments = Math.max(1, colors.length - 1);
  for (let i = 0; i < size; i++) {
    const t = size === 1 ? 0 : (i / (size - 1)) * segments;
    const k = Math.min(Math.floor(t), segments - 1);
    const f = colors.length === 1 ? 0 : t - k;
    const a = colors[Math.min(k, colors.length - 1)]!;
    const b = colors[Math.min(k + 1, colors.length - 1)]!;
    for (let c = 0; c < 4; c++) {
      lut[i * 4 + c] = Math.round(a[c]! + (b[c]! - a[c]!) * f);
    }
  }
  return lut;
}
