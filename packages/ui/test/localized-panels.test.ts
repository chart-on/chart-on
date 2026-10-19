import { afterEach, describe, expect, it, vi } from 'vitest';
import { Chart, darkTheme } from '@chart-on/core';
import { dispatch, fakeContainer } from '../../core/test/fake-dom';
import { createAppearance } from '../src/appearance';
import { createChartSettings } from '../src/chart-settings';
import { drawingSettingsForm } from '../src/drawing-settings';
import { createFormDialog } from '../src/form-dialog';
import { formErrors, type FormSchema } from '../src/form-model';
import { builtinText } from '../src/messages';
import { createPickerDialog } from '../src/picker-dialog';

type El = HTMLElement & { children: El[]; tagName: string; textContent: string; placeholder?: string };
const all = (root: unknown): El[] => (root as El).children.flatMap((c) => [c, ...all(c)]);
const find = (root: unknown, test: (el: El) => boolean) => all(root).find(test);
const byLabel = (root: unknown, label: string) => find(root, (el) => el.getAttribute('aria-label') === label);
const texts = (root: unknown) => all(root).map((el) => el.textContent);
const action = (root: unknown, id: string) => find(root, (el) => el.getAttribute('data-action') === id)!;
const textOf = (el: El) => [el.textContent, ...all(el).map((c) => c.textContent)].join('');

const german = {
  dialogOk: 'OK',
  dialogCancel: 'Abbrechen',
  dialogReset: 'Zurücksetzen',
  dialogResetDefaults: 'Standard wiederherstellen',
  dialogDone: 'Fertig',
  dialogSections: 'Bereiche',
  dialogStyle: 'Stil',
  dialogClose: 'Schließen',
  formNumber: 'Zahl eingeben.',
  formMin: 'Mindestens {value} eingeben.',
  pickerEmpty: 'Nichts anzuzeigen.',
  'symbolSearchResults.one': '{count} Ergebnis',
  'symbolSearchResults.other': '{count} Ergebnisse',
  menuAppearance: 'Darstellung',
  appearanceResetAll: 'Alles zurücksetzen',
  appearanceResetSection: '{name} zurücksetzen',
  'appearance.section.candles': 'Kerzen',
  'appearance.up': 'Steigender Körper',
  'appearance.horizontal': 'Horizontale Linien',
  appearanceShow: '{name} anzeigen',
  'preset.paper-ink': 'Papier und Tinte',
  drawingTextColor: 'Textfarbe',
  drawingBold: 'Fett',
  drawingText: 'Text',
  seriesKindLine: 'Linie',
  seriesColor: 'Farbe',
  chartSettingsTitle: 'Diagrammeinstellungen',
  'settings.readout': 'Werteanzeige',
  'settings.readout.legend': 'Legende',
  'setting.features.legend': 'Legende anzeigen',
  'setting.legend.position.top-start': 'Oben am Anfang',
};

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.restoreAllMocks();
});

function chart(messages: Record<string, string> = german) {
  const c = new Chart(fakeContainer(), { localization: { locale: 'de-DE', messages } });
  charts.push(c);
  return c;
}

const schema: FormSchema = {
  id: 'test',
  title: 'Test',
  layout: 'sidebar',
  sections: [
    { id: 'a', title: 'A', groups: [{ id: 'g', inputs: [{ id: 'n', label: 'N', kind: 'number', min: 2, default: 3 }] }] },
    { id: 'b', title: 'B', groups: [{ id: 'h', inputs: [{ id: 't', label: 'T', kind: 'text', default: '' }] }] },
  ],
};

describe('form dialog text', () => {
  it('shows Ok, Cancel, the close button and validation in the given language', () => {
    const c = chart();
    const dialog = createFormDialog(fakeContainer(), schema, { localization: c.localization });
    expect(textOf(action(dialog.el, 'ok'))).toBe('OK');
    expect(textOf(action(dialog.el, 'cancel'))).toBe('Abbrechen');
    expect(byLabel(dialog.el, 'Schließen')).toBeDefined();
    expect(texts(dialog.el)).toContain('Bereiche');
    expect(dialog.errors).toEqual({});
    expect(formErrors(schema, { n: 1, t: '' }, c)).toEqual({ n: 'Mindestens 2 eingeben.' });
    expect(formErrors(schema, { n: 'x', t: '' }, c)).toEqual({ n: 'Zahl eingeben.' });
    dialog.close();
  });

  it('keeps English without a language, and an action label the app changed', () => {
    const c = chart();
    const plain = createFormDialog(fakeContainer(), schema);
    expect([textOf(action(plain.el, 'ok')), textOf(action(plain.el, 'cancel'))]).toEqual(['Ok', 'Cancel']);
    expect(byLabel(plain.el, 'Close')).toBeDefined();
    expect(formErrors(schema, { n: 1, t: '' })).toEqual({ n: 'Enter 2 or more.' });
    plain.close();
    const own = createFormDialog(
      fakeContainer(),
      { ...schema, actions: [{ id: 'ok', label: 'Apply', labelKey: 'dialogOk', role: 'submit' }, { id: 'cancel', label: 'Cancel', labelKey: 'dialogCancel', role: 'cancel' }] },
      { localization: c.localization },
    );
    expect([textOf(action(own.el, 'ok')), textOf(action(own.el, 'cancel'))]).toEqual(['Apply', 'Abbrechen']);
    own.close();
  });
});

describe('picker dialog text', () => {
  it('uses the language for its own text and counts, and English by default', () => {
    const c = chart();
    const items = [{ id: 'a', label: 'Alpha' }];
    const open = (localization?: typeof c.localization) =>
      createPickerDialog(fakeContainer(), { title: 'Pick', source: { items }, multiple: true }, { onSelect: () => {} }, { localization });
    const de = open(c.localization);
    expect(textOf(action(de.el, 'done'))).toBe('Fertig');
    expect(byLabel(de.el, 'Schließen')).toBeDefined();
    expect(texts(de.el)).toContain('1 Ergebnis');
    de.close();
    const en = open();
    expect(textOf(action(en.el, 'done'))).toBe('Done');
    expect(texts(en.el)).toContain('1 result');
    en.close();
  });
});

describe('drawing settings text', () => {
  it('names built-in fields and sections in the language, and keeps a plugin label', () => {
    const c = chart();
    const tool = c.drawings.getTools().find((t) => t.type === 'text')!;
    const form = drawingSettingsForm({}, { ...tool, settings: [{ key: 'tone', label: 'Tone', type: 'boolean' }] }, ['color', 'textColor', 'bold'], darkTheme, c)!;
    expect(form.schema.sections[0]!.title).toBe('Stil');
    const labels = form.schema.sections[0]!.groups.flatMap((g) => [g.label, ...g.inputs.map((i) => i.label)]);
    expect(labels).toEqual(expect.arrayContaining(['Linie', 'Farbe', 'Text', 'Textfarbe', 'Fett', 'Tone']));
    expect(form.schema.actions!.map((a) => a.labelKey)).toEqual(['dialogReset', 'dialogCancel', 'dialogOk']);
    const english = drawingSettingsForm({}, tool, ['color', 'textColor', 'bold'], darkTheme)!;
    expect(english.schema.sections[0]!.groups.flatMap((g) => g.inputs.map((i) => i.label))).toEqual(['Color', 'Text color', 'Bold']);
  });
});

describe('appearance panel text', () => {
  it('is in the chart language when it opens, with built-in preset names translated', () => {
    const c = chart();
    const a = createAppearance(c, { storage: null });
    a.open();
    const panel = find(c.root, (el) => el.className.split(' ').includes('pc-appearance'))!;
    expect(panel.getAttribute('aria-label')).toBe('Darstellung');
    expect(texts(panel)).toEqual(expect.arrayContaining(['Darstellung', 'Alles zurücksetzen', 'Kerzen', 'Steigender Körper', 'Horizontale Linien']));
    expect(byLabel(panel, 'Kerzen zurücksetzen') ?? find(panel, (el) => el.getAttribute('data-tip') === 'Kerzen zurücksetzen')).toBeDefined();
    expect(byLabel(panel, 'Horizontale Linien anzeigen')).toBeDefined();
    expect(byLabel(panel, 'Papier und Tinte')).toBeDefined();
    a.destroy();
  });

  it('keeps a preset name the app gave a built-in preset id', () => {
    const c = chart();
    const a = createAppearance(c, {
      storage: null,
      presets: [{ id: 'paper-ink', label: 'House style', light: { background: '#ffffff', primary: '#000000' }, dark: { background: '#000000', primary: '#ffffff' } }],
    } as Parameters<typeof createAppearance>[1]);
    a.open();
    expect(byLabel(c.root, 'House style')).toBeDefined();
    a.destroy();
  });
});

describe('chart settings text', () => {
  it('translates built-in sections, fields and choices, and keeps labels the app set', () => {
    const c = chart();
    c.addCandles({ title: 'ABC' }).setData([{ time: 0, open: 1, high: 2, low: 0.5, close: 1.5 }]);
    const host = fakeContainer();
    const settings = createChartSettings(c, host, {
      storage: null,
      sections: (defaults) =>
        defaults.map((s) =>
          s.id === 'axes' ? { ...s, title: 'Axes and labels' } : s,
        ),
    });
    const dialog = settings.open('readout')!;
    const words = texts(dialog.el);
    expect(words).toEqual(expect.arrayContaining(['Diagrammeinstellungen', 'Werteanzeige', 'Legende', 'Legende anzeigen', 'Oben am Anfang', 'Axes and labels']));
    dispatch(action(dialog.el, 'cancel'), 'click');
  });
});

describe('builtinText', () => {
  it('translates a label only while it is the built-in English text', () => {
    const c = chart({ 'category.trend': 'Trend (de)' });
    expect(builtinText(c, 'category.trend', 'Trend', 'Trend')).toBe('Trend (de)');
    expect(builtinText(c, 'category.trend', 'Trending', 'Trend')).toBe('Trending');
    expect(builtinText(null, 'category.trend', 'Trend')).toBe('Trend');
  });

  it('renders the built-in English text without a language', () => {
    const c = new Chart(fakeContainer());
    charts.push(c);
    const a = createAppearance(c, { storage: null });
    a.open();
    const panel = find(c.root, (el) => el.className.split(' ').includes('pc-appearance'))!;
    expect(texts(panel)).toEqual(
      expect.arrayContaining(['Appearance', 'Reset all', 'Presets', 'Candles', 'Rising body', 'Scales and text', 'Horizontal lines', 'Solid']),
    );
    expect(byLabel(panel, 'Show horizontal lines')).toBeDefined();
    expect(byLabel(panel, 'Vertical lines color')).toBeDefined();
    a.destroy();
    const picker = createPickerDialog(fakeContainer(), { title: 'Pick', source: { items: [] }, multiple: true }, { onSelect: () => {} });
    expect(texts(picker.el)).toEqual(expect.arrayContaining(['Nothing to show.', '0 selected', 'No results']));
    expect([textOf(action(picker.el, 'done'))]).toEqual(['Done']);
    picker.close();
    expect(formErrors(schema, { n: 'x', t: 3 })).toEqual({ n: 'Enter a number.', t: 'Enter some text.' });
  });
});
