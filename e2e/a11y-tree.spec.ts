import { expect, test, type Page } from '@playwright/test';
import type { ChartShell } from '@chart-on/ui';
import { KEYBOARD_PAGE_PORT } from './keyboard-page/vite.config';
import { pageReady } from './keyboard-page/ready';

/**
 * What a screen reader reads from the UI shell (keyboard-page/), in both themes. Screen
 * readers cannot run here, so these check the browser's accessibility tree they read from:
 * roles, names, descriptions, states and live regions. Aria snapshots cover structure and
 * names; properties they leave out (role description, description, orientation, live
 * regions) come from the browser's own tree over the DevTools protocol. Changing numbers
 * (prices, dates) are matched loosely or compared with `chart.describe()`.
 */

const URL = `http://localhost:${KEYBOARD_PAGE_PORT}/`;

/** An element's node in the browser's accessibility tree. */
interface AxNode {
  role: string;
  name: string;
  description: string;
  /** Properties such as `roledescription`, `orientation`, `live`, `atomic`, `focusable`. */
  props: Record<string, unknown>;
}

/** The accessibility node of the first element matching `selector`. */
async function axNode(page: Page, selector: string): Promise<AxNode> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error(`no element matches ${selector}`);
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
    const node = nodes[0]!;
    return {
      role: String(node.role?.value ?? ''),
      name: String(node.name?.value ?? ''),
      description: String(node.description?.value ?? ''),
      props: Object.fromEntries((node.properties ?? []).map((p) => [p.name, p.value.value])),
    };
  } finally {
    await cdp.detach();
  }
}

const chartOf = (page: Page) => page.evaluate(() => (window as unknown as { shell: ChartShell }).shell.chart.describe());

for (const theme of ['dark', 'light'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`${URL}?theme=${theme}`);
      await pageReady(page);
    });

    test('the bars are named toolbars, the navigator a named group of sliders', async ({ page }) => {
      await expect(page.locator('body')).toMatchAriaSnapshot(`
        - toolbar "Chart toolbar":
          - button /symbol search/
          - button "Interval"
          - button "Chart type"
        - toolbar "Drawing tools":
          - button "Crosshair" [pressed]
          - button "More cursors"
          - button "Trend line"
        - application "Chart"
        - group "Chart navigator":
          - slider "Visible range"
          - slider "Start of visible range"
          - slider "End of visible range"
        - toolbar "Chart range and scale":
          - button "Timezone"
          - button "Price scale"
      `);
      // Screen readers tell which arrow keys move in a toolbar from its orientation.
      expect(await axNode(page, '.pc-shell-top > .pc-toolbar')).toMatchObject({ role: 'toolbar', props: { orientation: 'horizontal' } });
      expect(await axNode(page, '.pc-rail')).toMatchObject({ role: 'toolbar', props: { orientation: 'vertical' } });
      expect(await axNode(page, '.pc-bottombar > .pc-toolbar')).toMatchObject({ role: 'toolbar', props: { orientation: 'horizontal' } });
    });

    test('the chart is a focusable chart described by its summary', async ({ page }) => {
      const chart = page.getByRole('application', { name: 'Chart' });
      await expect(chart).toHaveAccessibleDescription(/^SAMPLE\. \d+ bars from .+ to .+\. Close [\d.]+ to [\d.]+, (up|down) .+\. High [\d.]+, low [\d.]+\.$/);
      await expect(chart).toHaveAccessibleDescription(await chartOf(page));
      const node = await axNode(page, '.pc-chart');
      expect(node).toMatchObject({ role: 'application', name: 'Chart', props: { roledescription: 'chart', focusable: true } });
      // The summary is read on focus, not as a live region on every change.
      expect((await axNode(page, `#${await chart.getAttribute('aria-describedby')}`)).props.live).toBeUndefined();

      // Its controls are inside it, named.
      await expect(chart).toMatchAriaSnapshot(`
        - application "Chart":
          - group "SAMPLE":
            - button "Hide SAMPLE"
            - button "Settings for SAMPLE"
            - button "More actions for SAMPLE"
          - group "Close":
            - button "Hide Close"
            - button "Remove Close"
      `);

      // Panning from the keyboard changes the summary; the description follows (throttled).
      const before = await chartOf(page);
      await chart.focus();
      await page.keyboard.press('PageUp');
      await expect.poll(() => chartOf(page)).not.toBe(before);
      await expect(chart).toHaveAccessibleDescription(await chartOf(page));
    });

    test('announcements and the crosshair readout are polite live regions', async ({ page }) => {
      const announcements = await axNode(page, '.pc-chart [data-role=announcements]');
      expect(announcements.props).toMatchObject({ live: 'polite', atomic: true });
      await page.evaluate(() => (window as unknown as { shell: ChartShell }).shell.chart.announce('Alert crossed'));
      await expect(page.locator('.pc-chart [data-role=announcements]')).toHaveText('Alert crossed');

      // The readout, off by default, reads the values under the crosshair once turned on.
      const readout = page.locator('.pc-chart [aria-live=polite]:not([data-role])');
      await expect(readout).toHaveCount(1);
      await expect(readout).toHaveText('');
      await page.evaluate(() =>
        (window as unknown as { shell: ChartShell }).shell.chart.applyOptions({ accessibility: { crosshairReadout: true } }),
      );
      const box = (await page.locator('.pc-chart canvas').first().boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
      await expect(readout).toHaveText(/SAMPLE/);
      expect((await axNode(page, '.pc-chart [aria-live=polite]:not([data-role])')).props).toMatchObject({ live: 'polite', atomic: true });
    });

    const menus = [
      {
        name: 'toolbar menu',
        trigger: '.pc-shell-top > .pc-toolbar button[aria-label="Interval"]',
        snapshot: `
          - listbox "Interval":
            - option "1m"
            - option "1d" [selected]
        `,
        focused: { role: 'option', name: '1d', selected: true },
      },
      {
        name: 'bottom bar menu',
        trigger: '.pc-bottombar button[aria-label="Timezone"]',
        snapshot: `
          - listbox "Timezone":
            - option "UTC" [selected]
            - option "New York"
            - option "Tokyo"
        `,
        focused: { role: 'option', name: 'UTC', selected: true },
      },
      {
        name: 'rail cursor flyout',
        trigger: '.pc-rail button[aria-label="More cursors"]',
        snapshot: `
          - menu "Cursors":
            - menuitemradio "Crosshair" [checked]
            - menuitemradio "Pointer"
        `,
        focused: { role: 'menuitemradio', name: 'Crosshair', checked: true },
      },
      {
        name: 'rail tool flyout',
        trigger: '.pc-rail button[aria-label="More lines"]',
        snapshot: `
          - menu "Lines":
            - group "Trend lines":
              - menuitemradio "Ray"
              - menuitemradio "Trend angle"
              - menuitemradio "Trend line" [checked]
            - group "Level lines":
              - menuitemradio "Horizontal line"
        `,
        focused: { role: 'menuitemradio', name: 'Trend line', checked: true },
      },
      {
        name: 'toolbar More menu',
        // The top toolbar's: the bottom bar is a toolbar with a More menu too.
        trigger: '.pc-shell-top .pc-toolbar-more [aria-haspopup]',
        // The overflowing buttons have fixed widths (keyboard-page/page.css), but where the
        // cut falls still depends on the font widths of the items before them; the last
        // button always overflows.
        snapshot: `
          - menu "More":
            - menuitem "Foxtrot"
        `,
        // Nothing is selected: focus lands on the first entry.
        focused: { role: 'menuitem' },
        narrow: true,
      },
    ] as const;
    test('the rail overflow is a disclosure of a named group holding the rail buttons that do not fit', async ({ page }) => {
      // A short page leaves the rail no room for all its buttons.
      await page.setViewportSize({ width: 1000, height: 360 });
      await page.reload();
      await pageReady(page);
      const trigger = page.locator('.pc-rail button[aria-label="More"]');
      // Its popover holds rail buttons, not menu items: no menu button role.
      await expect(trigger).not.toHaveAttribute('aria-haspopup');
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await trigger.focus();
      await page.keyboard.press('Enter');
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      const panel = page.locator('.pc-rail .pc-popover:visible');
      await expect(panel).toMatchAriaSnapshot(`
        - group "More":
          - button
      `);
      expect(await panel.getByRole('menuitem').count()).toBe(0);
      await expect(panel.getByRole('button').first()).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await expect(trigger).toBeFocused();
    });

    for (const menu of menus) {
      test(`${menu.name} opened from the keyboard: a named list of entries with their state`, async ({ page }) => {
        if ('narrow' in menu) {
          await page.setViewportSize({ width: 720, height: 720 });
          await page.reload();
          await pageReady(page);
        }
        const trigger = page.locator(menu.trigger);
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');
        await trigger.focus();
        await page.keyboard.press('Enter');
        await expect(trigger).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('.pc-popover:visible')).toMatchAriaSnapshot(menu.snapshot);
        const { role, ...state } = menu.focused;
        await expect(page.locator('.pc-popover:visible').getByRole(role, { exact: true, ...state }).first()).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      });
    }
  });
}
