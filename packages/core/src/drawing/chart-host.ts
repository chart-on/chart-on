import { labelTextColor, type Chart, type ChartEvents } from '../chart';
import { priceFactor } from '../data/adjust';
import { UndoSteps } from '../history';
import { snapPrice } from '../pointer';
import type { ChartInternals, DrawingsFeature } from '../registry';
import { scaleFormat } from '../series';
import { lowerBound } from '../timeline';
import { fontCss, resolveFont } from '../typography';
import { withAlpha } from '../util/color';
import { sharp } from '../util/math';
import type { DrawingEvents, DrawingHost, DrawingManager, SelectionAxisMarks } from './manager';

// What the drawings plugins give their drawing manager of the chart. It lives here, not in the
// chart, so a chart without drawings leaves it out.

/** The drawing manager's host on `chart`, through the chart's `internals`. */
export function drawingHost(chart: Chart, internals: ChartInternals): DrawingHost {
  return {
    // Getter so theme changes reach the drawing layer.
    get theme() {
      return chart.theme;
    },
    timeline: chart.timeline,
    time: chart.time,
    panes: chart.panes,
    roundPrice: (pane, price, scale) => (scale ? scaleFormat(chart.panes[pane]?.series ?? [], scale) : chart.paneFormat(pane))?.round(price) ?? price,
    zoomTo: (pane, a, b) => {
      const p = chart.panes[pane]!;
      const s = p.primary;
      chart.setVisibleIndexRange(chart.time.xToIndex(Math.min(a.x, b.x)), chart.time.xToIndex(Math.max(a.x, b.x)));
      chart.setPriceRange({ from: s.yToPrice(a.y - p.top), to: s.yToPrice(b.y - p.top) }, pane, s.id, true);
    },
    magnetPrice: (index, price) => snapPrice('ohlc', price, chart.main?.data[index]),
    get pixelRatio() {
      return chart.dpr;
    },
    get localization() {
      return chart.localization;
    },
    // The timeline is built from the main series, so its indices index the bars.
    barSpan: (from, to) => {
      const bars = chart.main?.data ?? [];
      const times = chart.timeline.times;
      let end = lowerBound(times, to);
      if (times[end] === to) end++;
      return { bars, start: Math.min(lowerBound(times, from), bars.length), end: Math.min(end, bars.length) };
    },
    formatPrice: (pane, price, scale) => (scale ? internals.formatOnScale(pane, scale, price) : chart.formatPrice(pane, price)),
    formatTime: (time) => chart.formatTime(time),
    intervalSeconds: internals.intervalSeconds,
    priceFactor: (pane, time) => internals.priceFactor(chart.panes[pane], time),
    // Drawings below the series are on the scene's bottom layer.
    requestOverlay: () => (chart.drawingLayer?.below ? chart.redraw('drawings') : chart.redrawOverlay('drawings')),
    toolsChange: internals.toolsChange,
    editText: (at, initial, done) => editText(chart, internals, at, initial, done),
    groupName: (n) => chart.localization.text('drawingGroupName', { n }),
    // Copied drawings replace a copied indicator: paste takes what was copied last.
    copied: () => internals.indicators()?.drop(),
    history: chart.undoSteps((changed) => new UndoSteps(changed)),
    indicator: (id) => {
      const series = chart.indicatorLayer?.getById(id)?.series;
      return series ? { pane: chart.panes.indexOf(series.pane), shown: series.visible, scale: series.scale } : null;
    },
    // A drawing started in an indicator's own pane ties to the first visible one on the pane's main scale, else on another scale.
    paneIndicator: (index) => {
      const pane = chart.panes[index];
      if (!pane || index === 0) return null;
      const shown = chart.indicatorLayer?.getAll().filter((ind) => ind.series?.pane === pane && ind.series.visible) ?? [];
      return (shown.find((ind) => ind.series!.scale === pane.primary) ?? shown[0])?.id ?? null;
    },
    emit: <K extends keyof DrawingEvents>(event: K, payload: DrawingEvents[K]) => {
      // Changes reach the scene: `autoscale` drawings' price ranges and `below` drawings (also one just removed or raised).
      if (event === 'drawings:change' || event === 'drawings:visibility') chart.redraw('drawings');
      chart.emit(event, payload as ChartEvents[K]);
    },
  };
}

/** The chart's side of the drawings feature: a selected drawing's marks on the axes (`ranges`, `labels`), `rebase` and `end`. */
export function drawingsGlue(
  chart: Chart,
  internals: ChartInternals,
  manager: DrawingManager,
): Pick<DrawingsFeature, 'ranges' | 'labels' | 'end' | 'rebase'> {
  /** The pane the marks go on, or null when it is not shown, with each mark's pane-local y and plot x (NaN where none). */
  const place = (marks: SelectionAxisMarks) => {
    const pane = chart.panes[marks.pane];
    if (!pane || pane.collapsed || !(pane.height > 0)) return null;
    // Prices are on the drawing's indicator's scale (see `Drawing.indicator`), else the pane's primary one.
    const own = manager.priceScaleOf(marks.id) ?? pane.primary;
    const ys = marks.prices.map((p) => own.priceToY(p));
    const xs = marks.times.map((t) => chart.time.indexToX(chart.timeline.indexFromTime(t)));
    return { pane, own, ys, xs };
  };
  return {
    end: () => {
      // A gesture (undo only cancels it then), the active tool, the selection, a text edit.
      if (manager.isBusy) manager.undo();
      manager.leaveHistory();
      manager.setTool(null);
      manager.select(null);
      internals.textEditor?.remove();
      internals.textEditor = null;
    },
    rebase: (adjustments, mode) =>
      manager.reprice((pane, time, price) => {
        const p = chart.panes[pane];
        const now = internals.priceFactor(p, time);
        const before = p === chart.main?.pane ? priceFactor(time, adjustments, mode) : 1;
        return now === before ? price : (price * now) / before;
      }),
    ranges: (ctx, marks) => {
      const at = place(marks);
      if (!at) return;
      const { pane } = at;
      const ys = at.ys.filter(Number.isFinite);
      const xs = at.xs.filter(Number.isFinite);
      ctx.fillStyle = safeAlpha(marks.color, 0.2, chart.theme.drawingFill);
      const y0 = Math.max(0, Math.min(...ys));
      const y1 = Math.min(pane.height, Math.max(...ys));
      if (ys.length > 1 && y1 > y0) {
        for (const scale of chart.axisScales(pane)) {
          const [left, width] = internals.axisBox(pane, scale);
          ctx.fillRect(left, pane.top + y0, width, y1 - y0);
        }
      }
      const x0 = Math.max(0, Math.min(...xs));
      const x1 = Math.min(chart.plotWidth, Math.max(...xs));
      if (xs.length > 1 && x1 > x0) ctx.fillRect(x0, chart.plotHeight, x1 - x0, internals.timeAxisSize());
    },
    // Like the crosshair labels, in the drawing's color.
    labels: (ctx, marks) => {
      const at = place(marks);
      if (!at) return;
      const { pane, own, ys, xs } = at;
      let bg = marks.color;
      let fg: string;
      try {
        fg = labelTextColor(bg);
      } catch {
        // A color the chart cannot read: the crosshair label colors.
        bg = chart.theme.labelBackground;
        fg = chart.theme.labelText;
      }
      ys.forEach((local, k) => {
        if (!(local >= 0 && local <= pane.height)) return;
        const y = sharp(pane.top + local);
        for (const scale of chart.axisScales(pane)) {
          // The drawing's own price, exactly; other scales read it at its height.
          const price = scale === own ? marks.prices[k]! : scale.yToPrice(local);
          internals.axisPill(ctx, chart.formatAxis(marks.pane, price, scale.id), y, bg, fg, pane, scale);
        }
      });
      if (internals.timeAxisSize() === 0) return;
      const top = chart.plotHeight + 3;
      xs.forEach((x, k) => {
        if (!(x >= 0 && x <= chart.plotWidth)) return;
        internals.timePill(ctx, chart.formatTime(marks.times[k]!), x, top, bg, fg);
      });
    },
  };
}

/** `color` at `alpha`, or `fallback` when the chart cannot read it. */
function safeAlpha(color: string, alpha: number, fallback: string): string {
  try {
    return withAlpha(color, alpha);
  } catch {
    return fallback;
  }
}

/** The inline text editor at `at` (plot-space css px); `done(null)` on cancel. */
function editText(chart: Chart, internals: ChartInternals, at: { x: number; y: number }, initial: string, done: (text: string | null) => void): void {
  internals.textEditor?.remove();
  const theme = chart.theme;
  const input = document.createElement('input');
  input.className = 'pc-text-editor';
  input.value = initial;
  input.placeholder = chart.localization.text('drawingTextPlaceholder');
  Object.assign(input.style, {
    position: 'absolute',
    left: `${at.x + chart.plotLeft - 4}px`,
    top: `${at.y - 4}px`,
    zIndex: '3',
    font: fontCss(resolveFont(theme, 'drawings'), 14),
    color: theme.labelText,
    background: theme.labelBackground,
    border: `1px solid ${theme.drawing}`,
    borderRadius: '6px',
    padding: '2px 6px',
    outline: 'none',
  });
  let finished = false;
  const finish = (value: string | null) => {
    if (finished) return;
    finished = true;
    input.remove();
    // Removing the focused editor on destroy can still fire `blur`.
    if (internals.destroyed()) return;
    internals.textEditor = null;
    chart.root.focus();
    done(value);
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(input.value);
    if (e.key === 'Escape') finish(null);
  });
  input.addEventListener('pointerdown', (e) => e.stopPropagation());
  input.addEventListener('blur', () => finish(input.value));
  chart.root.appendChild(input);
  internals.textEditor = input;
  requestAnimationFrame(() => input.focus());
}
