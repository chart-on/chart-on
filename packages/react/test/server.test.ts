import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Chart, useChart } from '@chart-on/react';
import { ChartShell, useChartShell } from '@chart-on/react/shell';

/** Server rendering: no DOM, no WebGL, and no chart, only the container element. */

describe('server rendering', () => {
  it('renders <Chart> as its container without creating a chart', () => {
    let seen: unknown = 'unset';
    function Probe() {
      seen = useChart();
      return createElement('span', null, 'legend');
    }
    const html = renderToString(
      createElement(Chart, { id: 'price', className: 'chart', style: { height: 300 }, options: { barSpacing: 8 } }, createElement(Probe)),
    );
    expect(html).toBe('<div id="price" class="chart" style="height:300px"><span>legend</span></div>');
    expect(seen).toBeNull();
    // Creating a chart would have needed `document`, which a server does not have.
    expect(typeof document).toBe('undefined');
  });

  it('renders <ChartShell> as its container without creating a shell', () => {
    let seen: unknown = 'unset';
    function Probe() {
      seen = useChartShell();
      return null;
    }
    const html = renderToString(createElement(ChartShell, { className: 'shell', theme: 'light' }, createElement(Probe)));
    expect(html).toBe('<div class="shell"></div>');
    expect(seen).toBeNull();
  });
});
