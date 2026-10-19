import type { PriceFormat } from '@chart-on/core';
import type { SymbolSearchFilters, SymbolSearchResult } from '@chart-on/ui';

/** A made-up symbol and the price level its synthetic bars start from. */
export interface DemoSymbol extends SymbolSearchResult {
  price: number;
  priceFormat?: PriceFormat;
}

/** Letter badge standing in for a logo image. */
function badge(letter: string, color: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect width="20" height="20" fill="${color}"/>` +
    `<text x="10" y="14" fill="#fff" font-family="sans-serif" font-size="11" font-weight="700" text-anchor="middle">${letter}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Months of one futures contract, grouped under `root` in the search results. */
function futures(root: string, description: string, price: number, months: [code: string, label: string][]): DemoSymbol[] {
  return months.map(([code, label]) => ({
    symbol: `${root}${code}`,
    name: `${root}${code}`,
    description: `${description} ${label}`,
    type: 'futures',
    exchange: 'Exchange D',
    root,
    price,
    // No minute bars, and months follow the exchange's calendar.
    intervals: ['1h', '4h', '1d', '1w', '1M'],
    timezone: 'America/Chicago',
  }));
}

export const DEMO_SYMBOLS: DemoSymbol[] = [
  { symbol: 'BTCUSD', name: 'BTCUSD', description: 'Bitcoin / US Dollar', type: 'crypto', exchange: 'Exchange A', logo: badge('B', '#e8912d'), price: 68000 },
  {
    symbol: 'MICROUSD',
    name: 'MICROUSD',
    description: 'Micro Token / US Dollar',
    type: 'crypto',
    exchange: 'Exchange A',
    logo: badge('M', '#2d8fe8'),
    price: 0.00000412,
    // Fold the run of zeros so the axis stays narrow and the digits readable.
    priceFormat: { type: 'decimal', precision: 12, zeroFold: {} },
  },
  { symbol: 'DEMOUSD', name: 'DEMOUSD', description: 'Demo Token / US Dollar', type: 'crypto', exchange: 'Exchange A', logo: badge('D', '#8257c9'), price: 24 },
  { symbol: 'USDJPY', name: 'USDJPY', description: 'US Dollar / Japanese Yen', type: 'forex', exchange: 'Exchange B', price: 151 },
  { symbol: 'XAUUSD', name: 'XAUUSD', description: 'Gold / US Dollar', type: 'commodity', exchange: 'Exchange B', price: 2380 },
  { symbol: 'ABC', name: 'ABC', description: 'ABC Industries', type: 'stock', exchange: 'Exchange C', logo: badge('A', '#0f8268'), price: 124 },
  { symbol: 'XYZ', name: 'XYZ', description: 'XYZ Holdings', type: 'stock', exchange: 'Exchange C', logo: badge('X', '#5f43e6'), price: 46 },
  { symbol: 'DEMO', name: 'DEMO', description: 'Demo Corp', type: 'stock', exchange: 'Exchange C', price: 312 },
  { symbol: 'IND50', name: 'IND50', description: 'Sample 50 Index', type: 'index', exchange: 'Exchange C', price: 5210 },
  ...futures('IXF', 'Sample 50 Index Future', 5230, [
    ['Z26', 'Dec 2026'],
    ['H27', 'Mar 2027'],
    ['M27', 'Jun 2027'],
    ['U27', 'Sep 2027'],
  ]),
  ...futures('AUF', 'Gold Future', 2395, [
    ['Z26', 'Dec 2026'],
    ['G27', 'Feb 2027'],
    ['J27', 'Apr 2027'],
  ]),
];

const TYPES = ['crypto', 'forex', 'commodity', 'stock', 'index', 'futures'];
const EXCHANGES = ['Exchange A', 'Exchange B', 'Exchange C', 'Exchange D'];

/** Exchange and type filters for the search dialog; it applies them to the returned symbols. */
export const demoSearchFilters: SymbolSearchFilters = {
  types: TYPES.map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) })),
  exchanges: EXCHANGES.map((value) => ({ value, label: value })),
};

/**
 * Mock symbol search for the demo data source: symbol prefix matches first,
 * after a random delay, so responses can arrive out of order.
 */
export async function searchDemoSymbols(query: string): Promise<DemoSymbol[]> {
  await new Promise((resolve) => setTimeout(resolve, 150 + Math.random() * 250));
  const q = query.trim().toLowerCase();
  const starts = (s: DemoSymbol) => (s.symbol.toLowerCase().startsWith(q) ? 0 : 1);
  return DEMO_SYMBOLS.filter((s) => [s.symbol, s.name, s.description ?? ''].some((text) => text.toLowerCase().includes(q))).sort(
    (a, b) => starts(a) - starts(b),
  );
}
