import { describe, expect, it } from 'vitest';
import { hash32, seededRandom } from '../src/util/random';

describe('seededRandom', () => {
  it('repeats the same numbers for the same seed', () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
    expect(seededRandom(8)()).not.toBe(seededRandom(7)());
  });

  it('spreads numbers evenly over [0, 1)', () => {
    const rand = seededRandom(1);
    const bins = new Array(10).fill(0);
    for (let i = 0; i < 100_000; i++) {
      const v = rand();
      expect(v >= 0 && v < 1).toBe(true);
      bins[Math.floor(v * 10)]++;
    }
    for (const count of bins) expect(Math.abs(count - 10_000)).toBeLessThan(500);
  });
});

describe('hash32', () => {
  it('gives distinct 32-bit hashes to distinct inputs', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 65_536; i++) {
      const h = hash32(0, i);
      expect(h >>> 0).toBe(h);
      seen.add(h);
    }
    expect(seen.size).toBe(65_536);
  });

  it('depends on the order of hashed values', () => {
    expect(hash32(hash32(0, 1), 2)).not.toBe(hash32(hash32(0, 2), 1));
    expect(hash32(1, 2)).not.toBe(hash32(2, 1));
  });
});
