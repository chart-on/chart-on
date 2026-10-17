import { expect, test, type Page } from '@playwright/test';
import type { HeatmapPage, ProbeResult } from './heatmap-page/main';

/**
 * Heatmap cell reduction on the GPU (heatmap-page/main.ts): one bright cell in a
 * 2,000-row grid at 2 columns and 4 rows per device pixel is lit in exactly the pixel
 * holding its centre at every sub-pixel pan offset with `cellReduce: 'max'` and `'sum'`,
 * and two cells sharing a pixel show their max or their sum. `'nearest'` (one sample per
 * pixel) drops the cell at some offsets. Pixels are read back from page screenshots.
 * Plus screenshot baselines of a zoomed-out heatmap in a short pane, in
 * heatmap-page/__screenshots__/<platform>/ (see CONTRIBUTING.md to update them).
 */

type Rect = ProbeResult['plot'];
type Pixel = { x: number; y: number; r: number; g: number; b: number };

/** Sub-pixel pans: columns by quarters of a pixel (half a column), rows by sixteenths of one. */
const OFFSETS = Array.from({ length: 16 }, (_, i) => ({ col: (i % 4) * 0.5, row: i * 0.25 }));

/**
 * Pixels of `rect` (css px, device scale 1) in the probe's black-to-magenta ramp, any
 * brightness, in page coordinates. The clip is snapped out to whole pixels, so screenshot
 * pixels are page pixels.
 */
async function litPixels(page: Page, rect: Rect): Promise<Pixel[]> {
  const x = Math.floor(rect.x);
  const y = Math.floor(rect.y);
  const clip = { x, y, width: Math.ceil(rect.x + rect.width) - x, height: Math.ceil(rect.y + rect.height) - y };
  const png = await page.screenshot({ clip });
  return page.evaluate(
    async ({ b64, x0, y0 }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, img.width, img.height).data;
      const lit: Pixel[] = [];
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
        // Magenta at any brightness: red equals blue, no green. Neither theme's background is.
        if (r > 24 && Math.abs(r - b) <= 4 && g <= 4) {
          const p = i / 4;
          lit.push({ x: x0 + (p % img.width), y: y0 + Math.floor(p / img.width), r, g, b });
        }
      }
      return lit;
    },
    { b64: png.toString('base64'), x0: x, y0: y },
  );
}

async function probe(page: Page, reduce: 'max' | 'sum' | 'nearest', offset: { col: number; row: number }, pair = false) {
  const result = await page.evaluate(
    (o) => (window as unknown as { heatmapPage: HeatmapPage }).heatmapPage.probe!(o),
    { reduce, ...offset, pair },
  );
  // The shader's pixel grid starts at the canvas corner; on whole pixels it is the page's.
  expect(Number.isInteger(result.canvas.x) && Number.isInteger(result.canvas.y), 'canvas on whole pixels').toBe(true);
  expect(result.colsPerPx).toBeCloseTo(2, 6);
  expect(result.rowsPerPx).toBeCloseTo(4, 6);
  // Each cell counts in the pixel holding its centre (the page aligns centres off pixel edges).
  const expected = result.cells.map((c) => ({ x: Math.floor(c.x), y: Math.floor(c.y) }));
  return { ...result, expected, lit: await litPixels(page, result.plot) };
}

/** The ramp's colour for `value` of 100: black to magenta, linear in 8-bit channels. */
const ramp = (value: number) => Math.round((255 * value) / 100);

for (const theme of ['dark', 'light']) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/?scene=probe&theme=${theme}`);
      await page.locator('html[data-done], html[data-error]').waitFor();
      expect(await page.locator('html').getAttribute('data-error')).toBeNull();
    });

    for (const reduce of ['max', 'sum'] as const) {
      test(`a single bright cell is lit in exactly its own pixel at every pan offset with ${reduce}`, async ({ page }) => {
        const seen = new Set<string>();
        for (const offset of OFFSETS) {
          const { lit, expected } = await probe(page, reduce, offset);
          const at = `offset ${JSON.stringify(offset)}`;
          // The expected pixel follows the pan, so a frame drawn before the pan would not match.
          expect(lit.map(({ x, y }) => ({ x, y })), at).toEqual(expected);
          expect(lit[0], at).toMatchObject({ r: 255, g: 0, b: 255 });
          seen.add(`${expected[0]!.x},${expected[0]!.y}`);
        }
        // The pans carry the cell across a pixel edge in each axis.
        const xs = new Set([...seen].map((p) => p.split(',')[0]));
        const ys = new Set([...seen].map((p) => p.split(',')[1]));
        expect(xs.size).toBeGreaterThanOrEqual(2);
        expect(ys.size).toBeGreaterThanOrEqual(2);
      });
    }

    test('two cells in one pixel show their max with max and their sum with sum', async ({ page }) => {
      const shown: Record<string, number> = {};
      for (const reduce of ['max', 'sum'] as const) {
        const { lit, expected } = await probe(page, reduce, OFFSETS[0]!, true);
        expect(expected[0], 'both cells in one pixel').toEqual(expected[1]);
        expect(lit.map(({ x, y }) => ({ x, y })), reduce).toEqual([expected[0]]);
        shown[reduce] = lit[0]!.r;
      }
      // Each cell holds 30 of the range's 100: max shows 30, sum 60.
      expect(Math.abs(shown.max! - ramp(30))).toBeLessThanOrEqual(1);
      expect(Math.abs(shown.sum! - ramp(60))).toBeLessThanOrEqual(1);
    });

    // A witness of how `nearest` behaves, not a requirement: one sample at each pixel's centre
    // (its own shader variant since #846), so a cell narrower than a pixel is missed at some
    // offsets. If a later change makes it keep such cells, update this test on purpose rather
    // than loosening it.
    test('nearest drops the cell at some offsets (one sample per pixel)', async ({ page }) => {
      const shown: number[] = [];
      for (const offset of OFFSETS) shown.push((await probe(page, 'nearest', offset)).lit.length);
      expect(shown.every((n) => n <= 1)).toBe(true);
      expect(shown).toContain(0);
      expect(shown).toContain(1);
    });

    test('a zoomed-out heatmap in a short pane matches the baseline', async ({ page }) => {
      // The last-bar countdown and "now" line read the clock: pin it after the last bar.
      await page.clock.setFixedTime(new Date('2026-01-01T00:00:00Z'));
      await page.goto(`/?scene=visual&theme=${theme}`);
      await page.locator('html[data-done], html[data-error]').waitFor();
      expect(await page.locator('html').getAttribute('data-error')).toBeNull();
      await expect(page.locator('#chart')).toHaveScreenshot(`heatmap-zoomed-out-${theme}.png`);
    });
  });
}
