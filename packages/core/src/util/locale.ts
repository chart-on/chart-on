import { formatCompact, isoDateTime } from './format';
import { parseCompact, type PriceFormatModel } from './price-format';
import { isText } from './records';
import { isDev } from './dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/** Values that fill `{name}` placeholders in a message. */
export type MessageParams = Readonly<Record<string, string | number>>;

/**
 * The `localization` chart option: the language of numbers, dates and the
 * built-in text. Every field is optional; without any of them the chart keeps
 * its built-in English output.
 */
export interface LocalizationOptions {
  /**
   * BCP 47 language tag, e.g. `'de-DE'` or `'ja-JP'`. Decimal marks, minus
   * and percent signs, digits (e.g. Arabic-Indic for `'ar-EG'`, or any
   * `-u-nu-` numbering system), month and weekday names and the time format
   * follow it through `Intl`. Unset (the default): the built-in English formats.
   */
  locale?: string;
  /** Decimal mark for every number the chart shows, whatever the locale says, e.g. `','`. */
  decimalSeparator?: string;
  /**
   * Group the digits of prices the locale's way, e.g. `1.234,50` in German or
   * `12,34,567.50` in Indian English, on the price axis, the crosshair, the
   * legend and the data window. Typed prices accept the grouping back. Price
   * formats with a `unit` and `custom` formats are left as they are. Default
   * `false`: prices are not grouped (`1234,50`).
   */
  grouping?: boolean;
  /** 12 or 24 hour clock. Unset: the locale's own, or 24 hours without a locale. */
  hourCycle?: 'h12' | 'h23';
  /**
   * `Intl.DateTimeFormat` fields for the date in the crosshair label and other
   * full dates, e.g. `{ day: 'numeric', month: 'long', year: 'numeric' }`.
   * Unset: day, abbreviated month and whole year, in the locale's order, or
   * ISO 8601 (`2026-10-16`) with no `locale` and a 24-hour clock. Time-of-day fields here are
   * ignored; the time follows `hourCycle`.
   */
  dateFormat?: Intl.DateTimeFormatOptions;
  /** Your text by message key (see `defaultMessages`); keys left out keep the default. A new object replaces the previous one. */
  messages?: Readonly<Record<string, string>>;
  /**
   * Called for every message before the defaults, e.g. to hand keys to an
   * i18n library. Return `undefined` to use `messages` or the English default.
   */
  translate?: (key: string, params: MessageParams) => string | undefined;
}

/**
 * The chart's built-in English text, by message key. `{name}` marks a value
 * filled in at run time. Drawing tool names are not listed: their key is
 * `tool.` plus the tool's type (e.g. `tool.trendline`), and the tool's
 * `label` is the default. Indicator text is not listed either: its keys are
 * made from ids, with the definition's own text as the default:
 * `indicator.<id>` (name), `indicator.<id>.description`,
 * `input.<id>.<input>` (input label), `input.<id>.<input>.<value>` (select
 * choice), `inputGroup.<id>.<group>` and `plot.<id>.<plot>` (plot title).
 */
export const defaultMessages = {
  chartLabel: 'Chart',
  chartLabelSymbol: '{symbol} chart',
  scrollToLatest: 'Scroll to the most recent bar',
  attribution: 'Made with charton',
  statusLoading: 'Loading…',
  statusNoData: 'No data',
  statusError: 'Could not load data',
  statusUnknownSymbol: 'Unknown symbol',
  statusExpired: 'Contract expired',
  statusReconnecting: 'Reconnecting…',
  statusStale: 'Data may be out of date',
  adjustmentsFailed: 'Could not load splits and dividends: prices are shown unadjusted',
  adjustmentSplit: 'Split',
  adjustmentSplitShort: 'S',
  adjustmentDividend: 'Dividend',
  adjustmentDividendShort: 'D',
  adjustmentOther: 'Corporate action',
  adjustmentOtherShort: 'C',
  adjustmentFactor: 'Earlier prices × {factor}',
  marketPre: 'Pre-market',
  marketOpen: 'Market open',
  marketPost: 'After hours',
  marketClosed: 'Market closed',
  marketEndOfDay: 'End of day',
  marketDelayed: '{minutes} min delayed',
  paneToolbar: 'Pane',
  paneMoveUp: 'Move pane up',
  paneMoveDown: 'Move pane down',
  paneMaximize: 'Maximize pane',
  paneRestore: 'Restore panes',
  paneCollapse: 'Collapse pane',
  paneExpand: 'Expand pane',
  paneRemove: 'Remove pane',
  legendHide: 'Hide {title}',
  legendShow: 'Show {title}',
  legendSettings: 'Settings for {title}',
  legendMore: 'More actions for {title}',
  legendRemove: 'Remove {title}',
  indicatorSelected: '{title} selected',
  indicatorPasteFailed: 'Indicator {type} cannot be pasted on this chart',
  legendShowMore: 'Show {count} more',
  legendCollapse: 'Collapse legend',
  legendOpen: 'O',
  legendHigh: 'H',
  legendLow: 'L',
  legendClose: 'C',
  legendCount: 'N',
  legendPoc: 'POC',
  legendVah: 'VAH',
  legendVal: 'VAL',
  legendTitleCandles: 'Price',
  legendTitleHistogram: 'Histogram',
  legendTitleLine: 'Line',
  legendTitleHeatmap: 'Heatmap',
  legendTitleIndicator: 'Indicator',
  legendTitleCustom: 'Series',
  legendTitleVolumeProfile: 'Volume profile',
  legendTitlePoints: 'Points',
  describeHead: '{name}, {interval}.',
  describeHeadNoInterval: '{name}.',
  describeEmpty: 'No data in view.',
  describeBars: '{count} bars from {from} to {to}.',
  describeClose: 'Close {first} to {last}, {move}.',
  describeUp: 'up {change}',
  describeDown: 'down {change}',
  describeUnchanged: 'unchanged',
  describeHighLow: 'High {high}, low {low}.',
  newBar: 'New bar {time}.',
  newBarPrevious: 'Previous close {close}, {change}.',
  tableSpan: '{from} to {to}',
  tableNoData: 'no data',
  tableNewest: 'newest {shown} of {total} rows',
  sonifyBar: '{time}. Open {open}, high {high}, low {low}, close {close}, {move}.',
  sonifyPoint: '{time}. {title} {value}.',
  sonifyValue: 'Value',
  sonifyCueMarker: 'Marker.',
  sonifyCueAlert: 'Alert line crossed.',
  sonifyCueSession: 'New session.',
  actionScrollOlder: 'Scroll to older bars',
  actionScrollNewer: 'Scroll to newer bars',
  actionPageOlder: 'One screen to older bars',
  actionPageNewer: 'One screen to newer bars',
  actionOldestBar: 'Go to the oldest bar',
  actionNewestBar: 'Go to the newest bar',
  actionZoomIn: 'Zoom in',
  actionZoomOut: 'Zoom out',
  actionResetView: 'Reset view',
  actionCrosshairPrev: 'Crosshair to the previous bar',
  actionCrosshairNext: 'Crosshair to the next bar',
  actionFitContent: 'Fit all bars',
  actionAutoScale: 'Auto scale',
  actionRemoveSelected: 'Remove selected',
  actionCopy: 'Copy',
  actionCut: 'Cut',
  actionPaste: 'Paste',
  actionDeleteDrawings: 'Remove selected drawings',
  actionCopyDrawings: 'Copy selected drawings',
  actionCutDrawings: 'Cut selected drawings',
  actionPasteDrawings: 'Paste drawings',
  actionUndo: 'Undo',
  actionRedo: 'Redo',
  actionLockDrawings: 'Lock all drawings',
  actionHideDrawings: 'Hide all drawings',
  actionGroupDrawings: 'Group selected drawings',
  actionUngroupDrawings: 'Ungroup selected drawings',
  actionDrawTool: 'Draw: {tool}',
  drawingGroupName: 'Group {n}',
  drawingTextPlaceholder: 'Text',
  measureBar: '{count} bar',
  measureBars: '{count} bars',
  measureDays: '{n}d',
  measureHours: '{n}h',
  measureMinutes: '{n}m',
  measureSeconds: '{n}s',
  positionTarget: 'Target {price}',
  positionStop: 'Stop {price}',
  positionLongEntry: 'Long entry {price}',
  positionShortEntry: 'Short entry {price}',
  positionRiskReward: 'R:R {ratio}',
  timezoneLocal: 'Local ({zone}, {offset})',
} as const;

/** A key of the chart's built-in text. */
export type CoreMessageKey = keyof typeof defaultMessages;

const pluralRules = new Map<string, Intl.PluralRules>();

/**
 * The message `key` for `count` in the plural form of the language:
 * `key.one`, `key.few`, `key.many`, … as `Intl.PluralRules` picks for the
 * locale (`key.zero` too where the language has it), else `key.other`, else
 * `fallback` (default: the message `key` itself). E.g. with
 * `{ 'measureBars.one': '{count} barre', 'measureBars.other': '{count} barres' }`,
 * French writes `0 barre` and `2 barres`.
 */
export function pluralText(
  localization: Pick<Localizer, 'locale' | 'text'>,
  key: string,
  count: number,
  params?: MessageParams,
  fallback = localization.text(key, params),
): string {
  const locale = localization.locale ?? 'en';
  let rules = pluralRules.get(locale);
  if (!rules) pluralRules.set(locale, (rules = new Intl.PluralRules(locale)));
  const other = localization.text(`${key}.other`, params, fallback);
  const category = rules.select(count);
  return category === 'other' ? other : localization.text(`${key}.${category}`, params, other);
}

/**
 * Numbers, dates and text in the chart's language: `chart.localization`.
 * Built from the `localization` option; a new one replaces it when the option
 * changes (`localization:change`).
 */
export interface Localizer {
  /** The `locale` option; undefined for the built-in English formats. */
  readonly locale: string | undefined;
  readonly decimalSeparator: string;
  readonly minusSign: string;
  readonly hourCycle: 'h12' | 'h23';
  /**
   * The text for `key` with `params` filled in: `translate`, else `messages`,
   * else `fallback`, else the built-in default, else the key itself.
   */
  text(key: string, params?: MessageParams, fallback?: string): string;
  /** `value` with exactly `decimals` places and no grouping, e.g. `1234,50` in German or `١٢٣٤٫٥٠` in Egyptian Arabic. */
  number(value: number, decimals: number): string;
  /** A price with `decimals` places: `number`, with its digits grouped when the `grouping` option is on (`1.234,50`). */
  price(value: number, decimals: number): string;
  /** `value` as a percentage with `decimals` places and the locale's percent sign; `signed` adds a `+` to positive values. */
  percent(value: number, decimals: number, signed?: boolean): string;
  /**
   * Compact amounts. With a `locale`, in its own words, digits and grouping
   * through `Intl`, e.g. `1,25 Mio.` in German, `12.35L` (lakh) in Indian
   * English or `١٫٢٥ مليون` in Egyptian Arabic; without one, `1.25M`.
   */
  compact(value: number): string;
  /**
   * The reverse of `compact`, for parsing what a user typed: the locale's
   * suffixes, digits and grouping, or a K, M, B or T suffix. NaN when the text
   * is not an amount.
   */
  parseCompact(text: string): number;
  /**
   * Number text made with ASCII digits, `.` and `-` (e.g. by a price format),
   * in this locale's digits, decimal mark and minus sign.
   */
  localize(text: string): string;
  /** The reverse of `localize`, for parsing what a user typed. */
  delocalize(text: string): string;
  /**
   * A price format whose text follows this locale, grouped when the `grouping`
   * option is on (except a format with a `unit`); custom formats are returned as they are.
   */
  priceFormat(model: PriceFormatModel, custom?: boolean): PriceFormatModel;
  /**
   * Format a wall-clock `Date` (its UTC fields hold the chart-timezone time, as
   * `Zone.date` returns) with `Intl` fields in this locale.
   */
  date(wall: Date, fields: Intl.DateTimeFormatOptions): string;
  /** Short month name of a wall-clock date, e.g. `Jan` or `janv.`. */
  monthShort(wall: Date): string;
  /**
   * Hours and minutes of a wall-clock date in the hour cycle, e.g. `14:30` or
   * `2:30 PM`; with `seconds`, also the seconds.
   */
  time(wall: Date, seconds?: boolean): string;
  /**
   * The full date of the crosshair label (see `dateFormat`), with the time
   * (and its seconds with `seconds`) unless `dateOnly`. ISO 8601
   * (`2026-10-16 14:30`) while dates do not go through `Intl`.
   */
  dateTime(wall: Date, dateOnly: boolean, seconds?: boolean): string;
  /**
   * True when dates go through `Intl`; false for the built-in English labels,
   * which the axis and crosshair draw themselves.
   */
  readonly intlDates: boolean;
}

/**
 * The crosshair date through `Intl` (#863): an abbreviated month and the whole
 * year, in the locale's order (`Jan 5, 2026`, `5. Jan. 2026`, `2026年1月5日`).
 * The month is named or marked, so no reader swaps day and month as in
 * `03/04`, and the year never loses its century. Not `dateStyle: 'medium'`,
 * which some locales write as digits only (`05.01.2026`, `2026/01/05`).
 */
const DEFAULT_DATE: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
const TIME_FIELDS = ['hour', 'minute', 'second', 'fractionalSecondDigits', 'dayPeriod', 'hour12', 'hourCycle', 'timeStyle'] as const;

const ASCII_DIGITS = '0123456789';

interface NumberSymbols {
  decimal: string;
  minus: string;
  percent: string;
  /** Digit group separator, e.g. `.` in German. */
  group: string;
  /** The locale's digits for 0 to 9; the ASCII ones for Latin numbering. */
  digits: readonly string[];
}

const ASCII_SYMBOLS: NumberSymbols = { decimal: '.', minus: '-', percent: '%', group: ',', digits: [...ASCII_DIGITS] };

/** Invisible direction marks `Intl` puts around signs in right-to-left locales; `number` leaves them out too. */
const BIDI_MARKS = /[\u061c\u200e\u200f]/g;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Decimal mark, minus and percent signs and digits of `locale`, as `Intl` writes them. */
function numberSymbols(locale: string): NumberSymbols {
  const plain = new Intl.NumberFormat(locale, { useGrouping: false });
  const parts = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, useGrouping: false }).formatToParts(-1.5);
  const percent = new Intl.NumberFormat(locale, { style: 'percent' }).formatToParts(0.5);
  const grouped = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(1234567);
  return {
    decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.',
    minus: parts.find((p) => p.type === 'minusSign')?.value ?? '-',
    percent: percent.find((p) => p.type === 'percentSign')?.value ?? '%',
    group: grouped.find((p) => p.type === 'group')?.value ?? ',',
    digits: [...ASCII_DIGITS].map((d) => plain.format(Number(d))),
  };
}

function localeHourCycle(locale: string): 'h12' | 'h23' {
  const cycle = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle;
  return cycle === 'h12' || cycle === 'h11' ? 'h12' : 'h23';
}

function fill(template: string, params: MessageParams | undefined): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

/**
 * Build a {@link Localizer}. Throws a `RangeError` for a locale tag `Intl`
 * does not accept, an empty decimal separator, or a `dateFormat` field
 * `Intl.DateTimeFormat` rejects.
 */
export function createLocalizer(options: LocalizationOptions = {}): Localizer {
  const { locale, decimalSeparator, grouping = false, hourCycle, dateFormat, messages, translate } = options;
  checkLocalization(options);
  const symbols = locale ? numberSymbols(locale) : ASCII_SYMBOLS;
  const decimal = decimalSeparator ?? symbols.decimal;
  const { minus, percent: percentSign, group, digits } = symbols;
  const latin = digits.every((d, i) => d === ASCII_DIGITS[i]);
  const cycle = hourCycle ?? (locale ? localeHourCycle(locale) : 'h23');
  // Built-in English labels unless something asks for `Intl`.
  const intlDates = locale !== undefined || dateFormat !== undefined || cycle === 'h12';
  const intlLocale = locale ?? 'en-US';
  const plain = decimal === '.' && minus === '-' && latin;

  const formatter = dateFormats(intlLocale);
  const dateFields = dateOnly(dateFormat);
  const timeFields: Intl.DateTimeFormatOptions = { hour: cycle === 'h12' ? 'numeric' : '2-digit', minute: '2-digit', hourCycle: cycle };
  const secondFields: Intl.DateTimeFormatOptions = { ...timeFields, second: '2-digit' };
  // Made up front: a bad `dateFormat` field throws here, not in a later frame,
  // and the axis and crosshair labels skip the cache key on every call.
  const dateFormatter = intlDates ? formatter(dateFields) : null;
  const timeFormatter = intlDates ? formatter(timeFields) : null;
  const secondFormatter = intlDates ? formatter(secondFields) : null;
  const monthFormatter = intlDates ? formatter({ month: 'short' }) : null;
  const clock = (seconds: boolean) => (seconds ? (secondFormatter ?? formatter(secondFields)) : (timeFormatter ?? formatter(timeFields)));

  const localize = (text: string) => {
    if (plain) return text;
    let out = '';
    for (const ch of text) {
      const digit = ch >= '0' && ch <= '9' ? digits[ch.charCodeAt(0) - 48] : undefined;
      out += digit ?? (ch === '.' ? decimal : ch === '-' ? minus : ch);
    }
    return out;
  };
  const asciiDigits = (text: string) =>
    latin ? text : digits.reduce((acc, d, i) => acc.split(d).join(ASCII_DIGITS[i]!), text);
  const delocalize = (text: string) => {
    if (plain) return text;
    let out = asciiDigits(text);
    if (minus !== '-') out = out.split(minus).join('-');
    // With the locale's mark present, dots group digits; without it, a dot still reads as a decimal point.
    if (decimal !== '.' && out.includes(decimal)) out = out.split('.').join('').split(decimal).join('.');
    return out;
  };
  // `toFixed` as it is, `-0.00` included, so the English output stays what it was.
  const number = (value: number, decimals: number) => localize(value.toFixed(decimals));

  // Digit grouping of prices (the `grouping` option): `groupDigits` writes ASCII number text with its
  // integer digits in the locale's groups, `ungroup` takes well-formed groups out of typed text.
  let groupDigits: ((text: string) => string) | null = null;
  let ungroup = (text: string) => text;
  // A group mark that reads as the `decimalSeparator` would change the number: no grouping then.
  if (grouping && group !== decimal) {
    // Group sizes as `Intl` writes them: the last group (3) and the ones before it (2 in `en-IN`),
    // and the fewest integer digits that group (5 in Spanish, which writes `1234`).
    const runs = new Intl.NumberFormat(intlLocale).formatToParts(123456789).filter((p) => p.type === 'integer');
    const last = runs[runs.length - 1]?.value.length ?? 3;
    const size = runs.length > 1 ? runs[runs.length - 2]!.value.length : last;
    const fewest = /\D/.test(asciiDigits(new Intl.NumberFormat(intlLocale).format(1000))) ? last + 1 : last + 2;
    groupDigits = (text) => {
      const m = /^(\D*)(\d+)(.*)$/s.exec(text);
      if (!m || m[2]!.length < fewest) return localize(text);
      const digits = m[2]!;
      const parts = [digits.slice(-last)];
      for (let end = digits.length - last; end > 0; end -= size) parts.unshift(digits.slice(Math.max(0, end - size), end));
      return localize(m[1]!) + parts.map(localize).join(group) + localize(m[3]!);
    };
    // A typed space stands for a space-like mark (French writes a narrow no-break space).
    const mark = /\s/.test(group) ? '\\s' : escapeRegExp(group);
    const grouped = new RegExp(`(?<!\\d)\\d{1,${size}}(?:${mark}\\d{${size}})*${mark}\\d{${last}}(?!\\d)`, 'g');
    ungroup = (text) => asciiDigits(text).replace(grouped, (run) => run.replace(/\D/g, ''));
  }

  // Compact amounts in the locale's words and grouping; the built-in `1.25M` without a locale.
  const compactFormat = (fraction: number) =>
    new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: fraction });
  const compactWide = locale ? compactFormat(2) : null;
  const compactWhole = locale ? compactFormat(0) : null;
  const compactText = (parts: Intl.NumberFormatPart[]) =>
    parts
      .map((p) => {
        if (p.type === 'decimal') return decimal;
        // A group mark that reads as the `decimalSeparator` is left out.
        if (p.type === 'group' && p.value === decimal) return '';
        return p.type === 'literal' ? p.value.replace(BIDI_MARKS, '') : p.value;
      })
      .join('');
  const compact = (value: number) => {
    if (!compactWide || !compactWhole || !Number.isFinite(value)) return localize(formatCompact(value));
    const v = value === 0 ? 0 : value; // no `-0`
    let parts = compactWide.formatToParts(v);
    // Like the built-in format: whole numbers from 100 up when there is no suffix.
    if (Math.abs(v) >= 100 && !parts.some((p) => p.type === 'compact')) parts = compactWhole.formatToParts(v);
    return compactText(parts);
  };
  // The locale's suffixes and the power of ten each stands for, longest first; built on first parse.
  let suffixes: [string, number][] | null = null;
  const compactSuffixes = () => {
    if (suffixes) return suffixes;
    const found = new Map<string, number>();
    for (let power = 3; compactWide && power <= 15; power++) {
      // Leads 2 and 5 catch plural forms of a suffix.
      for (const lead of [1, 2, 5]) {
        const parts = compactWide.formatToParts(lead * 10 ** power);
        const suffix = parts.find((p) => p.type === 'compact')?.value.trim();
        if (!suffix || found.has(suffix)) continue;
        const join = (type: string) => parts.filter((p) => p.type === type).map((p) => p.value).join('');
        const fraction = join('fraction');
        const mantissa = Number(asciiDigits(fraction ? `${join('integer')}.${fraction}` : join('integer')));
        if (mantissa > 0) found.set(suffix, 10 ** Math.round(Math.log10((lead * 10 ** power) / mantissa)));
      }
    }
    return (suffixes = [...found].sort((a, b) => b[0].length - a[0].length));
  };
  // A group separator followed by the last three digits, as in German `12.345`.
  const trailingGroup = group !== decimal ? new RegExp(`\\d${escapeRegExp(group)}\\d{3}$`) : null;
  const parseCompactText = (text: string) => {
    let t = text.replace(BIDI_MARKS, '').trim();
    let scale = 1;
    const suffix = compactSuffixes().find(([s]) => t.endsWith(s));
    if (suffix) {
      t = t.slice(0, -suffix[0].length).trim();
      scale = suffix[1];
    }
    t = asciiDigits(t);
    if (trailingGroup && !t.includes(decimal) && trailingGroup.test(t)) t = t.split(group).join('');
    return parseCompact(delocalize(t)) * scale;
  };

  return {
    locale,
    decimalSeparator: decimal,
    minusSign: minus,
    hourCycle: cycle,
    intlDates,
    text(key, params, fallback) {
      const translated = translate?.(key, params ?? {});
      const template =
        translated ?? messages?.[key] ?? fallback ?? (defaultMessages as Record<string, string>)[key] ?? key;
      return fill(template, params);
    },
    number,
    price: (value, decimals) => (groupDigits ? groupDigits(value.toFixed(decimals)) : number(value, decimals)),
    percent: (value, decimals, signed = false) => `${signed && value > 0 ? '+' : ''}${number(value, decimals)}${percentSign}`,
    compact,
    parseCompact: parseCompactText,
    localize,
    delocalize,
    priceFormat(model, custom = false) {
      const grouped = model.unit === undefined ? groupDigits : null;
      if (custom || (plain && !grouped)) return model;
      const write = grouped ?? localize;
      return {
        ...model,
        format: (price) => write(model.format(price)),
        parse: (text) => model.parse(delocalize(grouped ? ungroup(text) : text)),
      };
    },
    date: (wall, fields) => formatter(fields).format(wall),
    monthShort: (wall) => (monthFormatter ?? formatter({ month: 'short' })).format(wall),
    time: (wall, seconds = false) => clock(seconds).format(wall),
    dateTime(wall, dateOnly, seconds = false) {
      if (!dateFormatter) return isoDateTime(wall, dateOnly, seconds);
      const date = dateFormatter.format(wall);
      return dateOnly ? date : `${date} ${clock(seconds).format(wall)}`;
    },
  };
}

/**
 * @internal Throw a `RangeError` for a `localization` option `createLocalizer`
 * rejects: a locale tag `Intl` does not accept, an empty decimal separator, an
 * unknown hour cycle or a `dateFormat` field `Intl.DateTimeFormat` rejects. A
 * chart without the `localization()` plugin checks what it keeps with it.
 */
export function checkLocalization({ locale, decimalSeparator, hourCycle, dateFormat }: LocalizationOptions): void {
  if (locale !== undefined) Intl.getCanonicalLocales(locale);
  if (decimalSeparator !== undefined && !isText(decimalSeparator)) {
    throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'localization.decimalSeparator must be a non-empty string' : '');
  }
  if (hourCycle !== undefined && hourCycle !== 'h12' && hourCycle !== 'h23') {
    throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `localization.hourCycle must be 'h12' or 'h23', got ${String(hourCycle)}` : '');
  }
  if (dateFormat) new Intl.DateTimeFormat(locale ?? 'en-US', { ...dateOnly(dateFormat), timeZone: 'UTC' });
}

/** The date fields of `dateFormat` (default: weekday, day, month and year), its time fields left out. */
function dateOnly(dateFormat: Intl.DateTimeFormatOptions | undefined): Intl.DateTimeFormatOptions {
  const fields: Intl.DateTimeFormatOptions = { ...(dateFormat ?? DEFAULT_DATE) };
  for (const field of TIME_FIELDS) delete (fields as Record<string, unknown>)[field];
  return fields;
}

/** `Intl` formats of wall-clock dates (their UTC fields hold the chart-timezone time) in `locale`, by their fields, made on first use. */
function dateFormats(locale: string): (fields: Intl.DateTimeFormatOptions) => Intl.DateTimeFormat {
  const formats = new Map<string, Intl.DateTimeFormat>();
  return (fields) => {
    const key = JSON.stringify(fields);
    let f = formats.get(key);
    if (!f) formats.set(key, (f = new Intl.DateTimeFormat(locale, { ...fields, timeZone: 'UTC' })));
    return f;
  };
}

/**
 * The built-in English formats: what the chart uses without the
 * `localization()` plugin, and what `createLocalizer()` makes with no options.
 * Built on its own, so a chart that never localizes leaves the `Intl` number
 * and compact code of `createLocalizer` out.
 */
export const englishLocalizer: Localizer = /* @__PURE__ */ (() => {
  const formatter = dateFormats('en-US');
  const timeFields: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  const clock = (seconds: boolean) => formatter(seconds ? { ...timeFields, second: '2-digit' } : timeFields);
  const number = (value: number, decimals: number) => value.toFixed(decimals);
  const same = (text: string) => text;
  return {
    locale: undefined,
    decimalSeparator: '.',
    minusSign: '-',
    hourCycle: 'h23',
    intlDates: false,
    text: (key, params, fallback) => fill(fallback ?? (defaultMessages as Record<string, string>)[key] ?? key, params),
    number,
    price: number,
    percent: (value, decimals, signed = false) => `${signed && value > 0 ? '+' : ''}${number(value, decimals)}%`,
    compact: (value) => formatCompact(value),
    parseCompact(text) {
      const t = text.replace(BIDI_MARKS, '').trim();
      // A comma before the last three digits groups them, as in `12,345`.
      return parseCompact(!t.includes('.') && /\d,\d{3}$/.test(t) ? t.split(',').join('') : t);
    },
    localize: same,
    delocalize: same,
    priceFormat: (model) => model,
    date: (wall, fields) => formatter(fields).format(wall),
    monthShort: (wall) => formatter({ month: 'short' }).format(wall),
    time: (wall, seconds = false) => clock(seconds).format(wall),
    dateTime: isoDateTime,
  };
})();
