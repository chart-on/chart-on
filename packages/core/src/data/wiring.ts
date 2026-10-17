import type { Chart, ChartEvents } from '../chart';
import { errorText } from '../errors';
import { DataController, type DataControllerOptions, type DataTarget } from './controller';
import type { DataEvents, DataSource } from './types';

// What the `dataSource()` plugin does with a data source's events: the in-pane load status,
// the market badge's data delay, and the parts that follow each load (indicators with their own
// data, the source's markers). It lives here, not in the chart, so a chart without a data
// source leaves it out.

/** @internal The chart's own state a data source's events reach, which plugin code cannot. */
export interface SourceWiring {
  /** The current symbol's data delay, for `marketStatus()` and the legend badge. */
  setDelay(delay: number | 'eod'): void;
  /** The source's markers loader, or null without the `sourceMarkers()` plugin or a source that has markers. */
  markers(): { reset(): void; refresh(): void } | null;
  /** A new symbol or interval landed: fetch its markers. */
  markersContext(): void;
}

/** @internal The controller that loads `source` into `target` on `chart`, with its events handled. */
export function connectSource(
  chart: Chart,
  wiring: SourceWiring,
  source: DataSource,
  target: DataTarget,
  options: Partial<DataControllerOptions>,
): DataController {
  return new DataController(
    source,
    target,
    (event, payload) => {
      dataStatus(chart, wiring, event, payload);
      chart.emit(event, payload as ChartEvents[typeof event]);
      // Indicators with their own data follow symbol, interval and history loads, and refetch on corrections.
      if (event === 'data:loaded') {
        if ((payload as DataEvents['data:loaded']).kind === 'reset') chart.indicatorLayer?.dataReset();
        else chart.indicatorLayer?.dataLoaded();
      }
      // Markers follow the load: the old symbol's go when it starts (and stay gone if it fails), the new one's come when it lands.
      if (event === 'data:loading' && (payload as DataEvents['data:loading']).kind === 'initial') wiring.markers()?.reset();
      if (event === 'data:loaded' && (payload as DataEvents['data:loaded']).kind === 'initial') wiring.markersContext();
      // A reset of the shown bars (`onReset`) refetches their markers too: the one path for refetching.
      if (event === 'data:reset') wiring.markers()?.refresh();
    },
    options,
  );
}

/** Track data-source loads in the in-pane status. */
function dataStatus<K extends keyof DataEvents>(chart: Chart, wiring: SourceWiring, event: K, payload: DataEvents[K]): void {
  const data = chart.data;
  const status = chart.getStatus();
  if (event === 'data:loading' && (payload as DataEvents['data:loading']).kind === 'initial') {
    chart.setStatus({ kind: 'loading' });
    // The requested symbol's delay is unknown until it loads.
    wiring.setDelay(0);
  } else if (event === 'data:loaded' && (payload as DataEvents['data:loaded']).kind === 'initial') {
    const { bars, symbol } = payload as DataEvents['data:loaded'];
    // A reconnect that started during the load was hidden behind "Loading…": show it now.
    const down = data?.connection?.state === 'reconnecting';
    chart.setStatus(symbol.expired ? { kind: 'expired' } : bars.length === 0 ? { kind: 'no-data' } : down ? { kind: 'reconnecting' } : null);
    wiring.setDelay(symbol.delay ?? 0);
  } else if (event === 'data:snapshot') {
    // Cached bars are on screen while the load runs.
    chart.setStatus(null);
  } else if (event === 'data:error' && (payload as DataEvents['data:error']).kind === 'initial' && data?.showingSnapshot) {
    // The cached snapshot stays: say it may be out of date rather than covering it with an error.
    chart.setStatus({ kind: 'stale' });
    wiring.setDelay(0);
  } else if (event === 'data:error' && (payload as DataEvents['data:error']).kind === 'initial') {
    const { error } = payload as DataEvents['data:error'];
    // Raw source errors can be technical or long: keep them out of the pane, but in `detail`.
    const raw = error.cause ?? error;
    chart.setStatus({ kind: 'error', detail: errorText(raw) });
    wiring.setDelay(0);
  } else if (event === 'data:reconnecting' || event === 'data:stale') {
    // Never cover a message about the load itself (loading, error, no data...).
    const kind = event === 'data:stale' ? 'stale' : 'reconnecting';
    if (!status || status.kind === 'reconnecting' || status.kind === 'stale') chart.setStatus({ kind });
  } else if (event === 'data:reconnect' || (event === 'data:loaded' && (payload as DataEvents['data:loaded']).kind === 'reset')) {
    const kind = status?.kind;
    // A reset landing during an outage leaves the feed still down.
    if (data?.connection?.state === 'reconnecting') return;
    if (kind === 'reconnecting' || kind === 'stale') chart.setStatus(data?.stale ? { kind: 'stale' } : null);
  } else if (event === 'data:warning' && chart.options.adjustment !== 'none') {
    // The bars are on screen, only unadjusted: a notification rather than a pane message.
    const { error } = payload as DataEvents['data:warning'];
    if (error.code === 'adjustments-failed') chart.notify({ message: chart.localization.text('adjustmentsFailed'), kind: 'error' });
  }
}
