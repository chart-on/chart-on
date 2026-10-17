import { createNumericChart, crispLine, darkTheme, depthCurve, lightTheme, type BookLevel, type NumericChart, type NumericPrimitive } from '@charton/core';
import { expose } from './expose';

// Charts with a numeric horizontal axis: an order-book depth curve, a yield
// curve and open interest by option strike, all with synthetic data.
const light = matchMedia('(prefers-color-scheme: light)');
const theme = () => (light.matches ? lightTheme : darkTheme);

/** Deterministic pseudo-random numbers, so the page looks the same on every load. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const charts: NumericChart[] = [];

/** A primitive: a dashed vertical line at `x` with a label, in the theme's muted text colour. */
function marker(x: number, title: string): NumericPrimitive {
  return {
    layer: 'below',
    drawPlot(ctx, env) {
      const px = env.xToPixel(x);
      ctx.strokeStyle = env.theme.textMuted;
      ctx.setLineDash([3, 3]);
      crispLine(ctx, px, 0, px, env.height, 1, env.pixelRatio);
      ctx.setLineDash([]);
      ctx.fillStyle = env.theme.textMuted;
      ctx.font = `11px ${env.theme.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.fillText(`${title} ${env.formatX(x)}`, px, 14);
    },
  };
}

// Depth: 60 levels either side of a 100.00 mid, sizes growing away from it.
{
  const rand = random(7);
  const bids: BookLevel[] = [];
  const asks: BookLevel[] = [];
  for (let i = 0; i < 60; i++) {
    const size = (0.5 + rand() * 2) * (1 + i / 12);
    bids.push({ price: +(99.95 - i * 0.05).toFixed(2), size: +size.toFixed(2) });
    asks.push({ price: +(100.05 + i * 0.05).toFixed(2), size: +((0.5 + rand() * 2) * (1 + i / 12)).toFixed(2) });
  }
  const chart = createNumericChart(document.getElementById('depth')!, {
    theme: theme(),
    horizontalScale: { format: { type: 'decimal', tickSize: 0.01 } },
    priceScale: { marginBottom: 0 },
  });
  const curve = depthCurve(bids, asks);
  chart.addLine({ title: 'Bids', color: theme().bid, lineType: 'step', area: true }).setData(curve.bids);
  chart.addLine({ title: 'Asks', color: theme().ask, lineType: 'step', area: true }).setData(curve.asks);
  chart.attachPrimitive(marker(100, 'Mid'));
  charts.push(chart);
}

// Yield curve: maturities in years; the gaps between them keep their true width.
{
  const maturities = [1 / 12, 0.25, 0.5, 1, 2, 3, 5, 7, 10, 20, 30];
  const yields = [5.38, 5.41, 5.33, 5.02, 4.63, 4.42, 4.26, 4.28, 4.31, 4.58, 4.49];
  const previous = [5.35, 5.39, 5.36, 5.15, 4.86, 4.65, 4.44, 4.41, 4.39, 4.62, 4.51];
  const chart = createNumericChart(document.getElementById('yield')!, {
    theme: theme(),
    priceScale: { format: { type: 'percent', precision: 2 } },
  });
  chart.addLine({ title: 'A month ago', color: theme().textMuted, lineStyle: 'dashed', lineWidth: 1.5 }).setData(
    maturities.map((x, i) => ({ x, value: previous[i]! })),
  );
  chart.addLine({ title: 'Today', lineWidth: 2.5 }).setData(maturities.map((x, i) => ({ x, value: yields[i]! })));
  chart.addPriceLine({ price: 5.33, title: 'Policy rate' });
  charts.push(chart);
}

// Open interest by strike, calls up and puts down, around a 4,500 underlying.
{
  const rand = random(11);
  const calls = [];
  const puts = [];
  for (let strike = 4000; strike <= 5000; strike += 25) {
    const near = Math.exp(-(((strike - 4500) / 260) ** 2));
    calls.push({ x: strike, value: Math.round((near * 9000 + rand() * 1500) * (strike >= 4500 ? 1.2 : 0.7)) });
    puts.push({ x: strike, value: -Math.round((near * 9000 + rand() * 1500) * (strike <= 4500 ? 1.2 : 0.7)) });
  }
  const chart = createNumericChart(document.getElementById('strikes')!, {
    theme: theme(),
    priceScale: { format: { type: 'volume' } },
  });
  chart.addHistogram({ title: 'Calls', color: theme().up, columnWidth: 18 }).setData(calls);
  chart.addHistogram({ title: 'Puts', color: theme().down, columnWidth: 18 }).setData(puts);
  chart.addPriceLine({ price: 0, lineStyle: 'solid', axisLabel: false });
  charts.push(chart);
}

light.addEventListener('change', () => {
  for (const chart of charts) {
    chart.applyOptions({ theme: theme() });
    // Colours picked from the theme above follow it too.
    for (const series of chart.getSeries()) {
      if (series.options.title === 'Bids') series.applyOptions({ color: theme().bid });
      if (series.options.title === 'Asks') series.applyOptions({ color: theme().ask });
      if (series.options.title === 'Calls') series.applyOptions({ color: theme().up });
      if (series.options.title === 'Puts') series.applyOptions({ color: theme().down });
      if (series.options.title === 'A month ago') series.applyOptions({ color: theme().textMuted });
    }
  }
});

expose({ numericCharts: charts });
