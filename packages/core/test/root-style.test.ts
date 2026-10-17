import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fakeContainer, installFakeDom } from './fake-dom';
import { Chart } from '../src/chart';
import { ROOT_RULE } from '../src/root-style';
import { darkTheme } from '../src/theme';

/** A constructable stylesheet that records its text. */
class FakeSheet {
  text = '';
  replaceSync(text: string): void {
    this.text = text;
  }
}

type Scope = { adoptedStyleSheets: FakeSheet[] };
installFakeDom();
const page = document as unknown as Partial<Scope>;
const charts: Chart[] = [];

function chart(container = fakeContainer()) {
  const c = new Chart(container, {});
  charts.push(c);
  return c;
}

const style = (c: Chart) => c.root.style as unknown as Record<string, string>;

// The rule needs constructable stylesheets; stand in for them.
beforeAll(() => {
  Object.assign(globalThis, { CSSStyleSheet: FakeSheet });
  page.adoptedStyleSheets = [];
});
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));
afterAll(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.CSSStyleSheet;
  delete page.adoptedStyleSheets;
});

describe('chart root style', () => {
  it('ships a rule with no specificity, so any host rule on the root wins', () => {
    expect(ROOT_RULE.startsWith(':where(.pc-chart) {')).toBe(true);
    for (const decl of ['width: 100%', 'height: 100%', 'user-select: none', 'touch-action: var(', 'background: var(']) {
      expect(ROOT_RULE).toContain(decl);
    }
  });

  it('adopts the rule once and keeps only layout styles inline', () => {
    const a = chart();
    chart();
    expect(page.adoptedStyleSheets!.map((s) => s.text)).toEqual([ROOT_RULE]);
    const inline = style(a);
    expect(inline.position).toBe('relative');
    expect(inline.overflow).toBe('hidden');
    for (const name of ['width', 'height', 'background', 'touchAction', 'userSelect', 'outline']) expect(inline[name]).toBeUndefined();
  });

  it('passes the background and touch action through variables', () => {
    const c = chart();
    expect(style(c)['--pc-root-background']).toBe(darkTheme.background);
    expect(style(c)['--pc-root-touch-action']).toBe('none');
    c.applyOptions({ theme: { background: 'rgba(0, 0, 0, 0.4)' } });
    expect(style(c)['--pc-root-background']).toBe('transparent');
    c.applyOptions({ features: { touchScroll: false } });
    expect(style(c)['--pc-root-touch-action']).toBe('pan-y');
    expect(style(c).touchAction).toBeUndefined();
  });

  it('adopts the rule into the shadow root the chart lives in', () => {
    const shadow: Scope = { adoptedStyleSheets: [] };
    const container = fakeContainer();
    Object.assign(container, { getRootNode: () => shadow });
    chart(container);
    expect(shadow.adoptedStyleSheets.map((s) => s.text)).toEqual([ROOT_RULE]);
  });

  it('styles the root inline when the sheet cannot be adopted (another document)', () => {
    const other = {
      get adoptedStyleSheets(): FakeSheet[] {
        return [];
      },
      set adoptedStyleSheets(_: FakeSheet[]) {
        throw new Error('NotAllowedError');
      },
    };
    const container = fakeContainer();
    Object.assign(container, { getRootNode: () => other });
    const c = chart(container);
    expect(style(c).width).toBe('100%');
    expect(style(c).touchAction).toBe('none');
    c.applyOptions({ features: { touchScroll: false } });
    expect(style(c).touchAction).toBe('pan-y');
    expect(style(c)['--pc-root-touch-action']).toBeUndefined();
  });
});
