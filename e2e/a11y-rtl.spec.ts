import { expect, test, type Page } from '@playwright/test';

/**
 * Forced colours (#309) and right-to-left layout (#311) in a real browser, on the scenes of
 * a11y-rtl-page/main.ts: checks from the DOM and the chart's state, then screenshots compared
 * with the baselines in a11y-rtl-page/__screenshots__/<platform>/. Update them with
 * `pnpm test:browser --project=a11y-rtl --update-snapshots` after a deliberate rendering change.
 */

/** One `fillText` call on a 2D canvas: the text, and the direction and fill it was drawn with. */
interface TextCall {
  text: string;
  direction: string;
  fill: string;
}

declare global {
  interface Window {
    textCalls: TextCall[];
  }
}

/** Records every canvas `fillText`, so the spec sees what the chart drew and how. */
function recordCanvasText(): void {
  window.textCalls = [];
  const fillText = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof fillText>) {
    window.textCalls.push({ text: args[0], direction: this.direction, fill: String(this.fillStyle) });
    return fillText.apply(this, args);
  };
}

async function open(page: Page, query: string): Promise<void> {
  // Countdowns and the bottom bar clock read the clock: pin it after the last bar.
  await page.clock.setFixedTime(new Date('2024-06-01T00:00:00Z'));
  await page.addInitScript(recordCanvasText);
  await page.goto(`/?${query}`);
  await page.locator('html[data-done]').waitFor();
}

/** The focus ring of the first match of `selector` (drawn by its `pseudo` element when given). */
async function focusRing(page: Page, selector: string, pseudo?: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((el, pseudo) => {
      const style = getComputedStyle(el, pseudo);
      return { visible: el.matches(':focus-visible'), style: style.outlineStyle, width: parseFloat(style.outlineWidth), color: style.outlineColor };
    }, pseudo);
}

for (const scheme of ['dark', 'light'] as const) {
  test.describe(`forced colours, ${scheme} system palette`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ forcedColors: 'active', colorScheme: scheme });
      await open(page, `scene=forced&theme=${scheme}`);
    });

    test('the chart theme takes the system colours', async ({ page }) => {
      const result = await page.evaluate(() => {
        // System colours as the browser resolves them in this palette, with nothing forcing the probe itself.
        const probe = document.createElement('span');
        probe.style.forcedColorAdjust = 'none';
        document.body.append(probe);
        const system = (name: string) => {
          probe.style.color = name;
          return getComputedStyle(probe).color;
        };
        const names = ['Canvas', 'CanvasText', 'LinkText', 'Highlight', 'HighlightText'];
        const colors = Object.fromEntries(names.map((n) => [n, system(n)]));
        probe.remove();
        const { chart } = window.scene.shell;
        const t = chart.theme;
        // Canvas fill styles read back as hex; normalise the system colours the same way.
        const ctx = document.createElement('canvas').getContext('2d')!;
        const asFill = (color: string) => {
          ctx.fillStyle = color;
          return String(ctx.fillStyle);
        };
        // Axis and value-label text; tabular numerals draw it digit by digit.
        const numbers = window.textCalls.filter((c) => /^[\d.,]+$/.test(c.text));
        return {
          forced: matchMedia('(forced-colors: active)').matches,
          colors,
          theme: {
            background: t.background,
            text: t.text,
            separator: t.separator,
            up: t.up,
            down: t.down,
            labelBackground: t.labelBackground,
            labelText: t.labelText,
          },
          numbers: numbers.length,
          numberFills: [...new Set(numbers.map((c) => c.fill))],
          systemFills: names.map((n) => asFill(colors[n]!)),
          ink: asFill(colors.CanvasText!),
          axisRight: chart.priceAxisSpace('right'),
          hollowDown: chart.main?.options.hollowDown,
        };
      });
      expect(result.forced).toBe(true);
      const { colors } = result;
      // The emulated colour scheme picks the palette: a dark or a light canvas.
      const lightness = (rgb: string) => rgb.match(/\d+/g)!.slice(0, 3).reduce((sum, v) => sum + Number(v), 0) / 3;
      expect(lightness(colors.Canvas!) > 128).toBe(scheme === 'light');
      expect(result.theme).toEqual({
        background: colors.Canvas,
        text: colors.CanvasText,
        separator: colors.CanvasText,
        up: colors.LinkText,
        down: colors.CanvasText,
        labelBackground: colors.Highlight,
        labelText: colors.HighlightText,
      });
      // The price axis is laid out and its numbers are drawn in system colours, the axis labels in the text colour.
      expect(result.axisRight).toBeGreaterThan(0);
      expect(result.numbers).toBeGreaterThan(10);
      expect(result.numberFills).toContain(result.ink);
      for (const fill of result.numberFills) expect(result.systemFills).toContain(fill);
      // Falling candles are outlines, so direction reads from shape too.
      expect(result.hollowDown).toBe(true);
    });

    test('focus rings show in the highlight colour', async ({ page }) => {
      const system = await page.evaluate(() => {
        const probe = document.createElement('span');
        probe.style.forcedColorAdjust = 'none';
        document.body.append(probe);
        const read = (name: string) => {
          probe.style.color = name;
          return getComputedStyle(probe).color;
        };
        const colors = { highlight: read('Highlight'), highlightText: read('HighlightText') };
        probe.remove();
        return colors;
      });
      // The active tool has a Highlight fill, so its ring takes the text colour on it.
      const active = '.pc-rail .pc-icon-btn.is-active';
      await page.locator(active).focus();
      expect(await focusRing(page, active)).toEqual({ visible: true, style: 'solid', width: 2, color: system.highlightText });

      // The next tool, reached with the arrow keys as a keyboard user would (past the cursor's menu button).
      const next = '.pc-rail :focus';
      for (let i = 0; i < 3 && (await page.locator(next).getAttribute('aria-label')) !== 'Trend line'; i++) await page.keyboard.press('ArrowDown');
      await expect(page.locator(next)).toHaveAttribute('aria-label', 'Trend line');
      expect(await focusRing(page, next)).toEqual({ visible: true, style: 'solid', width: 2, color: system.highlight });
      await expect(page.locator('#scene')).toHaveScreenshot(`forced-${scheme}-rail-focus.png`);

      // The chart's ring is a layer over its canvases. It shows once the keyboard moves focus there
      // (F6 from the rail), not for focus a script or a pointer gives it.
      const chart = '.pc-stage .pc-chart';
      await page.keyboard.press('F6');
      await expect(page.locator(chart)).toBeFocused();
      expect(await focusRing(page, chart, '::after')).toEqual({ visible: true, style: 'solid', width: 2, color: system.highlight });
      await expect(page.locator('#scene')).toHaveScreenshot(`forced-${scheme}-chart-focus.png`);
    });

    test("the rail's group bar shows in the text colour", async ({ page }) => {
      const bar = await page
        .locator('.pc-rail-group:has(> .pc-rail-more) > .pc-icon-btn')
        .first()
        .evaluate((el) => {
          const probe = document.createElement('span');
          probe.style.color = 'CanvasText';
          document.body.append(probe);
          const ink = getComputedStyle(probe).color;
          probe.remove();
          return { background: getComputedStyle(el, '::after').backgroundColor, ink };
        });
      expect(bar.background).toBe(bar.ink);
    });
  });
}

for (const theme of ['dark', 'light'] as const) {
  test.describe(`right to left, ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await open(page, `scene=rtl&theme=${theme}`);
    });

    test('the chrome mirrors while time runs left to right', async ({ page }) => {
      // The same scene with the default bottom bar; the clock and canvas text hooks stay in place.
      await page.goto(`/?scene=rtl&theme=${theme}&bottombar`);
      await page.locator('html[data-done]').waitFor();
      const layout = await page.evaluate(() => {
        const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
        const { shell } = window.scene;
        const { chart } = shell;
        const root = box('.pc-stage .pc-chart');
        const plot = chart.plotRect;
        const bars = chart.mainBars;
        const item = (id: string) => box(`.pc-bottombar [data-id="${id}"]`);
        return {
          dir: document.querySelector('.pc-shell')!.getAttribute('dir'),
          direction: shell.direction,
          chartDirection: chart.options.direction,
          rail: box('.pc-rail'),
          root,
          // The main series' title, the legend's first item.
          title: box('.pc-legend-title'),
          plot,
          side: chart.panes[0]!.primary.side,
          axisLeft: chart.priceAxisSpace('left'),
          axisRight: chart.priceAxisSpace('right'),
          firstX: chart.timeToX(bars[0]!.time),
          lastX: chart.timeToX(bars[bars.length - 1]!.time),
          goTo: item('go-to-date'),
          scale: item('scale-mode'),
        };
      });
      expect(layout.dir).toBe('rtl');
      expect(layout.direction).toBe('rtl');
      expect(layout.chartDirection).toBe('rtl');
      // The drawing rail is on the right of the chart, the bottom bar's start (go to date) is on the right.
      expect(layout.rail.left).toBeGreaterThanOrEqual(layout.root.right);
      expect(layout.goTo.left).toBeGreaterThan(layout.scale.right);
      // The main price axis is on the left; the legend starts at the plot's right edge.
      expect(layout.side).toBe('left');
      expect(layout.axisLeft).toBeGreaterThan(0);
      expect(layout.axisRight).toBe(0);
      expect(layout.plot.x).toBe(layout.axisLeft);
      const plotRight = layout.root.left + layout.plot.x + layout.plot.width;
      expect(plotRight - layout.title.right).toBeGreaterThanOrEqual(0);
      expect(plotRight - layout.title.right).toBeLessThan(24);
      // Time still runs left to right.
      expect(layout.firstX!).toBeLessThan(layout.lastX!);
    });

    test('prices use Arabic-Indic digits and the locale grouping', async ({ page }) => {
      const result = await page.evaluate(() => {
        const { chart } = window.scene.shell;
        const intl = new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true });
        return {
          price: chart.localization.price(2450, 2),
          intl: intl.format(2450),
          axis: window.textCalls.filter((c) => /^[٠-٩]{1,3}٬[٠-٩]{3}٫[٠-٩]{2}$/.test(c.text)).map((c) => c.text),
          latinDigits: window.textCalls.filter((c) => /^[\d.,]+$/.test(c.text)).map((c) => c.text),
          legend: document.querySelector('.pc-legend')!.textContent,
        };
      });
      expect(result.price).toBe(result.intl);
      expect(result.price).toBe('٢٬٤٥٠٫٠٠');
      // Price axis labels (and the last value label) group the locale's way in its digits; none is in Latin digits.
      expect(result.axis.length).toBeGreaterThan(2);
      expect(result.latinDigits).toEqual([]);
      expect(result.legend).toMatch(/[٠-٩]٬[٠-٩]{3}٫[٠-٩]{2}/);
    });

    test('drawing text with mixed scripts reads in the order the browser lays it out', async ({ page }) => {
      const result = await page.evaluate(() => {
        const { texts } = window.scene;
        // The browser's own base direction for each text (`dir="auto"` spans under the chart).
        const spans = [...document.querySelectorAll<HTMLElement>('#reference span')];
        return texts.map((text, i) => ({
          text,
          browser: spans[i]!.textContent === text && spans[i]!.matches(':dir(rtl)') ? 'rtl' : 'ltr',
          canvas: [...new Set(window.textCalls.filter((c) => c.text === text).map((c) => c.direction))],
        }));
      });
      // Arabic first and Hebrew first read right to left, Latin first left to right, digits inside each.
      expect(result.map((r) => r.browser)).toEqual(['rtl', 'rtl', 'ltr']);
      for (const r of result) expect(r.canvas, r.text).toEqual([r.browser]);
    });

    test('the scene matches the baseline', async ({ page }) => {
      await expect(page.locator('#shot')).toHaveScreenshot(`rtl-${theme}.png`);
    });
  });
}
