import type { Chart } from '../chart';
import { safeIntervalSeconds } from '../data/interval';
import type { ChartInternals } from '../registry';
import { fontCss, resolveFont } from '../typography';
import type { AnnotationHost } from './manager';

// What the `annotations()` plugin gives its annotation manager of the chart. It lives here, not
// in the chart, so a chart without annotations leaves it out.

/** The annotation manager's host on `chart`, through the chart's `internals`. */
export function annotationHost(chart: Chart, internals: ChartInternals): AnnotationHost {
  let measure: CanvasRenderingContext2D | null = null;
  return {
    get theme() {
      return chart.theme;
    },
    get main() {
      return chart.main;
    },
    get plotLeft() {
      return chart.plotLeft;
    },
    timeline: chart.timeline,
    time: chart.time,
    panes: chart.panes,
    formatPrice: (pane, price) => chart.formatPrice(pane, price),
    formatAxis: (pane, price, scaleId) => chart.formatAxis(pane, price, scaleId),
    measureText: (text, as) => {
      measure ??= document.createElement('canvas').getContext('2d');
      const font = as ?? resolveFont(chart.theme, 'labels');
      if (!measure) return text.length * font.fontSize * 0.6;
      measure.font = fontCss(font);
      return measure.measureText(text).width;
    },
    axisLabel: (ctx, text, y, background, color, at) => {
      const scale = chart.labelScale(at.pane, at.scale);
      // In the axis font, whatever font the caller draws its own labels in.
      ctx.save();
      ctx.font = fontCss(resolveFont(chart.theme, 'axis'));
      internals.axisPill(ctx, text, y, background, color, at.pane, scale);
      ctx.restore();
    },
    requestOverlay: () => chart.redrawOverlay('annotations'),
    requestRedraw: () => chart.redraw('annotations'),
    priceFactor: internals.priceFactor,
    attachPrimitive: (primitive, series) => chart.attachPrimitive(primitive, series ? { series } : {}),
    tradeHover: (e) => chart.emit('trade:hover', e),
    tradeHoverEnd: () => chart.emit('trade:hover-end', {}),
    tradeClick: (e) => chart.emit('trade:click', e),
    listensToTradeClicks: () => chart.listens('trade:click'),
    markerHover: (e) => chart.emit('marker:hover', e),
    markerHoverEnd: (e) => chart.emit('marker:hover-end', e),
    markerClick: (e) => chart.emit('marker:click', e),
    listensToMarkerClicks: () => chart.listens('marker:click'),
    markClick: (ids, point) => {
      const byId = new Map(chart.sourceMarkers.map((m) => [m.id, m]));
      const markers = ids.flatMap((id) => {
        const m = byId.get(id);
        // A copy, so a listener cannot change the chart's marker.
        return m ? [{ ...m }] : [];
      });
      if (markers.length > 0) chart.emit('sourcemarkers:click', { markers, point });
    },
    listensToMarkClicks: () => chart.listens('sourcemarkers:click'),
    timeMarkBand: internals.timeMarkBand,
    paneButtons: internals.paneButtons,
    barInterval: () => {
      const interval = chart.data?.interval;
      // A custom interval name the chart cannot measure: leave fills unbounded.
      return interval ? safeIntervalSeconds(interval) : null;
    },
    clusterClick: (e) => chart.emit('annotations:cluster', e),
    draftEdit: (e) => chart.emit('draft:edit', e),
    orderCreate: (e) => chart.emit('order:create', e),
  };
}
