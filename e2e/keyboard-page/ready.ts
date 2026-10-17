import { expect, type Page } from '@playwright/test';

/** Wait for main.ts to set up the page; fail at once, with its message, if it threw. */
export async function pageReady(page: Page): Promise<void> {
  await page.locator('html[data-done], html[data-error]').waitFor();
  expect(await page.locator('html').getAttribute('data-error'), 'page set-up error').toBeNull();
}
