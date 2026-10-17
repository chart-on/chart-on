/**
 * Controls for the form dialog's input kinds, and `registerInput` for adding
 * kinds or replacing the built-in ones.
 */
import type { Localizer } from '@charton/core';
import { createColorControl } from './color-control';
import { h } from './dom';
import { createListbox } from './listbox';
import { builtinText } from './messages';
import {
  defaultSources,
  type BooleanInputDef,
  type ColorInputDef,
  type FormInputDef,
  type FormOption,
  type FormValues,
  type MultiSelectInputDef,
  type NumberInputDef,
  type RangeInputDef,
  type SelectInputDef,
  type SliderInputDef,
  type SourceInputDef,
  type TextInputDef,
} from './form-model';

/** What the form hands a renderer. */
export interface InputContext<V = unknown> {
  /** Put this id on the focusable control; the field's label points at it. */
  readonly controlId: string;
  /** Id of the field's label, for controls labelled with `aria-labelledby` (groups). */
  readonly labelId: string;
  /** Value when the control is created. */
  readonly value: V;
  /** Current values of the whole form. */
  readonly values: Readonly<FormValues>;
  /** Report a value the user entered; the form validates it and updates the preview. */
  set(value: V): void;
  /** The language of the dialog (its `localization` option), for the control's own text. */
  readonly localization?: Localizer;
}

/** A rendered input. */
export interface InputControl<V = unknown> {
  el: HTMLElement;
  /** Element that takes focus and carries `aria-invalid`; default `el`. */
  focusTarget?: HTMLElement;
  /** Show a value set from outside (reset, cancel, `setValues`) without reporting it. */
  setValue(value: V): void;
  setDisabled(disabled: boolean): void;
  destroy?(): void;
}

/** Renders one input kind. `I` is that kind's input type (see `FormInputKinds`), `V` its value. */
export type InputRenderer<I = FormInputDef, V = unknown> = (
  input: I,
  context: InputContext<V>,
) => InputControl<V>;

type AnyRenderer = InputRenderer<FormInputDef, unknown>;

const registered = new Map<string, AnyRenderer>();

/**
 * Render inputs of `kind` with `renderer` in every form dialog. Replaces a
 * built-in kind of the same name. Returns a function that removes it again.
 */
export function registerInput<I = FormInputDef, V = unknown>(
  kind: string,
  renderer: InputRenderer<I, V>,
): () => void {
  const entry = renderer as unknown as AnyRenderer;
  const previous = registered.get(kind);
  registered.set(kind, entry);
  return () => {
    if (registered.get(kind) !== entry) return;
    if (previous) registered.set(kind, previous);
    else registered.delete(kind);
  };
}

/** The renderer for `kind`: a dialog's own, then a registered one, then a built-in. */
export function inputRenderer(kind: string, local?: Record<string, InputRenderer<never, never>>): AnyRenderer | undefined {
  const own = local && Object.hasOwn(local, kind) ? (local[kind] as unknown as AnyRenderer) : undefined;
  return own ?? registered.get(kind) ?? (builtins as Record<string, AnyRenderer | undefined>)[kind];
}

function disable(...els: HTMLElement[]) {
  return (disabled: boolean) => {
    for (const el of els) (el as HTMLInputElement).disabled = disabled;
  };
}

const numberText = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? String(value) : '');
const parseNumber = (text: string) => (text.trim() === '' ? Number.NaN : Number(text));

function numberField(id: string, input: { min?: number; max?: number; step?: number }, label?: string): HTMLInputElement {
  const attrs: Record<string, string> = {
    type: 'number',
    class: 'pc-input pc-input--number',
    inputmode: 'decimal',
    id,
  };
  if (input.min !== undefined) attrs.min = String(input.min);
  if (input.max !== undefined) attrs.max = String(input.max);
  attrs.step = input.step !== undefined ? String(input.step) : 'any';
  if (label) attrs['aria-label'] = label;
  return h('input', attrs);
}

const numberInput: InputRenderer<NumberInputDef, number> = (input, ctx) => {
  const el = numberField(ctx.controlId, input);
  el.value = numberText(ctx.value);
  el.addEventListener('input', () => ctx.set(parseNumber(el.value)));
  return {
    el,
    setValue: (v) => (el.value = numberText(v)),
    setDisabled: disable(el),
  };
};

const textInput: InputRenderer<TextInputDef, string> = (input, ctx) => {
  const attrs: Record<string, string> = {
    type: 'text',
    class: 'pc-input',
    id: ctx.controlId,
    autocomplete: 'off',
  };
  if (input.placeholder) attrs.placeholder = input.placeholder;
  if (input.maxLength !== undefined) attrs.maxlength = String(input.maxLength);
  const el = h('input', attrs);
  el.value = typeof ctx.value === 'string' ? ctx.value : '';
  el.addEventListener('input', () => ctx.set(el.value));
  return {
    el,
    setValue: (v) => (el.value = typeof v === 'string' ? v : ''),
    setDisabled: disable(el),
  };
};

const booleanInput: InputRenderer<BooleanInputDef, boolean> = (_input, ctx) => {
  const el = h('input', {
    type: 'checkbox',
    class: 'pc-check',
    id: ctx.controlId,
  });
  el.checked = ctx.value === true;
  el.addEventListener('change', () => ctx.set(el.checked));
  return {
    el,
    setValue: (v) => (el.checked = v === true),
    setDisabled: disable(el),
  };
};

/** A select field: the themed listbox, with a search box when the input asks for one. */
function listboxInput(input: { label: string; searchable?: boolean }, options: readonly FormOption[], ctx: InputContext<unknown>): InputControl<unknown> {
  return createListbox({
    options,
    value: ctx.value,
    label: input.label,
    id: ctx.controlId,
    labelId: ctx.labelId,
    search: input.searchable,
    localization: ctx.localization,
    set: ctx.set,
  });
}

const selectInput: InputRenderer<SelectInputDef, string | number> = (input, ctx) =>
  listboxInput(input, input.options, ctx as InputContext<unknown>) as InputControl<string | number>;

/** Bar values in the dialog's language (`source.<value>` keys) while they keep their built-in labels. */
const sourceInput: InputRenderer<SourceInputDef, string> = (input, ctx) =>
  listboxInput(
    input,
    (input.options ?? defaultSources).map((o) => ({
      ...o,
      label: builtinText(ctx, `source.${o.value}`, o.label, defaultSources.find((d) => d.value === o.value)?.label),
    })),
    ctx as InputContext<unknown>,
  ) as InputControl<string>;

const multiSelectInput: InputRenderer<MultiSelectInputDef, (string | number)[]> = (input, ctx) => {
  const el = h('div', {
    class: 'pc-form-choices',
    role: 'group',
    'aria-labelledby': ctx.labelId,
  });
  const boxes = input.options.map((option, i) => {
    const box = h('input', { type: 'checkbox', class: 'pc-check' });
    if (i === 0) box.setAttribute('id', ctx.controlId);
    box.addEventListener('change', () => ctx.set(input.options.filter((_, j) => boxes[j]!.checked).map((o) => o.value)));
    el.append(h('label', { class: 'pc-form-choice' }, box, h('span', {}, option.label)));
    return box;
  });
  const show = (value: unknown) => {
    const picked = Array.isArray(value) ? value : [];
    input.options.forEach((option, i) => (boxes[i]!.checked = picked.includes(option.value)));
  };
  show(ctx.value);
  return {
    el,
    focusTarget: boxes[0],
    setValue: show,
    setDisabled: disable(...boxes),
  };
};

const colorInput: InputRenderer<ColorInputDef, string> = (input, ctx) => {
  // An empty value shows the placeholder, the color used while none is chosen.
  const shown = (v: unknown) => (typeof v === 'string' && v ? v : input.placeholder || '#000000');
  const control = createColorControl({
    label: input.label,
    value: shown(ctx.value),
    onInput: (color) => ctx.set(color),
    swatches: input.swatches,
    localization: ctx.localization,
  });
  const trigger = control.el.firstElementChild as HTMLButtonElement;
  trigger.setAttribute('id', ctx.controlId);
  return {
    el: control.el,
    focusTarget: trigger,
    setValue: (v) => control.setValue(shown(v)),
    setDisabled: disable(trigger),
    destroy: control.destroy,
  };
};

const sliderInput: InputRenderer<SliderInputDef, number> = (input, ctx) => {
  const slider = h('input', {
    type: 'range',
    class: 'pc-slider',
    id: ctx.controlId,
    min: String(input.min),
    max: String(input.max),
    step: String(input.step ?? 1),
  });
  const output = h('span', { class: 'pc-slider-value', 'aria-hidden': 'true' });
  const show = (value: unknown) => {
    const text = numberText(value);
    slider.value = text;
    output.textContent = `${text}${input.unit ?? ''}`;
    slider.setAttribute('aria-valuetext', output.textContent);
  };
  show(ctx.value);
  slider.addEventListener('input', () => {
    const value = Number(slider.value);
    show(value);
    ctx.set(value);
  });
  const el = h('div', { class: 'pc-form-slider' }, slider, output);
  return {
    el,
    focusTarget: slider,
    setValue: show,
    setDisabled: disable(slider),
  };
};

const rangeInput: InputRenderer<RangeInputDef, [number, number]> = (input, ctx) => {
  const from = numberField(ctx.controlId, input);
  const to = numberField(`${ctx.controlId}-to`, input, `${input.label} end`);
  const show = (value: unknown) => {
    const pair = Array.isArray(value) ? value : [];
    from.value = numberText(pair[0]);
    to.value = numberText(pair[1]);
  };
  show(ctx.value);
  const report = () => ctx.set([parseNumber(from.value), parseNumber(to.value)]);
  from.addEventListener('input', report);
  to.addEventListener('input', report);
  const el = h(
    'div',
    { class: 'pc-form-range', role: 'group', 'aria-labelledby': ctx.labelId },
    from,
    h('span', { 'aria-hidden': 'true' }, '–'),
    to,
  );
  return {
    el,
    focusTarget: from,
    setValue: show,
    setDisabled: disable(from, to),
  };
};

const builtins = {
  number: numberInput,
  text: textInput,
  boolean: booleanInput,
  select: selectInput,
  'multi-select': multiSelectInput,
  color: colorInput,
  slider: sliderInput,
  range: rangeInput,
  source: sourceInput,
} as const;
