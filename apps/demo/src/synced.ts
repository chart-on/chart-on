import { createChart, createLinkGroup, type Bar, type Chart } from '@charton/core';

export interface SyncedChart {
  chart: Chart;
  /** Load a second instrument derived from the main chart's bars, on the same times. */
  load(bars: readonly Bar[]): void;
  destroy(): void;
}

/**
 * A second chart under the shell, linked to the main chart: the crosshair, pan
 * and zoom follow in both directions. Its data is a static snapshot: live ticks
 * and scroll-back history stay on the main chart.
 */
export function createSyncedChart(host: HTMLElement, peer: Chart): SyncedChart {
  const chart = createChart(host, { theme: peer.theme });
  const line = chart.addLine({ title: 'Index · linked to the chart above' });
  // The timezone stays per chart: the main chart follows each symbol's own.
  const group = createLinkGroup([peer, chart], { timezone: false });

  return {
    chart,
    load(bars) {
      // The link group puts the view on the main chart's range; scrolling here would move the main chart too.
      line.setData(bars.map((b, i) => ({ time: b.time, value: b.close / 20 + Math.sin(i / 40) * 50 })));
    },
    destroy() {
      group.destroy();
      chart.destroy();
    },
  };
}
