import { volumeOf } from '@charton/core';
import { sampleBars } from '@charton/core/testing';
import { createChartShell, type ChartShell } from '@charton/ui';
import '@charton/ui/style.css';

/**
 * Scenes for ../a11y-rtl.spec.ts, each the UI shell with candles, volume and both axes:
 * - `?scene=forced`: falling candles hollow, for the forced-colours checks (the spec turns
 *   forced colours on through media emulation before the page loads).
 * - `?scene=rtl`: a right-to-left shell in Arabic (Egypt) with grouped prices, and text
 *   drawings mixing right-to-left scripts, Latin and digits; the same texts are laid out
 *   by the browser under the chart (`dir="auto"`) for comparison.
 * `&bottombar` adds the default bottom bar, for the mirroring checks; the baseline
 * scene has none, like a shell's default.
 * `?theme=light` picks the light theme. Seeded data, so every run draws the same pixels.
 * Sets `data-done` on <html> when drawn and exposes the shell as `window.scene`.
 */

declare global {
  interface Window {
    scene: { shell: ChartShell; texts: readonly string[] };
  }
}

const params = new URLSearchParams(location.search);
const theme = params.get('theme') === 'light' ? 'light' : 'dark';
const rtl = params.get('scene') === 'rtl';
const bottomBar = params.has('bottombar');
const DAY = 86400;
// Prices in the thousands, so the grouping separator shows on the axis.
const bars = sampleBars({ count: 40, interval: DAY, price: 2500 });

/** Drawing texts: Arabic first, Hebrew first, and Latin first with Arabic and digits inside. */
const TEXTS = ['هدف السعر 2600 USD', 'יעד ראשון 2,450 points', 'Stop 2400 وقف'] as const;

const frames = async () => {
  for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
};

async function run(): Promise<void> {
  document.documentElement.dataset.theme = theme;
  const shell = createChartShell(document.getElementById('scene')!, {
    theme,
    bottomBar,
    ...(rtl ? { direction: 'rtl' as const, chart: { localization: { locale: 'ar-EG', grouping: true } } } : {}),
  });
  const { chart } = shell;
  chart.addCandles({ title: 'SAMPLE', hollowDown: !rtl }).setData(bars);
  chart.addHistogram({ title: 'Volume', follow: volumeOf }, chart.addPane({ stretch: 0.2 }));
  if (rtl) {
    const at = (i: number, price: number) => ({ time: bars[i]!.time, price });
    // Stacked in the empty corner under the first bars.
    const low = Math.min(...bars.map((b) => b.low));
    TEXTS.forEach((text, i) => chart.drawings.add({ type: 'text', pane: 0, points: [at(5, low + 60 - i * 25)], text, style: {} }));
    const reference = document.getElementById('reference')!;
    reference.style.background = chart.theme.background;
    for (const text of TEXTS) {
      const span = document.createElement('span');
      span.dir = 'auto';
      span.textContent = text;
      Object.assign(span.style, { fontFamily: chart.theme.fontFamily, color: chart.theme.text, background: chart.theme.background });
      reference.append(span);
    }
  }
  chart.fitContent();
  window.scene = { shell, texts: TEXTS };
  await frames();
}

run().finally(() => {
  document.documentElement.dataset.done = '';
});
