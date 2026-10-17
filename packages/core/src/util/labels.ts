import { clampLow } from './math';
/**
 * Spread label centres so they stop overlapping, moving them as little as
 * possible: labels that would collide form a group centred on their wanted
 * positions. `gaps` is the distance a label needs below its centre before the
 * next one (one number for all, or one per label for labels of different
 * heights). Groups stay within `[min, max]` when they fit. Returns the new
 * centres in input order.
 */
export function spreadLabels(ys: readonly number[], gaps: number | readonly number[], min: number, max: number): number[] {
  const gapOf = (i: number) => (typeof gaps === 'number' ? gaps : gaps[i]!);
  const order = ys.map((_, i) => i).sort((a, b) => ys[a]! - ys[b]!);
  // A group: its first slot in `order`, size, the offsets of its labels from
  // its top centre, the sum of the tops they want, and its placed top.
  interface Group {
    first: number;
    size: number;
    offsets: number[];
    sum: number;
    top: number;
  }
  const groups: Group[] = [];
  const place = (g: Group) => {
    g.top = clampLow(g.sum / g.size, min, max - g.offsets[g.size - 1]!);
  };
  order.forEach((index, k) => {
    const g: Group = { first: k, size: 1, offsets: [0], sum: ys[index]!, top: 0 };
    place(g);
    groups.push(g);
    for (;;) {
      const cur = groups[groups.length - 1]!;
      const prev = groups[groups.length - 2];
      if (!prev) break;
      const last = order[prev.first + prev.size - 1]!;
      const step = prev.offsets[prev.size - 1]! + gapOf(last);
      if (prev.top + step <= cur.top) break;
      for (let j = 0; j < cur.size; j++) {
        const offset = step + cur.offsets[j]!;
        prev.offsets.push(offset);
        prev.sum += ys[order[cur.first + j]!]! - offset;
      }
      prev.size += cur.size;
      groups.pop();
      place(prev);
    }
  });
  const out = new Array<number>(ys.length);
  for (const g of groups) for (let j = 0; j < g.size; j++) out[order[g.first + j]!] = g.top + g.offsets[j]!;
  return out;
}
