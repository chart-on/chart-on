import { defineComponent, h, markRaw, onActivated, onDeactivated, onMounted, onUnmounted, provide, shallowRef } from 'vue';
import { createChart, type Chart as CoreChart } from '@charton/core';
import { chartKey } from './context';
import { chartProps, clearEvents, readInputs, startEngine, watchEngine, type ChartEventHandlers, type ChartInputs, type Engine } from './sync';

/** What a template ref on `<Chart>` reaches. */
export interface ChartExposed {
  /** The `Chart` while the component is mounted; null before, after and on a server. */
  readonly chart: CoreChart | null;
}

/**
 * The chart engine alone, in a `div`. The chart is created when the component
 * mounts and destroyed when it unmounts; prop changes update it in place.
 * `class`, `style` and other attributes go to the `div`: give it a height, the
 * chart fills it. The default slot renders inside the `div`, where `useChart()`
 * returns this chart.
 */
export const Chart = defineComponent({
  name: 'Chart',
  props: chartProps,
  setup(props, { slots, expose }) {
    const element = shallowRef<HTMLDivElement | null>(null);
    const chart = shallowRef<CoreChart | null>(null);
    let mounted: Engine | null = null;
    provide(chartKey, chart);

    // Mount: runs only in the browser, never during server rendering.
    onMounted(() => {
      const inputs = readInputs(props);
      // Kept out of reactivity: the chart is a large mutable object the app never needs proxied.
      mounted = startEngine(markRaw(createChart(element.value!, inputs.options)), inputs, () => props.on);
      chart.value = mounted.chart;
    });

    // Inside a kept-alive branch: measure when taken out of the page (no size, so no drawing)
    // and when put back, without waiting for the resize observer.
    onActivated(() => mounted?.chart.resize());
    onDeactivated(() => mounted?.chart.resize());

    // Unmount: after the slot content has unmounted, so its clean-up still sees a live chart.
    onUnmounted(() => {
      if (!mounted) return;
      clearEvents(mounted.events);
      mounted.chart.destroy();
      mounted = null;
      chart.value = null;
    });

    // Updates: apply what changed since the last time, never through a new chart.
    watchEngine(props, () => mounted);

    expose({ chart });
    return () => h('div', { ref: element }, slots.default?.());
  },
});

/** The props of `<Chart>`, for apps that build them in code. */
export interface ChartProps extends ChartInputs {
  on?: ChartEventHandlers;
}
