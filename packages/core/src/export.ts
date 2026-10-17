import type { Bar, Time, ValuePoint } from './types';
import { boundByTime } from './util/search';
import { zoneOf, type Zone } from './util/timezone';

/** Tabular chart data: one row per time, first column `time` (unix seconds). Missing values are null. */
export interface DataTable {
  columns: string[];
  rows: (number | null)[][];
}

/** One series' contribution. `label` prefixes OHLCV columns (empty for the main series). */
export type ExportSource =
  | { label: string; kind: 'ohlcv'; data: readonly Bar[] }
  | { label: string; kind: 'value'; data: readonly ValuePoint[] };

function inRange<T extends { time: Time }>(data: readonly T[], from: Time, to: Time): readonly T[] {
  return data.slice(boundByTime(data, from, true), boundByTime(data, to, false));
}

/** A finite number, or null for gaps and NaN/Infinity values. */
function cell(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) ? value : null;
}

/** Make repeated labels unique: `RSI`, `RSI 2`, … */
function uniqueLabels(labels: string[]): string[] {
  const seen = new Map<string, number>();
  return labels.map((label) => {
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    return n === 1 ? label : `${label} ${n}`;
  });
}

/** The source (index into the sources) and field of one column after `time`. */
export interface ExportColumn {
  source: number;
  field: 'open' | 'high' | 'low' | 'close' | 'volume' | 'value';
}

/**
 * Rows for every time any source has in `[from, to]` (inclusive), ascending.
 * OHLCV sources add open/high/low/close columns, plus volume when any bar in
 * range has one; value sources add one column.
 */
export function buildExport(sources: readonly ExportSource[], from: Time, to: Time): DataTable {
  return exportWithColumns(sources, from, to).data;
}

/** `buildExport`, plus where each column after `time` comes from (for per-column formats). */
export function exportWithColumns(
  sources: readonly ExportSource[],
  from: Time,
  to: Time,
): { data: DataTable; fields: ExportColumn[] } {
  const slices = sources.map((s) => ({ ...s, data: inRange<Bar | ValuePoint>(s.data, from, to) }));
  const times = [...new Set(slices.flatMap((s) => s.data.map((d) => d.time)))].sort((a, b) => a - b);

  const rawLabels: string[] = [];
  const fields: ExportColumn[] = [];
  const columnsOf = slices.map((s, source) => {
    if (s.kind === 'value') {
      fields.push({ source, field: 'value' });
      return [s.label];
    }
    const prefix = s.label ? `${s.label} ` : '';
    const names: ExportColumn['field'][] = ['open', 'high', 'low', 'close'];
    if ((s.data as readonly Bar[]).some((b) => b.volume !== undefined)) names.push('volume');
    for (const field of names) fields.push({ source, field });
    return names.map((f) => prefix + f);
  });
  columnsOf.forEach((c) => rawLabels.push(...c));

  const rows = times.map((t) => [t] as (number | null)[]);
  slices.forEach((s, si) => {
    const width = columnsOf[si]!.length;
    let j = 0;
    times.forEach((t, row) => {
      while (j < s.data.length && s.data[j]!.time < t) j++;
      const point = s.data[j]?.time === t ? s.data[j] : undefined;
      if (!point) {
        rows[row]!.push(...new Array<null>(width).fill(null));
      } else if (s.kind === 'value') {
        rows[row]!.push(cell((point as ValuePoint).value));
      } else {
        const b = point as Bar;
        const cells = [b.open, b.high, b.low, b.close].map(cell);
        if (width === 5) cells.push(cell(b.volume));
        rows[row]!.push(...cells);
      }
    });
  });

  return { data: { columns: ['time', ...uniqueLabels(rawLabels)], rows }, fields };
}

/**
 * A text cell. Text a spreadsheet would read as a formula (leading `=`, `+`,
 * `-`, `@`, tab or carriage return) gets a `'` prefix so it opens as plain
 * text: series titles are user-controlled and end up in the header. The
 * result is then quoted when it holds a comma, quote or line break.
 */
function csvCell(value: string): string {
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** How `toCSV` writes the first (`time`) column. */
export interface CsvExportOptions {
  /**
   * `'unix'` (default): unix seconds. `'iso'`: the wall-clock date and time in
   * `timezone` as `YYYY-MM-DD HH:mm:ss`, which spreadsheets read as a date.
   * A function returns the text itself; it is escaped like any text cell.
   */
  time?: 'unix' | 'iso' | ((time: Time) => string);
  /** IANA timezone, or `'local'`, for `time: 'iso'`. Default `'UTC'`. */
  timezone?: string;
}

/** `time` as `YYYY-MM-DD HH:mm:ss` on the wall clock of `zone`. */
export function isoWallTime(time: Time, zone: Zone): string {
  return zone.date(time).toISOString().slice(0, 19).replace('T', ' ');
}

/** The writer of the time column for `options`, or null to write it as a number. */
function timeWriter(options: CsvExportOptions): ((time: Time) => string) | null {
  const { time } = options;
  if (typeof time === 'function') return time;
  if (time !== 'iso') return null;
  const zone = zoneOf(options.timezone ?? 'UTC');
  return (t) => isoWallTime(t, zone);
}

/**
 * CSV text with a header row; null and non-finite cells are left empty.
 * Numeric cells are written as numbers, so negative values are not prefixed.
 * The first column is the time, written as `options.time` says. Throws a
 * RangeError for an unknown `timezone`.
 */
export function toCSV(data: DataTable, options: CsvExportOptions = {}): string {
  const number = (v: number | null | undefined) => (v !== null && v !== undefined && Number.isFinite(v) ? String(v) : '');
  const writeTime = timeWriter(options);
  const lines = [data.columns.map(csvCell).join(',')];
  for (const row of data.rows) {
    const cells = row.map(number);
    const time = row[0];
    if (writeTime && cells.length > 0 && time !== null && time !== undefined && Number.isFinite(time)) cells[0] = csvCell(writeTime(time));
    lines.push(cells.join(','));
  }
  return lines.join('\n');
}
