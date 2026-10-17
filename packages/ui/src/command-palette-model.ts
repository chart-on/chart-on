/**
 * The DOM-free parts of the command palette: entry and source types, and the
 * fuzzy ranking that orders entries for a query.
 */
import { normalize, rankBy, words } from './picker-model';

/** One row of the command palette. */
export interface CommandEntry {
  /** Unique within its source. */
  id: string;
  label: string;
  /** Secondary text, e.g. an exchange or a group; searched with a lower weight. */
  description?: string;
  /** Other words that find the entry, e.g. abbreviations. */
  keywords?: readonly string[];
  /** Shortcut shown at the end of the row, in `chart.actions` form (`'Mod+Z'`). */
  shortcut?: string;
  /** For toggles: whether it is on. Leave out for plain commands. */
  checked?: boolean;
  /** Listed, but cannot run now. Disabled entries rank after the enabled ones. */
  disabled?: boolean;
  /** Do it. Called after the palette closed and gave focus back. */
  run(): void;
}

/**
 * Where the palette's entries come from. The palette lists `chart.actions`
 * itself; an app adds sources for anything else, e.g. symbols or indicators.
 */
export interface CommandSource {
  /** Unique among the palette's sources. */
  id: string;
  /** Category name in the palette, e.g. `Symbols`. */
  label: string;
  /**
   * The entries for `query` (empty when nothing is typed). A list the
   * palette filters and ranks itself, or a promise for a server-side search;
   * `signal` aborts when the query changes or the palette closes.
   */
  entries(query: string, signal: AbortSignal): readonly CommandEntry[] | Promise<readonly CommandEntry[]>;
  /** The source already filtered and ordered its entries for the query; the palette keeps them as they are. Default false. */
  ranked?: boolean;
}

/**
 * Characters of `text` skipped while finding `query`'s characters in order,
 * or null when they are not all there. Each character is taken at the
 * earliest position after the previous one; skips before the first do not count.
 */
function skipped(text: string, query: string): number | null {
  let at = -1;
  let gaps = 0;
  for (const ch of query) {
    const next = text.indexOf(ch, at + 1);
    if (next < 0) return null;
    if (at >= 0) gaps += next - at - 1;
    at = next;
  }
  return gaps;
}

/**
 * How well `text` matches `query` (both lower case): lower is better, null
 * for no match. In order: the whole text, its start, the start of a word,
 * the initials of its words, anywhere in it, and last its characters in
 * order with others between them (fewer skipped characters rank higher).
 */
export function fuzzyScore(text: string, query: string): number | null {
  if (!query) return 0;
  if (text === query) return 0;
  if (text.startsWith(query)) return 1;
  const parts = words(text);
  if (parts.some((w) => w.startsWith(query))) return 2;
  if (query.length > 1 && parts.map((w) => w[0]).join('').startsWith(query)) return 3;
  if (text.includes(query)) return 4;
  const gaps = skipped(text, query);
  // 5 to just under 6: the share of skipped characters among those read.
  return gaps === null ? null : 5 + gaps / (gaps + query.length);
}

/** Best score over the label, keywords and description; the other fields add a penalty, so label matches rank first. */
function fieldScore(entry: CommandEntry, query: string): number | null {
  let best: number | null = null;
  const consider = (text: string | undefined, penalty: number) => {
    if (!text) return;
    const score = fuzzyScore(text.toLowerCase(), query);
    if (score !== null && (best === null || score + penalty < best)) best = score + penalty;
  };
  consider(entry.label, 0);
  for (const k of entry.keywords ?? []) consider(k, 0.5);
  consider(entry.description, 1);
  return best;
}

/**
 * How well `entry` matches `query`: lower is better, null for no match. The
 * whole query is tried first; a query of several words also matches when
 * every word does, scored by its worst word.
 */
export function commandScore(entry: CommandEntry, query: string): number | null {
  const q = normalize(query);
  if (!q) return 0;
  const whole = fieldScore(entry, q);
  const parts = q.split(' ');
  if (parts.length < 2) return whole;
  let worst = 0;
  for (const part of parts) {
    const score = fieldScore(entry, part);
    if (score === null) return whole;
    worst = Math.max(worst, score);
  }
  // Matching word by word ranks just after the same quality of whole-query match.
  const split = worst + 0.25;
  return whole === null ? split : Math.min(whole, split);
}

/**
 * The entries matching `query`, best first: enabled entries before disabled
 * ones, then by score; equal entries keep their order. An empty query keeps
 * every entry, enabled ones first.
 */
export function rankCommands<T extends CommandEntry>(entries: readonly T[], query: string): T[] {
  return rankBy(entries, (entry) => commandScore(entry, query), (entry) => (entry.disabled ? 1 : 0));
}
