import { defineComponent, h, markRaw, ref } from 'vue';
import { createMockDataSource } from '@charton/core';
import { Chart } from '@charton/vue';

const intervals = ['1m', '1h', '1d'] as const;

/**
 * Renders the same markup on the server and in the browser. On the server the
 * chart is only its container `div`; the chart itself is created after
 * hydration, when the component mounts.
 */
export const App = defineComponent({
  name: 'App',
  setup() {
    // Creating the source does not touch the network or the DOM, so it is safe on the server too.
    const dataSource = markRaw(createMockDataSource());
    const interval = ref<(typeof intervals)[number]>('1h');

    return () =>
      h('main', { style: { fontFamily: 'system-ui', padding: '16px' } }, [
        h('h1', { style: { fontSize: '20px' } }, 'Server-rendered chart'),
        h(
          'div',
          { role: 'group', 'aria-label': 'Interval', style: { display: 'flex', gap: '8px', marginBottom: '8px' } },
          intervals.map((value) =>
            h('button', { key: value, type: 'button', 'aria-pressed': value === interval.value, onClick: () => (interval.value = value) }, value),
          ),
        ),
        h(Chart, { id: 'chart', style: { height: '420px' }, dataSource, symbol: 'DEMO', interval: interval.value }),
      ]);
  },
});
