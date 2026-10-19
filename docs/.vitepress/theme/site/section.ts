import type { Chart } from '@chart-on/core';
import { seededRandom } from '@chart-on/core/internal';
import { siteChartTheme } from '../site-theme';

/** A running landing page section: follows the docs colour scheme and cleans up after itself. */
export interface Section {
  setDark(dark: boolean): void;
  destroy(): void;
}

export const themeFor = siteChartTheme;

/** Re-themes the charts a section owns. */
export function retheme(charts: (Chart | null)[], dark: boolean): void {
  for (const chart of charts) chart?.applyOptions({ theme: themeFor(dark) });
}

/** Runs `start` the first time `el` scrolls near the screen, so off-screen sections cost nothing. */
export function whenVisible(el: Element, start: () => void): () => void {
  const observer = new IntersectionObserver(
    ([entry]) => {
      if (!entry?.isIntersecting) return;
      observer.disconnect();
      start();
    },
    { rootMargin: '200px 0px' },
  );
  observer.observe(el);
  return () => observer.disconnect();
}

export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Seeded random numbers in [0, 1), so every visit opens on the same history. */
export const rng = seededRandom;
