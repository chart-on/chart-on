import type { Chart, Drawing, DrawingStyle, Rect } from '@chart-on/core';
import { Copy, Group, ListOrdered, Lock, LockOpen, Settings, SlidersHorizontal, Trash2, Ungroup } from 'lucide';
import { iconButton } from './controls';
import { h, markActive, icon, isChartNavKey, isolateFromChart, nameButton, popoverToggle, type IconSource } from './dom';
import { shellText, type ShellMessageKey } from './messages';
import { levelsEditor, styleFieldControl, type StyleEdit, type StyleFieldContext, type StyleFieldControl } from './drawing-style-controls';
import { replayOf } from './replay';
import { retainTips } from './tooltip';

/** Returned by `createDrawingToolbar`: the floating toolbar's element and `destroy`. */
export interface DrawingToolbarHandle {
  el: HTMLElement;
  destroy(): void;
}

/** Options for `createDrawingToolbar`: an optional Settings button handler. */
export interface DrawingToolbarOptions {
  /**
   * Show a Settings button that calls this with the selected drawing's id,
   * e.g. to open `openDrawingSettings`. The settings then hold the fields
   * that are not inline, so the "More style" popover is left out.
   */
  onSettings?(id: string): void;
}

const GAP = 10;
const INSET = 4;

/**
 * Where to put a toolbar of `size` next to the selection `rect` inside an area
 * of `area` (all css px). It tries, in order: centered above the selection,
 * below it, to its right, to its left. The first side with room keeps the
 * toolbar outside the selection box, so it never covers an anchor. Only when
 * no side has room does it fall back to below the selection, clamped into the
 * area. `area.top` keeps a band at the top of the area clear, for a strip
 * floating there (the replay controls); when the toolbar does not fit below
 * the band, it overlaps the band rather than leave the area.
 */
export function placeToolbar(
  rect: Rect,
  size: { width: number; height: number },
  area: { width: number; height: number; top?: number },
): { x: number; y: number } {
  // Below the band, unless that would push the toolbar out of the bottom.
  const minY = Math.max(INSET, Math.min(Math.max(0, area.top ?? 0) + INSET, area.height - size.height - INSET));
  const clamp = (v: number, max: number, min = INSET) => Math.round(Math.max(min, Math.min(max - INSET, v)));
  const centerX = clamp(rect.x + rect.width / 2 - size.width / 2, area.width - size.width);
  const centerY = clamp(rect.y + rect.height / 2 - size.height / 2, area.height - size.height, minY);
  const above = rect.y - GAP - size.height;
  if (above >= minY) return { x: centerX, y: Math.round(above) };
  const below = rect.y + rect.height + GAP;
  if (below >= minY && below + size.height <= area.height - INSET) return { x: centerX, y: Math.round(below) };
  const right = rect.x + rect.width + GAP;
  if (right + size.width <= area.width - INSET) return { x: Math.round(right), y: centerY };
  const left = rect.x - GAP - size.width;
  if (left >= INSET) return { x: Math.round(left), y: centerY };
  return { x: centerX, y: clamp(below, area.height - size.height, minY) };
}

export { isChartNavKey };

/**
 * Floating toolbar for the selected drawing. It shows the drawing's quick
 * style fields (`chart.drawings.quickFields`), the rest of the fields its tool
 * honors (`styleFields`) in a "More style" popover, a levels editor for
 * level-based tools, then lock, clone, delete, group or ungroup and, with
 * `onSettings`, a Settings button that replaces the "More style" popover.
 * Follows the drawing and hides when it is deselected or out of view. With
 * several drawings selected, the fields are those of the last one selected,
 * and every edit applies to each selected drawing whose tool honors the
 * field; lock, clone and delete act on them all. Edits go through
 * `chart.drawings.update`, so they persist via `drawings:change` and are
 * undoable (one step for all the drawings); dragging across a color picker
 * previews live and commits once. Arrow and +/-/= keys stay in the toolbar;
 * Escape, Delete and undo/redo shortcuts reach the chart.
 */
export function createDrawingToolbar(chart: Chart, options: DrawingToolbarOptions = {}): DrawingToolbarHandle {
  const t = (key: ShellMessageKey) => shellText(chart, key);
  const el = h('div', { class: 'pc-drawing-toolbar', role: 'toolbar' });
  el.hidden = true;
  // Keep chart gestures (pan, drawing hit tests, wheel zoom) off the toolbar.
  isolateFromChart(el);

  const selected = (): Drawing | null => chart.drawings.selected;
  /** The drawings the controls edit; kept until they are torn down so a pending picker commits to them. */
  let targets: string[] = [];
  let lastRect: Rect | null = null;
  /**
   * Each target's share of a style patch: all of it for the drawing the
   * controls were built for (the last selected), the fields their tools
   * offer for the others.
   */
  const each = (style: DrawingStyle, apply: (id: string, style: DrawingStyle) => void) => {
    const shown = targets.at(-1);
    for (const id of targets) {
      const fields = new Set([...chart.drawings.styleFields(id), ...chart.drawings.quickFields(id)]);
      const own = id === shown ? style : Object.fromEntries(Object.entries(style).filter(([key]) => fields.has(key)));
      if (Object.keys(own).length > 0) apply(id, own);
    }
  };
  const edit: StyleEdit = {
    preview: (style) => each(style, (id, own) => chart.drawings.preview(id, { style: own })),
    // One undo step for all of them.
    commit: (style) => chart.drawings.batch(() => each(style, (id, own) => chart.drawings.update(id, { style: own }))),
  };
  /** The selected drawings that still exist, last selected last. */
  const selection = () => chart.drawings.selection;

  const fields = h('div', { class: 'pc-drawing-fields' });
  const more = popoverButton(SlidersHorizontal, 'pc-drawing-style-popover');
  const levels = popoverButton(ListOrdered, 'pc-levels-popover');

  const lock = iconButton({
    icon: LockOpen,
    label: '',
    variant: 'ghost',
    onClick: () => {
      const d = selected();
      if (!d) return;
      // All follow the drawing selected last.
      chart.drawings.batch(() => selection().forEach((id) => chart.drawings.update(id, { locked: !d.locked })));
    },
  });
  const cloneButton = iconButton({
    icon: Copy,
    label: '',
    variant: 'ghost',
    onClick: () => {
      const ids = selection();
      if (ids.length === 1) chart.drawings.clone(ids[0]!);
      else chart.drawings.duplicate(ids);
    },
  });
  const remove = iconButton({
    icon: Trash2,
    label: '',
    variant: 'ghost',
    onClick: () => chart.drawings.batch(() => selection().forEach((id) => chart.drawings.remove(id))),
  });
  remove.classList.add('pc-danger');
  const groupButton = iconButton({
    icon: Group,
    label: '',
    variant: 'ghost',
    onClick: () => chart.actions.run('group-drawings'),
  });
  const ungroupButton = iconButton({
    icon: Ungroup,
    label: '',
    variant: 'ghost',
    onClick: () => chart.actions.run('ungroup-drawings'),
  });
  const { onSettings } = options;
  const settings = onSettings
    ? [
        iconButton({
          icon: Settings,
          label: '',
          variant: 'ghost',
          onClick: () => {
            const d = selected();
            if (d) onSettings(d.id);
          },
        }),
      ]
    : [];
  el.append(
    fields,
    more.el,
    levels.el,
    h('div', { class: 'pc-sep', role: 'separator' }),
    lock,
    cloneButton,
    remove,
    groupButton,
    ungroupButton,
    ...settings,
  );
  chart.root.append(el);

  /** Whether the lock button shows the locked state; null until it is named. */
  let lockShown: boolean | null = null;
  /** Name the lock button for `locked`, when that changed (or always with `force`). */
  const nameLock = (locked: boolean, force = false) => {
    if (locked === lockShown && !force) return;
    lockShown = locked;
    lock.replaceChildren(icon(locked ? Lock : LockOpen, 16));
    nameButton(lock, t(locked ? 'drawingUnlock' : 'drawingLock'));
  };
  /** Name the toolbar and its buttons in the chart's language; again on `localization:change`. */
  const relabel = () => {
    el.setAttribute('aria-label', t('drawingSelected'));
    more.name(t('drawingMoreStyle'));
    levels.name(t('drawingLevels'));
    nameLock(lockShown === true, true);
    const names: [HTMLElement, ShellMessageKey][] = [
      [cloneButton, 'drawingClone'],
      [remove, 'drawingDelete'],
      [groupButton, 'drawingGroup'],
      [ungroupButton, 'drawingUngroup'],
      ...settings.map((b): [HTMLElement, ShellMessageKey] => [b, 'toolbarSettings']),
    ];
    for (const [target, key] of names) nameButton(target, t(key));
  };
  relabel();

  let controls: StyleFieldControl[] = [];
  /** Tool type and fields the controls were built for. */
  let builtFor = '';

  /** Build the controls for drawing `d`'s tool, unless they are already built. */
  const build = (d: Drawing) => {
    const quick = chart.drawings.quickFields(d.id);
    const all = chart.drawings.styleFields(d.id);
    const key = `${d.type}|${quick.join()}|${all.join()}`;
    if (key === builtFor) return;
    teardown();
    builtFor = key;
    const ctx: StyleFieldContext = {
      tool: chart.drawings.getTools().find((t) => t.type === d.type),
      theme: chart.theme,
      edit,
      localization: chart.localization,
    };
    const make = (keys: readonly string[]) =>
      keys.flatMap((k) => {
        const control = styleFieldControl(k, ctx);
        return control ? [control] : [];
      });
    const inline = make(quick);
    // With a settings dialog, the fields that are not inline live there.
    const rest = onSettings ? [] : make(all.filter((k) => !quick.includes(k)));
    fields.replaceChildren(...inline.map((c) => c.el));
    more.setContent(rest.map((c) => h('div', { class: 'pc-drawing-style-row' }, h('span', {}, c.label), c.el)));
    const editor = all.includes('levels') ? [levelsEditor(ctx)] : [];
    levels.setContent(editor.map((c) => c.el));
    controls = [...inline, ...rest, ...editor];
  };

  /** Close pickers (committing a pending change) and drop the controls. */
  const teardown = () => {
    // Clear first: a pending commit re-enters `sync` through `drawings:change`.
    const old = controls;
    controls = [];
    builtFor = '';
    more.close();
    levels.close();
    for (const c of old) c.destroy();
  };

  /** Reflect the selected drawing's style in the controls. */
  const sync = () => {
    const d = selected();
    if (!d) return;
    const ids = selection();
    if (ids.join() !== targets.join()) {
      // A different selection: close the old one's pickers before retargeting.
      teardown();
      targets = ids;
    }
    build(d);
    for (const c of controls) c.sync(d);
    const locked = d.locked === true;
    nameLock(locked);
    markActive(lock, locked);
    groupButton.hidden = !chart.actions.get('group-drawings')?.enabled;
    ungroupButton.hidden = !chart.actions.get('ungroup-drawings')?.enabled;
    if (lastRect && !el.hidden) place(lastRect);
  };

  /** Whether a replay ran at the last `replay:change`, to re-place only when that flips. */
  let replaying = !!replayOf(chart)?.state.active;

  /** The bottom of the replay strip when it shows, so the toolbar stays clear of it. */
  const reservedTop = (): number => {
    const strip = chart.root.querySelector<HTMLElement>('.pc-replay-bar');
    return strip && !strip.hidden ? strip.offsetTop + strip.offsetHeight : 0;
  };

  const place = (rect: Rect) => {
    lastRect = rect;
    el.hidden = false;
    const { x, y } = placeToolbar(
      rect,
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: chart.plotWidth, height: chart.plotHeight, top: reservedTop() },
    );
    // The placement is in plot coordinates; left price axes push the plot right.
    el.style.transform = `translate(${x + chart.plotLeft}px, ${y}px)`;
  };

  const hide = () => {
    // Hand focus back to the chart so its shortcuts keep working after Escape or Delete.
    if (el.contains(document.activeElement)) chart.root.focus({ preventScroll: true });
    el.hidden = true;
  };

  const offs = [
    chart.on('drawing:select', ({ id }) => {
      if (id !== null) return sync();
      teardown();
      targets = [];
      hide();
    }),
    // The replay strip shows or hides: keep out of its way. Only a start or a stop moves it, not
    // each playback step; and the strip may listen after this toolbar, so measure once every
    // listener has run.
    chart.on('replay:change', ({ active }) => {
      if (active === replaying) return;
      replaying = active;
      queueMicrotask(() => {
        if (lastRect && !el.hidden) place(lastRect);
      });
    }),
    chart.on('drawing:bounds', ({ rect }) => {
      if (rect && selected()) place(rect);
      else hide();
    }),
    chart.on('drawings:change', sync),
    // Rebuild the style controls too, so their names follow the new language.
    chart.on('localization:change', () => {
      relabel();
      teardown();
      sync();
    }),
  ];

  const releaseTips = retainTips();
  return {
    el,
    destroy() {
      releaseTips();
      for (const off of offs) off();
      teardown();
      el.remove();
    },
  };
}

interface PopoverButton {
  el: HTMLElement;
  /** Name the button and its popover. */
  name(label: string): void;
  /** Fill the popover; with nothing in it the button hides. */
  setContent(children: HTMLElement[]): void;
  close(): void;
}

/** Icon button that opens a popover panel under it; hidden while it has no content. */
function popoverButton(source: IconSource, panelClass: string): PopoverButton {
  const wrap = h('div', { class: 'pc-menu' });
  const panel = h('div', { class: `pc-popover pc-popover--end ${panelClass}`, role: 'dialog' });
  const trigger = iconButton({ icon: source, label: '', variant: 'ghost' });
  trigger.setAttribute('aria-haspopup', 'dialog');
  const { close } = popoverToggle(
    wrap,
    trigger,
    () => {
      wrap.append(panel);
      return panel;
    },
    undefined,
    true,
  );
  wrap.append(trigger);
  wrap.hidden = true;
  return {
    el: wrap,
    name(label) {
      nameButton(trigger, label);
      panel.setAttribute('aria-label', label);
    },
    setContent(children) {
      panel.replaceChildren(...children);
      wrap.hidden = children.length === 0;
    },
    close,
  };
}
