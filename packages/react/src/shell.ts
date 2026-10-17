import {
  createContext,
  createElement,
  forwardRef,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { ChartEvents } from '@charton/core';
import {
  createChartShell,
  type ChartShell as CoreShell,
  type ChartShellOptions,
  type ShellEvents,
  type ShellFeatures,
  type ShellPalette,
  type ShellTheme,
} from '@charton/ui';
import { ChartContext } from './context';
import { clearEvents, keepUnset, sameValue, syncChart, syncEvents, type ChartEventHandlers, type ChartInputs } from './sync';

// Main entry types the props use, so this entry's typings name only what it exports.
export type { ChartEventHandlers, ChartInputs } from './sync';

/** One callback per shell event the app listens to, keyed by event name. */
export type ShellEventHandlers = { [K in keyof ShellEvents]?: (payload: ShellEvents[K]) => void };

/** Shell options that can only be chosen when the shell is created. */
export type ShellCreationOptions = Omit<ChartShellOptions, 'chart' | 'theme' | 'palette' | 'features'>;

/** The props of `<ChartShell>`: chart options and data, plus shell set-up, event handlers and container attributes. */
export interface ChartShellProps extends ChartInputs {
  /**
   * Toolbar, rail, dialogs and the rest of the shell's set-up. Read once, when
   * the shell is created: to change them, remount the component on purpose,
   * for example with a new `key`.
   */
  shellOptions?: ShellCreationOptions;
  /** Colour scheme of the chrome and the chart; changes go through `setTheme`. Default `dark`. */
  theme?: ShellTheme;
  /** Up and down colours; changes go through `setPalette`. */
  palette?: ShellPalette;
  /** Shell parts to show or hide; changes go through `applyFeatures` and are compared by value. */
  features?: Partial<ShellFeatures>;
  /** Chart events to listen to, keyed by event name. */
  on?: ChartEventHandlers;
  /** Shell events to listen to, keyed by event name, e.g. `{ 'theme:change': (e) => … }`. */
  shellOn?: ShellEventHandlers;
  /** Attributes of the container element. Give it a height: the shell fills it. */
  id?: string;
  className?: string;
  style?: CSSProperties;
  /** Rendered inside the container; `useChart()` and `useChartShell()` in them return this shell's instances. */
  children?: ReactNode;
}

const ShellContext = createContext<CoreShell | null>(null);

/** The shell of the nearest enclosing `<ChartShell>`; null on a server and until it has mounted. */
export function useChartShell(): CoreShell | null {
  return useContext(ShellContext);
}

/** Shell props a mounted component last applied. */
interface ShellInputs extends ChartInputs {
  theme?: ShellTheme;
  palette?: ShellPalette;
  features?: Partial<ShellFeatures>;
}

interface Mounted {
  shell: CoreShell;
  inputs: ShellInputs;
  chartEvents: Map<keyof ChartEvents, () => void>;
  shellEvents: Map<keyof ShellEvents, () => void>;
}

/** The options `createChartShell` gets at mount, leaving out props that are not set. */
function creationOptions(props: ChartShellProps): ChartShellOptions {
  const options: ChartShellOptions = { ...props.shellOptions };
  if (props.options) options.chart = props.options;
  if (props.theme) options.theme = props.theme;
  if (props.palette) options.palette = props.palette;
  if (props.features) options.features = props.features;
  return options;
}

/** Apply the shell props that changed since `last`. */
function syncShell(shell: CoreShell, last: ShellInputs, next: ChartShellProps): void {
  if (next.theme && next.theme !== last.theme) shell.setTheme(next.theme);
  if (next.palette && next.palette !== last.palette) shell.setPalette(next.palette);
  if (next.features && !sameValue(next.features, last.features)) shell.applyFeatures(next.features);
}

/**
 * The batteries-included widget: toolbar, drawing rail, bottom bar and the
 * chart, in a `div`. Import `@charton/ui/style.css` once in the app. The shell
 * is created when the component mounts and destroyed when it unmounts; prop
 * changes update it in place. The `ref` receives the `ChartShell` while the
 * component is mounted (its chart is `shell.chart`), and null otherwise.
 */
export const ChartShell = forwardRef<CoreShell | null, ChartShellProps>(function ChartShell(props, ref) {
  const element = useRef<HTMLDivElement>(null);
  const mounted = useRef<Mounted | null>(null);
  const handlers = useRef({ chart: props.on, shell: props.shellOn });
  const [shell, setShell] = useState<CoreShell | null>(null);

  // Mount: runs only in the browser, once per mount (twice in development double mounting).
  useEffect(() => {
    const created = createChartShell(element.current!, creationOptions(props));
    const state: Mounted = { shell: created, inputs: props, chartEvents: new Map(), shellEvents: new Map() };
    // Listen first: loading the symbol below emits events straight away.
    syncEvents(created.chart, state.chartEvents, props.on, () => handlers.current.chart);
    syncEvents(created, state.shellEvents, props.shellOn, () => handlers.current.shell);
    syncChart(created.chart, null, props);
    mounted.current = state;
    setShell(created);
    return () => {
      clearEvents(state.chartEvents);
      clearEvents(state.shellEvents);
      created.destroy();
      mounted.current = null;
      setShell(null);
    };
    // No dependencies on purpose: later prop changes go through the update effect below,
    // never through a new shell.
  }, []);

  // Update: after every commit, apply what changed since the last one.
  useEffect(() => {
    handlers.current = { chart: props.on, shell: props.shellOn };
    const state = mounted.current;
    if (!state) return;
    const next = keepUnset(state.inputs, props);
    syncShell(state.shell, state.inputs, next);
    syncChart(state.shell.chart, state.inputs, next);
    syncEvents(state.shell.chart, state.chartEvents, props.on, () => handlers.current.chart);
    syncEvents(state.shell, state.shellEvents, props.shellOn, () => handlers.current.shell);
    state.inputs = next;
  });

  useImperativeHandle<CoreShell | null, CoreShell | null>(ref, () => shell, [shell]);

  return createElement(
    ShellContext.Provider,
    { value: shell },
    createElement(
      ChartContext.Provider,
      { value: shell?.chart ?? null },
      createElement('div', { ref: element, id: props.id, className: props.className, style: props.style }, props.children),
    ),
  );
});
