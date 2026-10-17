import { expect, test, type Page } from '@playwright/test';
import { openDemo, openRailGroup, pick, review, SCHEMES } from './helpers';

/**
 * The shell's opt-in parts the demo passes (#830): symbol search on `/`, the
 * command palette on Mod+K, favourite stars and the favourites bar, toolbar
 * customization and toasts. One test per part, in each theme.
 */

const topBar = (page: Page) => page.getByRole('toolbar', { name: 'Chart toolbar' });
const symbolOf = (page: Page) => page.evaluate(() => window.chart.data?.requested?.symbol);
/** Click the plot, which focuses the chart for its keys, away from the legend and the overlays. */
const focusChart = (page: Page) => page.getByRole('application').click({ position: { x: 640, y: 330 } });

for (const scheme of SCHEMES) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test.beforeEach(({ page }) => openDemo(page, scheme));

    test('symbol search opens on / and loads the picked symbol', async ({ page }) => {
      await focusChart(page);
      await page.keyboard.press('/');
      const search = page.getByRole('dialog', { name: 'Symbol search' });
      await expect(search).toBeVisible();
      await expect(search.getByRole('combobox', { name: 'Search symbols' })).toBeFocused();
      await page.keyboard.type('XAU');
      await search.getByRole('option', { name: /XAUUSD/ }).click();
      await expect(search).toBeHidden();
      await expect.poll(() => symbolOf(page)).toBe('XAUUSD');
      await expect(topBar(page).getByRole('button', { name: /^XAUUSD/ })).toBeVisible();
    });

    test('the command palette opens on Mod+K and runs a symbol entry', async ({ page }) => {
      await focusChart(page);
      await page.keyboard.press('ControlOrMeta+K');
      const palette = page.getByRole('dialog', { name: 'Command palette' });
      await expect(palette).toBeVisible();
      await page.keyboard.type('USDJPY');
      await review(page, `palette-${scheme}`);
      await palette.getByRole('option', { name: /USDJPY/ }).first().click();
      await expect(palette).toBeHidden();
      await expect.poll(() => symbolOf(page)).toBe('USDJPY');
    });

    test('a star in a rail flyout adds the tool to the favourites bar', async ({ page }) => {
      const rail = page.getByRole('toolbar', { name: 'Drawing tools', exact: true });
      const bar = page.getByRole('toolbar', { name: 'Favourite drawing tools' });
      await expect(bar.getByRole('button', { name: 'Ray', exact: true })).toHaveCount(0);
      await (await openRailGroup(page, 'More lines')).getByRole('menuitemcheckbox', { name: 'Add Ray to favourites' }).click();
      await expect(page.getByRole('menuitemcheckbox', { name: 'Remove Ray from favourites' })).toBeChecked();
      await review(page, `favourite-star-${scheme}`);
      await page.keyboard.press('Escape');
      await bar.getByRole('button', { name: 'Ray', exact: true }).click();
      expect(await page.evaluate(() => window.chart.drawings.tool)).toBe('ray');
      await page.keyboard.press('Escape');
      // The rail button shows and hides the bar.
      const toggle = rail.getByRole('button', { name: 'Favourites bar' });
      await toggle.click();
      await expect(bar).toBeHidden();
      await toggle.click();
      await expect(bar).toBeVisible();
    });

    test('toolbar customization hides an action, keeps the locked ones and resets', async ({ page }) => {
      await topBar(page).getByRole('button', { name: 'More' }).click();
      await page.getByRole('menuitem', { name: 'Customize toolbar' }).click();
      const dialog = page.getByRole('dialog', { name: 'Customize toolbar' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('checkbox', { name: 'Symbol search' })).toBeDisabled();
      await expect(dialog.getByRole('checkbox', { name: 'Interval' })).toBeDisabled();
      // An action the default bar shows.
      await dialog.getByRole('checkbox', { name: 'Full screen' }).uncheck();
      await expect(topBar(page).getByRole('button', { name: 'Full screen' })).toHaveCount(0);
      await review(page, `customize-${scheme}`);
      await dialog.getByRole('button', { name: 'Reset to default' }).click();
      await expect(topBar(page).getByRole('button', { name: 'Full screen' })).toBeVisible();
      await dialog.getByRole('button', { name: 'Close' }).click();
      await expect(dialog).toBeHidden();
    });

    test('a dropped feed shows a status toast until it is back', async ({ page }) => {
      const view = topBar(page).getByRole('button', { name: 'View' });
      const toasts = page.locator('.pc-toasts');
      // The live feed entry cycles: live, paused, dropped, live.
      await pick(page, view, 'Live updates');
      await pick(page, view, 'Live updates paused');
      const status = toasts.locator('.pc-toast--status');
      await expect(status).toHaveText('Reconnecting…');
      await review(page, `toast-status-${scheme}`);
      await pick(page, view, 'Live feed dropped');
      await expect(status).toHaveCount(0);
    });

    test('a notification toast shows and is dismissed', async ({ page }) => {
      const view = topBar(page).getByRole('button', { name: 'View' });
      await pick(page, view, 'Sketch drawings');
      const toast = page.locator('.pc-toast').filter({ hasText: /^Sketching is on/ });
      await expect(toast).toBeVisible();
      await review(page, `toast-notice-${scheme}`);
      await toast.getByRole('button', { name: 'Dismiss' }).click();
      await expect(toast).toHaveCount(0);
      await pick(page, view, 'Sketch drawings');
      expect(await page.evaluate(() => window.chart.features.sketch)).toBe(false);
    });
  });
}
