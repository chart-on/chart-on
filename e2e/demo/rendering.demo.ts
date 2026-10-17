import { expect, test, type Page } from '@playwright/test';
import { chartOrigin, colorDistance, openDemo, pick, pixels, review, SCHEMES } from './helpers';

/**
 * Rendering the DOM cannot show, checked on pixels: the depth lane beside the
 * price axis and the depth ladder listing the same book (#812), the area and
 * baseline fills of line-based chart types (#816); and the scroll-to-newest
 * button.
 */

type Rgb = [number, number, number];

/** Leave only the main series in the main pane, holding still: no volume, no range profile, no watermark, no crosshair, no live updates. */
async function quietMainPane(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Hide Vol', exact: true }).click();
  await page.getByRole('button', { name: 'Hide Visible range profile', exact: true }).click();
  const view = page.getByRole('toolbar', { name: 'Chart toolbar' }).getByRole('button', { name: 'View' });
  await pick(page, view, 'Symbol watermark');
  // The live feed entry cycles from live to paused.
  await pick(page, view, 'Live updates');
  await page.mouse.move(1, 1);
}

/** The main pane's rectangle in page coordinates, between the legend and the time axis. */
async function mainPane(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const origin = await chartOrigin(page);
  const pane = await page.evaluate(() => ({ ...window.chart.plotRect, top: window.chart.panes[0]!.top, height: window.chart.panes[0]!.height }));
  return { x: origin.x + pane.x, y: origin.y + pane.top, width: pane.width, height: pane.height };
}

for (const scheme of SCHEMES) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test('the depth lane and the depth ladder', async ({ page }) => {
      await openDemo(page, scheme);
      const layers = page.getByRole('toolbar', { name: 'Chart toolbar' }).getByRole('button', { name: 'Layers' });
      const plotWidth = () => page.evaluate(() => window.chart.plotRect.width);
      const before = await plotWidth();

      await pick(page, layers, 'Depth lane and ladder (synthetic book)');
      // The lane takes its width beside the price axis.
      await expect.poll(plotWidth).toBeLessThanOrEqual(before - 80);
      const ladder = page.getByRole('region', { name: 'Order book' });
      await expect(ladder).toBeVisible();
      // Eight asks above eight bids, the best of each side marked.
      const rows = ladder.locator('.pc-ladder-row');
      await expect(rows).toHaveCount(16);
      await expect(ladder.locator('.pc-ladder-ask')).toHaveCount(8);
      await expect(ladder.locator('.pc-ladder-best')).toHaveCount(2);
      // Sizes drift ten times a second; the ladder follows.
      const first = await rows.allTextContents();
      await expect.poll(() => rows.allTextContents()).not.toEqual(first);

      // The lane draws the bids and the asks as blue and red bars, around the last price.
      await page.mouse.move(1, 1);
      const pane = await mainPane(page);
      const last = await page.evaluate(() => window.chart.priceToY(window.chart.main!.data.at(-1)!.close)!);
      const lane = await pixels(page, { x: pane.x + pane.width + 2, y: Math.max(pane.y, pane.y + last - 50), width: 86, height: 100 });
      // Rows of the lane with a bar of each side: asks above the last price, bids below it.
      const rowsWith = (side: (p: Rgb) => boolean) => lane.flatMap((row, y) => (row.filter(side).length >= 3 ? [y] : []));
      const askRows = rowsWith(([r, , b]) => r - b > 25);
      const bidRows = rowsWith(([r, , b]) => b - r > 25);
      expect(askRows.length, 'lane rows with ask bars').toBeGreaterThanOrEqual(5);
      expect(bidRows.length, 'lane rows with bid bars').toBeGreaterThanOrEqual(5);
      const median = (list: number[]) => [...list].sort((a, b) => a - b)[list.length >> 1]!;
      expect(median(askRows)).toBeLessThan(median(bidRows));
      await review(page, `depth-${scheme}`);

      await pick(page, layers, 'Depth lane and ladder (synthetic book)');
      await expect(ladder).toHaveCount(0);
      await expect.poll(plotWidth).toBe(before);
    });

    test('area and baseline fills', async ({ page }) => {
      await openDemo(page, scheme);
      await quietMainPane(page);
      // The strips sampled below reach 34 px over and under the line: keep that much room at the pane
      // edges, more than the automatic margins (the legend block above, half a price label below) leave.
      await page.evaluate(() => window.chart.setPriceScaleOptions({ marginTop: 0.15, marginBottom: 0.15 }));
      const chartType = page.getByRole('toolbar', { name: 'Chart toolbar' }).getByRole('button', { name: 'Chart type' });
      const setStyle = async (option: string, style: string) => {
        await pick(page, chartType, option);
        await expect.poll(() => page.evaluate(() => window.chart.main!.options.style)).toBe(style);
        await page.mouse.move(1, 1);
      };
      /**
       * Where to sample, in chart-root css px: three bars in the left half of the plot (clear of the
       * legend), the highest and lowest closes and the middle of the pane, where the baseline splits.
       * The line types scale the pane to the same closes, so these stay put between them.
       */
      const marks = () =>
        page.evaluate(() => {
          const c = window.chart;
          const range = c.getVisibleIndexRange()!;
          const data = c.main!.data;
          const at = (bar: { time: number; close: number }) => ({ x: Math.round(c.timeToX(bar.time)!), y: Math.round(c.priceToY(bar.close)!) });
          const byClose = data.slice(Math.ceil(range.from), Math.floor(range.to) + 1).sort((a, b) => a.close - b.close);
          const pane = c.panes[0]!;
          return {
            columns: [0.3, 0.4, 0.5].map((f) => at(data[Math.round(range.from + (range.to - range.from) * f)]!)),
            high: at(byClose.at(-1)!),
            low: at(byClose[0]!),
            split: Math.round(pane.top + pane.height / 2),
          };
        });
      const origin = await chartOrigin(page);
      const strip = (x: number, from: number, to: number) =>
        pixels(page, { x: origin.x + x - 1, y: origin.y + Math.min(from, to), width: 3, height: Math.abs(to - from) });
      type At = Awaited<ReturnType<typeof marks>>;
      /** Strips over and under the line at each column, and between the highest and lowest closes and the split. */
      const capture = async (at: At) => {
        const columns: { over: Rgb[][]; under: Rgb[][] }[] = [];
        for (const { x, y } of at.columns) columns.push({ over: await strip(x, y - 34, y - 8), under: await strip(x, y + 8, y + 34) });
        return { columns, up: await strip(at.high.x, at.high.y + 6, at.split - 6), down: await strip(at.low.x, at.split + 6, at.low.y - 6) };
      };
      /** Mean of `f` over the pixels of two same-sized strips, pixel by pixel. */
      const meanOf = (a: Rgb[][], b: Rgb[][], f: (p: Rgb, q: Rgb) => number) => {
        const flatB = b.flat();
        return a.flat().reduce((sum, p, i) => sum + f(p, flatB[i]!), 0) / flatB.length;
      };
      const greenShift = (a: Rgb[][], b: Rgb[][]) => meanOf(a, b, ([r, g], [r0, g0]) => g - r - (g0 - r0));

      // The negative control, drawn in this run: the same strips under a plain line, which has no fill.
      // Later styles are compared with it pixel by pixel, so the line itself and the grid cancel out.
      await setStyle('Line', 'line');
      // Once the pane has scaled to the closes and the line is drawn, both hold still. Each read takes
      // eight screenshots, which on a loaded machine leaves few reads in the usual wait.
      let at = await marks();
      let line = await capture(at);
      await expect
        .poll(async () => {
          const previous = JSON.stringify([at, line]);
          at = await marks();
          line = await capture(at);
          return JSON.stringify([at, line]) === previous;
        }, { message: 'the line is drawn and holds still', timeout: 30_000 })
        .toBe(true);
      expect(at.high.y).toBeLessThan(at.split - 30);
      expect(at.low.y).toBeGreaterThan(at.split + 30);

      await test.step('area: filled below the line, not above it, unlike a plain line', async () => {
        await setStyle('Area', 'area');
        await expect.poll(marks).toEqual(at);
        await expect
          .poll(async () => {
            const area = await capture(at);
            // How much the area changed under the line, over how much it changed above it, at the weakest column.
            const ratios = area.columns.map((c, i) => {
              const under = meanOf(c.under, line.columns[i]!.under, colorDistance);
              const over = meanOf(c.over, line.columns[i]!.over, colorDistance);
              return (under + 1) / (over + 1);
            });
            return Math.min(...ratios);
          }, 'the area fill under the line')
          .toBeGreaterThan(3);
        await review(page, `area-${scheme}`);
      });

      await test.step('baseline: up colour above the baseline, down colour below', async () => {
        await setStyle('Baseline', 'baseline');
        await expect.poll(marks).toEqual(at);
        // The theme's up colour is green and its down colour red: against the line, the strip above the split
        // turns greener and the one below it redder.
        await expect
          .poll(async () => {
            const baseline = await capture(at);
            return Math.min(greenShift(baseline.up, line.up), -greenShift(baseline.down, line.down));
          }, 'up fill above the split, down fill below it')
          .toBeGreaterThan(4);
        await review(page, `baseline-${scheme}`);
      });
    });

    test('the scroll-to-newest button', async ({ page }) => {
      await openDemo(page, scheme);
      const button = page.getByRole('button', { name: 'Scroll to the most recent bar' });
      const shown = () => button.evaluate((el) => getComputedStyle(el).opacity);
      const lastVisible = () => page.evaluate(() => window.chart.getVisibleIndexRange()!.to);
      const newest = await page.evaluate(() => window.chart.main!.data.length - 1);
      await expect.poll(shown).toBe('0');

      // Drag the plot right, towards older bars.
      const pane = await mainPane(page);
      await page.mouse.move(pane.x + pane.width * 0.3, pane.y + pane.height / 2);
      await page.mouse.down();
      await page.mouse.move(pane.x + pane.width * 0.8, pane.y + pane.height / 2, { steps: 8 });
      await page.mouse.up();
      await expect.poll(lastVisible).toBeLessThan(newest - 20);
      await expect.poll(shown).toBe('1');
      await review(page, `scroll-button-${scheme}`);

      await button.click();
      await expect.poll(lastVisible).toBeGreaterThanOrEqual(newest);
      await expect.poll(shown).toBe('0');
    });
  });
}
