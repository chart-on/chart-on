import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from './fake-dom';
import type { AccessItem } from '../src/access';
import { Chart, type ChartOptionsPatch } from '../src/chart';
import type { IndicatorDef } from '../src/indicators/types';

const charts: Chart[] = [];
afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

const bars = Array.from({ length: 10 }, (_, i) => ({ time: i * 60, open: 1, high: 2, low: 0, close: 1 + i }));

const def = (id: string): IndicatorDef => ({
  id,
  name: id,
  placement: 'overlay',
  inputs: [],
  plots: [{ id: 'v', type: 'line' }],
  compute: (src) => ({ v: Float64Array.from(src.close) }),
});

function chart(options: ChartOptionsPatch = {}) {
  const c = new Chart(fakeContainer(), options);
  charts.push(c);
  c.addCandles({ title: 'ABC' }).setData(bars);
  for (const id of ['a', 'b', 'c']) c.indicators.register(def(id));
  return c;
}

// The app decides per item; these are the two common rules written as predicates.
const allowOnly = (...ids: string[]) => (item: AccessItem) => ids.includes(item.id);
const denyOnly = (...ids: string[]) => (item: AccessItem) => !ids.includes(item.id);

describe('indicator access rule', () => {
  it('refuses what an allow list leaves out in add() and fires indicator:refuse first', () => {
    const c = chart({ access: { allow: allowOnly('a') } });
    const refused = vi.fn();
    c.on('indicator:refuse', refused);
    expect(() => c.indicators.add('b')).toThrow(/not allowed/);
    expect(refused).toHaveBeenCalledWith({ type: 'b', reason: 'blocked' });
    expect(c.indicators.getAll()).toHaveLength(0);
    expect(c.indicators.add('a').type).toBe('a');
    expect(c.indicators.refusal('b')).toBe('blocked');
    expect(c.indicators.refusal('a')).toBeNull();
  });

  it('refuses what a deny list names, checking a definition object by its id', () => {
    const c = chart({ access: { allow: denyOnly('x') } });
    expect(() => c.indicators.add(def('x'))).toThrow(/not allowed/);
    expect(c.indicators.getDefinitions().some((d) => d.id === 'x')).toBe(false);
    expect(c.indicators.add('a').type).toBe('a');
  });

  it('asks the rule with the kind, so one rule covers tools and indicators', () => {
    const allow = vi.fn((item: AccessItem) => item.kind === 'indicator');
    const c = chart({ access: { allow } });
    expect(c.indicators.isAllowed('a')).toBe(true);
    expect(c.drawings.isToolAllowed('a')).toBe(false);
    expect(allow).toHaveBeenCalledWith({ kind: 'indicator', id: 'a' });
    expect(allow).toHaveBeenCalledWith({ kind: 'drawing', id: 'a' });
  });

  it('lets restricted: false and saved layouts through', () => {
    const c = chart({ access: { allow: () => false } });
    expect(() => c.indicators.add('a', {}, { restricted: false })).not.toThrow();
    c.indicators.load([{ type: 'b' }, { type: 'c' }]);
    expect(c.indicators.getAll().map((i) => i.type)).toEqual(['b', 'c']);
  });

  it('validates setAccess', () => {
    const c = chart();
    expect(() => c.indicators.setAccess(['a'] as unknown as () => boolean)).toThrow(/function or null/);
  });
});

describe('indicator limit', () => {
  it('refuses adds and duplicates past limits.indicators', () => {
    const c = chart({ access: { limits: { indicators: 2 } } });
    const refused = vi.fn();
    c.on('indicator:refuse', refused);
    const first = c.indicators.add('a');
    c.indicators.add('b');
    expect(() => c.indicators.add('c')).toThrow(/limit/);
    expect(() => c.indicators.duplicate(first)).toThrow(/limit/);
    expect(refused).toHaveBeenCalledTimes(2);
    expect(refused).toHaveBeenLastCalledWith({ type: 'a', reason: 'limit' });
    expect(c.indicators.getAll()).toHaveLength(2);
    first.remove();
    expect(() => c.indicators.add('c')).not.toThrow();
  });

  it('counts indicators added with restricted: false, which may pass the cap', () => {
    const c = chart({ access: { limits: { indicators: 1 } } });
    c.indicators.add('a', {}, { restricted: false });
    c.indicators.add('b', {}, { restricted: false });
    expect(c.indicators.refusal('c')).toBe('limit');
  });

  it('changes at runtime, and an empty limits object lifts the cap', () => {
    const c = chart();
    const changes = vi.fn();
    c.on('indicators:access-change', changes);
    c.applyOptions({ access: { limits: { indicators: 0 } } });
    expect(c.indicators.limit).toBe(0);
    expect(changes).toHaveBeenLastCalledWith({ allow: null, limit: 0 });
    expect(() => c.indicators.add('a')).toThrow(/limit/);
    c.applyOptions({ access: { limits: {} } });
    expect(c.indicators.limit).toBeNull();
    expect(() => c.indicators.add('a')).not.toThrow();
    expect(() => c.indicators.setLimit(1.5)).toThrow(/non-negative integer/);
  });
});

describe('access option', () => {
  it('sets the drawing tool rule and fires tool:refuse for refused tools', () => {
    const c = chart({ access: { allow: allowOnly('trendline') } });
    const refused = vi.fn();
    c.on('tool:refuse', refused);
    expect(() => c.drawings.setTool('rectangle')).toThrow(/not allowed/);
    expect(refused).toHaveBeenCalledWith({ tool: 'rectangle' });
    c.drawings.setTool('trendline');
    expect(c.drawings.tool).toBe('trendline');
  });

  it('keeps what the app set in options.access, a patch changing only its fields', () => {
    const allow = allowOnly('a');
    const c = chart({ access: { allow, refused: 'disable' } });
    expect(c.options.access).toEqual({ allow, limits: {}, refused: 'disable' });
    c.applyOptions({ access: { limits: { indicators: 3 } } });
    expect(c.options.access).toEqual({ allow, limits: { indicators: 3 }, refused: 'disable' });
    c.applyOptions({ access: { allow: undefined } });
    expect(c.options.access.allow).toBe(allow);
    c.applyOptions({ access: { allow: null } });
    expect(c.options.access.allow).toBeNull();
    expect(c.indicators.isAllowed('b')).toBe(true);
    expect(c.drawings.isToolAllowed('ray')).toBe(true);
  });

  it('is never saved with a layout', () => {
    const c = chart({ access: { allow: denyOnly('b'), limits: { indicators: 2 }, refused: 'disable' } });
    c.indicators.add('a');
    const text = JSON.stringify(c.serializeLayout());
    expect(text).not.toMatch(/access|allow|limits|refused/);
  });

  it('announces both rules again when only refused changes', () => {
    const c = chart();
    const tools = vi.fn();
    const indicators = vi.fn();
    c.on('access:change', tools);
    c.on('indicators:access-change', indicators);
    c.applyOptions({ access: { refused: 'disable' } });
    expect(c.options.access.refused).toBe('disable');
    expect(tools).toHaveBeenCalledTimes(1);
    expect(indicators).toHaveBeenCalledTimes(1);
    c.applyOptions({ access: { refused: 'disable' } });
    expect(tools).toHaveBeenCalledTimes(1);
  });

  it('keeps a rule set through a manager when only refused changes', () => {
    const c = chart();
    const drawings = vi.fn();
    c.on('access:change', drawings);
    c.drawings.setAccess(denyOnly('ray'));
    c.indicators.setAccess(denyOnly('a'));
    c.applyOptions({ access: { refused: 'disable' } });
    // Announced again, so built-in UI redraws, but with the manager's own rule.
    expect(drawings).toHaveBeenCalledTimes(2);
    expect(c.drawings.isToolAllowed('ray')).toBe(false);
    expect(c.drawings.isToolAllowed('trendline')).toBe(true);
    expect(c.indicators.isAllowed('a')).toBe(false);
    expect(() => c.drawings.setTool('ray')).toThrow(/not allowed/);
    expect(c.options.access.allow).toBeNull();
  });

  it('throws on an invalid patch before changing anything', () => {
    const c = chart();
    expect(() => c.applyOptions({ access: { limits: { indicators: 2 }, refused: 'grey' as 'hide' } })).toThrow(/refused/);
    expect(c.indicators.limit).toBeNull();
    expect(() => c.applyOptions({ access: { allow: ['a'] as unknown as () => boolean } })).toThrow(/function or null/);
    expect(() => c.applyOptions({ access: { limits: null as unknown as {} } })).toThrow(/limits/);
    expect(() => new Chart(fakeContainer(), { access: { limits: { indicators: -1 } } })).toThrow(/limits\.indicators/);
  });
});
