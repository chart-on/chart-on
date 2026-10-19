import { defineComponent, h, markRaw, ref } from 'vue';
import { createMockDataSource } from '@chart-on/core';
import { ChartShell, type ChartShellExposed } from '@chart-on/vue/shell';

/** The widget with synthetic data, a theme switch and a crosshair readout. */
export const App = defineComponent({
  name: 'App',
  setup() {
    // Created once and kept out of reactivity: a new source would attach again and reload the symbol.
    const dataSource = markRaw(createMockDataSource());
    const shell = ref<ChartShellExposed | null>(null);
    const theme = ref<'dark' | 'light'>('dark');
    const price = ref<number | null>(null);
    const on = { 'crosshair:move': (e: { price: number } | null) => (price.value = e ? e.price : null) };

    return () =>
      h('div', { style: { display: 'flex', flexDirection: 'column', height: '100vh' } }, [
        h('header', { style: { display: 'flex', gap: '12px', alignItems: 'center', padding: '8px', fontFamily: 'system-ui' } }, [
          h('button', { type: 'button', onClick: () => (theme.value = theme.value === 'dark' ? 'light' : 'dark') }, `Theme: ${theme.value}`),
          h('button', { type: 'button', onClick: () => shell.value?.chart?.fitContent() }, 'Fit'),
          h('span', `Crosshair: ${price.value === null ? '-' : price.value.toFixed(2)}`),
        ]),
        h(ChartShell, {
          ref: shell,
          style: { flex: 1, minHeight: 0 },
          theme: theme.value,
          dataSource,
          symbol: 'DEMO',
          interval: '1h',
          on,
        }),
      ]);
  },
});
