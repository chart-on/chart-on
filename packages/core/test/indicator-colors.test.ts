import { describe, expect, it } from 'vitest';
import { IndicatorRunner, resolveInputs } from '../src/indicators/runner';
import { IndicatorSeries } from '../src/indicators/series';
import type { IndicatorDef } from '../src/indicators/types';
import { Pane } from '../src/pane';
import { opaque, type SeriesHost } from '../src/series';
import { darkTheme } from '../src/theme';
import { Timeline } from '../src/timeline';

const host: SeriesHost = {
  timeline: new Timeline(),
  theme: darkTheme,
  maxTextureSize: 4096,
  mainDataChanged: () => {},
  mainLastBarChanged: () => {},
  requestRender: () => {},
};

const def: IndicatorDef = {
  id: 'colors',
  name: 'Colors',
  placement: 'pane',
  inputs: [
    { id: 'color', type: 'color', default: '' },
    { id: 'up', type: 'color', role: 'up', default: '' },
    { id: 'down', type: 'color', role: 'down', default: '' },
  ],
  plots: [
    { id: 'line', type: 'line', colorInput: 'color' },
    { id: 'columns', type: 'histogram' },
    { id: 'tinted', type: 'histogram', color: '#123456' },
    { id: 'picked', type: 'histogram', positiveColorInput: 'up', negativeColorInput: 'down' },
  ],
  compute: () => ({
    line: Float64Array.of(1, 1),
    columns: Float64Array.of(2, -2),
    tinted: Float64Array.of(2, -2),
    picked: Float64Array.of(2, -2),
  }),
};

function legendColors(inputs: Record<string, string>, index: number): string[] {
  const runner = new IndicatorRunner(def, resolveInputs(def.inputs, inputs), { change: () => {}, error: () => {} });
  runner.setBars([
    { time: 0, open: 1, high: 1, low: 1, close: 1 },
    { time: 60, open: 1, high: 1, low: 1, close: 1 },
  ]);
  const series = new IndicatorSeries(host, new Pane(0, { stretch: 1, marginTop: 0, marginBottom: 0 }), { title: '', format: String }, runner);
  return series.legend(index).parts.map((p) => p.color!);
}

describe('indicator plot colours', () => {
  it('an empty colour input falls back to the theme line colour', () => {
    expect(legendColors({}, 0)[0]).toBe(opaque(darkTheme.line));
    expect(legendColors({ color: '#ff0000' }, 0)[0]).toBe(opaque('#ff0000'));
  });

  it('a histogram without colours uses the theme up and down colours', () => {
    expect(legendColors({}, 0)[1]).toBe(opaque(darkTheme.up));
    expect(legendColors({}, 1)[1]).toBe(opaque(darkTheme.down));
  });

  it('a histogram with its own colour keeps it', () => {
    expect(legendColors({}, 0)[2]).toBe(opaque('#123456'));
    expect(legendColors({}, 1)[2]).toBe(opaque('#123456'));
  });

  it('a histogram takes its up and down colours from linked colour inputs, the theme when empty', () => {
    expect(legendColors({}, 0)[3]).toBe(opaque(darkTheme.up));
    expect(legendColors({}, 1)[3]).toBe(opaque(darkTheme.down));
    expect(legendColors({ up: '#00ff00' }, 0)[3]).toBe(opaque('#00ff00'));
    expect(legendColors({ up: '#00ff00' }, 1)[3]).toBe(opaque(darkTheme.down));
    expect(legendColors({ down: '#ff00ff' }, 1)[3]).toBe(opaque('#ff00ff'));
  });
});
