import { defineComponent, h, inject, markRaw, onActivated, onDeactivated, onMounted, onUnmounted, provide, shallowRef, watch, type InjectionKey, type PropType, type ShallowRef } from 'vue';
import type { Chart } from '@charton/core';
import {
  createChartShell,
  type ChartShell as CoreShell,
  type ChartShellOptions,
  type ShellEvents,
  type ShellFeatures,
  type ShellPalette,
  type ShellTheme,
} from '@charton/ui';
import { chartKey } from './context';
import { chartProps, clearEvents, handledNames, plainCopy, readInputs, sameValue, startEngine, syncEvents, watchEngine, type ChartEventHandlers, type ChartInputs, type Engine } from './sync';

// Main entry types the props use, so this entry's typings name only what it exports.
export type { ChartEventHandlers, ChartInputs } from './sync';

/** One callback per shell event the app listens to, keyed by event name. */
export type ShellEventHandlers = { [K in keyof ShellEvents]?: (payload: ShellEvents[K]) => void };

/** Shell options that can only be chosen when the shell is created. */
export type ShellCreationOptions = Omit<ChartShellOptions, 'chart' | 'theme' | 'palette' | 'features'>;

const shellKey: InjectionKey<Readonly<ShallowRef<CoreShell | null>>> = Symbol('charton-shell');

/**
 * The shell of the nearest enclosing `<ChartShell>`, as a ref. It holds null
 * on a server and until the shell has mounted, then the shell.
 */
export function useChartShell(): Readonly<ShallowRef<CoreShell | null>> {
  return inject(shellKey, () => shallowRef(null), true);
}

/** What a template ref on `<ChartShell>` reaches. */
export interface ChartShellExposed {
  /** The `ChartShell` while the component is mounted; null before, after and on a server. */
  readonly shell: CoreShell | null;
  /** The shell's chart, `shell.chart`, under the same conditions. */
  readonly chart: Chart | null;
}

interface Mounted {
  shell: CoreShell;
  engine: Engine;
  shellEvents: Map<keyof ShellEvents, () => void>;
  /** The features last applied, to compare by value. */
  features?: Partial<ShellFeatures>;
}

/** The props of `<ChartShell>`, for apps that build them in code. */
export interface ChartShellProps extends ChartInputs {
  theme?: ShellTheme;
  palette?: ShellPalette;
  features?: Partial<ShellFeatures>;
  shellOptions?: ShellCreationOptions;
  on?: ChartEventHandlers;
  shellOn?: ShellEventHandlers;
}

/** The options `createChartShell` gets at mount, leaving out props that are not set. */
function creationOptions(props: ChartShellProps, chart: ChartInputs['options'], features: ChartShellProps['features']): ChartShellOptions {
  const options: ChartShellOptions = { ...plainCopy(props.shellOptions) };
  if (chart) options.chart = chart;
  if (props.theme) options.theme = props.theme;
  if (props.palette) options.palette = props.palette;
  if (features) options.features = features;
  return options;
}

/**
 * The batteries-included widget: toolbar, drawing rail, bottom bar and the
 * chart, in a `div`. Import `@charton/ui/style.css` once in the app. The shell
 * is created when the component mounts and destroyed when it unmounts; prop
 * changes update it in place. `class`, `style` and other attributes go to the
 * `div`. The default slot renders inside it, where `useChart()` returns the
 * shell's chart and `useChartShell()` the shell.
 */
export const ChartShell = defineComponent({
  name: 'ChartShell',
  props: {
    ...chartProps,
    /**
     * Toolbar, rail, dialogs and the rest of the shell's set-up. Read once, when
     * the shell is created: to change them, remount the component on purpose,
     * for example with a new `key`.
     */
    shellOptions: Object as PropType<ShellCreationOptions>,
    /** Colour scheme of the chrome and the chart; changes go through `setTheme`. Default `dark`. */
    theme: String as PropType<ShellTheme>,
    /** Up and down colours; changes go through `setPalette`. */
    palette: String as PropType<ShellPalette>,
    /** Shell parts to show or hide; changes go through `applyFeatures` and are compared by value. */
    features: Object as PropType<Partial<ShellFeatures>>,
    /** Shell events to listen to, keyed by event name, e.g. `{ 'theme:change': (e) => … }`. */
    shellOn: Object as PropType<ShellEventHandlers>,
  },
  setup(props, { slots, expose }) {
    const element = shallowRef<HTMLDivElement | null>(null);
    const shell = shallowRef<CoreShell | null>(null);
    const chart = shallowRef<Chart | null>(null);
    let mounted: Mounted | null = null;
    provide(shellKey, shell);
    provide(chartKey, chart);

    // Mount: runs only in the browser, never during server rendering.
    onMounted(() => {
      const inputs = readInputs(props);
      const features = plainCopy(props.features);
      // Kept out of reactivity: the shell and its chart are large mutable objects.
      const created = markRaw(createChartShell(element.value!, creationOptions(props, inputs.options, features)));
      const shellEvents = new Map<keyof ShellEvents, () => void>();
      syncEvents(created, shellEvents, () => props.shellOn);
      mounted = { shell: created, engine: startEngine(markRaw(created.chart), inputs, () => props.on), shellEvents, features };
      shell.value = created;
      chart.value = created.chart;
    });

    // Inside a kept-alive branch: measure when taken out of the page and when put back.
    onActivated(() => mounted?.shell.chart.resize());
    onDeactivated(() => mounted?.shell.chart.resize());

    // Unmount: after the slot content has unmounted, so its clean-up still sees a live shell.
    onUnmounted(() => {
      if (!mounted) return;
      clearEvents(mounted.engine.events);
      clearEvents(mounted.shellEvents);
      mounted.shell.destroy();
      mounted = null;
      shell.value = null;
      chart.value = null;
    });

    // Updates: apply what changed since the last time, never through a new shell. Like every
    // prop, a theme, palette or features left out or set to `undefined` leaves the shell as it is.
    watchEngine(props, () => mounted?.engine ?? null);
    watch(
      () => props.theme,
      (theme) => theme && mounted?.shell.setTheme(theme),
    );
    watch(
      () => props.palette,
      (palette) => palette && mounted?.shell.setPalette(palette),
    );
    watch(
      () => plainCopy(props.features),
      (features) => {
        if (!mounted || !features || sameValue(features, mounted.features)) return;
        mounted.shell.applyFeatures(features);
        mounted.features = features;
      },
    );
    watch(
      () => handledNames(props.shellOn),
      () => mounted && syncEvents(mounted.shell, mounted.shellEvents, () => props.shellOn),
    );

    expose({ shell, chart });
    return () => h('div', { ref: element }, slots.default?.());
  },
});
