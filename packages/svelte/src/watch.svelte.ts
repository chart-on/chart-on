import { untrack } from 'svelte';
import { handledNames, plainCopy, syncEvents, updateEngine, type ChartInputs, type Engine } from './sync.js';

/**
 * Apply prop changes to the mounted chart. `props` reads the component's props
 * through getters, so each effect below tracks only the props it reads: the
 * options are copied and compared only when something inside them changed,
 * not on every change of another prop. Call it during component set-up, after
 * `onMount`, so the first run of each effect finds the engine already started
 * and has nothing to apply.
 */
export function watchEngine(props: ChartInputs, engine: () => Engine | null): void {
  $effect(() => {
    const options = plainCopy(props.options);
    untrack(() => {
      const state = engine();
      if (state) updateEngine(state, { options });
    });
  });
  $effect(() => {
    const patch = { dataSource: props.dataSource, symbol: props.symbol, interval: props.interval };
    untrack(() => {
      const state = engine();
      if (state) updateEngine(state, patch);
    });
  });
  $effect(() => {
    handledNames(props.on);
    untrack(() => {
      const state = engine();
      if (state) syncEvents(state.chart, state.events, () => props.on);
    });
  });
}
