import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Chart, Seasonality } from '@charton/core';
import type { ChartGrid, ChartShell } from '@charton/ui';

/**
 * Shared steps of the demo tests: open a page in a colour scheme, read the
 * chart the demo puts on `window` (apps/demo/src/expose.ts), find canvas-drawn
 * controls and sample pixels.
 */

declare global {
  interface Window {
    chart: Chart;
    shell: ChartShell;
    grid: ChartGrid;
    charts: Chart[];
    seasonality: Seasonality;
  }
}

export const SCHEMES = ['dark', 'light'] as const;
export type Scheme = (typeof SCHEMES)[number];

/** Whether a `#rrggbb` or `rgb()` colour is light, by its luminance. */
export const isLightColor = (color: string): boolean => {
  const [r, g, b] = rgbOf(color);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 128;
};

export function rgbOf(color: string): [number, number, number] {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(color);
  if (hex) return [parseInt(hex[1]!, 16), parseInt(hex[2]!, 16), parseInt(hex[3]!, 16)];
  const rgb = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(color);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  throw new Error(`Not a colour: ${color}`);
}

/** What the page logs for each slow-frame notice it keeps out. */
const SLOW_FRAMES_LOG = 'demo-e2e: slow-frame notice kept out';

/**
 * The main demo page with its bars loaded, in the theme of the colour scheme
 * the test emulates (the shell follows the system scheme). The notice that
 * frames are slow, which the software renderer can raise at any moment, is
 * kept out: a toast that comes and goes would get in the way of clicks. How
 * many were kept out goes in the test's `slow-frames` annotation and the log.
 */
export async function openDemo(page: Page, scheme: Scheme): Promise<void> {
  await page.addInitScript((log) => {
    let chart: Chart | undefined;
    // The demo assigns `window.chart` once it has made the chart (apps/demo/src/expose.ts).
    Object.defineProperty(window, 'chart', {
      configurable: true,
      get: () => chart,
      set: (value: Chart) => {
        chart = value;
        chart.on('ui:notify', (e) => {
          if (!e.message.startsWith('Frames take')) return;
          e.preventDefault();
          console.info(log);
        });
      },
    });
  }, SLOW_FRAMES_LOG);
  const info = test.info();
  let slowFrames = 0;
  page.on('console', (message) => {
    if (message.text() !== SLOW_FRAMES_LOG) return;
    if (slowFrames++ === 0) info.annotations.push({ type: 'slow-frames', description: '' });
    info.annotations.find((a) => a.type === 'slow-frames')!.description = `${slowFrames} slow-frame notices kept out`;
  });
  page.on('close', () => {
    if (slowFrames > 0) console.log(`${info.titlePath.join(' > ')}: ${slowFrames} slow-frame notices kept out`);
  });
  await page.goto('/');
  await page.waitForFunction(() => (window.chart?.main?.data.length ?? 0) > 0);
  // The demo hides its chart style and Layers menus to stay minimal (Customize toolbar adds them back); the tests use them.
  await page.evaluate(() => {
    const { shell } = window as unknown as { shell: { toolbar: { update(id: string, patch: { hidden: boolean }): void } } };
    for (const id of ['style', 'layers']) shell.toolbar.update(id, { hidden: false });
  });
  expect(isLightColor(await page.evaluate(() => window.chart.theme.background))).toBe(scheme === 'light');
}

/** The chart root's position on the page, to turn chart-root css px into page coordinates. */
export async function chartOrigin(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const r = window.chart.root.getBoundingClientRect();
    return { x: r.left, y: r.top };
  });
}

/**
 * Runs of the chart's pointer cursor along a row, from `x0` towards `x1`
 * (chart-root css px): where the cursor changes over canvas-drawn labels,
 * which have no DOM of their own. Hovers with pointer events sent in the page,
 * which the chart answers at once, so a long row takes no time.
 */
export async function cursorRuns(page: Page, y: number, x0: number, x1: number): Promise<{ from: number; to: number; cursor: string }[]> {
  return page.evaluate(
    ([y, x0, x1]) => {
      const root = window.chart.root;
      const box = root.getBoundingClientRect();
      const runs: { from: number; to: number; cursor: string }[] = [];
      const dir = Math.sign(x1 - x0);
      for (let x = x0; dir * (x1 - x) >= 0; x += dir) {
        const at = { clientX: box.left + x, clientY: box.top + y, pointerType: 'mouse', pointerId: 1, isPrimary: true, bubbles: true };
        root.dispatchEvent(new PointerEvent('pointermove', at));
        const cursor = root.style.cursor;
        const last = runs[runs.length - 1];
        if (last && last.cursor === cursor) last.to = x;
        else runs.push({ from: x, to: x, cursor });
      }
      return runs;
    },
    [y, x0, x1] as const,
  );
}

/** Press and release the mouse at a chart-root point without moving between, as a click on a canvas label needs. */
export async function clickAt(page: Page, x: number, y: number): Promise<void> {
  const origin = await chartOrigin(page);
  await page.mouse.move(origin.x + x, origin.y + y);
  await page.mouse.down();
  await page.mouse.up();
}

/** RGB pixels of a page region, as rows of `[r, g, b]`, read from a screenshot. */
export async function pixels(page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<[number, number, number][][]> {
  const png = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
  // Decoded by the browser, so the tests need no image library.
  const data = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    return { width: image.width, height: image.height, rgba: Array.from(ctx.getImageData(0, 0, image.width, image.height).data) };
  }, png.toString('base64'));
  const rows: [number, number, number][][] = [];
  for (let y = 0; y < data.height; y++) {
    const row: [number, number, number][] = [];
    for (let x = 0; x < data.width; x++) {
      const i = (y * data.width + x) * 4;
      row.push([data.rgba[i]!, data.rgba[i + 1]!, data.rgba[i + 2]!]);
    }
    rows.push(row);
  }
  return rows;
}

/** Largest channel difference between two colours. */
export const colorDistance = (a: readonly number[], b: readonly number[]): number =>
  Math.max(Math.abs(a[0]! - b[0]!), Math.abs(a[1]! - b[1]!), Math.abs(a[2]! - b[2]!));

/**
 * Open the flyout of the rail group whose opener is named `opener` (`More lines`) as a mouse
 * does: by resting on the group. The opener itself is the keyboard's way in and takes no clicks.
 */
export async function openRailGroup(page: Page, opener: string): Promise<Locator> {
  const rail = page.getByRole('toolbar', { name: 'Drawing tools', exact: true });
  const group = rail.locator('.pc-rail-group').filter({ has: page.getByRole('button', { name: opener, exact: true }) });
  await group.locator('> .pc-icon-btn').hover();
  const menu = group.getByRole('menu');
  await expect(menu).toBeVisible();
  return menu;
}

/** Pick an option from one of the shell's menu buttons (a listbox of options, or a menu of checkable items). */
export async function pick(page: Page, trigger: Locator, option: string | RegExp): Promise<void> {
  await trigger.click();
  const popover = page.locator('.pc-popover').filter({ visible: true }).last();
  const item = (role: 'option' | 'menuitem' | 'menuitemcheckbox' | 'menuitemradio') => popover.getByRole(role, { name: option, exact: true });
  await item('option').or(item('menuitem')).or(item('menuitemcheckbox')).or(item('menuitemradio')).first().click();
}

/**
 * A screenshot for a person to look at, not compared with anything, in
 * `test-results/demo-review/`. Animations are finished first, so pop-ins show.
 */
export async function review(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `test-results/demo-review/${name}.png`, animations: 'disabled' });
}
