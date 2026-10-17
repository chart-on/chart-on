import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer, installFakeDom } from '../../core/test/fake-dom';
import { createSymbolSearch, type SymbolSearchOptions } from '../src/symbol-search';
import { chooseOption, chosenLabel } from './listbox';

installFakeDom();

type Node = HTMLElement & { children: Node[] };
const all = (root: Node): Node[] => root.children.flatMap((c) => [c, ...all(c)]);
const byClass = (root: HTMLElement, cls: string) => all(root as Node).filter((n) => n.className.split(/\s+/).includes(cls));

const exchanges = (n: number) => Array.from({ length: n }, (_, i) => ({ value: `X${i}`, label: `Exchange ${i}` }));

function dialog(filters: SymbolSearchOptions['source']['searchFilters']) {
  const search = vi.fn(async () => []);
  const d = createSymbolSearch(fakeContainer(), { source: { search, searchFilters: filters }, onSelect: () => {}, openOnTyping: false });
  cleanups.push(() => d.destroy());
  const select = () => byClass(d.el, 'pc-form-combo')[0]!;
  return { d, search, select };
}

const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '', overflowY: 'visible' }));
  vi.stubGlobal('MutationObserver', class {
    observe(): void {}
    disconnect(): void {}
  });
});
afterEach(() => {
  cleanups.splice(0).forEach((done) => done());
  vi.unstubAllGlobals();
});

describe('symbol search exchange filter', () => {
  it('shows no exchange select for fewer than two exchanges', () => {
    expect(byClass(dialog(undefined).d.el, 'pc-form-combo')).toHaveLength(0);
    expect(byClass(dialog({ exchanges: [] }).d.el, 'pc-form-combo')).toHaveLength(0);
    expect(byClass(dialog({ exchanges: exchanges(1) }).d.el, 'pc-form-combo')).toHaveLength(0);
  });

  it('puts the outlined exchange select on the search row and the type tabs below', () => {
    const { d, select } = dialog({ exchanges: exchanges(2), types: [{ value: 'stock', label: 'Stock' }] });
    const bar = byClass(d.el, 'pc-symbol-search-bar')[0]!;
    expect(bar.children.map((c) => c.className)).toEqual(['pc-symbol-search-field', 'pc-form-combo-wrap']);
    expect(select().className.split(' ')).toContain('pc-select');
    expect(select().getAttribute('aria-label')).toBe('Exchange');
    expect(chosenLabel(select())).toBe('All exchanges');
    const filters = byClass(d.el, 'pc-symbol-search-filters')[0]!;
    expect(byClass(filters, 'pc-seg')).toHaveLength(1);
    expect(byClass(filters, 'pc-form-combo')).toHaveLength(0);
  });

  it('searches the picked exchange', () => {
    const { d, search, select } = dialog({ exchanges: exchanges(3) });
    // Fake DOM inputs start without a value.
    Object.assign(byClass(d.el, 'pc-symbol-search-input')[0]!, { value: '' });
    chooseOption(select(), 'Exchange 1');
    expect(search).toHaveBeenLastCalledWith('', expect.objectContaining({ exchange: 'X1' }));
    expect(chosenLabel(select())).toBe('Exchange 1');
  });
});
