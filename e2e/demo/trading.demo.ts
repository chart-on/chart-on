import { expect, test, type Page } from '@playwright/test';
import { clickAt, cursorRuns, openDemo, review, SCHEMES } from './helpers';

/**
 * The replay and trading parts the demo passes (#831): the replay strip from
 * the toolbar's replay button, picking a start bar and restarting at another; the order
 * draft's quantity keypad and type menu; and the list of a folded cluster of
 * order labels with its cancel buttons.
 */

const lastBarTime = (page: Page) => page.evaluate(() => window.chart.main!.data.at(-1)!.time);
/** Chart-root x of the bar `back` bars before the newest one. */
const barX = (page: Page, back: number) =>
  page.evaluate((back) => {
    const data = window.chart.main!.data;
    return { x: window.chart.timeToX(data[data.length - 1 - back]!.time)!, time: data[data.length - 1 - back]!.time };
  }, back);
/** How far inside a label segment's edge a click lands, clear of the segment next to it. */
const INSET = 4;
/**
 * The cursor runs along a draft's line, right to left: the discard and confirm buttons, the bracket
 * grip and price (dragged), the type and quantity (the editable segments, one run), then the line.
 */
const DRAFT_RUNS = ['pointer', 'ns-resize', 'pointer', 'ns-resize'];
/** The editable run of the draft label at chart-root `y`: type on its right, quantity on its left. */
async function editableRun(page: Page, y: number, plotWidth: number): Promise<{ from: number; to: number }> {
  const runs = await cursorRuns(page, y, plotWidth - 2, plotWidth - 400);
  expect(runs.map((r) => r.cursor), JSON.stringify(runs)).toEqual(DRAFT_RUNS);
  return runs[2]!;
}
/** Chart-root y in the middle of the main pane. */
const midY = (page: Page) => page.evaluate(() => window.chart.panes[0]!.top + window.chart.panes[0]!.height / 2);

for (const scheme of SCHEMES) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test('bar replay from the toolbar', async ({ page }) => {
      await openDemo(page, scheme);
      const total = await page.evaluate(() => window.chart.main!.data.length);
      const strip = page.getByRole('toolbar', { name: 'Bar replay' });
      await expect(strip).toBeHidden();

      await page.getByRole('toolbar', { name: 'Chart toolbar' }).getByRole('button', { name: 'Bar replay', exact: true }).click();
      // Picking a bar: only random bar and exit.
      await expect(strip).toBeVisible();
      await expect(strip.getByRole('button', { name: 'Random bar', exact: true })).toBeVisible();
      await expect(strip.getByRole('button', { name: 'Play', exact: true })).toBeHidden();
      await review(page, `replay-pick-${scheme}`);

      const start = await barX(page, 60);
      await clickAt(page, start.x, await midY(page));
      await expect.poll(() => page.evaluate(() => window.chart.replay.state.active)).toBe(true);
      expect(await lastBarTime(page)).toBe(start.time);
      await expect(strip.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
      await review(page, `replay-strip-${scheme}`);

      await strip.getByRole('button', { name: 'Next bar', exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.chart.main!.data.length)).toBe(total - 59);
      await strip.getByRole('button', { name: 'Play', exact: true }).click();
      await expect(strip.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
      await strip.getByRole('button', { name: 'Pause', exact: true }).click();
      await expect(strip.getByRole('button', { name: 'Play', exact: true })).toBeVisible();

      // Paused, a click on another bar restarts the replay there.
      const restart = await barX(page, 20);
      await clickAt(page, restart.x, await midY(page));
      await expect.poll(() => lastBarTime(page)).toBe(restart.time);
      expect(await page.evaluate(() => window.chart.replay.state.active)).toBe(true);

      await strip.getByRole('button', { name: 'Exit replay', exact: true }).click();
      await expect(strip).toBeHidden();
      await expect.poll(() => page.evaluate(() => window.chart.main!.data.length)).toBeGreaterThanOrEqual(total);
    });

    test('order drafts and folded order labels', async ({ page }) => {
      await openDemo(page, scheme);
      await page.getByRole('button', { name: 'Open the trading example' }).click();
      const panel = page.getByRole('region', { name: 'Trading example' });
      const plotWidth = await page.evaluate(() => window.chart.plotRect.width);
      // The example's position line sits at an earlier close, which the latest price can come back to;
      // it would then fold into the labels measured here. Remove it: these steps are about drafts and orders.
      await page.evaluate(() => window.chart.annotations.tradeLines.filter((l) => l.options.kind === 'position').forEach((l) => l.remove()));

      await test.step('the quantity keypad and the type menu edit a draft', async () => {
        await panel.getByRole('button', { name: 'Draft buy' }).click();
        const y = await page.evaluate(() => window.chart.priceToY(window.chart.annotations.draftLines[0]!.options.price)!);
        // Quantity is the left of the two editable segments (runs go right to left, so `to` is the left end).
        await clickAt(page, (await editableRun(page, y, plotWidth)).to + INSET, y);
        const keypad = page.getByRole('dialog', { name: 'Order quantity' });
        await expect(keypad).toBeVisible();
        await expect(keypad.getByRole('spinbutton', { name: 'Quantity' })).toHaveValue('0.5');
        await review(page, `draft-keypad-${scheme}`);
        await keypad.getByRole('button', { name: 'Quantity 5' }).click();
        await expect(keypad).toBeHidden();
        expect(await page.evaluate(() => window.chart.annotations.draftLines[0]!.options.quantity)).toBe(5);

        // The type is the right one; the label got wider with the new quantity, so find it again.
        await clickAt(page, (await editableRun(page, y, plotWidth)).from - INSET, y);
        const types = page.getByRole('menu', { name: 'Order type' });
        await expect(types).toBeVisible();
        await expect(types.getByRole('menuitemradio', { name: 'Limit' })).toBeChecked();
        await review(page, `draft-type-${scheme}`);
        await types.getByRole('menuitemradio', { name: 'Stop' }).click();
        await expect(types).toBeHidden();
        expect(await page.evaluate(() => window.chart.annotations.draftLines[0]!.options.type)).toBe('stop');
      });

      await test.step('a folded cluster lists its orders, each with a cancel button', async () => {
        await page.evaluate(() => window.chart.annotations.draftLines.forEach((d) => d.discard()));
        await panel.getByRole('checkbox', { name: 'Take profit / stop loss' }).uncheck();
        for (let i = 0; i < 3; i++) await panel.getByRole('button', { name: 'Buy limit' }).click();
        const orders = () => page.evaluate(() => window.chart.annotations.tradeLines.filter((l) => l.options.kind === 'order').length);
        expect(await orders()).toBe(3);
        const y = await page.evaluate(() => {
          const line = window.chart.annotations.tradeLines.find((l) => l.options.kind === 'order')!;
          return window.chart.priceToY(line.options.price)!;
        });
        // The three labels overlap and fold into one summary label, which is one clickable run.
        const runs = await cursorRuns(page, y, plotWidth - 2, plotWidth - 200);
        const summary = runs.find((r) => r.cursor === 'pointer')!;
        await clickAt(page, (summary.from + summary.to) / 2, y);
        const list = page.getByRole('dialog', { name: '3 orders' });
        await expect(list).toBeVisible();
        const cancels = list.getByRole('button', { name: /^Cancel Buy 0\.5 @/ });
        await expect(cancels).toHaveCount(3);
        await review(page, `cluster-list-${scheme}`);
        await cancels.first().click();
        await expect.poll(orders).toBe(2);
      });
    });
  });
}
