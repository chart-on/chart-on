import type { Chart, DraftEditEvent, DraftLine, OrderType } from '@chart-on/core';
import { button } from './controls';
import { fadeOutAndRemove, h, isolateFromChart, onDismiss, placeAtOrigin } from './dom';
import { keyOf, shellText, type Localized, type ShellMessageKey } from './messages';
import { devCheck, devRequirePlugin } from './options-schema';

/** A quantity keypad button: a quantity, the maximum, or a share of it such as `'25%'`. */
export type QuantityPreset = number | 'max' | `${number}%`;

/** Options for `createDraftEditor`: the quantity keypad's preset buttons and the largest quantity a draft may have. */
export interface DraftEditorOptions {
  /**
   * Buttons of the quantity keypad. `'max'` and percentages show only when
   * `maxQuantity` is set. Default `[1, 5, 25, 'max', '25%']`.
   */
  quantityPresets?: readonly QuantityPreset[];
  /** The largest quantity the draft may have, e.g. from the account's buying power. */
  maxQuantity?: (ctx: { draft: DraftLine }) => number;
}

/** Returned by `createDraftEditor`: the open keypad or type menu, if any, with `close` and `destroy`. */
export interface DraftEditorHandle {
  /** The open keypad or type menu, or null. */
  readonly el: HTMLElement | null;
  close(): void;
  destroy(): void;
}

const DEFAULT_PRESETS: readonly QuantityPreset[] = [1, 5, 25, 'max', '25%'];
/** The order types the type menu offers; message `draft<Type>` names each. */
const ORDER_TYPES: readonly OrderType[] = ['limit', 'stop', 'market'];

/** The quantity a preset stands for, or null when it needs a maximum that is not known (or not positive). */
export function presetQuantity(preset: QuantityPreset, max: number | null): number | null {
  if (typeof preset === 'number') return preset > 0 ? preset : null;
  if (max === null || !(max > 0)) return null;
  if (preset === 'max') return max;
  const share = Number(preset.slice(0, -1));
  return share > 0 ? (max * share) / 100 : null;
}

/** The text of a quantity keypad button, e.g. `Max` (`draftMax` in the language of `options`) or `25%`. */
export function presetLabel(preset: QuantityPreset, options?: Localized): string {
  return preset === 'max' ? shellText(options, 'draftMax') : String(preset);
}

/**
 * The default answer to clicking a draft's quantity or type: a keypad with
 * presets, or a menu of order types, next to the segment. Apps that call
 * `preventDefault()` on `draft:edit` show their own UI instead; the editor
 * decides after every listener ran, so listeners added after it count too.
 */
export function createDraftEditor(chart: Chart, options: DraftEditorOptions = {}): DraftEditorHandle {
  const t = (key: ShellMessageKey, params?: Record<string, string>) => shellText(chart, key, params);
  let el: HTMLElement | null = null;
  let dispose: (() => void) | null = null;
  let frame = 0;
  // Bumped by every close, so an answer still waiting for its microtask is dropped.
  let generation = 0;

  const close = () => {
    generation++;
    if (el) fadeOutAndRemove(el);
    el = null;
    dispose?.();
    dispose = null;
    if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
    frame = 0;
  };

  /** Whether the draft is still on the chart and shown, so editing it makes sense. */
  const live = (draft: DraftLine) => draft.visible && chart.annotations.draftLines.includes(draft);

  // Drafts leave without an event (discard, commit, clear, hidden): check once a frame while open.
  const watch = (draft: DraftLine) => {
    if (typeof requestAnimationFrame !== 'function') return;
    const tick = () => {
      frame = 0;
      if (!el) return;
      if (!live(draft)) close();
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  };

  const show = (popover: HTMLElement, e: DraftEditEvent) => {
    // Presses inside must not pan the chart or start a drawing.
    isolateFromChart(popover);
    placeAtOrigin(popover);
    chart.root.append(popover);
    // Below the segment, or above it when there is no room; kept inside the chart.
    const w = popover.offsetWidth;
    const ph = popover.offsetHeight;
    const x = Math.max(4, Math.min(chart.width - w - 4, e.anchor.x - w / 2));
    const below = e.anchor.y + 4;
    const y = below + ph <= chart.height - 4 ? below : Math.max(4, e.anchor.y - ph - 28);
    Object.assign(popover.style, { left: `${Math.round(x)}px`, top: `${Math.round(y)}px` });
    el = popover;
    dispose = onDismiss(popover, close);
    watch(e.draft);
  };

  const keypad = (e: DraftEditEvent) => {
    const { draft } = e;
    const popover = h('div', { class: 'pc-popover pc-draft-editor', role: 'dialog', 'aria-label': t('draftQuantityTitle') });
    const input = h('input', { class: 'pc-draft-qty', type: 'number', min: '0', step: 'any', 'aria-label': t('draftQuantity') });
    if (draft.options.quantity !== undefined) input.value = String(draft.options.quantity);
    const apply = (quantity: number) => {
      if (!live(draft)) return close();
      if (!(Number.isFinite(quantity) && quantity > 0)) return;
      draft.applyOptions({ quantity });
      close();
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') apply(Number(input.value));
    });
    const max = options.maxQuantity ? options.maxQuantity({ draft }) : null;
    const presets = h('div', { class: 'pc-draft-presets' });
    for (const preset of options.quantityPresets ?? DEFAULT_PRESETS) {
      const quantity = presetQuantity(preset, max);
      if (quantity === null) continue;
      const chip = h('button', { class: 'pc-chip', 'aria-label': t('draftQuantityPreset', { value: presetLabel(preset, chart) }) }, presetLabel(preset, chart));
      chip.addEventListener('click', () => apply(quantity));
      presets.append(chip);
    }
    const ok = button({ label: t('draftSet'), variant: 'neutral', onClick: () => apply(Number(input.value)) });
    popover.append(h('div', { class: 'pc-draft-row' }, input, ok));
    if (presets.children.length > 0) popover.append(presets);
    show(popover, e);
    input.focus();
    input.select();
  };

  const typeMenu = (e: DraftEditEvent) => {
    const { draft } = e;
    const popover = h('div', { class: 'pc-popover pc-draft-editor', role: 'menu', 'aria-label': t('draftType') });
    for (const type of ORDER_TYPES) {
      const checked = draft.options.type === type;
      const item = h('button', { class: 'pc-popover-item', role: 'menuitemradio', 'aria-checked': String(checked) }, t(keyOf('draft', type)));
      item.addEventListener('click', () => {
        if (live(draft)) draft.applyOptions({ type });
        close();
      });
      popover.append(item);
    }
    show(popover, e);
    (popover.querySelector('[aria-checked="true"]') as HTMLElement | null)?.focus();
  };

  const offEdit = chart.on('draft:edit', (e) => {
    close();
    const ours = generation;
    // Decide after every listener ran, so one added after the editor can still prevent it.
    queueMicrotask(() => {
      if (ours !== generation || e.defaultPrevented || !live(e.draft)) return;
      if (e.segment === 'quantity') keypad(e);
      else typeMenu(e);
    });
  });
  const offSymbol = chart.on('data:loading', (e) => {
    if (e.kind === 'initial') close();
  });

  return {
    get el() {
      return el;
    },
    close,
    destroy() {
      close();
      offEdit();
      offSymbol();
    },
  };
}

/** The shell's `draftEditor` part, made by `draftEditor(options)`: the shell calls it with its chart. */
export type DraftEditorPart = (chart: Chart) => DraftEditorHandle;

/**
 * The order draft editor for the shell's `draftEditor` option: a quantity
 * keypad and an order type menu answering `draft:edit`. Needs the `trading()`
 * plugin. Without it `draft:edit` is left to the app.
 */
export function draftEditor(options: DraftEditorOptions = {}): DraftEditorPart {
  devCheck('draftEditor', options, 'draftEditor');
  return (chart) => {
    devRequirePlugin(chart, 'draftEditor', 'trading');
    return createDraftEditor(chart, options);
  };
}
