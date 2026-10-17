import { describe, expect, it } from 'vitest';
import type { IndicatorDef } from '../src/indicators/types';
import { matchRank, searchIndicators } from '../src/indicators/search';
import { matchTiers as matchRanks, withinOneEdit } from '../src/util/text-match';

function def(id: string, extra: Partial<IndicatorDef> = {}): IndicatorDef {
  return {
    id,
    name: id.toUpperCase(),
    placement: 'overlay',
    inputs: [],
    plots: [],
    compute: () => ({}),
    ...extra,
  };
}

const sma = def('sma', { name: 'SMA', category: 'trend', aliases: ['Simple Moving Average', 'MA'], placement: 'either' });
const ema = def('ema', { name: 'EMA', category: 'trend', aliases: ['Exponential Moving Average', 'MA'], placement: 'either' });
const bb = def('bbands', {
  name: 'BB',
  category: 'volatility',
  aliases: ['Bollinger Bands'],
  description: 'Bands a number of standard deviations around an average.',
});
const rsi = def('rsi', { name: 'RSI', category: 'momentum', aliases: ['Relative Strength Index'], placement: 'pane' });
const vwap = def('vwap', { name: 'VWAP', category: 'volume', aliases: ['Volume Weighted Average Price'] });
const custom = def('my-lib/heat', { name: 'Heat', category: 'flow', description: 'Order flow heat.' });
const plain = def('plain', { name: 'Plain' });
const defs = [sma, ema, bb, rsi, vwap, custom, plain];
const ids = (list: readonly IndicatorDef[]) => list.map((d) => d.id);

describe('search ranking', () => {
  it('detects one edit, including a swap of neighbours', () => {
    expect(withinOneEdit('', '')).toBe(true);
    expect(withinOneEdit('rsi', 'rsi')).toBe(true);
    expect(withinOneEdit('rsl', 'rsi')).toBe(true);
    expect(withinOneEdit('vwpa', 'vwap')).toBe(true);
    expect(withinOneEdit('bolinger', 'bollinger')).toBe(true);
    expect(withinOneEdit('bollinnger', 'bollinger')).toBe(true);
    expect(withinOneEdit('rss', 'vwap')).toBe(false);
    expect(withinOneEdit('abcd', 'badc')).toBe(false);
  });

  it('ranks exact, prefix, acronym, word prefix, substring, typo and description matches', () => {
    expect(matchRank(rsi, 'rsi')).toBe(matchRanks.exact);
    expect(matchRank(rsi, 'RS')).toBe(matchRanks.labelPrefix);
    expect(matchRank(bb, 'boll')).toBe(matchRanks.keywordPrefix);
    expect(matchRank(rsi, 'relative')).toBe(matchRanks.keywordPrefix);
    expect(matchRank(bb, 'bba')).toBe(matchRanks.keywordPrefix); // id 'bbands'
    expect(matchRank(vwap, 'vwa')).toBe(matchRanks.labelPrefix);
    expect(matchRank(rsi, 'strength')).toBe(matchRanks.wordPrefix);
    expect(matchRank(vwap, 'weighted av')).toBe(matchRanks.substring);
    expect(matchRank(rsi, 'rsl')).toBe(matchRanks.typo);
    expect(matchRank(bb, 'bolinger')).toBe(matchRanks.typo);
    expect(matchRank(bb, 'deviations')).toBe(matchRanks.description);
    expect(matchRank(rsi, 'macd')).toBeNull();
  });

  it('matches acronyms of multi-word names and aliases', () => {
    const bollinger = def('bollinger', { name: 'Bollinger Bands' });
    expect(matchRank(bollinger, 'bb')).toBe(matchRanks.acronym);
    expect(matchRank(vwap, 'v w a p')).toBe(matchRanks.acronym);
  });

  it('keeps short queries from matching through typos', () => {
    expect(matchRank(rsi, 'rx')).toBeNull();
    expect(matchRank(sma, 'mad')).toBeNull();
  });

  it('does not match a typo against a shorter start of a longer word', () => {
    // "si" of "simple" is one deletion away from "rsi".
    expect(matchRank(sma, 'rsi')).toBeNull();
    expect(ids(searchIndicators(defs, 'rsi'))).toEqual(['rsi']);
    // A whole word one letter shorter still matches.
    expect(matchRank(rsi, 'rsii')).toBe(matchRanks.typo);
  });

  it('orders results best first, keeping registration order on ties', () => {
    expect(ids(searchIndicators(defs, 'ma'))).toEqual(['sma', 'ema']);
    // Word prefixes of "average" in registration order, then the description match.
    expect(ids(searchIndicators(defs, 'av'))).toEqual(['sma', 'ema', 'vwap', 'bbands']);
    expect(ids(searchIndicators(defs, 'bb'))[0]).toBe('bbands');
    expect(ids(searchIndicators(defs, ''))).toEqual(ids(defs));
  });

  it('matches categories below names, aliases and descriptions', () => {
    const named = def('named', { name: 'Trend strength' });
    const described = def('described', { description: 'Trend following' });
    const categorized = def('categorized', { category: '  TREND  ' });
    expect(matchRank(categorized, ' TrEnD ')).toBe(matchRanks.category);
    expect(matchRank(categorized, 'ren')).toBe(matchRanks.category);
    expect(ids(searchIndicators([categorized, described, named], 'trend'))).toEqual(['named', 'described', 'categorized']);
    expect(ids(searchIndicators(defs, 'momentum'))).toEqual(['rsi']);
    expect(ids(searchIndicators(defs, '  '))).toEqual(ids(defs));
  });

  it('matches every query word somewhere above typos', () => {
    expect(matchRank(bb, 'bands standard')).toBe(matchRanks.allWords);
  });

  it('ranks by the shown name, keeping the own name as an alias', () => {
    const avg = def('avg', { name: 'Moving Average' });
    const nameOf = () => 'Gleitender Durchschnitt';
    expect(ids(searchIndicators([avg], 'gleit', { nameOf }))).toEqual(['avg']);
    expect(matchRank(avg, 'moving average', { name: nameOf() })).toBe(matchRanks.exact);
    expect(matchRank(avg, 'gleit')).toBeNull();
  });

  it('ignores malformed metadata', () => {
    const odd = def('odd', {
      aliases: [42 as unknown as string],
      description: 7 as unknown as string,
      category: 42 as unknown as string,
    });
    expect(matchRank(odd, 'odd')).toBe(matchRanks.exact);
    expect(matchRank(odd, '42')).toBeNull();
  });
});
