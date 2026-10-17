import { expect, test, type Locator, type Page } from '@playwright/test';
import { chartOrigin, clickAt, openDemo, pick, review, rgbOf, SCHEMES } from './helpers';

/**
 * Floating chrome kept clear of what it used to cover (#843): the toast stack
 * and the favourites bar, the replay strip and the legend's price row, and
 * the pane buttons and an alert label at the top of a pane; and the legend's
 * backdrop over a heatmap.
 */

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Whether two boxes overlap; touching edges do not count. */
const intersects = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
/** Whether two boxes share some horizontal extent, so only their heights keep them apart. */
const sideBySide = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width;
const boxOf = async (l: Locator): Promise<Box> => {
  const box = await l.boundingBox();
  expect(box, 'element is laid out').not.toBeNull();
  return box!;
};

const topBar = (page: Page) => page.getByRole('toolbar', { name: 'Chart toolbar' });

/**
 * Runs of the chart's pointer cursor down a column at chart-root `x`, from
 * `y0` to `y1`: where it changes over canvas-drawn label buttons.
 */
function cursorColumn(page: Page, x: number, y0: number, y1: number): Promise<{ from: number; to: number; cursor: string }[]> {
  return page.evaluate(
    ([x, y0, y1]) => {
      const root = window.chart.root;
      const box = root.getBoundingClientRect();
      const runs: { from: number; to: number; cursor: string }[] = [];
      for (let y = y0; y <= y1; y++) {
        const at = { clientX: box.left + x, clientY: box.top + y, pointerType: 'mouse', pointerId: 1, isPrimary: true, bubbles: true };
        root.dispatchEvent(new PointerEvent('pointermove', at));
        const cursor = root.style.cursor;
        const last = runs[runs.length - 1];
        if (last && last.cursor === cursor) last.to = y;
        else runs.push({ from: y, to: y, cursor });
      }
      return runs;
    },
    [x, y0, y1] as const,
  );
}

for (const scheme of SCHEMES) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test.beforeEach(({ page }) => openDemo(page, scheme));

    test('toasts stack clear of the favourites bar', async ({ page }) => {
      const bar = page.getByRole('toolbar', { name: 'Favourite drawing tools' });
      await expect(bar).toBeVisible();
      const view = topBar(page).getByRole('button', { name: 'View' });
      // A status toast (the feed paused) and a notice.
      await pick(page, view, 'Live updates');
      await pick(page, view, 'Live updates paused');
      await pick(page, view, 'Sketch drawings');
      const toasts = page.locator('.pc-toast');
      await expect(toasts).toHaveCount(2);
      await review(page, `overlap-toasts-${scheme}`);
      const barBox = await boxOf(bar);
      for (const toast of await toasts.all()) {
        const box = await boxOf(toast);
        // The bar sits at the bottom middle, under the stack: only height keeps them apart.
        expect(sideBySide(box, barBox)).toBe(true);
        expect(intersects(box, barBox), JSON.stringify({ toast: box, bar: barBox })).toBe(false);
      }
    });

    test('the replay strip keeps clear of the legend price row', async ({ page }) => {
      const strip = page.getByRole('toolbar', { name: 'Bar replay' });
      const priceRow = page.locator('.pc-legend').first().locator('.pc-legend-row').first();
      const check = async (name: string) => {
        await review(page, `overlap-replay-${name}-${scheme}`);
        const row = await boxOf(priceRow);
        const box = await boxOf(strip);
        expect(intersects(box, row), JSON.stringify({ strip: box, row })).toBe(false);
        // Just below the price row: the shorter rows under it do not reach the middle, so they do not push it further.
        expect(box.y, JSON.stringify({ strip: box, row })).toBeLessThanOrEqual(row.y + row.height + 8);
      };

      await topBar(page).getByRole('button', { name: 'Bar replay', exact: true }).click();
      await expect(strip).toBeVisible();
      // The price row runs under the middle of the chart, where the strip sits.
      expect(sideBySide(await boxOf(strip), await boxOf(priceRow))).toBe(true);
      await check('pick');

      const start = await page.evaluate(() => {
        const data = window.chart.main!.data;
        return window.chart.timeToX(data[data.length - 60]!.time)!;
      });
      const mid = await page.evaluate(() => window.chart.panes[0]!.top + window.chart.panes[0]!.height / 2);
      await clickAt(page, start, mid);
      await expect.poll(() => page.evaluate(() => window.chart.replay.state.active)).toBe(true);
      await expect(strip.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
      await check('running');
    });

    test('the pane buttons keep clear of an alert label at the top of the pane', async ({ page }) => {
      // Pane buttons show once there are several panes.
      const top = await page.evaluate(() => {
        const chart = window.chart;
        chart.indicators.add('rsi');
        // A price just under the main pane's top edge, so the line runs through the buttons' row.
        const y = chart.panes[0]!.top + 6;
        chart.annotations.addAlertLine({ price: chart.yToPrice(y, 0)!, onRemove: () => {} });
        return y;
      });
      const { plotRight, paneTop } = await page.evaluate(() => ({
        plotRight: window.chart.plotRect.x + window.chart.plotRect.width,
        paneTop: window.chart.panes[0]!.top,
      }));
      // Hover the main pane so its buttons show.
      const origin = await chartOrigin(page);
      await page.mouse.move(origin.x + plotRight / 2, origin.y + paneTop + 200);
      const buttons = page.locator('.pc-pane-controls').first();
      await expect(buttons).toHaveCSS('opacity', '1');
      await review(page, `overlap-pane-buttons-${scheme}`);
      const buttonsBox = await boxOf(buttons);
      const buttonsBottom = buttonsBox.y + buttonsBox.height - origin.y;
      expect(top, 'the alert line runs through the buttons').toBeLessThan(buttonsBottom);

      // The label's remove button (a pointer cursor) sits at its right end, under the buttons' column.
      const x = plotRight - 12;
      expect(x).toBeGreaterThan(buttonsBox.x - origin.x);
      expect(x).toBeLessThan(buttonsBox.x + buttonsBox.width - origin.x);
      const runs = await cursorColumn(page, x, paneTop, paneTop + 80);
      const remove = runs.find((r) => r.cursor === 'pointer');
      expect(remove, JSON.stringify(runs)).toBeDefined();
      const label = { x: origin.x + x - 1, y: origin.y + remove!.from, width: 2, height: remove!.to - remove!.from + 1 };
      expect(intersects(label, buttonsBox), JSON.stringify({ label, buttons: buttonsBox })).toBe(false);
    });

    test('the legend has a backdrop over a heatmap', async ({ page }) => {
      const paneOfHeatmap = () => page.evaluate(() => window.chart.panes.findIndex((p) => p.series.some((s) => s.kind === 'heatmap')));
      // The heatmap is an optional layer: switching it on in Layers creates it, switching it off removes it.
      const layers = page.getByRole('toolbar', { name: 'Chart toolbar' }).getByRole('button', { name: 'Layers' });
      const toggleHeatmap = () => pick(page, layers, 'Liquidation heatmap');

      await toggleHeatmap();
      await expect.poll(paneOfHeatmap, 'the heatmap layer is on').toBeGreaterThanOrEqual(0);
      const legend = page.locator('.pc-legend').nth(await paneOfHeatmap());
      const background = () => legend.evaluate((el) => getComputedStyle(el).backgroundColor);
      await expect.poll(background).toMatch(/^rgba\(.*, 0\.75\)$/);
      const theme = await page.evaluate(() => window.chart.theme.background);
      expect(rgbOf(await background())).toEqual(rgbOf(theme));
      await review(page, `overlap-legend-backdrop-${scheme}`);

      await toggleHeatmap();
      await expect.poll(paneOfHeatmap, 'the heatmap layer is off').toBe(-1);
      await expect.poll(background).toBe('rgba(0, 0, 0, 0)');
    });
  });
}
