import { HIT, labelledPolyline, labelSize, LINE_FIELDS, pillHeight, pillWidth, TEXT_FIELDS } from './draw';
import { distToSegment } from './geometry';
import type { DrawingToolDef } from './types';

const styleFields = /* @__PURE__ */ [LINE_FIELDS, 'showLabel', TEXT_FIELDS].flat();

/** Patterns and wave counts differ only in their point labels and count. */
function pattern(type: string, label: string, labels: readonly string[]): DrawingToolDef {
  return {
    type,
    label,
    group: 'patterns',
    points: labels.length,
    styleFields,
    render: (ctx, d, env) => labelledPolyline(ctx, d, env, d.drawing.style.showLabel === false ? [] : labels),
    hitTest: (d, p) => d.points.some((b, i) => i > 0 && distToSegment(p, d.points[i - 1]!, b) <= HIT),
    bounds(d, env) {
      const style = d.drawing.style;
      if (style.showLabel === false || d.points.length === 0) return null;
      let left = Infinity;
      let right = -Infinity;
      let top = Infinity;
      let bottom = -Infinity;
      const padding = labelSize(env, style) + 2 + pillHeight(env, style) / 2;
      d.points.forEach((p, i) => {
        const width = labels[i] ? pillWidth(env, labels[i]!, style) / 2 : 0;
        left = Math.min(left, p.x - width);
        right = Math.max(right, p.x + width);
        top = Math.min(top, p.y - padding);
        bottom = Math.max(bottom, p.y + padding);
      });
      return { x: left, y: top, width: right - left, height: bottom - top };
    },
  };
}

/** The `patterns` group, in the catalogue's order (see `builtinTools`): fewer points first, then by English label. */
export const patternTools: DrawingToolDef[] = [
  /* @__PURE__ */ pattern('elliott-correction', 'Correction wave', ['A', 'B', 'C']),
  /* @__PURE__ */ pattern('elliott-double-combo', 'Double combination wave', ['W', 'X', 'Y']),
  /* @__PURE__ */ pattern('abcd', 'ABCD pattern', ['A', 'B', 'C', 'D']),
  /* @__PURE__ */ pattern('triangle-pattern', 'Triangle pattern', ['A', 'B', 'C', 'D']),
  /* @__PURE__ */ pattern('cypher', 'Cypher pattern', ['X', 'A', 'B', 'C', 'D']),
  /* @__PURE__ */ pattern('elliott-triangle', 'Triangle wave', ['A', 'B', 'C', 'D', 'E']),
  /* @__PURE__ */ pattern('elliott-triple-combo', 'Triple combination wave', ['W', 'X', 'Y', 'X', 'Z']),
  /* @__PURE__ */ pattern('xabcd', 'XABCD pattern', ['X', 'A', 'B', 'C', 'D']),
  /* @__PURE__ */ pattern('elliott-impulse', 'Impulse wave', ['0', '1', '2', '3', '4', '5']),
  /* @__PURE__ */ pattern('head-shoulders', 'Head and shoulders', ['', 'Left shoulder', '', 'Head', '', 'Right shoulder', '']),
  /* @__PURE__ */ pattern('three-drives', 'Three drives', ['0', '1', 'A', '2', 'B', '3', 'C']),
];
