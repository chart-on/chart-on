import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart, type ChartOptionsPatch } from '../src/chart';
import { ERRORS_DOCS_URL } from '../src/util/dev';
import { isColor } from '../src/util/color';
import { devCheck } from '../src/options-schema';
import { either, int, list, num, oneOf, optionIssues, resetOptionWarnings, shape } from '../src/util/options-check';

const charts: Chart[] = [];
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetOptionWarnings();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function chart(options: ChartOptionsPatch = {}) {
  const c = new Chart(fakeContainer(), options);
  charts.push(c);
  return c;
}

const messages = () => warn.mock.calls.map((call: unknown[]) => String(call[0]));

describe('optionIssues', () => {
  const rule = shape<{ size: number; mode: 'a' | 'b'; color: string; inner: { flag: boolean }; items: number[]; legend: boolean | { visible: boolean } }>({
    size: num(0, 10),
    mode: oneOf<'a' | 'b'>({ a: 0, b: 0 }),
    color: 'color',
    inner: shape<{ flag: boolean }>({ flag: 'boolean' }),
    items: list(int(0)),
    legend: either('boolean', shape<{ visible: boolean }>({ visible: 'boolean' })),
  });

  it('accepts valid values and leaves undefined and null alone', () => {
    expect(optionIssues({ size: 3, mode: 'b', color: '#ff0000', inner: { flag: true }, items: [1, 2], legend: { visible: false } }, rule)).toEqual([]);
    expect(optionIssues({ size: undefined, mode: null, legend: true }, rule)).toEqual([]);
  });

  it('reports unknown keys with the closest known key, at any depth', () => {
    expect(optionIssues({ sise: 1, inner: { flg: true }, legend: { visibel: true }, zzzzzz: 1 }, rule)).toEqual([
      { code: 'option-unknown', path: 'sise', message: 'unknown option "sise" is ignored; did you mean "size"?' },
      { code: 'option-unknown', path: 'inner.flg', message: 'unknown option "inner.flg" is ignored; did you mean "flag"?' },
      { code: 'option-unknown', path: 'legend.visibel', message: 'unknown option "legend.visibel" is ignored; did you mean "visible"?' },
      { code: 'option-unknown', path: 'zzzzzz', message: 'unknown option "zzzzzz" is ignored' },
    ]);
  });

  it('reports wrong types, ranges, enum values and colours', () => {
    const issues = optionIssues({ size: '3', mode: 'c', color: '#zzz', inner: true, items: [1, -1], legend: 'yes' }, rule);
    expect(issues.map((i) => [i.code, i.path])).toEqual([
      ['option-type', 'size'],
      ['option-range', 'mode'],
      ['option-color', 'color'],
      ['option-type', 'inner'],
      ['option-range', 'items[1]'],
      ['option-type', 'legend'],
    ]);
    expect(issues[0]!.message).toBe('"size" should be a number from 0 to 10, got string "3"');
    expect(issues[1]!.message).toBe('"mode" should be one of "a", "b", got "c"');
    expect(issues[5]!.message).toBe('"legend" should be a boolean or an object, got string "yes"');
    expect(optionIssues({ size: 11 }, rule)[0]!.message).toBe('"size" should be a number from 0 to 10, got 11');
  });

  it('describes odd values without throwing', () => {
    const bare = Object.create(null) as object;
    expect(optionIssues({ mode: bare }, rule)[0]!.message).toBe('"mode" should be one of "a", "b", got an object');
    expect(optionIssues({ mode: () => 1 }, rule)[0]!.message).toBe('"mode" should be one of "a", "b", got a function');
  });

  it('rejects colours a canvas cannot draw', () => {
    for (const c of ['var(--up)', 'inherit', ' initial ', 'currentColor']) expect(isColor(c), c).toBe(false);
    expect(isColor('#0f0')).toBe(true);
  });

  it('reports only near misses on open objects, and never prototype keys', () => {
    const open = shape<{ color: string }>({ color: 'color' }, true);
    expect(optionIssues({ colour: 'red', pluginOwnField: 1 }, open).map((i) => i.path)).toEqual(['colour']);
    expect(optionIssues({ toString: 1 }, shape<{ size: number }>({ size: 'number' }))).toHaveLength(1);
  });
});

describe('chart options in development builds', () => {
  it('warn once about a misspelt key with a suggestion, the code and the docs link', () => {
    const c = chart();
    c.applyOptions({ crossHair: {} } as ChartOptionsPatch);
    c.applyOptions({ crossHair: {} } as ChartOptionsPatch);
    expect(messages()).toEqual([
      `charton [option-unknown]: applyOptions: unknown option "crossHair" is ignored; did you mean "crosshair"? (${ERRORS_DOCS_URL}#option-unknown)`,
    ]);
  });

  it('check nested chart options, features and the theme', () => {
    chart({
      barSpacing: 'wide',
      crosshair: { vertical: { widht: 2 } },
      features: { legned: false },
      theme: { up: '#12' },
      legend: { mode: 'tiny' },
    } as unknown as ChartOptionsPatch);
    const text = messages().join('\n');
    expect(text).toContain('[option-type]: createChart: "barSpacing" should be a number');
    expect(text).toContain('"crosshair.vertical.widht" is ignored; did you mean "width"?');
    expect(text).toContain('"features.legned" is ignored; did you mean "legend"?');
    expect(text).toContain('[option-color]: createChart: "theme.up"');
    expect(text).toContain('"legend.mode" should be one of "full", "compact", "title"');
  });

  it('check series options when added and when changed', () => {
    const c = chart();
    const candles = c.addCandles({ bodyColour: '#fff', bodyRatio: 2 } as never);
    candles.applyOptions({ upColr: '#0f0' } as never);
    c.addLine({ lineWidht: 2 } as never);
    c.addHistogram({ columnRatio: -1 });
    c.addPane({ strech: 1 } as never);
    const text = messages().join('\n');
    expect(text).toContain('addCandles: unknown option "bodyColour" is ignored');
    expect(text).toContain('addCandles: "bodyRatio" should be a number from 0 to 1, got 2');
    expect(text).toContain('series.applyOptions: unknown option "upColr" is ignored; did you mean "upColor"?');
    expect(text).toContain('addLine: unknown option "lineWidht" is ignored; did you mean "lineWidth"?');
    expect(text).toContain('addHistogram: "columnRatio"');
    expect(text).toContain('addPane: unknown option "strech" is ignored; did you mean "stretch"?');
  });

  it('check drawing styles but keep plugin fields quiet', () => {
    const c = chart();
    c.drawings.add({ type: 'trendline', pane: 0, points: [], style: { colr: '#fff', myPluginField: 1 } as never });
    expect(messages().join('\n')).toContain('drawings.add: unknown option "colr" is ignored; did you mean "color"?');
    expect(messages()).toHaveLength(1);
  });

  it('check the render statistics overlay', () => {
    chart({ renderStatsOverlay: 'outlines' } as unknown as ChartOptionsPatch);
    expect(messages().join('\n')).toContain('"renderStatsOverlay"');
    warn.mockClear();
    chart({ renderStatsOverlay: 'bounds' });
    chart({ renderStatsOverlay: true });
    expect(warn).not.toHaveBeenCalled();
  });

  it('stay silent with valid options', () => {
    const c = chart({ barSpacing: 10, crosshair: { mode: 'close' }, theme: { up: '#00ff00' }, legend: { position: 'top-right' } });
    c.addCandles({ style: 'hollow', upColor: '#0f0' });
    c.addLine({ lineType: 'curved', pointMarkers: { radius: 3 } });
    expect(warn).not.toHaveBeenCalled();
  });

  it('accept every spacing and fraction the engine accepts', () => {
    chart({ minBarSpacing: 0.001, barSpacing: 0.002, minBarCoverage: 0.5, theme: { fontSize: 0.5 } });
    expect(warn).not.toHaveBeenCalled();
  });

  it('stay off, without throwing, when `process` has no `env`', () => {
    const proc = (globalThis as unknown as { process: object }).process;
    const env = Object.getOwnPropertyDescriptor(proc, 'env')!;
    Object.defineProperty(proc, 'env', { value: undefined, configurable: true });
    try {
      expect(() => devCheck('applyOptions', { crossHair: {} }, 'chart')).not.toThrow();
    } finally {
      Object.defineProperty(proc, 'env', env);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('stay silent in production builds', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const c = chart({ crossHair: {} } as ChartOptionsPatch);
    c.applyOptions({ barSpacing: 'x' } as unknown as ChartOptionsPatch);
    c.addCandles({ bodyColour: '#fff' } as never);
    expect(warn).not.toHaveBeenCalled();
  });
});
