import { expect, test } from '@playwright/test';

/**
 * Screenshot tests of the scenes in visual/main.ts, in both themes, compared with the
 * baselines in visual/__screenshots__/<platform>/. Update them with
 * `pnpm test:browser --project=visual --update-snapshots` after a deliberate rendering change (see CONTRIBUTING.md).
 */

const SCENES = ['candles-volume', 'line', 'indicator', 'drawings', 'shell'];

for (const theme of ['dark', 'light']) {
  test(`scenes match the baselines in the ${theme} theme`, async ({ page }) => {
    // Countdowns, clocks and "now" lines read the clock: pin it after the last bar.
    await page.clock.setFixedTime(new Date('2024-06-01T00:00:00Z'));
    await page.goto(`/?theme=${theme}`);
    await page.locator('html[data-done]').waitFor();
    for (const scene of SCENES) {
      await expect.soft(page.locator(`#${scene}`)).toHaveScreenshot(`${scene}-${theme}.png`);
    }
  });
}
