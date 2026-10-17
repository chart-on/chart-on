import { clampLow } from '../util/math';
/**
 * Slots of a GPU buffer still waiting for their upload: a sorted list of
 * disjoint [from, to) ranges. The renderer uploads the part a draw needs at
 * once (`take`) and the rest in bounded pieces, nearest the view first (`next`).
 */
export class PendingRanges {
  /** Flat [from, to) pairs, sorted and disjoint (touching ranges are merged). */
  #ranges: number[] = [];

  /** Slots waiting in all. */
  get size(): number {
    let n = 0;
    for (let i = 0; i < this.#ranges.length; i += 2) n += this.#ranges[i + 1]! - this.#ranges[i]!;
    return n;
  }

  get empty(): boolean {
    return this.#ranges.length === 0;
  }

  clear(): void {
    this.#ranges.length = 0;
  }

  /** The ranges as [from, to) pairs, for uploading all of them. */
  all(): number[] {
    const out = this.#ranges;
    this.#ranges = [];
    return out;
  }

  /** Add slots [from, to), merging with the ranges it overlaps or touches. */
  add(from: number, to: number): void {
    if (!(to > from)) return;
    const r = this.#ranges;
    const out: number[] = [];
    let i = 0;
    while (i < r.length && r[i + 1]! < from) out.push(r[i++]!, r[i++]!);
    while (i < r.length && r[i]! <= to) {
      from = Math.min(from, r[i]!);
      to = Math.max(to, r[i + 1]!);
      i += 2;
    }
    out.push(from, to);
    while (i < r.length) out.push(r[i++]!);
    this.#ranges = out;
  }

  /** Remove the waiting slots within [from, to) and return them as [from, to) pairs. */
  take(from: number, to: number): number[] {
    const r = this.#ranges;
    const taken: number[] = [];
    if (!(to > from)) return taken;
    const out: number[] = [];
    for (let i = 0; i < r.length; i += 2) {
      const a = r[i]!;
      const b = r[i + 1]!;
      if (b <= from || a >= to) {
        out.push(a, b);
        continue;
      }
      taken.push(Math.max(a, from), Math.min(b, to));
      if (a < from) out.push(a, from);
      if (b > to) out.push(to, b);
    }
    this.#ranges = out;
    return taken;
  }

  /**
   * Remove and return up to `max` waiting slots next to `focus`, from the
   * range nearest it, on that range's side facing `focus`. Null when none wait.
   */
  next(focus: number, max: number): [from: number, to: number] | null {
    const r = this.#ranges;
    if (r.length === 0) return null;
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < r.length; i += 2) {
      const d = focus < r[i]! ? r[i]! - focus : focus >= r[i + 1]! ? focus - r[i + 1]! + 1 : 0;
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    const a = r[best]!;
    const b = r[best + 1]!;
    max = Math.max(1, Math.floor(max));
    // Below the range: grow it upwards from its start; above: downwards from its end.
    const from = focus >= b ? Math.max(a, b - max) : clampLow(focus, a, b - 1);
    const to = Math.min(b, from + max);
    this.take(from, to);
    return [from, to];
  }
}
