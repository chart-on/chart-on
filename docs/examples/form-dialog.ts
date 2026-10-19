import type { Bar, LineStyle } from '@chart-on/core';
import {
  createChartShell,
  createFormDialog,
  registerInput,
  type FormInputBase,
  type FormDialog,
  type FormSchema,
  type FormValues,
  type InputRenderer,
} from '@chart-on/ui';
import '@chart-on/ui/style.css';
import type { ExampleContext } from './types';
import { sampleBars } from './sample-data';

// A custom input kind: a minus / value / plus stepper for small whole numbers.
interface StepperInputDef extends FormInputBase<number> {
  kind: 'stepper';
  min?: number;
  max?: number;
}

// Tell the schema types about the new kind.
declare module '@chart-on/ui' {
  interface FormInputKinds {
    stepper: StepperInputDef;
  }
}

const stepper: InputRenderer<StepperInputDef, number> = (input, ctx) => {
  let value = ctx.value;
  const min = input.min ?? 1;
  const max = input.max ?? 10;
  const el = document.createElement('div');
  el.className = 'stepper';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-labelledby', ctx.labelId);
  const minus = document.createElement('button');
  const plus = document.createElement('button');
  const shown = document.createElement('output');
  minus.type = plus.type = 'button';
  minus.textContent = '−';
  plus.textContent = '+';
  minus.setAttribute('aria-label', `Decrease ${input.label}`);
  plus.setAttribute('aria-label', `Increase ${input.label}`);
  minus.setAttribute('id', ctx.controlId);
  const show = (next: number) => {
    value = next;
    shown.textContent = String(next);
    minus.disabled = next <= min;
    plus.disabled = next >= max;
  };
  const step = (by: number) => {
    show(Math.min(max, Math.max(min, value + by)));
    ctx.set(value);
  };
  minus.addEventListener('click', () => step(-1));
  plus.addEventListener('click', () => step(1));
  el.append(minus, shown, plus);
  show(value);
  return {
    el,
    focusTarget: minus,
    setValue: show,
    setDisabled: (disabled) => {
      minus.disabled = plus.disabled = disabled;
    },
  };
};

const schema: FormSchema = {
  id: 'moving-average',
  title: 'Moving average',
  sections: [
    {
      id: 'inputs',
      title: 'Inputs',
      groups: [
        {
          id: 'calc',
          inputs: [
            {
              kind: 'number',
              id: 'length',
              label: 'Length',
              default: 20,
              min: 2,
              max: 200,
              integer: true,
            },
            { kind: 'source', id: 'source', label: 'Source', default: 'close' },
          ],
        },
      ],
    },
    {
      id: 'style',
      title: 'Style',
      groups: [
        {
          id: 'line',
          label: 'Line',
          inputs: [
            { kind: 'color', id: 'color', label: 'Color', default: '#f59e0b' },
            {
              kind: 'stepper',
              id: 'width',
              label: 'Width',
              default: 2,
              min: 1,
              max: 6,
            },
            {
              kind: 'select',
              id: 'lineStyle',
              label: 'Style',
              default: 'solid',
              options: [
                { value: 'solid', label: 'Solid' },
                { value: 'dashed', label: 'Dashed' },
                { value: 'dotted', label: 'Dotted' },
              ],
            },
          ],
        },
      ],
    },
  ],
};

export default function mount(el: HTMLElement, { dark }: ExampleContext) {
  const unregister = registerInput('stepper', stepper);
  let dialog: FormDialog | null = null;
  const shell = createChartShell(el, {
    theme: dark ? 'dark' : 'light',
    rail: false,
    toolbar: [
      {
        type: 'button',
        id: 'settings',
        label: 'Moving average settings',
        text: 'Settings',
        // Every change previews live; Cancel or Escape puts the opening values back.
        onClick: () =>
          (dialog = createFormDialog(shell.el, schema, {
            values: settings,
            onChange: apply,
            onAction: keep,
          })),
      },
    ],
  });
  const bars = sampleBars();
  shell.chart.addCandles({ title: 'SAMPLE' }).setData(bars);
  const line = shell.chart.addLine({ title: 'MA' });
  let settings: FormValues = {};
  const apply = (values: FormValues) => {
    line.applyOptions({
      color: values.color as string,
      lineWidth: values.width as number,
      lineStyle: values.lineStyle as LineStyle,
    });
    line.setData(movingAverage(bars, values.length as number, values.source as keyof Bar));
  };
  const keep = (action: string, values: FormValues) => {
    if (action === 'ok') settings = values;
  };
  settings = {
    length: 20,
    source: 'close',
    color: '#f59e0b',
    width: 2,
    lineStyle: 'solid',
  };
  apply(settings);
  shell.chart.fitContent();

  return () => {
    dialog?.close();
    unregister();
    shell.destroy();
  };
}

/** Simple moving average of one bar field over `length` bars; averages such as `hl2` are computed. */
function movingAverage(bars: Bar[], length: number, source: string) {
  const pick = (b: Bar) =>
    source === 'hl2'
      ? (b.high + b.low) / 2
      : source === 'hlc3'
        ? (b.high + b.low + b.close) / 3
        : source === 'ohlc4'
          ? (b.open + b.high + b.low + b.close) / 4
          : (b[source as 'open' | 'high' | 'low' | 'close'] ?? b.close);
  const out = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += pick(bars[i]!);
    if (i >= length) sum -= pick(bars[i - length]!);
    if (i >= length - 1) out.push({ time: bars[i]!.time, value: sum / length });
  }
  return out;
}
