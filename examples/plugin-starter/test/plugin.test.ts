// Tests the way a plugin package would: only the public API and the test kit.
import { afterEach, describe, expect, it } from 'vitest';
import { createChart, drawings, indicators, type Chart } from '@chart-on/core';
import { flushFrames, installTestEnvironment, sampleBars } from '@chart-on/core/testing';
import { midpoint, priceTag, starterPlugin } from '../src/index';

const env = installTestEnvironment();
let chart: Chart | null = null;
afterEach(() => {
  chart?.destroy();
  chart = null;
});

function setup(): Chart {
  // The tool and the indicator need drawings and indicators on the chart; an app adds them the same way, or with `builtins()`.
  chart = createChart(env.container(), { plugins: [indicators(), drawings()] });
  chart.addCandles({ animate: false }).setData(sampleBars({ count: 50 }));
  return chart;
}

describe('starter plugin', () => {
  it('installs its tool and indicator, and uninstalls them again', () => {
    const c = setup();
    c.install(starterPlugin);
    expect(c.drawings.getTools().map((t) => t.type)).toContain(priceTag.type);
    const indicator = c.indicators.add(midpoint.id);
    flushFrames();
    const bars = c.main!.data;
    expect(c.valuesAt(bars[10]!.time)!.series.find((s) => s.series === indicator.series)?.legend?.parts[0]?.text).toBe(
      indicator.series!.formatValue((bars[10]!.high + bars[10]!.low) / 2),
    );
    c.drawings.add({ type: priceTag.type, pane: 0, points: [{ time: bars[5]!.time, price: bars[5]!.close }], style: {} });
    expect(c.uninstall(starterPlugin.name)).toBe(true);
    expect(c.drawings.getTools().map((t) => t.type)).not.toContain(priceTag.type);
    expect(c.indicators.getDefinitions().map((d) => d.id)).not.toContain(midpoint.id);
  });

  it('works with the core version it requires', () => {
    expect(() => setup().install(starterPlugin)).not.toThrow();
  });
});
