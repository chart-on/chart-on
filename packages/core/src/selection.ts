import { actionLabelKey } from './actions';
import type { Chart, ChartSelection } from './chart';
import type { Indicator } from './indicators/indicator';
import type { ChartInternals, SelectionFeature } from './registry';

// The selection and its commands, which only the drawings and indicators plugins make useful: they
// create it (`Chart.selector`), so a chart without them selects nothing and leaves Delete, copy,
// cut, paste, undo and redo to the page.

/** The selected indicator and the `chart.actions` that edit the selection; registered for the chart's life. */
export function createSelection(chart: Chart, internals: ChartInternals): SelectionFeature {
  /** The selected indicator. Drawings keep their own selection; at most one of the two holds anything. */
  let indicator: Indicator | null = null;
  /** What `selection:change` last reported: the indicator, the drawing ids joined, or null. */
  let reported: Indicator | string | null = null;

  const get = (): ChartSelection => {
    if (indicator) return { kind: 'indicator', indicator };
    const ids = chart.drawingLayer?.selection ?? [];
    return ids.length > 0 ? { kind: 'drawings', ids } : null;
  };
  const setIndicator = (next: Indicator | null) => {
    if (next === indicator) return;
    indicator = next;
    chart.redrawOverlay('options');
    if (next) chart.announce(chart.localization.text('indicatorSelected', { title: next.series?.options.title || next.def?.name || next.type }));
  };
  // Emit `selection:change` if the selection differs from the last one reported.
  const sync = () => {
    const selection = get();
    const key = selection?.kind === 'indicator' ? selection.indicator : (selection?.ids.join('\n') ?? null);
    if (key === reported) return;
    reported = key;
    chart.emit('selection:change', { selection });
  };
  const set = (selection: ChartSelection) => {
    const next = selection?.kind === 'indicator' ? selection.indicator : null;
    // The indicator first: clearing drawings then already reports it, with no empty selection in between.
    setIndicator(next && chart.indicatorLayer?.getAll().includes(next) ? next : null);
    chart.drawingLayer?.setSelection(selection?.kind === 'drawings' ? selection.ids : []);
    sync();
  };
  // Remove the selected indicator or drawings; false when nothing was removed.
  const remove = () => {
    if (!indicator) return chart.drawingLayer?.deleteSelection() ?? false;
    indicator.remove();
    return true;
  };
  // Copy the selected indicator or drawings; false when nothing was copied.
  const copy = () => {
    const indicators = internals.indicators();
    if (!indicator || !indicators) return (chart.drawingLayer?.copy() ?? 0) > 0;
    indicators.copy(indicator);
    return true;
  };

  const drawings = () => chart.drawingLayer;
  const list = [
    {
      id: 'remove-selected',
      keys: ['Delete', 'Backspace'],
      // Locked drawings stay: `run` then changes nothing and leaves the key to the page.
      enabled: () => get() !== null,
      run: remove,
    },
    { id: 'copy', keys: ['Mod+C'], enabled: () => get() !== null, run: copy },
    {
      id: 'cut',
      keys: ['Mod+X'],
      enabled: () => indicator !== null || ((drawings()?.selection.length ?? 0) > 0 && !drawings()!.locked),
      run: () => copy() && remove(),
    },
    {
      id: 'paste',
      keys: ['Mod+V'],
      enabled: () => !!internals.indicators()?.copied || (!!drawings() && !drawings()!.locked && !drawings()!.isBusy),
      // The copied indicator, or the copied drawings.
      run: () => {
        const indicators = internals.indicators();
        if (indicators?.copied) return indicators.paste(indicators.copied);
        return (drawings()?.paste().length ?? 0) > 0;
      },
    },
    // During a drawing gesture, undo and redo only cancel it.
    { id: 'undo', keys: ['Mod+Z'], enabled: () => chart.history.canUndo || !!drawings()?.isBusy, run: () => chart.history.undo() },
    {
      id: 'redo',
      keys: ['Mod+Shift+Z', 'Ctrl+Y'],
      enabled: () => chart.history.canRedo || !!drawings()?.isBusy,
      run: () => chart.history.redo(),
    },
  ];
  // Labels are the `action<Id>` messages (see `actionLabelKey`).
  for (const action of list) chart.actions.register({ ...action, local: true, label: () => chart.localization.text(actionLabelKey(action.id)) });

  return {
    get indicator() {
      return indicator;
    },
    get,
    set,
    click: (series) => {
      const hit = series ? (chart.indicatorLayer?.getAll().find((ind) => ind.series === series) ?? null) : null;
      if (hit) set({ kind: 'indicator', indicator: hit });
      else if (indicator) set(null);
    },
    changed: ({ ids, indicator: removed }) => {
      // One selection: selecting drawings drops the indicator, and so does removing it.
      if (ids?.length || removed === indicator) setIndicator(null);
      sync();
    },
  };
}
