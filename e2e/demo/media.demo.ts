import { expect, test, type Page } from '@playwright/test';
import { chartOrigin, colorDistance, openDemo, openRailGroup, pixels, review, rgbOf, SCHEMES } from './helpers';

/**
 * Images pasted on the chart become image drawings (#828: images are checked
 * before they are decoded, and ordinary ones still land), as do files picked
 * for the image tool, through the same checks; and the Appearance panel's
 * watermark section has a row for the watermark's name line (#820).
 */

/** The colour of the square in the middle of the pasted test image. */
const INNER = '#22bbdd';

/**
 * Paste an image made in the page (a pink 64 × 40 box with a blue square) the
 * way Ctrl/Cmd+V delivers one: the shortcut on the focused chart, then the
 * clipboard event carrying the file.
 */
async function pasteImage(page: Page, type: 'image/png' | 'image/jpeg'): Promise<void> {
  await page.evaluate(
    async ([type, inner]) => {
      const canvas = new OffscreenCanvas(64, 40);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#e0457b';
      ctx.fillRect(0, 0, 64, 40);
      ctx.fillStyle = inner;
      ctx.fillRect(20, 8, 24, 24);
      const blob = await canvas.convertToBlob({ type, quality: 0.95 });
      const target = document.activeElement!;
      const mac = navigator.platform.startsWith('Mac');
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', ctrlKey: !mac, metaKey: mac, bubbles: true, cancelable: true }));
      const data = new DataTransfer();
      data.items.add(new File([blob], `pasted.${type.slice(6)}`, { type }));
      target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    },
    [type, INNER] as const,
  );
}

/**
 * How close the pixels around the centre of image drawing `n` come to the pasted image's inner
 * colour: the nearest of a 5 × 5 block, so a crosshair line through the centre does not hide it. The
 * centre is read again each time, in case the price scale moved with a live bar.
 */
async function distanceFromInner(page: Page, n: number): Promise<number> {
  const origin = await chartOrigin(page);
  const image = (await images(page))[n]!;
  const block = await pixels(page, { x: origin.x + image.x - 2, y: origin.y + image.y - 2, width: 5, height: 5 });
  return Math.min(...block.flat().map((pixel) => colorDistance(pixel, rgbOf(INNER))));
}

/** Pick the Image tool from the rail and draw its box, which asks for a file. */
async function drawImageBox(page: Page): Promise<void> {
  const menu = await openRailGroup(page, 'More annotate');
  await menu.getByRole('menuitemradio', { name: 'Image', exact: true }).click();
  const plot = page.getByRole('application');
  await plot.click({ position: { x: 400, y: 200 } });
  await plot.click({ position: { x: 600, y: 360 } });
}

const images = (page: Page) =>
  page.evaluate(() =>
    window.chart.drawings
      .getAll()
      .filter((d) => d.type === 'image')
      .map((d) => ({
        text: d.text,
        // The box's centre in chart-root css px.
        x: (window.chart.timeToX(d.points[0]!.time)! + window.chart.timeToX(d.points[1]!.time)!) / 2,
        y: (window.chart.priceToY(d.points[0]!.price)! + window.chart.priceToY(d.points[1]!.price)!) / 2,
      })),
  );

for (const scheme of SCHEMES) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test('pasted PNG and JPEG images become image drawings', async ({ page }) => {
      await openDemo(page, scheme);
      for (const [n, type] of (['image/png', 'image/jpeg'] as const).entries()) {
        // Pasted images centre on the crosshair: one spot per image.
        await page.getByRole('application').click({ position: { x: 300 + n * 300, y: 300 } });
        await pasteImage(page, type);
        await expect.poll(async () => (await images(page)).length, `${type} pasted`).toBe(n + 1);
        const image = (await images(page))[n]!;
        expect(image.text).toMatch(/^pasted-/);
        // The image itself is drawn there, not the dashed box of one still loading or the crossed one of a failure.
        await page.keyboard.press('Escape');
        // Off the chart; the crosshair may stay where the image was pasted, which `distanceFromInner` allows for.
        await page.mouse.move(1, 1);
        await expect.poll(() => distanceFromInner(page, n), `${type} drawn`).toBeLessThan(40);
      }
      await review(page, `paste-${scheme}`);
    });

    test('after a reload, a saved image drawing does not show an image pasted later', async ({ page }) => {
      await openDemo(page, scheme);
      const plot = page.getByRole('application');
      await plot.click({ position: { x: 300, y: 300 } });
      await pasteImage(page, 'image/png');
      await expect.poll(async () => (await images(page)).length).toBe(1);
      const [saved] = await images(page);
      // Drawings are saved per symbol after changes settle.
      await expect.poll(() => page.evaluate((ref) => Object.values(localStorage).some((v) => v.includes(ref)), saved!.text)).toBe(true);

      // The page keeps pasted files in memory only, so the reloaded drawing has lost its image.
      await page.reload();
      await page.waitForFunction(() => (window.chart?.main?.data.length ?? 0) > 0);
      await expect.poll(async () => (await images(page)).map((i) => i.text)).toEqual([saved!.text]);
      await plot.click({ position: { x: 900, y: 300 } });
      await pasteImage(page, 'image/png');
      await expect.poll(async () => (await images(page)).length).toBe(2);
      const [old, fresh] = await images(page);
      expect(fresh!.text).not.toBe(old!.text);
      await page.keyboard.press('Escape');
      await page.mouse.move(1, 1);
      // The new image draws, which also shows the frame after it is on screen; the old drawing shows its crossed box, not it.
      await expect.poll(() => distanceFromInner(page, 1)).toBeLessThan(40);
      expect(await distanceFromInner(page, 0)).toBeGreaterThan(80);
    });

    test('the image tool asks for a file and draws it', async ({ page }) => {
      await openDemo(page, scheme);
      const png = await page.evaluate(async () => {
        const canvas = new OffscreenCanvas(32, 32);
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#22bbdd';
        ctx.fillRect(0, 0, 32, 32);
        const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
        return btoa(String.fromCharCode(...bytes));
      });
      const chooser = page.waitForEvent('filechooser');
      await drawImageBox(page);
      await (await chooser).setFiles({ name: 'square.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
      await expect.poll(async () => (await images(page)).map((i) => i.text)).toEqual([expect.stringMatching(/^pasted-/)]);
    });

    test('the image tool turns down a file that is not an image', async ({ page }) => {
      await openDemo(page, scheme);
      const chooser = page.waitForEvent('filechooser');
      await drawImageBox(page);
      // Named and typed as a PNG, but not one by its bytes: the tool's own checks catch it, as for a paste.
      await (await chooser).setFiles({ name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
      await expect(page.locator('.pc-toast').filter({ hasText: 'not an image the chart takes' })).toBeVisible();
      expect(await images(page)).toEqual([]);
    });

    test('undo and redo after a cancelled file pick do not ask again', async ({ page }) => {
      await openDemo(page, scheme);
      let asked = 0;
      page.on('filechooser', () => asked++);
      const chooser = page.waitForEvent('filechooser');
      await drawImageBox(page);
      await (await chooser).setFiles([]);
      await expect.poll(async () => (await images(page)).length).toBe(0);
      const steps: [string, number][] = [
        // Undo brings the empty box back, then takes the drawing away; redo draws it again, then removes it.
        ['ControlOrMeta+Z', 1],
        ['ControlOrMeta+Z', 0],
        ['ControlOrMeta+Shift+Z', 1],
        ['ControlOrMeta+Shift+Z', 0],
      ];
      for (const [key, count] of steps) {
        await page.keyboard.press(key);
        await expect.poll(async () => (await images(page)).length, key).toBe(count);
      }
      expect(asked, 'file choosers opened').toBe(1);
    });

    test('the watermark row in the Appearance panel sets its name line', async ({ page }) => {
      await openDemo(page, scheme);
      await page.getByRole('toolbar', { name: 'Chart toolbar' }).getByRole('button', { name: 'Settings' }).click();
      await page.getByRole('dialog', { name: 'Chart settings' }).getByRole('button', { name: 'Colors…' }).click();
      const section = page.getByRole('region', { name: 'Watermark' });
      await section.scrollIntoViewIfNeeded();
      const name = section.getByRole('textbox', { name: 'Name' });
      await expect(name).toHaveValue('');
      await name.fill('Desk 7');
      await expect.poll(() => page.evaluate(() => window.chart.watermark.options.author)).toBe('Desk 7');
      await review(page, `watermark-row-${scheme}`);
      await name.fill('');
      await expect.poll(() => page.evaluate(() => window.chart.watermark.options.author)).toBe('');
    });
  });
}
