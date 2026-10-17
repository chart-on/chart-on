/**
 * Numbers the landing page shows. Each one comes from a command in this
 * repository, run on the machine below. Rerun the commands and update the
 * values (and their date in `measured`) together; never type in a number nobody
 * measured. They stay hand-written: deriving them at docs build time would need
 * the packages built and bundled first.
 *
 * - Sizes: `pnpm build && pnpm size` (minified, production, gzip). These do not
 *   depend on the machine.
 * - Times: `pnpm bench`, medians, on `measured.machine`. These run under Node with WebGL stubbed, so
 *   they are the chart's CPU work per call, not GPU time. The live demo on the
 *   page shows the visitor's real frame rate.
 */
export const measured = {
  benchDate: '2026-10-14',
  sizeDate: '2026-10-17',
  machine: 'a 2021 laptop, 10-core ARM CPU, Node 25.9.0',
};

export interface Measurement {
  value: string;
  unit: string;
  label: string;
  detail: string;
}

export const measurements: Measurement[] = [
  {
    value: '0.05',
    unit: 'ms',
    label: 'CPU per pan frame',
    detail: 'With 1,000,000 candles loaded. The rest of a 16.7 ms frame is left to your app.',
  },
  {
    value: '104',
    unit: 'ms',
    label: 'to load 1M candles',
    detail: '`setData` of one million bars. 100,000 bars take 10.5 ms.',
  },
  {
    value: '92.4',
    unit: 'KiB',
    label: 'gzip for a live chart',
    detail: '`createChart` plus a REST data source, tree-shaken. Zero runtime dependencies.',
  },
  {
    value: '0.13',
    unit: 'ms',
    label: 'to zoom four linked charts',
    detail: 'Four charts of 100,000 candles each, kept in sync on every frame.',
  },
];
