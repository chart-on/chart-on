/** Text a search ranks with `matchScore`: a label, an id, other words that find it, and a description. */
export interface SearchItem {
  /** Matched like a keyword: exactly, by prefix, and in the all-words tier. */
  id: string;
  /** The name shown, ranked first. */
  label: string;
  /** Other words that find the item, e.g. abbreviations or aliases. */
  keywords?: readonly string[];
  /** Also searched, ranked last. */
  description?: string;
}

const words = (text: string) => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

/** First letters of the words, e.g. `rsi` for "relative strength index". */
const acronym = (text: string) =>
  words(text)
    .map((w) => w[0])
    .join('');

/**
 * Internal: true when `a` turns into `b` with at most one insertion, deletion,
 * substitution or swap of two neighbouring characters.
 */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const diff = a.length - b.length;
  if (Math.abs(diff) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (diff === 0) {
    // One substitution, or a swap of i and i + 1.
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  // One extra character in the longer string at i.
  return diff > 0 ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/**
 * `query` is one edit away from `target` or from the start of it (the user is
 * still typing). A start shorter than the query would let any extra first
 * letter match ("rsi" against "si" of "simple"), so it counts only as the whole word.
 */
function typoMatch(query: string, target: string): boolean {
  for (let len = query.length - 1; len <= query.length + 1; len++) {
    if (len <= 0 || len > target.length) continue;
    if (len < query.length && len < target.length) continue;
    if (withinOneEdit(query, target.slice(0, len))) return true;
  }
  return false;
}

/** The tiers `matchScore` returns, best first, and `category`, which only `matchRank` gives an indicator. */
export const matchTiers = {
  exact: 0,
  labelPrefix: 1,
  keywordPrefix: 2,
  acronym: 3,
  wordPrefix: 4,
  substring: 5,
  allWords: 6,
  typo: 7,
  description: 8,
  category: 9,
} as const;

/**
 * How well `item` matches `query`: lower is better, `null` for no match. In
 * order: exact label, keyword or id; label prefix; keyword or id prefix;
 * acronym of the label or a keyword (`rsi` for "Relative Strength Index");
 * word prefix; substring; every query word somewhere; with `options.typos`, one typo
 * in a query of three or more characters; description substring.
 */
export function matchScore(item: SearchItem, query: string, options: { typos?: boolean } = {}): number | null {
  const q = normalize(query);
  if (!q) return matchTiers.exact;
  const label = normalize(item.label);
  const id = normalize(item.id);
  const keywords = (item.keywords ?? []).map(normalize);
  const names = [label, ...keywords];
  const description = normalize(item.description ?? '');
  if (names.includes(q) || id === q) return matchTiers.exact;
  if (label.startsWith(q)) return matchTiers.labelPrefix;
  if (keywords.some((k) => k.startsWith(q)) || id.startsWith(q)) return matchTiers.keywordPrefix;
  const compact = q.replace(/ /g, '');
  if (compact.length > 1 && names.some((n) => acronym(n).startsWith(compact))) return matchTiers.acronym;
  const all = names.flatMap(words);
  if (all.some((w) => w.startsWith(q))) return matchTiers.wordPrefix;
  if (names.some((n) => n.includes(q))) return matchTiers.substring;
  const parts = words(q);
  if (parts.length > 1 && parts.every((part) => [...names, id, description].some((text) => text.includes(part)))) return matchTiers.allWords;
  // Short words would match too much: "mad" is one edit from "ma".
  if (options.typos && q.length >= 3 && [...names, ...all].some((n) => n.length >= 3 && typoMatch(q, n))) return matchTiers.typo;
  if (description.includes(q)) return matchTiers.description;
  return null;
}
