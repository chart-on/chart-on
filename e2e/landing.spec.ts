import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The docs site landing page, built and previewed (`landing` project): the hero,
 * the floating nav, the scheme pickers, the order flow tile with its depth lane
 * and the "Make it yours" tile, at desktop and phone widths in both schemes.
 * Behaviour is read from the DOM; the WebGL charts are checked by sampling
 * pixels of their screenshots. A few regions are also compared with baselines
 * in landing/__screenshots__/<platform>/, taken with the clock paused so the
 * live order flow chart holds still.
 */

const SIZES = {
  desktop: { width: 1280, height: 800 },
  phone: { width: 375, height: 812 },
};
const SCHEMES = ['dark', 'light'] as const;
type Scheme = (typeof SCHEMES)[number];

/** The colours layer of the "Make it yours" chart paints this background, whatever the scheme. */
const BRAND_BACKGROUND = [0x0f, 0x17, 0x29] as const;

// Console errors and uncaught exceptions fail the test they happen in.
let problems: string[] = [];
test.beforeEach(({ page }) => {
  problems = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
});
test.afterEach(() => expect(problems, 'console errors').toEqual([]));

async function open(page: Page): Promise<void> {
  await page.goto('/');
  await mounted(page);
}

/** The landing script loads after the page: it has run once the footer picker shows the scheme on screen. */
async function mounted(page: Page): Promise<void> {
  await expect(page.locator('.lp-footer [data-appearance][aria-checked="true"]')).toHaveCount(1, { timeout: 30_000 });
}

/** Scrolls a chart host into view and waits for the chart's first frames. */
async function chartReady(page: Page, host: Locator): Promise<void> {
  await host.scrollIntoViewIfNeeded();
  await expect(host.locator('canvas').first()).toBeAttached();
  await frames(page);
}

/** Lets a few frames render, so a canvas shows the last change. */
async function frames(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => done())))),
  );
}

interface Pixels {
  width: number;
  height: number;
  data: Uint8Array;
}

/** The RGBA pixels of a screenshot of `target`, decoded by the page itself. */
async function pixels(page: Page, target: Locator): Promise<Pixels> {
  const png = (await target.screenshot()).toString('base64');
  const { width, height, data } = await page.evaluate(async (src) => {
    const bytes = Uint8Array.from(atob(src), (c) => c.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const ctx = new OffscreenCanvas(image.width, image.height).getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const rgba = ctx.getImageData(0, 0, image.width, image.height).data;
    let text = '';
    for (let i = 0; i < rgba.length; i += 0x8000) text += String.fromCharCode(...rgba.subarray(i, i + 0x8000));
    return { width: image.width, height: image.height, data: btoa(text) };
  }, png);
  return { width, height, data: Uint8Array.from(Buffer.from(data, 'base64')) };
}

type Test = (r: number, g: number, b: number) => boolean;

/** The x of every pixel that passes `test`. */
function columnsWhere(img: Pixels, pass: Test): number[] {
  const xs: number[] = [];
  for (let i = 0; i < img.data.length; i += 4) {
    if (pass(img.data[i]!, img.data[i + 1]!, img.data[i + 2]!)) xs.push((i / 4) % img.width);
  }
  return xs;
}

/** The most common colour. */
function commonest(img: Pixels): [number, number, number] {
  const counts = new Map<number, number>();
  for (let i = 0; i < img.data.length; i += 4) {
    const key = (img.data[i]! << 16) | (img.data[i + 1]! << 8) | img.data[i + 2]!;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const [key] = [...counts].reduce((a, b) => (b[1] > a[1] ? b : a));
  return [key >> 16, (key >> 8) & 255, key & 255];
}

function differs(a: Pixels, b: Pixels): boolean {
  return a.width !== b.width || a.height !== b.height || Buffer.compare(a.data, b.data) !== 0;
}

/** The pixels of `target` once two screenshots in a row match, so a chart has finished drawing. */
async function settled(page: Page, target: Locator): Promise<Pixels> {
  let last = await pixels(page, target);
  await expect.poll(async () => {
    const next = await pixels(page, target);
    const same = !differs(last, next);
    last = next;
    return same;
  }, 'the chart settles').toBe(true);
  return last;
}

/** Waits until `target` no longer shows `before`. */
async function changes(page: Page, target: Locator, before: Pixels, what: string): Promise<void> {
  await expect.poll(async () => differs(before, await pixels(page, target)), what).toBe(true);
}

/**
 * Stops the order flow chart's live ticks: they skip while the page reports itself
 * hidden. Only `document.hidden` is faked; the chart's own frame loop reads
 * `visibilityState` and keeps drawing.
 */
async function noLiveTicks(page: Page): Promise<void> {
  await page.addInitScript(() => Object.defineProperty(document, 'hidden', { get: () => true, configurable: true }));
}

/** Blue: the bid side of the depth lane (the theme's bid colour and its tint), not the teal of up candles. */
const bluish: Test = (r, g, b) => b - r > 30 && b - g > 20;

/** Pairs of the boxes of `items` that overlap by more than half a pixel. */
async function overlaps(items: Locator): Promise<string[]> {
  return items.evaluateAll((els) => {
    const boxes = els.map((el) => ({ name: el.textContent?.trim() || el.getAttribute('aria-label') || el.tagName, r: el.getBoundingClientRect() }));
    const found: string[] = [];
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) {
        const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (a.r.width && b.r.width && x > 0.5 && y > 0.5) found.push(`${a.name} / ${b.name}`);
      }
    }
    return found;
  });
}

/** Whether every box of `items` lies inside the box of `container`. */
async function inside(items: Locator, container: Locator): Promise<boolean> {
  const outer = (await container.boundingBox())!;
  for (const box of await items.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect))) {
    if (box.left < outer.x - 0.5 || box.right > outer.x + outer.width + 0.5) return false;
  }
  return true;
}

/** Picks a scheme in the footer picker and waits until the page and its storage follow. */
async function pickScheme(page: Page, scheme: Scheme): Promise<void> {
  await page.locator(`.lp-footer [data-appearance="${scheme}"]`).click();
  await expect(page.locator('html')).toHaveClass(scheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('vitepress-theme-appearance'))).toBe(scheme);
}

const other = (scheme: Scheme): Scheme => (scheme === 'dark' ? 'light' : 'dark');
const cssVar = (target: Locator, name: string) => target.evaluate((el, n) => getComputedStyle(el).getPropertyValue(n).trim(), name);

for (const [size, viewport] of Object.entries(SIZES)) {
  for (const scheme of SCHEMES) {
    test.describe(`${size}, ${scheme}`, () => {
      test.use({ viewport, colorScheme: scheme });

      test('the hero shows its text, actions and illustration', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await open(page);
        const hero = page.locator('.lp-hero');
        await expect(hero.locator('h1')).toHaveText(/charting library/);
        const text = hero.locator('.lp-hero-text > *');
        expect(await overlaps(text)).toEqual([]);
        expect(await overlaps(hero.locator('.lp-hero-text a, .lp-install'))).toEqual([]);
        // The text column stays on screen.
        for (const box of await text.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect))) {
          expect(box.left).toBeGreaterThanOrEqual(0);
          expect(box.right).toBeLessThanOrEqual(viewport.width);
        }

        const art = (await hero.locator('.lp-hero-art-wrap').boundingBox())!;
        const textBox = (await hero.locator('.lp-hero-text').boundingBox())!;
        expect(art.width).toBeGreaterThan(200);
        if (size === 'phone') {
          // Below the text on narrow screens.
          expect(art.y).toBeGreaterThanOrEqual(textBox.y + textBox.height - 1);
        } else {
          // Under the text, bleeding to the window's right edge.
          expect(art.x + art.width).toBeGreaterThanOrEqual(viewport.width - 1);
          expect(art.x).toBeLessThan(textBox.x + textBox.width);
        }

        const install = hero.locator('.lp-install');
        await install.click();
        await expect(install.locator('.lp-install-done')).toHaveText('Copied');
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await install.getAttribute('data-copy'));
      });

      test('the floating nav hides while scrolling down and comes back on scrolling up', async ({ page }) => {
        await open(page);
        const nav = page.locator('.VPNav');
        const bottom = () => nav.evaluate((el) => el.getBoundingClientRect().bottom);
        expect(await bottom()).toBeGreaterThan(0);

        await page.evaluate(() => scrollTo(0, 1500));
        await expect(nav).toHaveClass(/lp-nav-hidden/);
        await expect.poll(bottom).toBeLessThanOrEqual(0);

        // Moves under a few pixels leave it as it is.
        await page.evaluate(() => scrollBy(0, -2));
        await frames(page);
        await expect(nav).toHaveClass(/lp-nav-hidden/);

        await page.evaluate(() => scrollBy(0, -200));
        await expect(nav).not.toHaveClass(/lp-nav-hidden/);
        await expect.poll(bottom).toBeGreaterThan(0);

        // Focus brings it back too.
        await page.evaluate(() => scrollBy(0, 600));
        await expect(nav).toHaveClass(/lp-nav-hidden/);
        await nav.locator('a').first().focus();
        await expect(nav).not.toHaveClass(/lp-nav-hidden/);

        // Near the top it stays.
        await page.evaluate(() => scrollTo(0, 0));
        await page.locator('h1').click();
        await page.evaluate(() => scrollTo(0, 60));
        await frames(page);
        await expect(nav).not.toHaveClass(/lp-nav-hidden/);
      });

      test('the scheme pickers follow the system, switch the scheme and remember it', async ({ page }) => {
        await open(page);
        const flowKey = page.locator('[data-flow-key]');
        const before = { bg: await cssVar(page.locator('html'), '--vp-c-bg'), bid: await cssVar(flowKey, '--lp-key-bid') };
        await expect(page.locator('.lp-footer [aria-checked="true"]')).toHaveAttribute('data-appearance', scheme);

        // The nav's picker sits in the bar on desktop and in the menu screen on phones.
        if (size === 'phone') {
          await page.locator('.VPNavBarHamburger').click();
          await expect(page.locator('.VPNavScreen')).toBeVisible();
          // The menu screen fills the window below the floating bar, edge to edge.
          const menu = (await page.locator('.VPNavScreen').boundingBox())!;
          const bar = (await page.locator('.VPNav').boundingBox())!;
          expect(menu.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
          expect(menu.y + menu.height).toBeCloseTo(viewport.height, 0);
          expect(menu.x).toBeCloseTo(0, 0);
          expect(menu.width).toBeCloseTo(viewport.width, 0);
        }
        const navPicker = page.locator('.VPNav .lp-appearance').locator('visible=true');
        await expect(navPicker).toHaveCount(1);
        await expect(navPicker.locator('[aria-checked="true"]')).toHaveAttribute('data-appearance', scheme);
        await navPicker.locator(`[data-appearance="${other(scheme)}"]`).click();
        await expect(page.locator('html')).toHaveClass(other(scheme) === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/);
        await expect.poll(() => page.evaluate(() => localStorage.getItem('vitepress-theme-appearance'))).toBe(other(scheme));
        if (size === 'phone') await page.locator('.VPNavBarHamburger').click();

        // Every picker shows the choice, and the page and the chart key take the other palette.
        const checked = () => page.locator('.lp-appearance').evaluateAll((groups) => groups.map((g) => g.querySelector('[aria-checked="true"]')?.getAttribute('data-appearance')));
        await expect.poll(checked).toEqual(Array(await page.locator('.lp-appearance').count()).fill(other(scheme)));
        expect(await cssVar(page.locator('html'), '--vp-c-bg')).not.toBe(before.bg);
        expect(await cssVar(flowKey, '--lp-key-bid')).not.toBe(before.bid);
        // The key swatch paints the variable.
        const swatch = flowKey.locator('.lp-key-bid');
        expect(await swatch.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
          await swatch.evaluate((el) => {
            const probe = document.createElement('i');
            probe.style.color = getComputedStyle(el).getPropertyValue('--lp-key-bid');
            el.append(probe);
            const color = getComputedStyle(probe).color;
            probe.remove();
            return color;
          }),
        );

        await page.reload();
        await expect(page.locator('html')).toHaveClass(other(scheme) === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/);
        await expect(page.locator('.lp-footer [aria-checked="true"]')).toHaveAttribute('data-appearance', other(scheme));

        await pickScheme(page, scheme);
        expect(await cssVar(page.locator('html'), '--vp-c-bg')).toBe(before.bg);
        expect(await cssVar(flowKey, '--lp-key-bid')).toBe(before.bid);
      });

      test('the order flow tile switches its views and shows the depth lane beside the axis', async ({ page }) => {
        // No live ticks, so the chart only changes when a view is switched.
        await noLiveTicks(page);
        await open(page);
        const tile = page.locator('.lp-tile-flow-chart');
        const host = tile.locator('[data-flow-chart]');
        const key = tile.locator('[data-flow-key] button');
        await chartReady(page, host);
        await expect(tile.locator('[data-flow-note]')).toBeHidden();

        await expect(key).toHaveText(['Heatmap', 'Order book', 'Footprint']);
        expect(await key.evaluateAll((els) => els.map((el) => el.getAttribute('aria-pressed')))).toEqual(['true', 'true', 'false']);
        // The key and the status share the bar without touching.
        expect(await overlaps(tile.locator('.lp-panel-bar').locator('button, .lp-status'))).toEqual([]);
        expect(await inside(tile.locator('.lp-panel-bar button'), tile.locator('.lp-panel-bar'))).toBe(true);

        // The lane: blue bid bars in one lane-wide band left of the price axis.
        const withBook = await settled(page, host);
        const bids = columnsWhere(withBook, bluish);
        expect(bids.length).toBeGreaterThan(100);
        const [left, right] = [Math.min(...bids), Math.max(...bids)];
        expect(right - left).toBeLessThanOrEqual(73);
        // Beside the axis: at most 100 px of axis to its right.
        expect(left).toBeGreaterThan(withBook.width - 72 - 100);
        expect(right).toBeLessThan(withBook.width - 30);

        const book = key.filter({ hasText: 'Order book' });
        await book.click();
        await expect(book).toHaveAttribute('aria-pressed', 'false');
        await expect.poll(async () => columnsWhere(await pixels(page, host), bluish).length).toBeLessThan(bids.length / 20);
        await book.click();
        await expect(book).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(async () => columnsWhere(await pixels(page, host), bluish).length).toBeGreaterThan(100);

        // Each view changes the picture when switched.
        for (const name of ['Heatmap', 'Footprint']) {
          const button = key.filter({ hasText: name });
          const pressed = await button.getAttribute('aria-pressed');
          const before = await settled(page, host);
          await button.click();
          await expect(button).toHaveAttribute('aria-pressed', pressed === 'true' ? 'false' : 'true');
          await changes(page, host, before, `${name} changes the chart`);
          await button.click();
        }
      });

      test('the "Make it yours" tile toggles layers, shows their code and keeps the brand colours', async ({ page }) => {
        await open(page);
        const chartTile = page.locator('.lp-tile-custom-chart');
        const codeTile = page.locator('.lp-tile-custom');
        const host = chartTile.locator('[data-custom-chart]');
        const layers = chartTile.locator('[data-custom-key] button');
        const files = codeTile.locator('[data-custom-file]');
        const panels = codeTile.locator('[data-custom-code]');
        await chartReady(page, host);
        await expect(chartTile.locator('[data-custom-note]')).toBeHidden();

        await expect(layers).toHaveText(['Indicator', 'Trades', 'Zones', 'Custom series', 'Colours']);
        expect(await layers.evaluateAll((els) => els.map((el) => el.getAttribute('aria-pressed')))).toEqual(['true', 'true', 'false', 'false', 'false']);
        await expect(files).toHaveText(['regime.ts', 'trades.ts', 'zones.ts', 'bubbles.ts', 'brand.ts']);
        await expect(files.first()).toHaveAttribute('aria-selected', 'true');
        await expect(panels.locator('visible=true')).toHaveCount(1);
        // Labels do not overlap: the layer toggles, the file tabs and the tile text.
        expect(await overlaps(layers)).toEqual([]);
        expect(await inside(layers, chartTile.locator('.lp-panel-bar'))).toBe(true);
        expect(await overlaps(files)).toEqual([]);
        expect(await overlaps(codeTile.locator(':scope > *'))).toEqual([]);

        const siteBackground = commonest(await pixels(page, host));
        expect(siteBackground).not.toEqual(BRAND_BACKGROUND);

        // Each layer switches on, changes the chart and brings its file forward, in view.
        const tabs = codeTile.locator('.lp-custom-files');
        for (const [layer, file] of [
          ['Zones', 'zones.ts'],
          ['Custom series', 'bubbles.ts'],
          ['Indicator', 'regime.ts'],
          ['Trades', 'trades.ts'],
          ['Colours', 'brand.ts'],
        ]) {
          const button = layers.filter({ hasText: layer });
          const pressed = (await button.getAttribute('aria-pressed')) === 'true';
          const before = await settled(page, host);
          await button.click();
          await expect(button).toHaveAttribute('aria-pressed', String(!pressed));
          const tab = files.filter({ hasText: file });
          await expect(tab).toHaveAttribute('aria-selected', 'true');
          await expect(files.and(page.locator('[aria-selected="true"]'))).toHaveCount(1);
          await expect(panels.locator('visible=true')).toHaveCount(1);
          await expect(codeTile.locator(`[data-custom-code="${await tab.getAttribute('data-custom-file')}"]`)).toBeVisible();
          await expect.poll(() => tab.evaluate((el) => {
            const strip = el.parentElement!.getBoundingClientRect();
            const box = el.getBoundingClientRect();
            return box.left >= strip.left - 1 && box.right <= strip.right + 1;
          }), `${file} scrolled into view`).toBe(true);
          await changes(page, host, before, `${layer} changes the chart`);
        }
        // The sliding highlight sits under the selected tab.
        await expect.poll(() => tabs.evaluate((strip) => {
          const indicator = strip.querySelector<HTMLElement>('.lp-indicator')!;
          const tab = strip.querySelector<HTMLElement>('[aria-selected="true"]')!;
          const x = Number(/translate[X3d]*\(\s*(-?[\d.]+)px/.exec(indicator.style.transform)?.[1] ?? NaN);
          return Math.abs(indicator.offsetWidth - tab.offsetWidth) <= 1 && Math.abs(x - tab.offsetLeft) <= 1;
        })).toBe(true);

        // Brand colours, and they stay on across a scheme change.
        const brand = (img: Pixels) => commonest(img).every((v, i) => Math.abs(v - BRAND_BACKGROUND[i]!) <= 2);
        await expect.poll(async () => brand(await pixels(page, host))).toBe(true);
        await pickScheme(page, other(scheme));
        // The scheme switch redraws the chart; it keeps the brand background.
        const switched = await settled(page, host);
        expect(brand(switched)).toBe(true);
        await expect(layers.filter({ hasText: 'Colours' })).toHaveAttribute('aria-pressed', 'true');

        // Off again: the other scheme's own background.
        await layers.filter({ hasText: 'Colours' }).click();
        await changes(page, host, switched, 'Colours off changes the chart');
        const otherBackground = commonest(await settled(page, host));
        expect(otherBackground).not.toEqual(BRAND_BACKGROUND);
        expect(otherBackground).not.toEqual(siteBackground);

        // A tab on its own only shows code.
        const pressedBefore = await layers.evaluateAll((els) => els.map((el) => el.getAttribute('aria-pressed')));
        await files.filter({ hasText: 'zones.ts' }).click();
        await expect(files.filter({ hasText: 'zones.ts' })).toHaveAttribute('aria-selected', 'true');
        await expect(codeTile.locator('[data-custom-code="zones"]')).toBeVisible();
        expect(await layers.evaluateAll((els) => els.map((el) => el.getAttribute('aria-pressed')))).toEqual(pressedBefore);
      });

      test('no text runs off the side of the page', async ({ page }) => {
        await open(page);
        // Start every section, then look from the top.
        for (const host of ['[data-speed-chart]', '[data-flow-chart]', '[data-custom-chart]']) await chartReady(page, page.locator(host));
        await page.evaluate(() => scrollTo(0, 0));
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
        const outside = await page.evaluate(() => {
          const width = document.documentElement.clientWidth;
          // Scrolling strips (code, tabs) may hold wider content.
          const scrolls = (el: Element) => {
            for (let p = el.parentElement; p && !p.matches('.lp'); p = p.parentElement) {
              if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(p).overflowX)) return true;
            }
            return false;
          };
          return [...document.querySelectorAll('.lp :is(h1, h2, h3, p, a, button, li, code), .VPNav :is(a, button)')]
            .filter((el) => {
              const box = el.getBoundingClientRect();
              return box.width > 0 && (box.left < -0.5 || box.right > width + 0.5) && !scrolls(el);
            })
            .map((el) => `${el.tagName} ${el.textContent?.trim().slice(0, 40)}`);
        });
        expect(outside).toEqual([]);
      });
    });
  }
}

// Baselines for a few regions. The clock is paused before the page loads and only
// moves when the test says so, so every chart opens on the same bars, and the order
// flow chart's live ticks are off, so moving the clock for frames never adds a bar.
// Fonts are loaded before each capture: the base font is a web font, the code font
// the platform's monospace, the same on every machine of a platform.
const BASELINES: { size: keyof typeof SIZES; regions: string[] }[] = [
  { size: 'desktop', regions: ['.lp-hero', '.lp-tile-flow-chart', '.lp-tile-custom-chart'] },
  { size: 'phone', regions: ['.lp-tile-flow-chart', '.lp-tile-custom-chart'] },
];

for (const { size, regions } of BASELINES) {
  for (const scheme of SCHEMES) {
    test.describe(`${size}, ${scheme}, baselines`, () => {
      test.use({ viewport: SIZES[size], colorScheme: scheme });

      test('key regions match the baselines', async ({ page }) => {
        const start = new Date('2026-01-12T12:00:00Z');
        await noLiveTicks(page);
        await page.clock.install({ time: start });
        await page.clock.pauseAt(start);
        await page.goto('/');
        await page.clock.runFor(500);
        await mounted(page);
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        // The hero's SVG packets are paused for reduced motion; pin them to their start.
        await page.locator('.lp-hero-art').evaluate((svg) => (svg as SVGSVGElement).setCurrentTime(0));
        for (const region of regions) {
          const target = page.locator(region);
          await target.scrollIntoViewIfNeeded();
          const host = target.locator('.lp-chart-host');
          if (await host.count()) await expect(host.locator('canvas').first()).toBeAttached();
          // Time for the chart's first frames.
          await page.clock.runFor(500);
          await page.evaluate(() => document.fonts.ready.then(() => undefined));
          const name = region.replace('.lp-', '');
          // The software renderer is slow to capture the hero under emulation.
          await expect.soft(target).toHaveScreenshot(`${name}-${size}-${scheme}.png`, { timeout: 30_000 });
        }
      });
    });
  }
}
