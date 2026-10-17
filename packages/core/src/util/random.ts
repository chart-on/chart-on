/*
 * Seeded pseudo-random numbers, designed for this project. Mock data and test
 * fixtures use them to look random while staying the same for a given seed.
 * They are not for anything that needs unpredictable numbers.
 *
 * `scramble` is three rounds of: multiply by an odd constant, then XOR the
 * word with two rotations of itself. Multiplying carries every bit towards the
 * top of the word; the rotations bring the top bits back down, so after three
 * rounds each input bit flips each output bit about half the time (measured
 * over random inputs for all 32 × 32 bit pairs). Both steps are bijections of
 * 32-bit words: an odd number is invertible modulo 2^32, and
 * `x ^ rotl(x, a) ^ rotl(x, b)` is invertible because its polynomial
 * 1 + t^a + t^b has an odd number of terms, so it shares no factor with
 * t^32 + 1 = (t + 1)^32. So different inputs never give the same output.
 *
 * Constants, by rule rather than by hand: the multipliers are the first 32
 * bits of the fractional parts of √6, √8 and √10 (the first three composite
 * numbers that are not squares), made odd. Irrational fractions give
 * irregular, balanced bit patterns, and anyone can recompute them. Primes are
 * avoided because their roots already serve as constants in other designs.
 * The rotations, 11 and 21, are about a third and two thirds of the word, so a
 * bit lands in three places far apart.
 *
 * `seededRandom` numbers its draws: draw n of a stream is the scramble of the
 * stream's key plus n, divided by 2^32. Consecutive counters differ in few
 * bits, which the measured mixing spreads over the whole word.
 */

const ROUNDS = [0x7311c281, 0xd413cccf, 0x298b075b];

function scramble(x: number): number {
  for (const m of ROUNDS) {
    x = Math.imul(x, m);
    x ^= ((x << 11) | (x >>> 21)) ^ ((x << 21) | (x >>> 11));
  }
  return x >>> 0;
}

/**
 * Folds the integer `value` into the 32-bit hash `h`; chain calls to hash
 * several values. `h` turns by half a word before `value` is added, so small
 * values in a different order hash differently.
 */
export function hash32(h: number, value: number): number {
  return scramble((((h << 16) | (h >>> 16)) + value) | 0);
}

/** A generator of numbers in [0, 1), the same sequence for the same integer `seed`. */
export function seededRandom(seed: number): () => number {
  const key = hash32(ROUNDS[0]!, seed);
  let n = 0;
  return () => hash32(key, n++) / 4294967296;
}
