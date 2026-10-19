import { expect, test, type Page } from '@playwright/test';
import type { ChartShell } from '@chart-on/ui';
import { KEYBOARD_PAGE_PORT } from './keyboard-page/vite.config';
import { pageReady } from './keyboard-page/ready';

/**
 * Keyboard and focus in the UI shell (keyboard-page/), with real key presses, in both
 * themes: Tab stops, arrow keys in the bars, F6 between areas, menus opened from the
 * keyboard, and Tab reach of the legend buttons and the scroll-to-newest button. Unit tests
 * in packages/ui/test cover the key handling itself; these check what only a browser shows:
 * the real Tab order, visible focus rings and focus moving into and out of menus.
 */

const URL = `http://localhost:${KEYBOARD_PAGE_PORT}/`;

type Region = 'toolbar' | 'rail' | 'chart' | 'navigator' | 'bottombar' | 'dialog' | 'page';

interface Focused {
  /** Accessible name, or the id of an element outside the shell. */
  label: string;
  region: Region;
  /** Inside an open dropdown menu. */
  menu: boolean;
  /** Shows a focus ring: `:focus-visible` with an outline, or an inset ring on itself or its `::after` (the chart's). */
  ring: boolean;
  /** Laid out and not transparent, itself or through an ancestor. */
  shown: boolean;
}

/** What has focus once running transitions and animations (a menu popping in) have ended. */
function focused(page: Page): Promise<Focused> {
  return page.evaluate(async () => {
    const ending = document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity);
    await Promise.all(ending.map((a) => a.finished.catch(() => {})));
    const el = document.activeElement as HTMLElement;
    const regions: [string, string][] = [
      ['[role=dialog]', 'dialog'],
      // Before `.pc-toolbar`: the bottom bar's items are a toolbar inside it.
      ['.pc-bottombar', 'bottombar'],
      ['.pc-toolbar', 'toolbar'],
      ['.pc-rail', 'rail'],
      ['.pc-chart', 'chart'],
      ['.pc-navigator', 'navigator'],
    ];
    const region = (regions.find(([selector]) => el.closest(selector))?.[1] ?? 'page') as Region;
    const style = getComputedStyle(el);
    const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0 && style.outlineColor !== 'rgba(0, 0, 0, 0)';
    const after = getComputedStyle(el, '::after');
    const inset = style.boxShadow.includes('inset') || (after.content !== 'none' && after.boxShadow.includes('inset'));
    let opacity = 1;
    for (let n: HTMLElement | null = el; n; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity);
    return {
      label: el.getAttribute('aria-label') ?? (el.id || el.textContent?.trim() || el.tagName),
      region,
      menu: !!el.closest('.pc-popover'),
      ring: el.matches(':focus-visible') && (outline || inset),
      shown: el.getClientRects().length > 0 && opacity > 0,
    };
  });
}

/** Press `key` and return what has focus then. */
async function press(page: Page, key: string): Promise<Focused> {
  await page.keyboard.press(key);
  return focused(page);
}

/** The page's globals (keyboard-page/main.ts). */
interface PageWindow {
  shell: ChartShell;
  presses: number;
}

/** Regions in the order focus visits them, each once per visit. */
const visits = (stops: Focused[]) => stops.map((s) => s.region).filter((r, i, all) => r !== all[i - 1]);

/** Tab (or Shift+Tab) from `from` until focus reaches `to`; the stops in between. */
async function tabStops(page: Page, from: string, to: string, key = 'Tab'): Promise<Focused[]> {
  await page.locator(from).focus();
  const stops: Focused[] = [];
  for (let i = 0; i < 60; i++) {
    const now = await press(page, key);
    if (now.label === to.slice(1)) return stops;
    stops.push(now);
  }
  throw new Error(`${key} never reached ${to}`);
}

/**
 * Each bar. The bottom bar holds a toolbar too (`.pc-bottombar > .pc-toolbar`), so the top
 * toolbar is the one in the shell's top strip.
 */
const BARS = { toolbar: '.pc-shell-top > .pc-toolbar', rail: '.pc-rail', bottombar: '.pc-bottombar' } as const;
const TOOLBAR = BARS.toolbar;

const expectRing = (f: Focused) => expect(f, `focus ring on ${f.label}`).toMatchObject({ ring: true, shown: true });

for (const theme of ['dark', 'light'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`${URL}?theme=${theme}`);
      await pageReady(page);
    });

    test('Tab visits each area once, in order, with a focus ring on every stop', async ({ page }) => {
      const stops = await tabStops(page, '#before', '#after');
      expect(visits(stops)).toEqual(['toolbar', 'rail', 'chart', 'navigator', 'bottombar']);
      for (const stop of stops) expectRing(stop);
      // Each bar is one stop; the chart comes first in its area, then its legend buttons.
      for (const bar of ['toolbar', 'rail', 'bottombar']) expect(stops.filter((s) => s.region === bar)).toHaveLength(1);
      expect(stops.find((s) => s.region === 'chart')!.label).toBe(await page.locator('.pc-chart').getAttribute('aria-label'));
      expect(stops.find((s) => s.region === 'navigator')!.label).toBe('Visible range');

      // Shift+Tab walks the same stops back.
      const back = await tabStops(page, '#after', '#before', 'Shift+Tab');
      expect(back.map((s) => s.label)).toEqual(stops.map((s) => s.label).reverse());
    });

    for (const [bar, next, previous] of [
      ['toolbar', 'ArrowRight', 'ArrowLeft'],
      ['rail', 'ArrowDown', 'ArrowUp'],
      ['bottombar', 'ArrowRight', 'ArrowLeft'],
    ] as const) {
      test(`arrow keys, Home and End move and wrap in the ${bar}`, async ({ page }) => {
        await page.locator(`${BARS[bar]} [tabindex="0"]`).focus();
        const first = await press(page, 'Home');
        const last = await press(page, 'End');
        expect(last.label).not.toBe(first.label);
        expect(await press(page, next)).toMatchObject({ label: first.label, region: bar });
        expect(await press(page, previous)).toMatchObject({ label: last.label, region: bar });
        await press(page, 'Home');
        const second = await press(page, next);
        expect(second.label).not.toBe(first.label);
        expect(second.region).toBe(bar);
        expectRing(first);
        expectRing(last);
        expectRing(second);
        // The bar stays one Tab stop: the focused button (disabled buttons take no focus at all).
        const tabbable = await page.evaluate(
          (selector) =>
            Array.from(document.querySelectorAll<HTMLButtonElement>(`${selector} button`)).filter(
              (b) => b.tabIndex === 0 && !b.disabled && b.getClientRects().length > 0 && !b.closest('.pc-popover'),
            ).length === 1 && document.activeElement!.matches('[tabindex="0"]'),
          BARS[bar],
        );
        expect(tabbable).toBe(true);
      });
    }

    test('Enter and Space press toolbar and bottom bar buttons', async ({ page }) => {
      await page.locator(TOOLBAR).getByRole('button', { name: 'Press', exact: true }).focus();
      await page.keyboard.press('Enter');
      await page.keyboard.press(' ');
      expect(await page.evaluate(() => (window as unknown as PageWindow).presses)).toBe(2);

      // The scale mode and auto-fit sit in one menu: Enter or Space opens it, the arrow keys reach an entry, and Enter or Space picks it.
      const bar = page.locator('.pc-bottombar');
      const trigger = bar.getByRole('button', { name: 'Price scale' });
      const mode = () => page.evaluate(() => (window as unknown as PageWindow).shell.chart.panes[0]!.price.mode);
      const pick = async (open: string, name: string, key: string) => {
        await trigger.focus();
        await page.keyboard.press(open);
        const entry = bar.getByRole('menuitemcheckbox', { name });
        for (let i = 0; i < 4 && !(await entry.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('ArrowDown');
        await expect(entry).toBeFocused();
        await page.keyboard.press(key);
        // Picking closes the menu; wait until it has faded out, so the next one opened is the only one.
        await expect(bar.getByRole('menu')).toHaveCount(0);
      };
      await pick('Enter', 'Logarithmic scale', 'Enter');
      expect(await mode()).toBe('log');
      await expect(trigger).toContainText('log');
      await pick(' ', 'Percent scale', ' ');
      expect(await mode()).toBe('percent');
      await trigger.focus();
      await page.keyboard.press('Enter');
      await expect(bar.getByRole('menuitemcheckbox', { name: 'Percent scale' })).toHaveAttribute('aria-checked', 'true');
      await expect(bar.getByRole('menuitemcheckbox', { name: 'Logarithmic scale' })).toHaveAttribute('aria-checked', 'false');
      await page.keyboard.press('Escape');
    });

    test('Enter and Space arm a rail tool, Shift+Enter keeps it', async ({ page }) => {
      const rail = page.locator('.pc-rail');
      const tool = () =>
        page.evaluate(() => {
          const { drawings } = (window as unknown as PageWindow).shell.chart;
          return { tool: drawings.tool, kept: drawings.toolKept };
        });
      const trend = rail.getByRole('button', { name: 'Trend line', exact: true });
      const text = rail.getByRole('button', { name: 'Text', exact: true });

      await trend.focus();
      await page.keyboard.press('Enter');
      expect(await tool()).toEqual({ tool: 'trendline', kept: false });
      await expect(trend).toHaveAttribute('aria-pressed', 'true');

      await text.focus();
      await page.keyboard.press(' ');
      expect(await tool()).toMatchObject({ tool: 'text', kept: false });

      await trend.focus();
      await page.keyboard.press('Shift+Enter');
      expect(await tool()).toEqual({ tool: 'trendline', kept: true });
      await expect(trend).toHaveAttribute('data-kept', '');
    });

    test('the flyout corner button of a rail group is reachable and shows a ring', async ({ page }) => {
      await page.locator('.pc-rail [tabindex="0"]').focus();
      expect(await press(page, 'Home')).toMatchObject({ label: 'Crosshair' });
      const corner = await press(page, 'ArrowDown');
      expect(corner).toMatchObject({ label: 'More cursors', region: 'rail' });
      expectRing(corner);
    });

    test('F6 and Shift+F6 cycle through the areas from each of them', async ({ page }) => {
      await page.locator(`${TOOLBAR} [tabindex="0"]`).focus();
      const order: Region[] = ['rail', 'chart', 'navigator', 'bottombar', 'toolbar'];
      for (const region of order) {
        const now = await press(page, 'F6');
        expect(now.region).toBe(region);
        expectRing(now);
      }
      for (const region of ['bottombar', 'navigator', 'chart', 'rail', 'toolbar'] as const) {
        expect((await press(page, 'Shift+F6')).region).toBe(region);
      }
      // From a legend button and a navigator handle, which are not an area's first stop.
      await page.locator('.pc-chart').focus();
      expect((await press(page, 'Tab')).label).toMatch(/SAMPLE/);
      expect((await press(page, 'F6')).region).toBe('navigator');
      await page.locator('.pc-navigator-handle').last().focus();
      expect((await press(page, 'Shift+F6')).region).toBe('chart');
    });

    test('F6 skips a hidden rail and toolbar', async ({ page }) => {
      await page.evaluate(() => (window as unknown as PageWindow).shell.applyFeatures({ rail: false }));
      await page.locator(`${TOOLBAR} [tabindex="0"]`).focus();
      expect((await press(page, 'F6')).region).toBe('chart');
      await page.evaluate(() => (window as unknown as PageWindow).shell.applyFeatures({ toolbar: false }));
      const cycle: Region[] = [];
      for (let i = 0; i < 3; i++) cycle.push((await press(page, 'F6')).region);
      expect(cycle).toEqual(['navigator', 'bottombar', 'chart']);
      expect((await press(page, 'Shift+F6')).region).toBe('bottombar');
    });

    test('F6 does nothing while the symbol search is open', async ({ page }) => {
      const header = page.locator(TOOLBAR).getByRole('button', { name: /symbol search/i });
      await header.focus();
      const search = await press(page, 'Enter');
      expect(search).toMatchObject({ region: 'dialog', label: 'Search symbols' });
      expect(await press(page, 'F6')).toEqual(search);
      expect(await press(page, 'Shift+F6')).toEqual(search);
      await expect(page.getByRole('combobox', { name: 'Search symbols' })).toBeVisible();
      expect(await press(page, 'Escape')).toMatchObject({ region: 'toolbar', label: await header.getAttribute('aria-label') });
    });

    const menus = [
      { name: 'toolbar menu', trigger: `${TOOLBAR} [aria-label="Interval"]`, selected: '1d' },
      { name: 'bottom bar menu', trigger: '.pc-bottombar [aria-label="Timezone"]', selected: 'UTC' },
      { name: 'rail flyout', trigger: '.pc-rail [aria-label="More cursors"]', selected: 'Crosshair' },
      // Nothing is selected in the overflow menu: focus lands on its first entry.
      { name: 'toolbar More menu', trigger: `${TOOLBAR} .pc-toolbar-more [aria-haspopup]`, selected: null, narrow: true },
    ];
    for (const menu of menus) {
      for (const key of ['Enter', 'Space'] as const) {
        test(`${menu.name} opened with ${key}: focus on the selected entry, arrows move, Escape returns`, async ({ page }) => {
          if (menu.narrow) {
            // Narrow enough to push buttons into the More menu, wide enough to keep the rail.
            // The overflowing buttons have fixed widths (keyboard-page/page.css), so several
            // go into the menu whatever the platform's fonts.
            await page.setViewportSize({ width: 720, height: 720 });
            await page.reload();
            await pageReady(page);
          }
          const trigger = page.locator(menu.trigger);
          const triggerLabel = await trigger.getAttribute('aria-label');
          await trigger.focus();
          const entry = await press(page, key === 'Space' ? ' ' : 'Enter');
          expect(entry.menu, 'focus moved into the menu').toBe(true);
          const entries = await page.evaluate(() =>
            Array.from(document.activeElement!.closest('.pc-popover')!.querySelectorAll('button'), (b) => b.getAttribute('aria-label') ?? b.textContent!.trim()),
          );
          expect(entry.label).toBe(menu.selected ?? entries[0]);
          expectRing(entry);
          expect(entries.length, 'the menu has entries to move between').toBeGreaterThan(1);
          const down = await press(page, 'ArrowDown');
          expect(down).toMatchObject({ menu: true });
          expect(down.label).not.toBe(entry.label);
          expectRing(down);
          expect(await press(page, 'ArrowUp')).toMatchObject({ menu: true, label: entry.label });
          expect(await press(page, 'Escape')).toMatchObject({ menu: false, label: triggerLabel });
          await expect(trigger).not.toHaveAttribute('aria-expanded', 'true');
          await expect(page.locator('.pc-popover:visible').filter({ has: page.getByText(entry.label, { exact: true }) })).toHaveCount(0);
        });
      }
    }

    test('legend buttons and the scroll-to-newest button are reachable with Tab from the chart', async ({ page }) => {
      /** Tab stops from the chart until focus leaves the chart area. */
      const chartStops = async () => {
        await page.locator('.pc-chart').focus();
        const stops: Focused[] = [];
        for (let now = await press(page, 'Tab'); now.region === 'chart'; now = await press(page, 'Tab')) {
          stops.push(now);
          if (stops.length === 60) throw new Error('Tab never left the chart area');
        }
        return stops;
      };
      const scroll = page.locator('.pc-scroll-realtime');
      const label = (await scroll.getAttribute('aria-label'))!;
      // At the newest bar the button is faded out: no Tab stop, nothing in the accessibility tree.
      await expect(scroll).toHaveAttribute('inert', '');
      expect((await chartStops()).map((s) => s.label)).not.toContain(label);

      // Scroll back so the scroll-to-newest button shows.
      await page.locator('.pc-chart').focus();
      await page.keyboard.press('PageUp');
      await expect(scroll).toHaveAttribute('tabindex', '0');
      await expect(scroll).not.toHaveAttribute('inert');

      const stops = await chartStops();
      const labels = stops.map((s) => s.label);
      expect(labels).toEqual(expect.arrayContaining(['Hide SAMPLE', 'Settings for SAMPLE', 'Hide Close', 'Remove Close', label]));
      for (const stop of stops) expectRing(stop);

      // Enter on it scrolls to the newest bar; as it hides, focus goes back to the chart.
      await scroll.focus();
      await page.keyboard.press('Enter');
      await expect(scroll).toHaveAttribute('tabindex', '-1');
      await expect(scroll).toHaveAttribute('inert', '');
      expect(await focused(page)).toMatchObject({ region: 'chart', label: await page.locator('.pc-chart').getAttribute('aria-label') });
    });
  });
}
