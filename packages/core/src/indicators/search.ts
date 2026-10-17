import type { IndicatorDef } from './types';
import { matchScore, matchTiers } from '../util/text-match';

/** Options of `searchIndicators`. */
export interface IndicatorSearchOptions {
  /** The name shown for a definition, e.g. in the chart's language; default its `name`. */
  nameOf?: (def: IndicatorDef) => string;
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/**
 * How well `def` matches `query` (lower is better, see `matchTiers`), or null
 * when it does not: `matchScore` with typos (`rsl` finds RSI) of its name,
 * aliases, id and description, then its category. `options.name` is the name
 * shown, e.g. in the chart's language; the definition's own name then counts as an alias.
 */
export function matchRank(def: IndicatorDef, query: string, options: { name?: string } = {}): number | null {
  const item = {
    id: def.id,
    label: options.name ?? def.name,
    keywords: [def.name, ...(Array.isArray(def.aliases) ? def.aliases : [])].filter((a) => typeof a === 'string'),
    description: text(def.description),
  };
  const score = matchScore(item, query, { typos: true });
  if (score !== null) return score;
  const category = text(def.category).toLowerCase();
  return category && category.includes(query.toLowerCase().trim()) ? matchTiers.category : null;
}

/** Definitions matching `query`, best first; equal ranks keep their order. All of them for an empty query. `nameOf` gives the names shown (see `matchRank`). */
export function searchIndicators(defs: readonly IndicatorDef[], query: string, options: IndicatorSearchOptions = {}): IndicatorDef[] {
  return defs
    .map((def) => ({ def, rank: matchRank(def, query, { name: options.nameOf?.(def) }) }))
    .filter((r): r is { def: IndicatorDef; rank: number } => r.rank !== null)
    .sort((a, b) => a.rank - b.rank)
    .map((r) => r.def);
}
