import { parseColor } from '../src/util/color';

/**
 * The palette the themes and the shell used before #137, when the current
 * one replaced it, and the colour picker swatches #1000 replaced that no
 * theme uses. Kept as hashes of the `r,g,b` values (any alpha), so the
 * repository no longer contains the colours themselves while tests can
 * still make sure none of them comes back.
 */
const RETIRED = new Set([
  413428505, 954718057, 2151318732, 2096183425, 26093034, 3953540192, 2855775807, 614453937, 1593073510,
  165002510, 2816396403, 4284717814, 2035567961, 2290100584, 1960190753, 2318171354, 677676018, 1954176661,
  // #1000: four colour picker swatches.
  3483063435, 730576666, 1620948432, 3590636771,
]);

/** 32-bit FNV-1a. */
export function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** Whether `color` has the red, green and blue of a retired palette colour. */
export function isRetired(color: string): boolean {
  return RETIRED.has(hash(parseColor(color).slice(0, 3).join(',')));
}

/** Every `#rrggbb` and `rgb()` / `rgba()` colour written in `text`. */
export function colorsIn(text: string): string[] {
  return text.match(/#[0-9a-f]{6}\b|rgba?\([^)]*\)/gi) ?? [];
}

/**
 * Design data replaced in the review of defaults (#853): default level sets,
 * menu and catalogue orders, labels and default shortcuts. Like the palette,
 * each is kept only as the hash of its text form (`designForms`), so the
 * replaced values leave the repository and the check needs nothing outside it.
 *
 * The lists start empty. A change that retires such data adds the hashes of
 * what it replaces, computed from our own code on `main` before the change,
 * for example in a scratch test: `console.log(hash(designForms.levels([0, 0.5, 1])))`.
 */
const RETIRED_DESIGN: RetiredDesign = {
  levels: new Set<number>([
    // #856: the speed fan's (also the Gann box's), the trend-based time tool's and the pitchforks' level sets.
    3391617664, 137968532, 3648493283,
    // #857: view and tool defaults: time scale, pane margins (main, added), fixed-range profile, drawing font sizes.
    1081274506, 1955040462, 2748106119, 222514782, 28428045,
  ]),
  // #861: the chart style menu order before it was grouped by what each style shows.
  // #862: the `builtinTools`, `patternTools` and rail group orders, and the rail group labels as a list.
  // #863: the settings section order.
  // #1000: the colour picker swatches before the generated grid.
  order: new Set<number>([895623166, 1834704140, 1870279211, 167092166, 1795684631, 3327815205, 59618304]),
  label: new Set<number>([
    // #861: three chart style labels, in English and in the seven locale packs.
    1077960217, 299439607, 701151406, 2539888224, 1885209977, 166457726, 4176229559, 3734163513, 363500131, 962023870,
    1622078639, 570515318, 3581673146, 2403492025, 876711463, 2448505158, 3719834858, 3501117915, 4252579924, 1016376585,
    1355316391, 2789444789, 1102537703, 431490503,
    // #862: two retired rail group labels.
    1853253374, 3389281597,
    // #863: four labels (countdown, ratio lock, session lines, info line tool) in English and in each locale pack.
    157178032, 519839934, 295355649, 2386662045, 2591942036, 944110417, 1204712949, 3324501266,
    2640060788, 3555929909, 3456337475, 3071875204, 1289928799, 1399747777, 1914172092, 2976962273, 3010617696, 3104255704,
    1821322556, 3572779659, 1848973140, 2744840214, 2098605891, 3444890727, 1041889746, 2035803006, 3664145723, 3876697138,
    1054047348, 2954674503, 3770520712, 1176302778,
  ]),
  // #863: the Alt defaults of four drawing tools, reset-view and go-to-date.
  shortcut: new Set<number>([16116594, 3459071765, 511904389, 3468644643, 1118776973, 3127136902]),
  // #859: the data source marks API it replaced: the two fetch methods and `getAdjustments`, the
  // chart's refresh and clear calls, the plugin, the item types, and the event, error and warning names.
  name: new Set<number>([
    1890122307, 3880656652, 2849774157, 1801320250, 235364184, 3813201822, 777681856, 2829460957, 3392769635, 3977957406,
    114625807, 265352972, 114359469, 4056846665, 576543197, 1064349494, 2447798792, 94843617, 3770223558,
    // #858: the bars request's count and the result's end-of-history flag, and the indicator fetch's bars call.
    // The request's first-load flag is left out: its name is a plain word the reports use in prose.
    2814664511, 3970942570, 2560655393,
    // #861: the chart style id renamed to `rangeBand`, and its shell message key.
    1392505987, 798378928,
    // #860: the list-based access rule types and the indicator cap option, the old layout list entry, and the session string helper.
    // `blocked` and `drawingTools` are left out: plain words, and `drawingTools` is still a plugin name.
    437923691, 4072649016, 4235211051, 697169915, 3014963563, 4064182609,
  ]),
};

/** The kinds of design data the guard compares; `name` is a public API name (method, type, event, error code). */
export type DesignKind = 'levels' | 'order' | 'label' | 'shortcut' | 'name';

/** Retired fingerprints by kind. */
export type RetiredDesign = Readonly<Record<DesignKind, ReadonlySet<number>>>;

/** One piece of live design data in its text form, and where it comes from (for the failure message). */
export interface DesignEntry {
  kind: DesignKind;
  where: string;
  form: string;
}

/**
 * The fixed text form of each kind of data. Fixed, because a fingerprint taken
 * before a change must still match the same data later; a test pins them.
 * Lists (levels, orders) are compared whole, since the combination is the
 * choice; sets (labels, shortcuts) member by member, so a retired label or key
 * stays retired while other entries come and go.
 */
export const designForms = {
  /** A level set: the values, sorted and comma-separated. Colours and visibility are left out, so restyling a retired set does not hide it. */
  levels: (values: readonly number[]) => [...values].sort((a, b) => a - b).join(','),
  /** An order: the ids, comma-separated in order. */
  order: (ids: readonly string[]) => ids.join(','),
  /** One label, trimmed and lower-cased, so a change of case or spacing does not hide it. */
  label: (label: string) => label.trim().toLowerCase(),
  /** One public API name, as written: names are case-sensitive, so `Mark` and `mark` are different names. */
  name: (name: string) => name,
  /** A shortcut map: its sorted `action=key` pairs, one form each, with keys in the action registry's canonical form. */
  shortcuts: (map: Readonly<Record<string, readonly string[]>>) =>
    Object.entries(map)
      .flatMap(([action, keys]) => keys.map((key) => `${action}=${key}`))
      .sort(),
};

/** The entries of `live` whose fingerprint is retired, as `where (kind): form`. */
export function retiredDesign(live: readonly DesignEntry[], retired: RetiredDesign = RETIRED_DESIGN): string[] {
  return live.filter((e) => retired[e.kind].has(hash(e.form))).map((e) => `${e.where} (${e.kind}): ${e.form}`);
}

/** Entries for one label per string in `labels`. */
export const labelEntries = (where: string, labels: Iterable<unknown>): DesignEntry[] =>
  [...labels].filter((l): l is string => typeof l === 'string').map((l) => ({ kind: 'label', where, form: designForms.label(l) }));

/** Entries for the default shortcuts of every action in `actions`. */
export const shortcutEntries = (where: string, actions: readonly { id: string; defaultKeys: readonly string[] }[]): DesignEntry[] =>
  designForms
    .shortcuts(Object.fromEntries(actions.map((a) => [a.id, a.defaultKeys])))
    .map((form) => ({ kind: 'shortcut', where, form }));

/**
 * Entries for every name an API report (`etc/*.api.md`) declares or uses:
 * each identifier, and each quoted string (event names, error and warning
 * codes). The reports are the public API, generated from the sources.
 */
export const nameEntries = (where: string, report: string): DesignEntry[] =>
  [...new Set(report.match(/[A-Za-z_$][\w$]*|'[^'\n]*'|"[^"\n]*"/g) ?? [])].map((n) => ({ kind: 'name', where, form: designForms.name(n.replace(/^['"]|['"]$/g, '')) }));
