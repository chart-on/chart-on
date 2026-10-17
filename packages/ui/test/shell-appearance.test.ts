import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from '../../core/test/fake-dom';
import { appearanceToolbarItem } from '../src/appearance';
import { createChartShell } from '../src/shell';

afterEach(() => vi.unstubAllGlobals());

type Node = { children: Node[]; getAttribute(k: string): string | null };
function byLabel(root: unknown, label: string): Node | null {
  for (const child of (root as Node).children) {
    if (child.getAttribute('aria-label') === label) return child;
    const found = byLabel(child, label);
    if (found) return found;
  }
  return null;
}

describe('shell appearance', () => {
  it('keeps the toolbar button pressed state in step when the panel opens or closes from code', () => {
    const container = fakeContainer();
    // The shell reads its theme from CSS custom properties; none are set here.
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
    vi.stubGlobal(
      'MutationObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
    const shell = createChartShell(container, { toolbar: [appearanceToolbarItem()], appearance: { storage: null } });
    const button = byLabel(shell.el, 'Appearance')!;
    expect(button.getAttribute('aria-pressed')).toBe('false');
    shell.appearance!.open();
    expect(button.getAttribute('aria-pressed')).toBe('true');
    shell.appearance!.close();
    expect(button.getAttribute('aria-pressed')).toBe('false');
    shell.destroy();
  });
});
