import { describe, expect, it } from 'vitest';
import { builtinTools } from '../src/drawing/tools';
import page from '../../../docs/guide/drawings.md?raw';

/** Style fields the catalogue leaves out of its rows, because most tools have them. */
const COMMON = new Set(['color', 'lineWidth', 'lineStyle', 'fill', 'textColor', 'fontSize', 'bold', 'italic']);

/**
 * Tool catalogue rows by type: the code-font names in a row's closing parenthesis,
 * after its last `;` when it has one. A row naming several types gives each the same list.
 */
function catalogue(): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  const section = page.split(/^### /m).find((s) => s.startsWith('Tool catalogue')) ?? '';
  for (const m of section.matchAll(/^\| ((?:`[a-z-]+`(?:, )?)+) \| [^|]+ \| (.*) \|$/gm)) {
    const tail = /\(([^()]*)\)$/.exec(m[2]!)?.[1] ?? '';
    const options = [...tail.slice(tail.lastIndexOf(';') + 1).matchAll(/`([A-Za-z]+)`/g)].map((x) => x[1]!);
    for (const t of m[1]!.matchAll(/`([a-z-]+)`/g)) rows.set(t[1]!, options);
  }
  return rows;
}

describe('drawings guide', () => {
  const rows = catalogue();

  it('has a catalogue row for every built-in tool, and no others', () => {
    expect([...rows.keys()].sort()).toEqual(builtinTools.map((t) => t.type).sort());
  });

  it("lists each tool's own style fields in its row, in the tool's order", () => {
    for (const tool of builtinTools) {
      const own = (tool.styleFields ?? []).filter((f) => !COMMON.has(f));
      expect({ type: tool.type, fields: rows.get(tool.type) }).toEqual({ type: tool.type, fields: own });
    }
  });
});
