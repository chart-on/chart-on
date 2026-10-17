import { expect, test } from '@playwright/test';

/**
 * The strict-policy page (docs/guide/security.md): served with the policy in
 * strict-page/vite.config.ts, the demo scenarios cause no policy violation, error or
 * request to another origin, in either theme.
 */

const MARKUP = '<img src=x onerror="alert(1)"><b>Bold</b>';

for (const theme of ['dark', 'light']) {
  test(`strict page passes in the ${theme} theme`, async ({ page, baseURL }) => {
    const problems: string[] = [];
    await page.exposeFunction('reportViolation', (text: string) => problems.push(`violation: ${text}`));
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        const report = (window as unknown as { reportViolation(text: string): void }).reportViolation;
        report(`${e.effectiveDirective} blocked ${e.blockedURI || 'inline'} ${e.sample}`.trim());
      });
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') problems.push(`console ${msg.type()}: ${msg.text()}`);
    });
    page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin !== baseURL && url.protocol !== 'data:') problems.push(`request: ${request.url()}`);
    });

    await page.goto(`/?theme=${theme}`);
    await page.locator('html[data-done]').waitFor();

    expect(problems).toEqual([]);
    // The scenarios ran: charts drew, and markup in titles, drawings and search results stayed text.
    expect(await page.locator('canvas').count()).toBeGreaterThan(0);
    expect(await page.getByText(MARKUP, { exact: true }).count()).toBeGreaterThan(0);
    expect(await page.locator('#core b, #shell b, #core script, #shell script').count()).toBe(0);
    // And the policy is in force: a markup sink throws.
    const enforced = await page.evaluate(() => {
      try {
        document.createElement('div').innerHTML = '<b>x</b>';
        return false;
      } catch {
        return true;
      }
    });
    expect(enforced).toBe(true);
  });
}
