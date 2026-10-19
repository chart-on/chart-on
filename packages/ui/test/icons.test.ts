import { describe, expect, it } from 'vitest';
import { builtinTools, type CandleStyle } from '@chart-on/core';
import { chartTypeIcons, drawingIcons, groupIcons } from '../src/icons';
import { toolIcons } from '../src/rail';

describe('drawing icons', () => {
  it('has an icon for every built-in tool', () => {
    const missing = builtinTools.filter((t) => !toolIcons[t.type]).map((t) => t.type);
    expect(missing).toEqual([]);
  });

  it('has a fallback icon for every built-in tool group', () => {
    const groups = [...new Set(builtinTools.flatMap((t) => (t.group ? [t.group] : [])))];
    expect(groups.filter((g) => !groupIcons[g])).toEqual([]);
  });

  it('draws every icon from at least one element', () => {
    for (const [type, node] of Object.entries(drawingIcons)) expect(node.length, type).toBeGreaterThan(0);
  });
});

// Typed as a full record, so adding a CandleStyle without listing it here fails typecheck.
const candleStyles: Record<CandleStyle, true> = {
  candles: true,
  hollow: true,
  volumeCandles: true,
  bars: true,
  hlcBars: true,
  heikinAshi: true,
  highLow: true,
  columns: true,
  line: true,
  lineMarkers: true,
  step: true,
  area: true,
  rangeBand: true,
  baseline: true,
  kagi: true,
  pointFigure: true,
};

describe('chart type icons', () => {
  it('has an icon for every candle style and the demo variants', () => {
    const missing = [...Object.keys(candleStyles), 'outlined', 'bodies'].filter((style) => !chartTypeIcons[style]?.length);
    expect(missing).toEqual([]);
  });
});
