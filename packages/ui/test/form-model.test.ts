import { describe, expect, it } from 'vitest';
import {
  conditionHolds,
  defaultValues,
  formErrors,
  inputError,
  validateFormSchema,
  type FormInputBase,
  type FormInputDef,
  type FormSchema,
} from '../src/form-model';

const custom = (def: FormInputBase & { kind: string }) => def as unknown as FormInputDef;

const schema = (inputs: FormInputDef[], extra: Partial<FormSchema> = {}): FormSchema => ({
  id: 'test',
  title: 'Test',
  sections: [{ id: 'main', title: 'Main', groups: [{ id: 'g', inputs }] }],
  ...extra,
});

describe('validateFormSchema', () => {
  it('accepts a valid schema', () => {
    const s = schema([
      {
        kind: 'number',
        id: 'length',
        label: 'Length',
        default: 14,
        min: 1,
        integer: true,
      },
      {
        kind: 'select',
        id: 'style',
        label: 'Style',
        options: [{ value: 'solid', label: 'Solid' }],
        default: 'solid',
      },
      {
        kind: 'slider',
        id: 'opacity',
        label: 'Opacity',
        min: 0,
        max: 100,
        default: 50,
      },
    ]);
    expect(validateFormSchema(s)).toEqual([]);
  });

  it('reports duplicate ids, missing labels and options, and unknown kinds', () => {
    const s: FormSchema = {
      id: 'x',
      title: '',
      sections: [
        {
          id: 'a',
          title: 'A',
          groups: [{ id: 'g', inputs: [{ kind: 'number', id: 'n', label: '' }] }],
        },
        {
          id: 'a',
          title: 'B',
          groups: [
            {
              id: 'g',
              collapsible: true,
              inputs: [
                { kind: 'text', id: 'n', label: 'Again' },
                { kind: 'select', id: 's', label: 'S', options: [] },
                custom({ kind: 'stepper', id: 'c', label: 'Custom' }),
                { kind: 'slider', id: 'r', label: 'R', min: 5, max: 1 },
              ],
            },
          ],
        },
      ],
    };
    const problems = validateFormSchema(s);
    expect(problems).toEqual(
      expect.arrayContaining([
        'The schema needs a title.',
        'Duplicate section id "a".',
        'Duplicate group id "g".',
        'Duplicate input id "n".',
        'Input "n" needs a label.',
        'Group "g" is collapsible but has no label.',
        'Input "s" needs options.',
        'Input "c" has unknown kind "stepper"; register it with registerInput.',
        'Input "r" has min above max.',
      ]),
    );
  });

  it('accepts custom kinds the caller knows', () => {
    const s = schema([custom({ kind: 'stepper', id: 'c', label: 'Custom' })]);
    expect(validateFormSchema(s, (kind) => kind === 'stepper')).toEqual([]);
  });

  it('checks built-in defaults', () => {
    const s = schema([{ kind: 'number', id: 'n', label: 'N', min: 1, default: 0 }]);
    expect(validateFormSchema(s)).toEqual(['Input "n" default is invalid: Enter 1 or more.']);
  });

  it('needs sections', () => {
    expect(validateFormSchema({ id: 'x', title: 'X', sections: [] })).toEqual(['The schema needs at least one section.']);
  });
});

describe('defaults and conditions', () => {
  it('collects defaults and copies arrays', () => {
    const tags: (string | number)[] = ['a'];
    const s = schema([
      { kind: 'number', id: 'n', label: 'N', default: 3 },
      { kind: 'text', id: 't', label: 'T' },
      {
        kind: 'multi-select',
        id: 'm',
        label: 'M',
        options: [{ value: 'a', label: 'A' }],
        default: tags,
      },
    ]);
    const values = defaultValues(s);
    expect(values).toEqual({ n: 3, m: ['a'] });
    expect(values.m).not.toBe(tags);
  });

  it('evaluates fixed and computed conditions', () => {
    expect(conditionHolds(undefined, {}, true)).toBe(true);
    expect(conditionHolds(false, {}, true)).toBe(false);
    expect(conditionHolds((v) => v.mode === 'b', { mode: 'b' }, false)).toBe(true);
  });
});

describe('validation messages', () => {
  const values = {};
  it('checks numbers', () => {
    const n: FormInputDef = {
      kind: 'number',
      id: 'n',
      label: 'N',
      min: 1,
      max: 10,
      integer: true,
    };
    expect(inputError(n, Number.NaN, values)).toBe('Enter a number.');
    expect(inputError(n, 0, values)).toBe('Enter 1 or more.');
    expect(inputError(n, 11, values)).toBe('Enter 10 or less.');
    expect(inputError(n, 2.5, values)).toBe('Enter a whole number.');
    expect(inputError(n, 5, values)).toBeNull();
  });

  it('checks text, options, colors and ranges', () => {
    expect(inputError({ kind: 'text', id: 't', label: 'T', required: true }, '  ', values)).toBe('Required.');
    expect(inputError({ kind: 'text', id: 't', label: 'T', maxLength: 2 }, 'abc', values)).toBe('Use 2 characters or fewer.');
    const options = [{ value: 1, label: 'One' }];
    expect(inputError({ kind: 'select', id: 's', label: 'S', options }, 2, values)).toBe('Choose an option.');
    expect(inputError({ kind: 'select', id: 's', label: 'S', options }, 1, values)).toBeNull();
    expect(inputError({ kind: 'multi-select', id: 'm', label: 'M', options }, [1, 3], values)).toBe('Choose from the options.');
    expect(inputError({ kind: 'source', id: 'src', label: 'Source' }, 'hlc3', values)).toBeNull();
    expect(inputError({ kind: 'source', id: 'src', label: 'Source' }, 'median', values)).toBe('Choose an option.');
    expect(inputError({ kind: 'color', id: 'c', label: 'C' }, '', values)).toBe('Choose a color.');
    // With a placeholder, empty means no color chosen; blank is still invalid.
    expect(inputError({ kind: 'color', id: 'c', label: 'C', placeholder: '#888888' }, '', values)).toBeNull();
    expect(inputError({ kind: 'color', id: 'c', label: 'C', placeholder: '#888888' }, ' ', values)).toBe('Choose a color.');
    const range: FormInputDef = { kind: 'range', id: 'r', label: 'R', min: 0 };
    expect(inputError(range, [3, 1], values)).toBe('The start must not be after the end.');
    expect(inputError(range, [-1, 1], values)).toBe('Enter 0 or more.');
    expect(inputError(range, [1, Number.NaN], values)).toBe('Enter two numbers.');
  });

  it('runs validate after the built-in checks, with all values', () => {
    const input: FormInputDef = {
      kind: 'number',
      id: 'slow',
      label: 'Slow',
      min: 1,
      validate: (value, all) => (value <= (all.fast as number) ? 'Must be longer than the fast length.' : null),
    };
    expect(inputError(input, 0, { fast: 5 })).toBe('Enter 1 or more.');
    expect(inputError(input, 4, { fast: 5 })).toBe('Must be longer than the fast length.');
    expect(inputError(input, 9, { fast: 5 })).toBeNull();
  });

  it('skips hidden and disabled inputs, including hidden groups and sections', () => {
    const s: FormSchema = {
      id: 'x',
      title: 'X',
      sections: [
        {
          id: 'a',
          title: 'A',
          groups: [
            {
              id: 'g1',
              inputs: [
                { kind: 'boolean', id: 'band', label: 'Band' },
                {
                  kind: 'number',
                  id: 'width',
                  label: 'Width',
                  min: 1,
                  visible: (v) => v.band === true,
                },
                {
                  kind: 'number',
                  id: 'locked',
                  label: 'Locked',
                  min: 1,
                  disabled: true,
                },
              ],
            },
            {
              id: 'g2',
              visible: (v) => v.band === true,
              inputs: [{ kind: 'text', id: 'name', label: 'Name', required: true }],
            },
          ],
        },
        {
          id: 'b',
          title: 'B',
          visible: false,
          groups: [
            {
              id: 'g3',
              inputs: [{ kind: 'number', id: 'other', label: 'O', min: 1 }],
            },
          ],
        },
      ],
    };
    const values = { band: false, width: 0, locked: 0, name: '', other: 0 };
    expect(formErrors(s, values)).toEqual({});
    expect(formErrors(s, { ...values, band: true })).toEqual({
      width: 'Enter 1 or more.',
      name: 'Required.',
    });
  });
});
