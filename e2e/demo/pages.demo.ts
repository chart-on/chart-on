import { expect, test } from '@playwright/test';
import { colorDistance, isLightColor, openDemo, pixels, review, rgbOf, SCHEMES } from './helpers';

/**
 * The demo's data pages load their bars through a data source (#834): the
 * main shell page, the chart grid, the sparklines and the seasonality view,
 * each in the theme of the colour scheme, with no page error.
 */

for (const scheme of SCHEMES) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test('the main page loads bars', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await openDemo(page, scheme);
      const loaded = await page.evaluate(() => ({ bars: window.chart.main!.data.length, symbol: window.chart.data?.requested?.symbol }));
      expect(loaded.bars).toBeGreaterThan(100);
      expect(loaded.symbol).toBe('BTCUSD');
      await review(page, `main-${scheme}`);
      expect(errors).toEqual([]);
    });

    test('the grid page loads bars in every cell', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('/grid.html');
      await page.waitForFunction(() => window.grid?.cells.length === 4 && window.grid.cells.every((s) => s.chart.mainBars.length > 0));
      const backgrounds = await page.evaluate(() => window.grid.cells.map((s) => s.chart.theme.background));
      for (const background of backgrounds) expect(isLightColor(background)).toBe(scheme === 'light');
      await review(page, `grid-${scheme}`);
      expect(errors).toEqual([]);
    });

    test('the sparklines page loads bars in every chart', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('/sparklines.html');
      // The interactive chart and 40 static ones.
      await page.waitForFunction(() => window.charts?.length === 41 && window.charts.every((c) => (c.main?.data.length ?? 0) > 0));
      const state = await page.evaluate(() => ({
        lines: window.charts.slice(1).every((c) => c.main?.options.style === 'line'),
        backgrounds: window.charts.map((c) => c.theme.background),
      }));
      expect(state.lines).toBe(true);
      for (const background of state.backgrounds) expect(isLightColor(background)).toBe(scheme === 'light');
      await review(page, `sparklines-${scheme}`);
      expect(errors).toEqual([]);
    });

    // Static charts give their WebGL context up between drawings and take one back for the next
    // (#842): on this page of 41 charts every one in view draws, within the browser's context limit.
    test('the sparklines page draws every chart', async ({ page }) => {
      const warnings: string[] = [];
      page.on('console', (m) => {
        if (/context restoration not allowed|Too many active WebGL contexts/.test(m.text())) warnings.push(m.text());
      });
      await page.goto('/sparklines.html');
      await page.waitForFunction(() => window.charts?.length === 41 && window.charts.every((c) => (c.main?.data.length ?? 0) > 0));
      // The interactive chart keeps its context while the static ones are made (#982): its plot shows
      // the theme's background with candles on it, not a blank canvas (white, which the light theme
      // shares, so the candles are checked too).
      const main = (await page.locator('#main').boundingBox())!;
      const background = rgbOf(await page.evaluate(() => window.charts[0]!.theme.background));
      const plot = await page.evaluate(() => window.charts[0]!.plotRect);
      const plotPixels = () => pixels(page, { x: main.x + plot.x, y: main.y + plot.y + plot.height * 0.2, width: plot.width * 0.9, height: plot.height * 0.6 });
      await expect.poll(async () => colorDistance((await plotPixels())[0]![0]!, background), 'plot background').toBeLessThan(40);
      // Rows with ink: candles span many, the dotted last-price line only one or two.
      const inkedRows = async () => (await plotPixels()).filter((row) => row.filter((p) => colorDistance(p, background) > 80).length >= 3).length;
      await expect.poll(inkedRows, 'candles drawn').toBeGreaterThan(40);
      const hosts = await page.locator('.spark').all();
      const expectDrawn = async (host: (typeof hosts)[number]) => {
        const inked = async () => {
          const box = (await host.boundingBox())!;
          const rows = await pixels(page, { x: box.x, y: box.y, width: box.width * 0.6, height: box.height * 0.7 });
          return rows.flat().filter((p) => colorDistance(p, rows[0]![0]!) > 40).length;
        };
        await expect.poll(inked, `pixels drawn in ${await host.evaluate((el) => el.previousElementSibling?.textContent)}`).toBeGreaterThan(30);
      };
      for (const host of hosts.slice(0, 12)) await expectDrawn(host);
      // Charts scrolled into view take a context back and draw too.
      await hosts.at(-1)!.scrollIntoViewIfNeeded();
      for (const host of hosts.slice(-6)) await expectDrawn(host);
      expect(warnings).toEqual([]);
    });

    test('the seasonality page loads five years and their average', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('/seasonality.html');
      await page.waitForFunction(() => {
        const view = window.seasonality;
        return view !== undefined && view.years.length === 5 && view.averageSeries !== null;
      });
      const state = await page.evaluate(() => {
        const view = window.seasonality;
        return { points: view.years.map((y) => view.yearSeries(y)?.data.length ?? 0), background: window.chart.theme.background };
      });
      for (const points of state.points) expect(points).toBeGreaterThan(0);
      expect(isLightColor(state.background)).toBe(scheme === 'light');
      await review(page, `seasonality-${scheme}`);
      expect(errors).toEqual([]);
    });
  });
}
