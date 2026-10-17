import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatch, fakeContainer, installFakeDom } from '../../core/test/fake-dom';
import { confirmDialog } from '../src/dialog';
import { createSymbolSearch, type SymbolSearchDialog } from '../src/symbol-search';

installFakeDom();

type Node = HTMLElement & { children: Node[] };
const all = (root: Node): Node[] => root.children.flatMap((c) => [c, ...all(c)]);
const byClass = (root: HTMLElement, cls: string) => all(root as Node).find((n) => n.className.split(/\s+/).includes(cls))!;

let resize: (() => void) | null = null;
let observing = 0;
const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe(): void {
        observing++;
      }
      disconnect(): void {
        observing--;
      }
    },
  );
});
afterEach(() => {
  cleanups.splice(0).forEach((done) => done());
  vi.unstubAllGlobals();
  resize = null;
  observing = 0;
});

function search(width = 800) {
  const host = fakeContainer();
  host.getBoundingClientRect = () => ({ width }) as DOMRect;
  const dialog: SymbolSearchDialog = createSymbolSearch(host, { source: { search: async () => [] }, onSelect: () => {}, openOnTyping: false });
  cleanups.push(() => dialog.destroy());
  const panel = dialog.el.children[0] as HTMLElement;
  const input = byClass(panel, 'pc-symbol-search-input');
  Object.assign(input, { setSelectionRange() {} });
  dialog.open();
  return { host, dialog, panel, input };
}

describe('symbol search frame', () => {
  it('marks compact mode from the host width while open', () => {
    const { host, dialog, panel } = search(400);
    expect(panel.getAttribute('data-compact')).toBe('true');
    host.getBoundingClientRect = () => ({ width: 800 }) as DOMRect;
    resize!();
    expect(panel.getAttribute('data-compact')).toBe('false');
    dialog.close();
    expect(observing).toBe(0);
  });

  it('is modal only while open', () => {
    const { dialog, panel } = search();
    expect(panel.getAttribute('aria-modal')).toBe('true');
    dialog.close();
    expect(panel.getAttribute('aria-modal')).toBeNull();
    dialog.open();
    expect(panel.getAttribute('aria-modal')).toBe('true');
  });

  it('keeps focus in the search box', () => {
    const { input } = search();
    const outside = fakeContainer();
    dispatch(outside, 'focusin');
    expect(document.activeElement).toBe(input);
  });

  it('stays open under a confirmation stacked over it and when a toast is pressed', async () => {
    const { host, dialog } = search();
    const answer = confirmDialog(host, { title: 'Sure?', message: 'Really?', confirmLabel: 'Yes', cancelLabel: 'No' });
    const confirmBackdrop = host.children[host.children.length - 1] as HTMLElement;
    dispatch(confirmBackdrop, 'pointerdown');
    await expect(answer).resolves.toBe(false);
    expect(dialog.isOpen).toBe(true);

    const toast = fakeContainer();
    Object.assign(toast, { closest: (selector: string) => (selector === '.pc-toasts' ? toast : null) });
    dispatch(toast, 'pointerdown');
    expect(dialog.isOpen).toBe(true);
    dispatch(host, 'pointerdown');
    expect(dialog.isOpen).toBe(false);
  });
});
