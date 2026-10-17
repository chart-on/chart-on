import { expect, test, type Locator, type Page } from '@playwright/test';
import { openDemo, pick, review, SCHEMES } from './helpers';

/**
 * Style templates and defaults in the drawing and indicator settings (#832,
 * #824): Save as default and Reset default for a drawing tool and for an
 * indicator, the picker adding an indicator from its default in two undo
 * steps, and the indicator panel's Template menu, unclipped, whose applied
 * template Cancel takes back.
 */

/** Not a panel still sliding out after it closed. */
const open = (page: Page) => page.locator('[role=dialog]:not([data-closing])');
const toast = (page: Page, text: string) => page.locator('.pc-toast').filter({ hasText: text });
/** Click the plot, which focuses the chart for its keys, away from the legend and the overlays. */
const focusChart = (page: Page) => page.getByRole('application').click({ position: { x: 640, y: 330 } });

/** Every option of the open menu is on screen and on top, not cut off by the panel it opened from. */
async function expectUnclipped(page: Page, menu: Locator): Promise<void> {
  const viewport = page.viewportSize()!;
  for (const option of await menu.getByRole('option').all()) {
    const box = (await option.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    const onTop = await option.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const corners = [
        [r.left + 2, r.top + 2],
        [r.right - 2, r.bottom - 2],
      ];
      return corners.every(([x, y]) => el.contains(document.elementFromPoint(x!, y!)));
    });
    expect(onTop, `${await option.textContent()} is covered`).toBe(true);
  }
}

/** Draw a trend line with the rail tool between two plot points; returns its id. */
async function drawTrendLine(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<string> {
  const before = await page.evaluate(() => window.chart.drawings.getAll().map((d) => d.id));
  await page.getByRole('toolbar', { name: 'Drawing tools', exact: true }).getByRole('button', { name: 'Trend line', exact: true }).click();
  const plot = page.getByRole('application');
  await plot.click({ position: from });
  await plot.click({ position: to });
  await page.keyboard.press('Escape');
  const drawn = await page.evaluate((before) => window.chart.drawings.getAll().filter((d) => !before.includes(d.id)), before);
  expect(drawn).toHaveLength(1);
  return drawn[0]!.id;
}

/** Open the settings of a drawing through its floating toolbar. */
async function openDrawingSettings(page: Page, id: string): Promise<Locator> {
  await page.evaluate((id) => window.chart.drawings.select(id), id);
  await page.getByRole('toolbar', { name: 'Selected drawing' }).getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Trend line' }).and(open(page));
  await expect(dialog).toBeVisible();
  return dialog;
}

const lineWidthOf = (page: Page, id: string) => page.evaluate((id) => window.chart.drawings.getAll().find((d) => d.id === id)!.style.lineWidth, id);

/** Add RSI through the indicator picker, as a user would. */
async function addRsiFromPicker(page: Page): Promise<void> {
  await page.getByRole('toolbar', { name: 'Chart toolbar' }).getByRole('button', { name: 'Indicators', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Indicators' });
  await picker.getByRole('combobox', { name: 'Search indicators' }).fill('RSI');
  await picker.getByRole('button', { name: 'Add RSI to the chart' }).click();
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
}

const rsiStates = (page: Page) =>
  page.evaluate(() =>
    window.chart.indicators
      .getAll()
      .filter((i) => i.type === 'rsi')
      .map((i) => {
        const s = i.serialize();
        return { length: s.inputs.length as number, width: s.plotStyles?.rsi?.lineWidth };
      }),
  );

/** Open the settings of the n-th RSI from its legend row. */
async function openRsiSettings(page: Page, n = 0): Promise<Locator> {
  await page.getByRole('button', { name: /^Settings for RSI/ }).nth(n).click();
  const dialog = page.getByRole('dialog', { name: 'RSI' }).and(open(page));
  await expect(dialog).toBeVisible();
  return dialog;
}

for (const scheme of SCHEMES) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test('a drawing tool default: save, use and reset', async ({ page }) => {
      await openDemo(page, scheme);
      const first = await drawTrendLine(page, { x: 300, y: 300 }, { x: 500, y: 220 });
      const defaultWidth = await lineWidthOf(page, first);

      let dialog = await openDrawingSettings(page, first);
      await pick(page, dialog.getByRole('button', { name: /^Line width/ }), '3px');
      await pick(page, dialog.getByRole('button', { name: 'Template' }), 'Save as default');
      await expect(toast(page, 'Saved as default')).toBeVisible();
      await review(page, `drawing-default-${scheme}`);
      await dialog.getByRole('button', { name: 'Ok' }).click();
      await expect(dialog).toBeHidden();

      // The next trend line starts from the saved default.
      const second = await drawTrendLine(page, { x: 300, y: 380 }, { x: 500, y: 300 });
      expect(await lineWidthOf(page, second)).toBe(3);

      dialog = await openDrawingSettings(page, second);
      await pick(page, dialog.getByRole('button', { name: 'Template' }), 'Reset default');
      await expect(toast(page, 'Default reset')).toBeVisible();
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      const third = await drawTrendLine(page, { x: 600, y: 380 }, { x: 800, y: 300 });
      expect(await lineWidthOf(page, third)).toBe(defaultWidth);
    });

    test('an indicator default: the picker adds from it in two undo steps', async ({ page }) => {
      await openDemo(page, scheme);
      await addRsiFromPicker(page);
      expect(await rsiStates(page)).toEqual([{ length: 14, width: undefined }]);

      let dialog = await openRsiSettings(page);
      await dialog.getByRole('spinbutton', { name: 'Length' }).fill('21');
      await dialog.getByRole('tab', { name: 'Style' }).click();
      await pick(page, dialog.getByRole('group', { name: 'rsi' }).getByRole('button', { name: /^Line width/ }), '3px');
      await pick(page, dialog.getByRole('button', { name: 'Template' }), 'Save as default');
      await expect(toast(page, 'Saved as default')).toBeVisible();
      await dialog.getByRole('button', { name: 'Ok' }).click();
      await expect(dialog).toBeHidden();

      await addRsiFromPicker(page);
      await expect.poll(() => rsiStates(page)).toEqual([
        { length: 21, width: 3 },
        { length: 21, width: 3 },
      ]);
      // Undo first takes the saved plot style back, then the add.
      await focusChart(page);
      await page.keyboard.press('ControlOrMeta+Z');
      await expect.poll(() => rsiStates(page)).toEqual([
        { length: 21, width: 3 },
        { length: 21, width: undefined },
      ]);
      await page.keyboard.press('ControlOrMeta+Z');
      await expect.poll(() => rsiStates(page)).toEqual([{ length: 21, width: 3 }]);

      dialog = await openRsiSettings(page);
      await pick(page, dialog.getByRole('button', { name: 'Template' }), 'Reset default');
      await expect(toast(page, 'Default reset')).toBeVisible();
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await addRsiFromPicker(page);
      await expect.poll(() => rsiStates(page)).toEqual([
        { length: 21, width: 3 },
        { length: 14, width: undefined },
      ]);
    });

    test('the Template menu in the indicator panel header is not clipped', async ({ page }) => {
      await openDemo(page, scheme);
      await addRsiFromPicker(page);
      let dialog = await openRsiSettings(page);
      const template = dialog.getByRole('button', { name: 'Template' });
      await expect(template).toBeVisible();
      await template.click();
      const menu = page.locator('.pc-popover').filter({ visible: true }).last();
      await expectUnclipped(page, menu);
      await review(page, `indicator-template-menu-${scheme}`);
      await page.keyboard.press('Escape');

      // In the narrow layout the panel is a bottom sheet; the menu still opens on screen.
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await page.setViewportSize({ width: 375, height: 740 });
      dialog = await openRsiSettings(page);
      await dialog.getByRole('button', { name: 'Template' }).click();
      await expectUnclipped(page, page.locator('.pc-popover').filter({ visible: true }).last());
      await review(page, `indicator-template-menu-narrow-${scheme}`);
    });

    test('an indicator template applies live, Cancel reverts it and Ok keeps it', async ({ page }) => {
      await openDemo(page, scheme);
      await addRsiFromPicker(page);
      const length = async () => (await rsiStates(page))[0]!.length;
      let dialog = await openRsiSettings(page);
      const template = dialog.getByRole('button', { name: 'Template' });

      // Save the edited inputs as a template; Cancel then puts the indicator back.
      await dialog.getByRole('spinbutton', { name: 'Length' }).fill('30');
      await pick(page, template, 'Save as template…');
      const prompt = page.getByRole('dialog', { name: 'Save as template…' });
      await prompt.getByRole('textbox', { name: 'Name' }).fill('Slow');
      await prompt.getByRole('button', { name: 'Save' }).click();
      await expect(toast(page, 'Saved template Slow')).toBeVisible();
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect.poll(length).toBe(14);

      // Applied live; Cancel reverts it.
      dialog = await openRsiSettings(page);
      await pick(page, dialog.getByRole('button', { name: 'Template' }), 'Slow');
      await expect.poll(length).toBe(30);
      await expect(dialog.getByRole('spinbutton', { name: 'Length' })).toHaveValue('30');
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect.poll(length).toBe(14);

      // Ok keeps it, as one undo step.
      dialog = await openRsiSettings(page);
      await pick(page, dialog.getByRole('button', { name: 'Template' }), 'Slow');
      await dialog.getByRole('button', { name: 'Ok' }).click();
      await expect.poll(length).toBe(30);
      await focusChart(page);
      await page.keyboard.press('ControlOrMeta+Z');
      await expect.poll(length).toBe(14);
    });
  });
}
