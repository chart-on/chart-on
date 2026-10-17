import { getContext, hasContext, setContext } from 'svelte';
import type { ChartShell } from '@charton/ui';
import type { Current } from './context.js';

const shellKey = Symbol('charton-shell');
const empty: Current<null> = { current: null };

/** Make `read()` the shell that `useChartShell()` returns in this component's children. */
export function provideShell(read: () => ChartShell | null): void {
  setContext<Current<ChartShell | null>>(shellKey, {
    get current() {
      return read();
    },
  });
}

/**
 * The shell of the nearest enclosing `<ChartShell>`. Its `current` is null on a
 * server and until the shell has mounted, then the shell. Call it while the
 * component is being set up, like `getContext`.
 */
export function useChartShell(): Current<ChartShell | null> {
  return hasContext(shellKey) ? getContext<Current<ChartShell | null>>(shellKey) : empty;
}
