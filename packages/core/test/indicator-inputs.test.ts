import { afterEach, describe, expect, it } from 'vitest';
import { fakeContainer } from './fake-dom';
import { Chart } from '../src/chart';
import { validateIndicatorDef } from '../src/indicators/indicator';
import { inputFields } from '../src/indicators/inputs';
import { restoreInputs } from '../src/indicators/manager';
import { resolveInputs } from '../src/indicators/runner';
import type { IndicatorDef, InputDef } from '../src/indicators/types';
import type { Bar } from '../src/types';

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
});

function chart(): Chart {
  const c = new Chart(fakeContainer());
  charts.push(c);
  const bars: Bar[] = Array.from({ length: 30 }, (_, i) => ({ time: i * 60, open: i, high: i + 1, low: i - 1, close: i }));
  c.addCandles().setData(bars);
  return c;
}

type MaInputs = { kind: string; length: number; fast: number; slow: number; showLabel: boolean; label: string };

/** A moving average with a select, a text input, groups and conditions. */
const inputs: InputDef[] = [
  {
    id: 'kind',
    type: 'select',
    default: 'sma',
    options: [
      { value: 'sma', label: 'Simple' },
      { value: 'ema', label: 'Exponential' },
    ],
  },
  { id: 'length', type: 'number', default: 20, min: 1 },
  {
    id: 'fast',
    type: 'number',
    group: 'Crossover',
    default: 12,
    min: 1,
    validate: (value, all) => ((value as number) < (all.slow as number) ? null : 'Must be below Slow'),
  },
  { id: 'slow', type: 'number', group: 'Crossover', default: 26, min: 1 },
  { id: 'showLabel', type: 'boolean', group: 'Label', default: false },
  {
    id: 'label',
    type: 'text',
    group: 'Label',
    default: 'MA',
    maxLength: 8,
    visible: (all) => all.showLabel === true,
    disabled: (all) => all.kind === 'ema',
    validate: (value) => ((value as string).trim() === '' ? 'Enter a label' : null),
  },
];

const def: IndicatorDef<MaInputs> = {
  id: 'test/ma',
  name: 'MA',
  placement: 'overlay',
  inputs,
  plots: [{ id: 'ma', type: 'line' }],
  compute: (src) => ({ ma: src.close.slice() }),
};

describe('select and text inputs', () => {
  it('accept an option value or text within maxLength, and reject the rest', () => {
    expect(resolveInputs(inputs, { kind: 'ema', label: 'Fast MA' })).toMatchObject({ kind: 'ema', label: 'Fast MA' });
    expect(() => resolveInputs(inputs, { kind: 'wma' })).toThrow(/"kind"/);
    expect(() => resolveInputs(inputs, { label: 'Too long label' })).toThrow(/"label"/);
    expect(() => resolveInputs(inputs, { label: 3 })).toThrow(/"label"/);
  });

  it('compare option values strictly, so numbers and strings stay apart', () => {
    const numeric: InputDef[] = [{ id: 'n', type: 'select', default: 1, options: [{ value: 1 }, { value: 2 }] }];
    expect(resolveInputs(numeric, { n: 2 })).toEqual({ n: 2 });
    expect(() => resolveInputs(numeric, { n: '2' })).toThrow(/"n"/);
  });

  it('are checked when a definition registers', () => {
    const base = { ...def, id: 'x' } as unknown as IndicatorDef;
    const withInputs = (list: unknown[]) => ({ ...base, inputs: list }) as IndicatorDef;
    expect(() => validateIndicatorDef(withInputs([{ id: 's', type: 'select', default: 'a', options: [] }]))).toThrow(/at least one option/);
    expect(() =>
      validateIndicatorDef(withInputs([{ id: 's', type: 'select', default: 'a', options: [{ value: 'a' }, { value: 'a' }] }])),
    ).toThrow(/option value twice/);
    expect(() => validateIndicatorDef(withInputs([{ id: 's', type: 'select', default: 'b', options: [{ value: 'a' }] }]))).toThrow(
      /default b is invalid/,
    );
    expect(() => validateIndicatorDef(withInputs([{ id: 't', type: 'text', default: '', maxLength: -1 }]))).toThrow(/maxLength/);
    expect(() =>
      validateIndicatorDef(
        withInputs([
          { id: 'a', type: 'boolean', default: true },
          { id: 'a', type: 'boolean', default: false },
        ]),
      ),
    ).toThrow(/input "a" twice/);
    expect(() =>
      validateIndicatorDef({ ...base, plots: [{ id: 'h', type: 'histogram', positiveColorInput: 'kind' }] } as IndicatorDef),
    ).toThrow(/color input "kind"/);
  });
});

describe('validate', () => {
  it('throws from add and applyInputs with its message, leaving the inputs unchanged', () => {
    const c = chart();
    expect(() => c.indicators.add(def, { fast: 30 })).toThrow(/"fast": Must be below Slow/);
    const ma = c.indicators.add(def);
    expect(() => ma.applyInputs({ slow: 10 })).toThrow(/Must be below Slow/);
    expect(ma.inputs.slow).toBe(26);
    ma.applyInputs({ fast: 5, slow: 10 });
    expect(ma.inputs).toMatchObject({ fast: 5, slow: 10 });
  });

  it('skips hidden inputs', () => {
    expect(resolveInputs(inputs, { label: ' ' })).toMatchObject({ label: ' ' });
    expect(() => resolveInputs(inputs, { label: ' ', showLabel: true })).toThrow(/Enter a label/);
  });

  it('resets restored values that fail it to their default and reports them, without throwing', () => {
    const state = { type: def.id, inputs: { kind: 'wma', fast: 40, label: '', showLabel: true }, pane: 0, visible: true };
    const { inputs: restored, problems } = restoreInputs(def as unknown as IndicatorDef, state);
    expect(restored).toMatchObject({ kind: 'sma', fast: 12, label: 'MA', showLabel: true });
    expect(problems).toEqual([
      'invalid value for input "kind" (wma), default used',
      'invalid value for input "fast" (40): Must be below Slow, default used',
      'invalid value for input "label" (): Enter a label, default used',
    ]);

    const c = chart();
    const errors: unknown[] = [];
    c.on('indicator:error', ({ error }) => errors.push(error));
    c.indicators.register(def);
    c.indicators.load([state]);
    expect(c.indicators.getAll()[0]!.inputs).toMatchObject({ kind: 'sma', fast: 12, label: 'MA' });
    expect(errors).toHaveLength(1);
  });
});

describe('inputFields', () => {
  it('groups inputs, ungrouped first, then groups in the order of their first input', () => {
    const groups = inputFields(inputs);
    expect(groups.map((g) => [g.name, g.fields.map((f) => f.input.id)])).toEqual([
      [null, ['kind', 'length']],
      ['Crossover', ['fast', 'slow']],
      ['Label', ['showLabel', 'label']],
    ]);
  });

  it('evaluates visibility, disabled state and errors for the given values', () => {
    const field = (values: Record<string, string | number | boolean>, id: string) =>
      inputFields(inputs, values)
        .flatMap((g) => g.fields)
        .find((f) => f.input.id === id)!;
    expect(field({}, 'label')).toMatchObject({ value: 'MA', visible: false, disabled: false, error: null });
    expect(field({ showLabel: true, kind: 'ema' }, 'label')).toMatchObject({ visible: true, disabled: true });
    expect(field({ showLabel: true, label: '' }, 'label').error).toBe('Enter a label');
    expect(field({ fast: 30 }, 'fast').error).toBe('Must be below Slow');
    expect(field({ length: 0 }, 'length').error).toBe('Must be at least 1');
    expect(field({ kind: 'wma' }, 'kind').error).toBe('Must be one of the options');
  });

  it('treats throwing callbacks as shown, enabled and invalid with the thrown message', () => {
    const boom = () => {
      throw new Error('boom');
    };
    const [group] = inputFields([{ id: 'x', type: 'boolean', default: true, visible: boom, disabled: boom, validate: boom }]);
    expect(group!.fields[0]).toMatchObject({ visible: true, disabled: false, error: 'boom' });
  });
});
