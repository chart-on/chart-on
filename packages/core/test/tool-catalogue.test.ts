import { describe, expect, it } from 'vitest';
import { builtinTools } from '../src/drawing/tools';
import { patternTools } from '../src/drawing/pattern-tools';
import type { DrawingToolDef } from '../src/drawing/types';

/**
 * The catalogue's groups from simple to complex, ranked by what a drawing adds
 * to the anchors the user places (see `builtinTools`): nothing beyond the line,
 * a shape or text, lines parallel to the anchors, price levels at ratios of the
 * move, times projected from it, several labelled legs, values computed from the bars.
 */
const GROUPS = ['lines', 'annotate', 'parallels', 'ratios', 'time', 'patterns', 'measure'];

/** Anchors a tool asks for; `'n'` (any number) and `'free'` (a drag) come after every fixed count. */
const anchors = (t: DrawingToolDef) => (typeof t.points === 'number' ? t.points : Infinity);

/** The catalogue rule: group rank, then fewer anchors, then the English label. Tools without a group (eraser, zoom box) go last, in their own order. */
function catalogueOrder(tools: readonly DrawingToolDef[]): string[] {
  const rank = (t: DrawingToolDef) => (t.group === undefined ? GROUPS.length : GROUPS.indexOf(t.group));
  return tools
    .map((t, i) => ({ t, i }))
    .sort((a, b) => rank(a.t) - rank(b.t) || (a.t.group === undefined ? a.i - b.i : anchors(a.t) - anchors(b.t) || a.t.label.localeCompare(b.t.label, 'en')))
    .map(({ t }) => t.type);
}

describe('drawing tool catalogue', () => {
  it('lists each tool once', () => {
    const types = builtinTools.map((t) => t.type);
    expect(new Set(types).size).toBe(types.length);
    expect(new Set(builtinTools.map((t) => t.label)).size).toBe(types.length);
  });

  it('puts every built-in tool with a group in one of the seven', () => {
    for (const t of builtinTools) if (t.group !== undefined) expect(GROUPS).toContain(t.group);
    expect(new Set(builtinTools.map((t) => t.group).filter(Boolean)).size).toBe(GROUPS.length);
  });

  it('orders the built-in tools by group, anchor count and label', () => {
    expect(builtinTools.map((t) => t.type)).toEqual(catalogueOrder(builtinTools));
  });

  it('orders the pattern tools by the same rule', () => {
    expect(patternTools.map((t) => t.type)).toEqual(catalogueOrder(patternTools));
  });

  it('keeps the eraser and zoom box last', () => {
    expect(builtinTools.slice(-2).map((t) => t.type)).toEqual(['eraser', 'zoom-box']);
  });
});
