import { describe, expect, it } from 'vitest';
import { buildExport, toCSV, type ExportSource } from '../src/export';
import type { Bar, ValuePoint } from '../src/types';

const bars: Bar[] = [0, 60, 120, 180].map((time, i) => ({
  time,
  open: 10 + i,
  high: 12 + i,
  low: 9 + i,
  close: 11 + i,
  volume: 100 * (i + 1),
}));
const rsi: ValuePoint[] = [
  { time: 60, value: 40 },
  { time: 180, value: 60 },
];

describe('buildExport', () => {
  it('includes both range ends and orders rows by time', () => {
    const out = buildExport([{ label: '', kind: 'ohlcv', data: bars }], 60, 120);
    expect(out.columns).toEqual(['time', 'open', 'high', 'low', 'close', 'volume']);
    expect(out.rows).toEqual([
      [60, 11, 13, 10, 12, 200],
      [120, 12, 14, 11, 13, 300],
    ]);
  });

  it('returns no rows for a range outside the data', () => {
    expect(buildExport([{ label: '', kind: 'ohlcv', data: bars }], 500, 900).rows).toEqual([]);
    expect(buildExport([{ label: '', kind: 'ohlcv', data: bars }], 120, 60).rows).toEqual([]);
  });

  it('aligns series by time and leaves gaps as null', () => {
    const out = buildExport(
      [
        { label: '', kind: 'ohlcv', data: bars },
        { label: 'RSI', kind: 'value', data: rsi },
      ],
      0,
      180,
    );
    expect(out.columns.at(-1)).toBe('RSI');
    expect(out.rows.map((r) => r.at(-1))).toEqual([null, 40, null, 60]);
  });

  it('covers times only some sources have', () => {
    const extra: ValuePoint[] = [{ time: 240, value: 1 }];
    const out = buildExport(
      [
        { label: '', kind: 'ohlcv', data: bars },
        { label: 'Extra', kind: 'value', data: extra },
      ],
      180,
      240,
    );
    expect(out.rows).toEqual([
      [180, 13, 15, 12, 14, 400, null],
      [240, null, null, null, null, null, 1],
    ]);
  });

  it('prefixes extra OHLCV sources, omits volume when absent and dedupes labels', () => {
    const noVolume = bars.map(({ volume: _volume, ...b }) => b);
    const sources: ExportSource[] = [
      { label: 'ETH', kind: 'ohlcv', data: noVolume },
      { label: 'MA', kind: 'value', data: rsi },
      { label: 'MA', kind: 'value', data: rsi },
    ];
    expect(buildExport(sources, 0, 180).columns).toEqual([
      'time',
      'ETH open',
      'ETH high',
      'ETH low',
      'ETH close',
      'MA',
      'MA 2',
    ]);
  });
});

describe('non-finite values', () => {
  it('become null cells and empty CSV fields', () => {
    const out = buildExport([{ label: 'X', kind: 'value', data: [{ time: 0, value: NaN }] }], 0, 0);
    expect(out.rows).toEqual([[0, null]]);
    expect(toCSV({ columns: ['time', 'X'], rows: [[0, Infinity]] })).toBe('time,X\n0,');
  });
});

describe('toCSV', () => {
  it('writes a header, empty cells for null and quotes awkward labels', () => {
    const csv = toCSV({ columns: ['time', 'Close, adj', 'Say "hi"'], rows: [[60, 1.5, null]] });
    expect(csv).toBe('time,"Close, adj","Say ""hi"""\n60,1.5,');
  });

  it.each([
    ['=HYPERLINK("x")', `"'=HYPERLINK(""x"")"`],
    ['+1', "'+1"],
    ['-1', "'-1"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tcmd', "'\tcmd"],
    ['\rcmd', `"'\rcmd"`],
  ])('prefixes formula-like text %j with a quote mark', (title, expected) => {
    expect(toCSV({ columns: ['time', title], rows: [] })).toBe(`time,${expected}`);
  });

  it('prefixes before quoting, so the mark sits inside the quotes', () => {
    expect(toCSV({ columns: ['=1,2'], rows: [] })).toBe(`"'=1,2"`);
    expect(toCSV({ columns: ['@a\nb'], rows: [] })).toBe(`"'@a\nb"`);
  });

  it('leaves safe text alone, including a trigger character past the start', () => {
    expect(toCSV({ columns: ['MA 1+2', 'a=b', 'RSI -1'], rows: [] })).toBe('MA 1+2,a=b,RSI -1');
  });

  it('writes negative numbers unprefixed', () => {
    expect(toCSV({ columns: ['time', 'X'], rows: [[60, -1.5]] })).toBe('time,X\n60,-1.5');
  });

  it('neutralises formula titles that reach the header through buildExport', () => {
    const out = buildExport([{ label: '=cmd', kind: 'value', data: rsi }], 0, 180);
    expect(toCSV(out).split('\n')[0]).toBe("time,'=cmd");
  });
});

describe('toCSV time column', () => {
  // 2024-03-09 14:30:00 UTC, the day before New York moves its clocks forward.
  const t = Date.UTC(2024, 2, 9, 14, 30) / 1000;
  const data = { columns: ['time', 'close'], rows: [[t, 1.5], [t + 86400, -2]] };

  it('writes unix seconds by default and with time: unix', () => {
    expect(toCSV(data)).toBe(`time,close\n${t},1.5\n${t + 86400},-2`);
    expect(toCSV(data, { time: 'unix', timezone: 'Asia/Tokyo' })).toBe(toCSV(data));
  });

  it('writes ISO dates and times a spreadsheet reads, in UTC by default', () => {
    expect(toCSV(data, { time: 'iso' })).toBe('time,close\n2024-03-09 14:30:00,1.5\n2024-03-10 14:30:00,-2');
  });

  it('writes the wall clock of the timezone, across a clock change', () => {
    expect(toCSV(data, { time: 'iso', timezone: 'America/New_York' }).split('\n').slice(1)).toEqual([
      '2024-03-09 09:30:00,1.5',
      '2024-03-10 10:30:00,-2',
    ]);
  });

  it('takes a formatter, whose text still gets the formula escaping', () => {
    expect(toCSV(data, { time: (time) => `day ${time / 86400}` }).split('\n')[1]).toBe(`day ${t / 86400},1.5`);
    expect(toCSV(data, { time: () => '=cmd()' }).split('\n')[1]).toBe("'=cmd(),1.5");
    expect(toCSV(data, { time: () => '+1, 2' }).split('\n')[1]).toBe(`"'+1, 2",1.5`);
  });

  it('leaves an empty time cell empty and throws for an unknown timezone', () => {
    expect(toCSV({ columns: ['time', 'x'], rows: [[null, 1]] }, { time: 'iso' })).toBe('time,x\n,1');
    expect(() => toCSV(data, { time: 'iso', timezone: 'Not/AZone' })).toThrow(RangeError);
  });
});
