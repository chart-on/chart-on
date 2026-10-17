import { svgIcon, type IconShape } from './util/svg-icon';
import type { ChartTheme } from './theme';
import type { Pane } from './pane';
import { prefersReducedMotion } from './pulse';
import { englishLocalizer, type Localizer } from './util/locale';

export type PaneAction = 'up' | 'down' | 'maximize' | 'collapse' | 'remove';

const GLYPHS: Record<string, readonly IconShape[]> = {
  up: [['path', { d: 'm6 15 6-6 6 6' }]],
  down: [['path', { d: 'm6 9 6 6 6-6' }]],
  maximize: [['rect', { x: '4', y: '4', width: '16', height: '16', rx: '2' }]],
  restore: [['path', { d: 'M8 8V4h12v12h-4' }], ['rect', { x: '4', y: '8', width: '12', height: '12', rx: '2' }]],
  collapse: [['path', { d: 'M5 12h14' }]],
  expand: [['path', { d: 'M12 5v14M5 12h14' }]],
  remove: [['path', { d: 'M18 6 6 18M6 6l12 12' }]],
};

const BUTTON_SIZE = 22;
/** Gap between a pane's top edge and its buttons. */
const BUTTONS_TOP = 4;
/** Distance from a pane's top to the bottom of its buttons, css px. */
export const PANE_BUTTONS_BOTTOM = BUTTONS_TOP + BUTTON_SIZE;

/** The room pane buttons take at the top of each pane: their bottom (css px from the pane top) and the side they sit on. */
export interface PaneButtonsSpace {
  height: number;
  side: 'left' | 'right';
}

export interface PaneControlsState {
  /** Pane under the pointer, or -1. */
  hover: number;
  /** Maximized pane, or -1. */
  maximized: number;
  /** Width beside the plot on the buttons' side (the price axis), css px. */
  axisWidth: number;
  /** Side the buttons sit on: the end side, `'right'` unless the chart reads right to left. Default `'right'`. */
  side?: 'left' | 'right';
  theme: ChartTheme;
  enabled: boolean;
  /** Button labels in the chart's language; default English. */
  text?: Pick<Localizer, 'text'>;
}

/** Small per-pane buttons at the top end of the pane under the pointer. */
export class PaneControls {
  #blocks: HTMLDivElement[] = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly onAction: (pane: number, action: PaneAction) => void,
  ) {}

  update(panes: readonly Pane[], state: PaneControlsState): void {
    while (this.#blocks.length > panes.length) this.#blocks.pop()!.remove();
    const multi = panes.length > 1;
    const t = state.text ?? englishLocalizer;
    panes.forEach((pane, i) => {
      const block = this.#block(i);
      const name = t.text('paneToolbar');
      if (block.getAttribute('aria-label') !== name) block.setAttribute('aria-label', name);
      // Buttons that apply to this pane right now; the main pane stays first.
      const actions: [PaneAction, string, string][] = [];
      if (i > 1) actions.push(['up', 'up', t.text('paneMoveUp')]);
      if (i > 0 && i < panes.length - 1) actions.push(['down', 'down', t.text('paneMoveDown')]);
      if (multi) {
        const max = state.maximized === i;
        actions.push(['maximize', max ? 'restore' : 'maximize', t.text(max ? 'paneRestore' : 'paneMaximize')]);
        if (state.maximized < 0) {
          actions.push(['collapse', pane.collapsed ? 'expand' : 'collapse', t.text(pane.collapsed ? 'paneExpand' : 'paneCollapse')]);
        }
      }
      if (i > 0) actions.push(['remove', 'remove', t.text('paneRemove')]);
      const key = `${actions.map((a) => `${a[1]}:${a[2]}`).join()}|${state.theme.text}|${state.theme.background}`;
      if (block.dataset.key !== key) {
        block.dataset.key = key;
        block.replaceChildren(...actions.map(([action, glyph, label]) => this.#button(i, action, glyph, label, state.theme)));
      }
      const shown = state.enabled && state.hover === i && pane.height > 0 && actions.length > 0;
      block.style.top = `${pane.top + BUTTONS_TOP}px`;
      const left = state.side === 'left';
      block.style.left = left ? `${state.axisWidth + 6}px` : '';
      block.style.right = left ? '' : `${state.axisWidth + 6}px`;
      block.style.opacity = shown ? '1' : '0';
      block.style.pointerEvents = shown ? 'auto' : 'none';
      block.style.visibility = state.enabled ? '' : 'hidden';
    });
  }

  #block(i: number): HTMLDivElement {
    let block = this.#blocks[i];
    if (block) return block;
    block = document.createElement('div');
    block.className = 'pc-pane-controls';
    block.setAttribute('role', 'toolbar');
    Object.assign(block.style, {
      position: 'absolute',
      zIndex: '3',
      display: 'flex',
      gap: '2px',
      opacity: '0',
      transition: prefersReducedMotion() ? 'none' : 'opacity 120ms ease',
    });
    // Keep presses on the buttons from starting a pan or a drawing.
    block.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.root.appendChild(block);
    this.#blocks[i] = block;
    return block;
  }

  #button(pane: number, action: PaneAction, glyph: string, label: string, theme: ChartTheme): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `pc-pane-btn pc-pane-btn--${action}`;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.replaceChildren(svgIcon(GLYPHS[glyph] ?? [], 14));
    Object.assign(b.style, {
      display: 'grid',
      placeItems: 'center',
      width: `${BUTTON_SIZE}px`,
      height: `${BUTTON_SIZE}px`,
      padding: '0',
      border: `1px solid ${theme.separator}`,
      borderRadius: '4px',
      background: theme.background,
      color: theme.text,
      cursor: 'pointer',
    });
    b.addEventListener('click', () => this.onAction(pane, action));
    return b;
  }
}
