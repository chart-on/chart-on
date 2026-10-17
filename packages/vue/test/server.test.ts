import { describe, expect, it } from 'vitest';
import { createSSRApp, defineComponent, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { Chart, useChart } from '@charton/vue';
import { ChartShell, useChartShell } from '@charton/vue/shell';

/** Server rendering: no DOM, no WebGL, and no chart, only the container element. */

describe('server rendering', () => {
  it('renders <Chart> as its container without creating a chart', async () => {
    let seen: unknown = 'unset';
    const Probe = defineComponent(() => {
      const chart = useChart();
      return () => ((seen = chart.value), h('span', 'legend'));
    });
    const app = createSSRApp(() =>
      h(Chart, { id: 'price', class: 'chart', style: { height: '300px' }, options: { barSpacing: 8 } }, { default: () => h(Probe) }),
    );
    const html = await renderToString(app);
    expect(html).toBe('<div id="price" class="chart" style="height:300px;"><span>legend</span></div>');
    expect(seen).toBeNull();
    // Creating a chart would have needed `document`, which a server does not have.
    expect(typeof document).toBe('undefined');
  });

  it('renders <ChartShell> as its container without creating a shell', async () => {
    let seen: unknown = 'unset';
    const Probe = defineComponent(() => {
      const shell = useChartShell();
      return () => ((seen = shell.value), null);
    });
    const html = await renderToString(createSSRApp(() => h(ChartShell, { class: 'shell', theme: 'light' }, { default: () => h(Probe) })));
    expect(html).toBe('<div class="shell"><!----></div>');
    expect(seen).toBeNull();
  });
});
