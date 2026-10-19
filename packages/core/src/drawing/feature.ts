import { actionLabelKey, type ActionDefinition } from '../actions';
import type { Chart } from '../chart';
import type { PluginContext } from '../plugins';
import type { ChartInternals, DrawingsFeature } from '../registry';
import { createSelection } from '../selection';
import { builtinToolLabels } from './builtin-labels';
import { DrawingClipboard } from './clipboard';
import { drawingHost, drawingsGlue } from './chart-host';
import { DrawingManager } from './manager';
import type { DrawingToolDef } from './types';

// The drawings plugins (`drawings()` and `drawingTools()` in `builtins.ts`): the drawing manager,
// its commands and the system clipboard live here, so a chart without them leaves them out.

/** The chart's internal hooks for drawings. */
type DrawingsHost = { provideFeature(key: 'drawings', feature: DrawingsFeature): () => void; internals(): ChartInternals };

/** Give the plugin's chart a drawing manager with `tools`, the drawing commands and the clipboard. */
export function installDrawings(ctx: PluginContext, tools: readonly DrawingToolDef[], builtin: readonly DrawingToolDef[] = []): void {
  const chart = ctx.chart;
  chart.selector((i) => createSelection(chart, i));
  // The English names `drawings.toolLabel` may translate; other labels are the app's own.
  for (const tool of builtin) builtinToolLabels.set(tool.type, tool.label);
  const drawActions = new Map<string, () => void>();
  const host = chart as unknown as DrawingsHost;
  const internals = host.internals();
  const manager = new DrawingManager(drawingHost(chart, internals));
  // A static chart takes no keys, so it needs no clipboard.
  const clipboard = chart.options.interactive
    ? new DrawingClipboard({
        root: chart.root,
        actions: chart.actions,
        drawings: manager,
        source: () => ({
          symbol: chart.data?.symbol?.symbol ?? null,
          interval: chart.data?.interval ?? null,
          visibleRange: chart.getVisibleRange(),
          priceRanges: manager.priceRanges(),
        }),
        anchor: () => chart.crosshair,
        indicator: () => internals.indicators()?.copied ?? null,
        // Without indicators, reported like an unknown indicator.
        pasteIndicator: (set) =>
          internals.indicators()?.paste(set) ??
          chart.notify({ message: chart.localization.text('indicatorPasteFailed', { type: '' }), kind: 'error' }),
      })
    : null;
  if (clipboard) ctx.onDispose(() => clipboard.destroy());
  // Focus leaving the chart clears a quick measurement, as Escape does.
  const blur = (e: FocusEvent) => chart.root.contains(e.relatedTarget as Node | null) || manager.clearMeasure();
  chart.root.addEventListener('focusout', blur);
  ctx.onDispose(() => chart.root.removeEventListener('focusout', blur));
  let sync = () => syncDrawActions(chart, manager, drawActions);
  const feature: DrawingsFeature = { manager, key: (e) => clipboard?.key(e) ?? false, toolsChange: () => sync(), ...drawingsGlue(chart, internals, manager) };
  ctx.onDispose(host.provideFeature('drawings', feature));
  ctx.onDispose(() => {
    sync = () => {};
    for (const remove of drawActions.values()) remove();
  });
  manager.setAccess(chart.options.access.allow);
  // Tools other plugins registered before drawings went away, and what a layout loaded without them kept.
  for (const tool of internals.pluginDrawingTools()) manager.register(tool);
  const toolDefaults = internals.takeLayout('toolDefaults');
  const drawings = internals.takeLayout('drawings');
  if (toolDefaults !== undefined) manager.loadToolDefaults(toolDefaults);
  if (drawings !== undefined) manager.load(drawings);
  chart.redrawOverlay('drawings');
  for (const action of drawingActions(manager)) {
    ctx.onDispose(chart.actions.register({ ...action, label: () => chart.localization.text(actionLabelKey(action.id)) }));
  }
  sync();
  for (const tool of tools) ctx.registerDrawingTool(tool);
}

/** The drawing commands on `chart.actions`: delete, copy, cut, paste, lock, hide, group. */
function drawingActions(drawings: DrawingManager): Omit<ActionDefinition, 'label'>[] {
  return [
    {
      // Delete and Backspace run the chart's `remove-selected`, and the copy, cut and paste keys its `copy`,
      // `cut` and `paste`, which also take a selected indicator.
      id: 'delete-drawings',
      local: true,
      enabled: () => drawings.selection.length > 0 && !drawings.locked,
      run: () => drawings.deleteSelection(),
    },
    {
      id: 'copy-drawings',
      local: true,
      enabled: () => drawings.selection.length > 0,
      run: () => drawings.copy() > 0,
    },
    {
      id: 'cut-drawings',
      local: true,
      enabled: () => drawings.selection.length > 0 && !drawings.locked,
      run: () => drawings.copy() > 0 && drawings.deleteSelection(),
    },
    {
      id: 'paste-drawings',
      local: true,
      enabled: () => !drawings.locked && !drawings.isBusy,
      run: () => drawings.paste().length > 0,
    },
    {
      id: 'lock-drawings',
      checked: () => drawings.locked,
      run: () => drawings.setLocked(!drawings.locked),
    },
    {
      id: 'hide-drawings',
      checked: () => drawings.hidden,
      run: () => drawings.setHidden(!drawings.hidden),
    },
    {
      id: 'group-drawings',
      keys: ['Mod+G'],
      local: true,
      // Not when the selection already is one whole group.
      enabled: () => drawings.selection.length > 1 && !drawings.locked && !isOneGroup(drawings),
      run: () => drawings.group() !== null,
    },
    {
      id: 'ungroup-drawings',
      keys: ['Mod+Shift+G'],
      local: true,
      enabled: () => !drawings.locked && drawings.selection.some((id) => drawings.getById(id)?.group),
      run: () => drawings.ungroup() > 0,
    },
  ];
}

/** Whether the selection is exactly one whole group. */
function isOneGroup(drawings: DrawingManager): boolean {
  const ids = drawings.selection;
  const name = drawings.getById(ids[0] ?? '')?.group;
  if (!name) return false;
  const members = drawings.groups.find((g) => g.name === name)?.ids ?? [];
  return members.length === ids.length && members.every((id) => ids.includes(id));
}

/**
 * One `draw-<type>` command per drawing tool the chart has, so any tool can
 * get a shortcut; kept in step as tools are registered and unregistered.
 * None has a default key (#863): the free unmodified keys are too few for a
 * catalogue this size, and a modifier such as Alt types a character on some
 * layouts and opens the browser menu on others. Apps and users bind them.
 */
function syncDrawActions(chart: Chart, drawings: DrawingManager, drawActions: Map<string, () => void>): void {
  const types = new Set(drawings.getTools().map((t) => t.type));
  for (const [type, remove] of drawActions) {
    if (types.has(type)) continue;
    remove();
    drawActions.delete(type);
  }
  for (const tool of drawings.getTools()) {
    if (drawActions.has(tool.type)) continue;
    const type = tool.type;
    drawActions.set(
      type,
      chart.actions.register({
        id: `draw-${type}`,
        label: () => chart.localization.text('actionDrawTool', { tool: drawings.toolLabel(type) }),
        local: true,
        enabled: () => drawings.isToolAllowed(type),
        checked: () => drawings.tool === type,
        run: () => drawings.setTool(drawings.tool === type ? null : type),
      }),
    );
  }
}
