/**
 * Drawings, or an indicator, on the system clipboard, so a copy on one chart
 * pastes on another tab or after a reload. The copy, cut and paste shortcuts
 * run on the browser's own `copy`, `cut` and `paste` events, which hand over
 * the clipboard without a permission prompt.
 */
import type { ActionRegistry } from '../actions';
import type { Interval } from '../data/types';
import type { IndicatorSet } from '../indicators/sets';
import { isRecord } from '../util/records';
import type { Point, Time } from '../types';
import { readDrawings, type DrawingManager } from './manager';
import type { Drawing, DrawingPoint } from './types';

/** `kind` of a clipboard payload. */
export const CLIPBOARD_KIND = 'charton-drawings';
/** `kind` of a copied indicator on the clipboard. */
export const INDICATOR_CLIPBOARD_KIND = 'charton-indicator';
/** `version` of the clipboard payload this build writes. */
export const CLIPBOARD_VERSION = 1;

/** Where copied drawings came from, for placing them on another chart. */
export interface ClipboardSource {
  symbol: string | null;
  interval: Interval | null;
  visibleRange: { from: Time; to: Time } | null;
  /** The prices the main scale of each pane shows, and whether it is logarithmic. Missing in older payloads. */
  priceRanges?: (PriceWindow | null)[];
}

/** The lowest and highest price a scale shows, and whether it is logarithmic. */
export interface PriceWindow {
  min: number;
  max: number;
  log: boolean;
}

/**
 * How drawings pasted from another chart are placed: `'scaled'` sizes them to
 * this chart's window as they were to the source's and centres them on the
 * crosshair; `'framed'` keeps where they were in the source's window.
 */
export type PasteScaling = 'scaled' | 'framed';

/** Drawings as they travel on the clipboard: prices as the data source sent them, like `serialize()`. */
export interface ClipboardPayload {
  kind: typeof CLIPBOARD_KIND;
  version: number;
  items: Drawing[];
  source: ClipboardSource;
}

/** What a paste adds: the in-memory copies, a payload from another chart, an indicator set from one, an image, or a text note. */
export type PasteContent =
  | { kind: 'memory' }
  | { kind: 'payload'; payload: ClipboardPayload }
  | { kind: 'indicator'; set: unknown }
  | { kind: 'image'; file: Blob }
  | { kind: 'text'; text: string };

/** Longest text kept from a plain-text paste; text drawings are one line. */
const MAX_TEXT = 1000;

export function encodeClipboard(items: readonly Drawing[], source: ClipboardSource): string {
  const payload: ClipboardPayload = { kind: CLIPBOARD_KIND, version: CLIPBOARD_VERSION, items: [...items], source };
  return JSON.stringify(payload);
}

/** A copied indicator as clipboard text: `{ kind: 'charton-indicator', set }`, `set` as `serializeSet()` writes it. */
export function encodeIndicator(set: IndicatorSet): string {
  return JSON.stringify({ kind: INDICATOR_CLIPBOARD_KIND, set });
}

/**
 * The payload in clipboard text, or null when the text is not one this build
 * reads. Malformed drawings are left out, as `load()` does.
 */
export function parseClipboard(text: string): ClipboardPayload | null {
  const data = payloadJson(text);
  return data ? readPayload(data) : null;
}

/**
 * Decide what a paste adds from the clipboard text and the image file on it,
 * if a tool takes one. The in-memory copies win while the clipboard still
 * holds what this chart wrote, or holds nothing: they are exact, and the page
 * may not expose the clipboard. Otherwise a payload from another chart, then
 * the image, then plain text as a note. Null: nothing to add, including a
 * payload of a version this build cannot read.
 */
export function resolvePaste(text: string | null, written: string | null, image: Blob | null = null): PasteContent | null {
  if (text ? text === written : !image) return { kind: 'memory' };
  const data = text ? payloadJson(text) : null;
  // The chart validates the set when it adds it.
  if (data?.kind === INDICATOR_CLIPBOARD_KIND) return { kind: 'indicator', set: data.set };
  if (data) {
    const payload = readPayload(data);
    return payload ? { kind: 'payload', payload } : null;
  }
  if (image) return { kind: 'image', file: image };
  const note = text!.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  return note ? { kind: 'text', text: note } : null;
}

/**
 * Move the points of drawings pasted from the `from` chart into the window of
 * the `to` chart, as `scaling` says; `at` is the crosshair. An axis without a
 * window on both sides, or with a log scale on one side only, keeps its
 * values and is moved so the drawings centre on the crosshair.
 */
export function placeDrawings(list: readonly Drawing[], from: ClipboardSource, to: ClipboardSource, at: (DrawingPoint & { pane: number }) | null, scaling: PasteScaling): void {
  const scaled = scaling === 'scaled';
  const time = (s: ClipboardSource) => s.visibleRange && { min: s.visibleRange.from, max: s.visibleRange.to };
  fit(list.flatMap((d) => d.points), 'time', time(from), time(to), scaled, at?.time);
  for (const pane of new Set(list.map((d) => d.pane))) {
    const points = list.flatMap((d) => (d.pane === pane ? d.points : []));
    // Only the crosshair's pane moves to it.
    fit(points, 'price', from.priceRanges?.[pane], to.priceRanges?.[pane], pane === (at?.pane ?? 0) ? scaled : null, at?.price);
  }
}

type Window = { min: number; max: number; log?: boolean } | null | undefined;

/**
 * Map `key` of `points` from window `src` to window `dst` in scale
 * coordinates, then centre them on `target` (the middle of `dst` without one)
 * when `scaled`, or when there is no map. `scaled: null` never centres.
 */
function fit(points: DrawingPoint[], key: keyof DrawingPoint, src: Window, dst: Window, scaled: boolean | null, target?: number): void {
  if (!dst || points.length === 0) return;
  const coord = (w: NonNullable<Window>, v: number) => (w.log ? Math.log10(v) : v);
  const lo = coord(dst, dst.min);
  const span = coord(dst, dst.max) - lo;
  const mapped = src && !src.log === !dst.log && src.max > src.min ? src : null;
  const values = points.map((p) =>
    mapped ? lo + ((coord(mapped, p[key]) - coord(mapped, mapped.min)) / (coord(mapped, mapped.max) - coord(mapped, mapped.min))) * span : coord(dst, p[key]),
  );
  // A log window cannot hold prices at or below zero.
  if (!values.every(Number.isFinite)) return;
  const shift =
    scaled === null || (mapped && !scaled) ? 0 : (target === undefined ? lo + span / 2 : coord(dst, target)) - (Math.min(...values) + Math.max(...values)) / 2;
  points.forEach((p, i) => {
    const v = values[i]! + shift;
    p[key] = dst.log ? 10 ** v : v;
  });
}

/** The JSON object of a clipboard payload of any version, or null for other text. */
function payloadJson(text: string): Record<string, unknown> | null {
  if (!text.trimStart().startsWith('{')) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  return isRecord(data) && (data.kind === CLIPBOARD_KIND || data.kind === INDICATOR_CLIPBOARD_KIND) ? data : null;
}

function readPayload(data: Record<string, unknown>): ClipboardPayload | null {
  if (data.kind !== CLIPBOARD_KIND || data.version !== CLIPBOARD_VERSION || !Array.isArray(data.items)) return null;
  const { drawings } = readDrawings({ drawings: data.items });
  return { kind: CLIPBOARD_KIND, version: CLIPBOARD_VERSION, items: drawings, source: readSource(data.source) };
}

/** What the clipboard needs from the chart. */
export interface ClipboardHost {
  readonly root: HTMLElement;
  readonly actions: ActionRegistry;
  readonly drawings: DrawingManager;
  /** The chart's symbol, interval, visible range and price ranges now. */
  source(): ClipboardSource;
  /** Where a text note goes: the crosshair, or null for the middle of the main pane. */
  anchor(): (Point & { pane: number }) | null;
  /** The indicator the last copy took, which the clipboard then carries instead of the drawings. */
  indicator(): IndicatorSet | null;
  /** Add an indicator set another chart copied. */
  pasteIndicator(set: unknown): void;
}

/** A clipboard key, and the chart action of the same id it runs, which acts on the selected drawings or indicator. */
type ClipboardKey = 'copy' | 'cut' | 'paste';

/**
 * Runs the copy, cut and paste shortcuts through the clipboard events. The key
 * does the in-memory part and arms the event that follows it; a browser that
 * fires none still pastes the in-memory copies.
 */
export class DrawingClipboard {
  /** The text this chart last put on the clipboard. */
  #written: string | null = null;
  /** The event the last shortcut armed, until it arrives or the task ends. */
  #pending: ClipboardKey | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  #doc: Document | null;

  readonly #host: ClipboardHost;

  constructor(host: ClipboardHost) {
    this.#host = host;
    this.#doc = host.root.ownerDocument ?? null;
    this.#doc?.addEventListener('copy', this.#onCopy);
    this.#doc?.addEventListener('cut', this.#onCopy);
    this.#doc?.addEventListener('paste', this.#onPaste);
  }

  destroy(): void {
    this.#doc?.removeEventListener('copy', this.#onCopy);
    this.#doc?.removeEventListener('cut', this.#onCopy);
    this.#doc?.removeEventListener('paste', this.#onPaste);
    this.#doc = null;
    this.#disarm();
  }

  /**
   * Take a copy, cut or paste shortcut on the browser's own keys (Ctrl or Cmd
   * with C, X or V) when it would run the chart's `copy`, `cut` or `paste`. Returns true when
   * taken; the caller must leave its default alone, or the clipboard event
   * never comes.
   */
  key(e: KeyboardEvent): boolean {
    const kind = clipboardKey(e);
    if (!kind) return false;
    const { actions } = this.#host;
    // The action the shortcut would run, as `handleKey` picks it.
    const id = actions.match(e).find((a) => actions.get(a)?.enabled);
    if (id !== kind) return false;
    // Copy and cut act now; their event only writes what the action copied.
    if (kind !== 'paste' && !actions.run(id)) return false;
    this.#disarm();
    this.#pending = kind;
    // Clipboard events follow their key in the same task; past it, none is coming.
    this.timer = setTimeout(() => {
      const missed = this.#pending;
      this.#disarm();
      if (missed === 'paste') actions.run('paste');
    }, 0);
    return true;
  }

  #disarm(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.#pending = null;
  }

  /** The `copy` or `cut` event a shortcut armed. */
  #onCopy = (e: ClipboardEvent): void => {
    if (this.#pending !== e.type) return;
    this.#disarm();
    if (!e.clipboardData) return;
    const set = this.#host.indicator();
    const text = set ? encodeIndicator(set) : encodeClipboard(this.#host.drawings.clipboardItems(), this.#host.source());
    e.clipboardData.setData('text/plain', text);
    e.preventDefault();
    this.#written = text;
  };

  #onPaste = (e: ClipboardEvent): void => {
    if (this.#pending !== 'paste') return;
    this.#disarm();
    e.preventDefault();
    const { drawings } = this.#host;
    const tool = drawings.getTools().find((t) => t.pasteImage);
    const content = resolvePaste(e.clipboardData?.getData('text/plain') ?? null, this.#written, tool ? imageFile(e.clipboardData) : null);
    if (!content) return;
    if (content.kind === 'memory') this.#host.actions.run('paste');
    else if (content.kind === 'payload') {
      const { items, source } = content.payload;
      const scaling = drawings.pasteScaling;
      drawings.pasteItems(items, scaling && ((list, at) => placeDrawings(list, source, this.#host.source(), at, scaling)), this.#host.anchor());
    } else if (content.kind === 'indicator') this.#host.pasteIndicator(content.set);
    else if (content.kind === 'image') {
      const at = this.#host.anchor();
      // A file it declines, or a chart gone by the time the image is ready, adds nothing.
      tool!.pasteImage!(content.file).then(
        (got) => got && this.#doc && drawings.pasteImage(tool!.type, got.text, got.width, got.height, at),
        () => {},
      );
    } else drawings.pasteText(content.text, this.#host.anchor());
  };
}

/** The first file on the clipboard that says it is an image; its bytes are checked later. */
function imageFile(data: DataTransfer | null): File | null {
  return Array.from(data?.files ?? []).find((f) => f.type.startsWith('image/')) ?? null;
}

/** The clipboard event a key fires by default, if any. */
function clipboardKey(e: KeyboardEvent): ClipboardKey | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return null;
  const key = e.key.toLowerCase();
  return key === 'c' ? 'copy' : key === 'x' ? 'cut' : key === 'v' ? 'paste' : null;
}

function readSource(raw: unknown): ClipboardSource {
  const source = isRecord(raw) ? raw : {};
  const range = isRecord(source.visibleRange) ? source.visibleRange : null;
  return {
    symbol: typeof source.symbol === 'string' ? source.symbol : null,
    interval: typeof source.interval === 'string' ? (source.interval as Interval) : null,
    visibleRange: range && Number.isFinite(range.from) && Number.isFinite(range.to) ? { from: range.from as Time, to: range.to as Time } : null,
    priceRanges: Array.isArray(source.priceRanges) ? source.priceRanges.map(readWindow) : undefined,
  };
}

function readWindow(w: unknown): PriceWindow | null {
  return isRecord(w) && Number.isFinite(w.min) && Number.isFinite(w.max) ? { min: w.min as number, max: w.max as number, log: w.log === true } : null;
}


