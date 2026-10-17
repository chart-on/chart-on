import { createContext, useContext } from 'react';
import type { Chart } from '@charton/core';

/** The chart of the nearest `<Chart>` or `<ChartShell>`; null before mount and on a server. */
export const ChartContext = createContext<Chart | null>(null);

/**
 * The chart of the nearest enclosing `<Chart>` or `<ChartShell>`. It is null
 * during server rendering and until the component has mounted, then the
 * component renders again with the chart, so effects that depend on it run once
 * it exists.
 */
export function useChart(): Chart | null {
  return useContext(ChartContext);
}
