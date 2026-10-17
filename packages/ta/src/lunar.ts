/** Mean length of a lunar cycle, new moon to new moon, in days. */
export const SYNODIC_MONTH = 29.530588853;

/** A mean new moon: 2000-01-06 18:14 UTC, in unix seconds. */
const NEW_MOON = 947182440;

/** Where the moon is in its cycle: see {@link moonPhase}. */
export interface MoonPhase {
  /** Days since the last new moon, 0 up to {@link SYNODIC_MONTH}; about half of that is a full moon. */
  age: number;
  /** Lit fraction of the disc, 0 at a new moon and 1 at a full moon. */
  illumination: number;
}

/**
 * Phase of the moon at `time` (unix seconds, like bar times), from the mean
 * lunar cycle. True new and full moons fall within about 15 hours of it, so
 * it suits marking the bar of an event, not timing it to the minute.
 */
export function moonPhase(time: number): MoonPhase {
  const days = (time - NEW_MOON) / 86400;
  const age = ((days % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH;
  return { age, illumination: (1 - Math.cos((2 * Math.PI * age) / SYNODIC_MONTH)) / 2 };
}
