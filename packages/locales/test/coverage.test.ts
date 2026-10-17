import { describe, expect, test } from 'vitest';
import {
  builtinTools,
  chartSettingsSchema,
  createImageTool,
  createStickerTool,
  defaultMessages,
  emojiTool,
  iconTool,
  type LocalizationOptions,
} from '@charton/core';
import { appearanceSections, defaultShellMessages } from '@charton/ui';

// Every pack the package exports, so a new language gets these checks by adding its export.
const manifest = '../package.json';
const pkg: { exports: Record<string, unknown> } = await import(manifest, { with: { type: 'json' } });
const tags = Object.keys(pkg.exports)
  .filter((subpath) => subpath !== './package.json')
  .map((subpath) => subpath.slice(2));

const load = () => new Blob();
const tools = [...builtinTools, emojiTool, iconTool, createImageTool({ load }), createStickerTool({ load })];
type Entry = [key: string, text: string | undefined];
/**
 * The keys the chart settings dialog reads its built-in text through, built as
 * the ui's `localText` builds them. Timezone choices are zone names, and
 * choices with a `labelKey` use that message instead.
 */
const settingsText = chartSettingsSchema.flatMap((s): Entry[] => [
  [`settings.${s.id}`, s.title],
  ...s.groups.flatMap((g): Entry[] => [
    [`settings.${s.id}.${g.id}`, g.label],
    ...g.fields.flatMap((f): Entry[] => [
      [`setting.${f.path}`, f.label],
      [`setting.${f.path}#hint`, f.hint],
      ...(f.path === 'timezone' ? [] : (f.choices ?? [])).filter((c) => !c.labelKey).map((c): Entry => [`setting.${f.path}.${c.value}`, c.label]),
    ]),
  ]),
]);
/** The appearance panel's section titles and color names, plus its grid line directions (not exported). */
const appearanceText = appearanceSections.flatMap((s): Entry[] => [
  [`appearance.section.${s.id}`, s.label],
  ...s.colors.map((c): Entry => [`appearance.${c.key}`, c.label]),
]);
appearanceText.push(['appearance.horizontal', 'Horizontal lines'], ['appearance.vertical', 'Vertical lines']);

/** The English text of every key a pack translates. */
const english: Record<string, string> = {
  ...defaultMessages,
  ...defaultShellMessages,
  ...Object.fromEntries(tools.map((tool) => [`tool.${tool.type}`, tool.label])),
  ...Object.fromEntries([...settingsText, ...appearanceText].filter((entry) => entry[1] !== undefined)),
};
/** Keys read through `pluralText`: the plain key is the `other` form, the language's other categories are extra keys. */
const PLURAL_KEYS = ['measureBars', 'symbolSearchResults', 'pickerSelected', 'clusterOrders'];

/**
 * Values a message gets besides the ones its English text uses, by key: the same name as written,
 * where English uses it in lower case. Languages that capitalize nouns use `{name}` instead.
 */
const SAME_VALUE: Record<string, Record<string, string>> = {
  railMoreGroup: { name: 'group' },
  appearanceResetSection: { name: 'lower' },
  appearanceShow: { name: 'lower' },
};

const placeholders = (text: string, key = '') =>
  [...text.matchAll(/\{(\w+)\}/g)].map((match) => SAME_VALUE[key]?.[match[1]!] ?? match[1]).sort();

const packs = await Promise.all(tags.map(async (tag) => ({ tag, module: (await import(`../src/${tag}.ts`)) as Record<string, LocalizationOptions> })));

describe.each(packs)('locale pack $tag', ({ tag, module }) => {
  const [pack] = Object.values(module);
  const messages = pack?.messages ?? {};
  const categories = new Intl.PluralRules(tag).resolvedOptions().pluralCategories.filter((category) => category !== 'other');
  const pluralKeys = PLURAL_KEYS.flatMap((key) => categories.map((category) => `${key}.${category}`));

  test('exports one LocalizationOptions object for its locale', () => {
    expect(Object.keys(module)).toHaveLength(1);
    expect(pack?.locale).toBe(tag);
  });

  test('has every built-in key and no unknown ones', () => {
    const optional = PLURAL_KEYS.map((key) => `${key}.other`);
    const expected = [...Object.keys(english), ...pluralKeys].sort();
    expect(Object.keys(messages).filter((key) => !optional.includes(key)).sort()).toEqual(expected);
  });

  test('keeps the placeholders of the English text', () => {
    for (const [key, text] of Object.entries(messages)) {
      const source = english[key] ?? english[key.slice(0, key.lastIndexOf('.'))]!;
      expect(placeholders(text, key.split('.')[0]), key).toEqual(placeholders(source));
    }
  });

  test('translates every message to non-empty text', () => {
    for (const [key, text] of Object.entries(messages)) expect(text.trim(), key).not.toBe('');
  });
});
