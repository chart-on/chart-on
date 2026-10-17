import type { Chart } from '@charton/core';
import { iconButton } from './controls';
import { drawingIcon } from './icons';
import { shellText } from './messages';
import type { ToolRailHandle } from './rail';

/** Shell width (css px) below which the `railSheet` flag switches to the compact layout. */
export const defaultRailBreakpoint = 640;

/**
 * Internal: the shell's narrow layout behind the `railSheet` flag. Below the
 * breakpoint, measured on the shell itself, the rail leaves its column and
 * opens as a bottom sheet from a "Drawing tools" button, and the bottom bar
 * shows its range presets as a menu (see `.pc-bottombar-range-menu`).
 */
export interface CompactLayout {
  /** The shell is narrower than the breakpoint and the flag is on. */
  readonly compact: boolean;
  /** Whether the bottom sheet is open. */
  readonly open: boolean;
  /** Turn the layout on or off (the `railSheet` flag). */
  setEnabled(enabled: boolean): void;
  setOpen(open: boolean): void;
  /** Re-place the sheet button after the rail or the bottom bar was shown or hidden. */
  refresh(): void;
  destroy(): void;
}

export interface CompactLayoutParts {
  shell: HTMLElement;
  /** The rail's column; it becomes the sheet. */
  side: HTMLElement;
  stage: HTMLElement;
  chart: Chart;
  rail: ToolRailHandle | null;
  /** The bottom bar while it is shown; the sheet button goes there, else it floats over the stage. */
  bottomBar: () => HTMLElement | null;
  breakpoint: number;
}

export function createCompactLayout(parts: CompactLayoutParts): CompactLayout {
  const { shell, side, stage, chart, rail, breakpoint } = parts;
  let enabled = false;
  let compact = false;
  let open = false;
  let observer: ResizeObserver | null = null;

  const toggle = rail
    ? iconButton({ icon: drawingIcon, label: '', variant: 'ghost', onClick: () => setOpen(!open) })
    : null;
  toggle?.classList.add('pc-sheet-toggle');
  toggle?.setAttribute('data-tip-side', 'top');
  toggle?.setAttribute('aria-expanded', 'false');
  /** Name the button in the chart's language; again on `localization:change`. */
  const relabel = () => {
    const label = shellText(chart, 'toolbarDrawingTools');
    toggle?.setAttribute('aria-label', label);
    toggle?.setAttribute('data-tip', label);
  };
  relabel();
  const offLanguage = chart.on('localization:change', relabel);

  // Outside presses and Escape close the sheet; presses on the button toggle it themselves.
  const onPointer = (e: PointerEvent) => {
    const target = e.target as Node;
    if (!side.contains(target) && !toggle?.contains(target)) setOpen(false);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    setOpen(false);
    toggle?.focus();
  };
  const listen = (on: boolean) => {
    const doc = chart.root.ownerDocument;
    if (on) {
      doc.addEventListener('pointerdown', onPointer, true);
      doc.addEventListener('keydown', onKey);
    } else {
      doc.removeEventListener('pointerdown', onPointer, true);
      doc.removeEventListener('keydown', onKey);
    }
  };

  const setOpen = (next: boolean) => {
    const value = next && compact && Boolean(rail?.visible);
    if (compact) side.setAttribute('data-sheet', value ? 'open' : 'closed');
    if (value) {
      // Sit above the bottom bar, so its button stays in reach to close the sheet.
      const bar = parts.bottomBar();
      side.style.bottom = bar ? `${Math.max(0, shell.getBoundingClientRect().bottom - bar.getBoundingClientRect().top)}px` : '';
    }
    toggle?.setAttribute('aria-expanded', String(value));
    if (value !== open) listen(value);
    open = value;
  };

  const refresh = () => {
    if (!toggle) return;
    if (!compact || !rail?.visible) {
      toggle.remove();
      setOpen(false);
      return;
    }
    const bar = parts.bottomBar();
    if (bar) {
      toggle.removeAttribute('data-float');
      toggle.style.bottom = '';
      bar.insertBefore(toggle, bar.firstElementChild);
    } else {
      // Above the time axis, clear of its labels.
      toggle.setAttribute('data-float', '');
      toggle.style.bottom = `${chart.options.timeAxis.height + 8}px`;
      stage.append(toggle);
    }
  };

  const apply = () => {
    if (compact) shell.setAttribute('data-pc-layout', 'compact');
    else shell.removeAttribute('data-pc-layout');
    if (rail) {
      // The rail lays out in wrapping rows and opens its menus upwards.
      if (compact) rail.el.dataset.orientation = 'horizontal';
      else delete rail.el.dataset.orientation;
      rail.el.setAttribute('aria-orientation', compact ? 'horizontal' : 'vertical');
    }
    if (!compact) {
      side.removeAttribute('data-sheet');
      side.style.bottom = '';
    }
    setOpen(false);
    refresh();
  };

  const measure = () => {
    const width = shell.getBoundingClientRect().width;
    // Zero while detached or hidden: keep the wide layout rather than guess.
    const next = enabled && width > 0 && width < breakpoint;
    if (next === compact) return;
    compact = next;
    apply();
  };

  // Picking a tool closes the sheet so the chart is free to draw on.
  const offTool = chart.on('tool:change', ({ tool }) => {
    if (tool !== null) setOpen(false);
  });

  return {
    get compact() {
      return compact;
    },
    get open() {
      return open;
    },
    setEnabled(next) {
      if (next === enabled) return;
      enabled = next;
      if (enabled) {
        observer = new ResizeObserver(measure);
        observer.observe(shell);
      } else {
        observer?.disconnect();
        observer = null;
      }
      measure();
    },
    setOpen,
    refresh,
    destroy() {
      offTool();
      offLanguage();
      observer?.disconnect();
      setOpen(false);
      toggle?.remove();
    },
  };
}
