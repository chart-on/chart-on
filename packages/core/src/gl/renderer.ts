import { RECT_STRIDE, type RectBatch } from './rect-batch';
import { LINE_STRIDE, type LineBatch } from './line-batch';
import type { Slots } from './slots';
import { ChartError } from '../errors';
import type { GpuTimer } from './gpu-timer';
import { PendingRanges } from './pending-ranges';
import type { FrameCounters, GpuMemory } from '../render-stats';
import type { RenderBackend } from './backend';
import type { HeatmapGrid } from './heatmap-grid';
import type { HeatmapUniforms } from './heatmap-program';
import { isDev } from '../util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };

/**
 * Upload bytes an animation frame may spend on batch data, for every chart
 * drawing through the renderer together. A batch whose waiting data fits in
 * what the frame has left uploads in one go; otherwise (a large `setData`, or
 * many series loading at once) the range on screen uploads first and the rest
 * follows in pieces over the next frames. The one exception: a draw always
 * uploads the instances it reads, so bars on screen are never missing, and a
 * frame that shows more data than this that has not arrived yet uploads all
 * of it. That takes at most `plotWidth / minBarSpacing` bars (2,560 for a
 * 1280 px plot at the default 0.5 px, about 180 KB of candles); only an app
 * that lowers `minBarSpacing` far enough to show a fresh large load in full
 * sends it in one frame.
 * Measured for 1M candles (69 MB): 2 MB keeps each frame's upload near 1 ms
 * and finishes in about 35 frames; 4 MB had frames near 8 ms.
 */
export const UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024;

/** Restore requests for a budget context before giving up; the second goes this many ms after the first, each later one after twice the wait. */
const RESTORE_ATTEMPTS = 4;
const RESTORE_RETRY_MS = 500;

/** Why a context was lost: given up for the page's context budget, or taken by the browser. */
export type ContextLossReason = 'budget' | 'browser';

/** What the renderer reports about its GPU context. */
export interface RendererEvents {
  /** The context was lost; nothing draws until it is restored. */
  lost(reason: ContextLossReason): void;
  /** The context is back and set up again; everything must be redrawn. */
  restored(reason: ContextLossReason): void;
  /** The context is back but could not be set up; the renderer stays lost. */
  restoreFailed(error: ChartError): void;
  /** The restore requests went unanswered: the context no longer counts against the budget, so a chart waiting may take it. */
  gaveUp?(): void;
}

const RECT_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_inst;   // index, p0, p1, kind
layout(location = 2) in vec4 a_color;
layout(location = 3) in float a_weight; // body width weight, < 0 = none
uniform vec2 u_x;        // css x = (index - u_origin) * u_x.x + u_x.y
uniform float u_origin;  // index near the view, so the products stay small in float32
uniform vec2 u_y;        // css y = coord(p) * u_y.x + u_y.y
uniform vec2 u_log;      // x: 1 = log10 scale, y: base price added back before the log
uniform vec2 u_viewport; // pane size, device px
uniform float u_dpr;
uniform vec2 u_ratio;    // body ratio, column ratio
uniform vec2 u_weight;   // body width per unit weight (0 = off), narrowest body fraction
uniform float u_stroke;  // wick/tick thickness per bar spacing (0 = one device px)
out vec4 v_color;
out vec2 v_px;
flat out vec3 v_hollow;  // enabled, width, height (device px)

float coord(float p) {
  return u_log.x > 0.5 ? log(max(p + u_log.y, 1e-12)) * 0.4342944819 : p;
}

void main() {
  int kind = int(a_inst.w + 0.5);
  float wick = max(1.0, floor(u_dpr));
  if (u_stroke > 0.0) wick = max(wick, floor(u_x.x * u_dpr * u_stroke));
  float w = wick;
  bool body = kind == 0 || kind == 5;
  if (body || kind == 2) {
    float ratio = body ? u_ratio.x : u_ratio.y;
    w = max(wick, floor(u_x.x * u_dpr * ratio));
    if (body && u_weight.x > 0.0 && a_weight >= 0.0) {
      // Width weights (volume candles): clamp to [min fraction, 1], and stay clearly wider than
      // the wick when the normal body has room (mirrored by volumeBodyWidth in series.ts).
      float scaled = floor(w * clamp(a_weight * u_weight.x, u_weight.y, 1.0));
      w = max(scaled, w >= wick * 3.0 ? wick * 3.0 : wick);
    }
    // Match wick parity so wicks sit exactly in the body center.
    if (mod(w, 2.0) != mod(wick, 2.0)) w = max(wick, w - 1.0);
  }
  float cx = floor(((a_inst.x - u_origin) * u_x.x + u_x.y) * u_dpr);
  float left = cx - floor(w * 0.5);
  float ya = (coord(a_inst.y) * u_y.x + u_y.y) * u_dpr;
  float yb = (coord(a_inst.z) * u_y.x + u_y.y) * u_dpr;
  float top = floor(min(ya, yb) + 0.5);
  float bottom = max(top + 1.0, floor(max(ya, yb) + 0.5));
  if (kind == 3 || kind == 4) {
    // OHLC open (left) / close (right) ticks, one wick thick.
    float wickLeft = cx - floor(wick * 0.5);
    w = max(wick, floor(u_x.x * u_dpr * u_ratio.x * 0.5));
    left = kind == 3 ? wickLeft - w : wickLeft + wick;
    top = floor(ya + 0.5 - wick * 0.5);
    bottom = top + wick;
  }
  vec2 size = vec2(w, bottom - top);
  vec2 pos = vec2(left, top) + a_corner * size;
  gl_Position = vec4(pos.x / u_viewport.x * 2.0 - 1.0, 1.0 - pos.y / u_viewport.y * 2.0, 0.0, 1.0);
  v_color = a_color;
  v_px = a_corner * size;
  v_hollow = vec3(kind == 5 ? wick : 0.0, size);
}`;

const RECT_FS = `#version 300 es
precision mediump float;
in vec4 v_color;
in vec2 v_px;
flat in vec3 v_hollow;
out vec4 outColor;
void main() {
  float b = v_hollow.x;
  if (b > 0.0 && v_hollow.y > b * 3.0 && v_hollow.z > b * 3.0 &&
      v_px.x > b && v_px.x < v_hollow.y - b && v_px.y > b && v_px.y < v_hollow.z - b) discard;
  outColor = vec4(v_color.rgb * v_color.a, v_color.a);
}`;

const SPAN_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_inst;   // x0, p0, p1, x1, relative to a_base
layout(location = 2) in vec4 a_color;
layout(location = 3) in float a_base;  // integer x the span ends are stored from
uniform vec2 u_x;        // css x = (x - u_origin) * u_x.x + u_x.y
uniform float u_origin;  // integer x near the view
uniform vec2 u_y;        // css y = coord(p) * u_y.x + u_y.y
uniform vec2 u_log;      // x: 1 = log10 scale, y: base price added back before the log
uniform vec2 u_viewport; // pane size, device px
uniform float u_dpr;
uniform float u_gap;     // device px kept empty above each span when it is tall enough
out vec4 v_color;

float coord(float p) {
  return u_log.x > 0.5 ? log(max(p + u_log.y, 1e-12)) * 0.4342944819 : p;
}

void main() {
  // x - origin = (x - base) - (origin - base): both integers, so the shift is
  // exact, and the stored ends are small, so their fractions survive float32.
  float shift = a_base - u_origin;
  // Snap edges to device pixels so neighbouring spans share edges exactly.
  float xa = floor(((a_inst.x + shift) * u_x.x + u_x.y) * u_dpr + 0.5);
  float xb = floor(((a_inst.w + shift) * u_x.x + u_x.y) * u_dpr + 0.5);
  float left = min(xa, xb);
  float right = max(max(xa, xb), left + 1.0);
  float ya = (coord(a_inst.y) * u_y.x + u_y.y) * u_dpr;
  float yb = (coord(a_inst.z) * u_y.x + u_y.y) * u_dpr;
  float top = floor(min(ya, yb) + 0.5);
  float bottom = floor(max(ya, yb) + 0.5);
  if (bottom - top > u_gap * 3.0) top += u_gap;
  bottom = max(bottom, top + 1.0);
  vec2 pos = vec2(left, top) + a_corner * vec2(right - left, bottom - top);
  gl_Position = vec4(pos.x / u_viewport.x * 2.0 - 1.0, 1.0 - pos.y / u_viewport.y * 2.0, 0.0, 1.0);
  v_color = a_color;
}`;

const SPAN_FS = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 outColor;
void main() {
  outColor = vec4(v_color.rgb * v_color.a, v_color.a);
}`;

const POINT_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_inst;   // index, price, size, unused
layout(location = 2) in vec4 a_color;
uniform vec2 u_x;        // css x = (index - u_origin) * u_x.x + u_x.y
uniform float u_origin;
uniform vec2 u_y;        // css y = coord(p) * u_y.x + u_y.y
uniform vec2 u_log;      // x: 1 = log10 scale, y: base price added back before the log
uniform vec2 u_viewport; // pane size, device px
uniform float u_dpr;
uniform vec4 u_size;     // default diameter, min, max (css px), mode: 0 sizes are css px, 1 linear, 2 sqrt
uniform vec2 u_domain;   // sizes mapped to min..max
out vec4 v_color;
out vec2 v_local;        // device px from the centre
flat out float v_radius; // device px

float coord(float p) {
  return u_log.x > 0.5 ? log(max(p + u_log.y, 1e-12)) * 0.4342944819 : p;
}

// Mirrored by pointDiameter in points.ts.
float diameter(float size) {
  if (size < 0.0) return u_size.x;
  if (u_size.w < 0.5) return size;
  float t = u_domain.y > u_domain.x ? clamp((size - u_domain.x) / (u_domain.y - u_domain.x), 0.0, 1.0) : 1.0;
  if (u_size.w > 1.5) t = sqrt(t);
  return mix(u_size.y, u_size.z, t);
}

void main() {
  float r = max(diameter(a_inst.z) * u_dpr * 0.5, 0.5);
  vec2 c = vec2(((a_inst.x - u_origin) * u_x.x + u_x.y) * u_dpr, (coord(a_inst.y) * u_y.x + u_y.y) * u_dpr);
  // One device px beyond the marker leaves room for its antialiased edge.
  vec2 local = (a_corner * 2.0 - 1.0) * (r + 1.0);
  vec2 pos = c + local;
  gl_Position = vec4(pos.x / u_viewport.x * 2.0 - 1.0, 1.0 - pos.y / u_viewport.y * 2.0, 0.0, 1.0);
  v_color = a_color;
  v_local = local;
  v_radius = r;
}`;

const POINT_FS = `#version 300 es
precision mediump float;
in vec4 v_color;
in vec2 v_local;
flat in float v_radius;
uniform int u_shape;        // 0 circle, 1 square, 2 diamond
uniform float u_opacity;    // fill opacity
uniform vec4 u_stroke;      // straight-alpha colour
uniform float u_strokeWidth; // device px; 0 = none
out vec4 outColor;

// Signed distance (device px) from the marker's edge, negative inside.
float edge(vec2 p, float r) {
  if (u_shape == 1) {
    vec2 q = abs(p) - r;
    return max(q.x, q.y);
  }
  if (u_shape == 2) return (abs(p.x) + abs(p.y) - r) * 0.7071067812;
  return length(p) - r;
}

void main() {
  float d = edge(v_local, v_radius);
  float cover = clamp(0.5 - d, 0.0, 1.0);
  if (cover <= 0.0) discard;
  vec4 c = vec4(v_color.rgb, v_color.a * u_opacity);
  if (u_strokeWidth > 0.0) c = mix(c, u_stroke, clamp(d + u_strokeWidth + 0.5, 0.0, 1.0));
  outColor = vec4(c.rgb * c.a, c.a) * cover;
}`;

const BOX_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_inst;   // index, p0, p1 (the box's price edges), glyph: 0 X, 1 O, 2 filled
layout(location = 2) in vec4 a_color;
uniform vec2 u_x;        // css x = (index - u_origin) * u_x.x + u_x.y
uniform float u_origin;
uniform vec2 u_y;        // css y = coord(p) * u_y.x + u_y.y
uniform vec2 u_log;      // x: 1 = log10 scale, y: base price added back before the log
uniform vec2 u_viewport; // pane size, device px
uniform float u_dpr;
uniform float u_ratio;   // box width per bar spacing
out vec4 v_color;
out vec2 v_local;        // device px from the box centre
flat out vec2 v_half;    // half the box size, device px
flat out float v_glyph;

float coord(float p) {
  return u_log.x > 0.5 ? log(max(p + u_log.y, 1e-12)) * 0.4342944819 : p;
}

void main() {
  float cx = ((a_inst.x - u_origin) * u_x.x + u_x.y) * u_dpr;
  float ya = (coord(a_inst.y) * u_y.x + u_y.y) * u_dpr;
  float yb = (coord(a_inst.z) * u_y.x + u_y.y) * u_dpr;
  vec2 half_ = vec2(max(abs(u_x.x) * u_ratio * u_dpr * 0.5, 0.5), max(abs(yb - ya) * 0.5, 0.5));
  // One device px beyond the box leaves room for the antialiased edge.
  vec2 local = (a_corner * 2.0 - 1.0) * (half_ + 1.0);
  vec2 pos = vec2(cx, (ya + yb) * 0.5) + local;
  gl_Position = vec4(pos.x / u_viewport.x * 2.0 - 1.0, 1.0 - pos.y / u_viewport.y * 2.0, 0.0, 1.0);
  v_color = a_color;
  v_local = local;
  v_half = half_;
  v_glyph = a_inst.w;
}`;

const BOX_FS = `#version 300 es
// highp: the ellipse distance squares box sizes in device px, past mediump's range on large boxes.
precision highp float;
in vec4 v_color;
in vec2 v_local;
flat in vec2 v_half;
flat in float v_glyph;
uniform float u_dpr;
out vec4 outColor;

// Distance from p to the segment a-b.
float segment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  return length(p - a - ab * t);
}

void main() {
  // The glyph keeps a margin inside its box, so neighbouring boxes stay apart.
  vec2 h = max(v_half - max(u_dpr, min(v_half.x, v_half.y) * 0.15), vec2(0.5));
  // Near square, however wide or tall the box: a flat X or O reads poorly.
  h = min(h, h.yx * 1.25);
  float m = min(h.x, h.y);
  float stroke = clamp(m * 0.16, 0.5 * u_dpr, 1.5 * u_dpr);
  float d;
  if (v_glyph > 1.5) {
    // A filled span: the glyph width, the whole height.
    vec2 q = abs(v_local) - vec2(h.x, v_half.y);
    d = max(q.x, q.y);
  } else if (m < 2.0 * u_dpr) {
    // Too small for a glyph: fill the box.
    vec2 q = abs(v_local) - h;
    d = max(q.x, q.y);
  } else if (v_glyph < 0.5) {
    d = min(segment(v_local, -h, h), segment(v_local, vec2(-h.x, h.y), vec2(h.x, -h.y))) - stroke;
  } else {
    // Distance to the ellipse filling the box, to first order.
    vec2 e = h - stroke;
    float k = length(v_local / e);
    float g = length(v_local / (e * e));
    d = abs(g > 1e-6 ? k * (k - 1.0) / g : -m) - stroke;
  }
  float cover = clamp(0.5 - d, 0.0, 1.0);
  if (cover <= 0.0) discard;
  outColor = vec4(v_color.rgb * v_color.a, v_color.a) * cover;
}`;

const LINE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_prev;     // index, value - base, arc (css px), 1 = point / 0 = break
layout(location = 2) in vec4 a_a;
layout(location = 3) in vec4 a_b;
layout(location = 4) in vec4 a_next;
uniform vec2 u_x;        // css x = (index - u_origin) * u_x.x + u_x.y
uniform float u_origin;
uniform vec2 u_y;        // css y = coord(value) * u_y.x + u_y.y
uniform vec2 u_log;      // x: 1 = log10 scale, y: base value added back before the log
uniform vec2 u_viewport; // pane size, device px
uniform float u_dpr;
uniform float u_half;    // half the line width, device px
flat out vec4 v_ab;      // segment ends a, b (device px)
flat out vec4 v_nb;      // neighbours: the vertex before a, after b
flat out vec4 v_info;    // has the neighbour before, has the one after, arc at a and at b (device px)

float coord(float p) {
  return u_log.x > 0.5 ? log(max(p + u_log.y, 1e-12)) * 0.4342944819 : p;
}

vec2 project(vec4 v) {
  return vec2((v.x - u_origin) * u_x.x + u_x.y, coord(v.y) * u_y.x + u_y.y) * u_dpr;
}

void main() {
  if (a_a.w < 0.5 || a_b.w < 0.5) {
    // A run boundary: every corner at one point, so nothing rasterizes.
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 a = project(a_a);
  vec2 b = project(a_b);
  vec2 d = b - a;
  float len = length(d);
  vec2 t = len > 0.0 ? d / len : vec2(1.0, 0.0);
  vec2 n = vec2(-t.y, t.x);
  // Room for joins, caps and the antialiased edge on every side.
  float ext = u_half + 1.0;
  vec2 pos = mix(a - t * ext, b + t * ext, a_corner.x) + n * ext * (a_corner.y * 2.0 - 1.0);
  gl_Position = vec4(pos.x / u_viewport.x * 2.0 - 1.0, 1.0 - pos.y / u_viewport.y * 2.0, 0.0, 1.0);
  v_ab = vec4(a, b);
  v_nb = vec4(project(a_prev), project(a_next));
  v_info = vec4(a_prev.w, a_next.w, a_a.z * u_dpr, a_b.z * u_dpr);
}`;

const LINE_FS = `#version 300 es
precision highp float;
flat in vec4 v_ab;
flat in vec4 v_nb;
flat in vec4 v_info;
uniform float u_half;
uniform int u_join;      // 0 round, 1 miter
uniform vec2 u_dash;     // on, off (device px); on = 0 is solid
uniform vec4 u_color;    // straight alpha
uniform vec4 u_below;    // colour from u_split down
uniform float u_split;   // device px
uniform vec3 u_pane;     // origin x, origin y (GL window coords), height (device px)
out vec4 outColor;

// Distance from p to segment ab: Euclidean (round joins) or the larger of the
// distances across and beyond it (square ends, which meet as miters at right
// angles). With miter joins, an end that is not 'square' is cut flat at the
// vertex instead (its distance beyond counts a half width more).
float dist(vec2 p, vec2 a, vec2 b, bvec2 square) {
  vec2 d = b - a;
  float len = length(d);
  vec2 t = len > 0.0 ? d / len : vec2(1.0, 0.0);
  vec2 q = p - a;
  float s = dot(q, t);
  float w = abs(dot(q, vec2(-t.y, t.x)));
  if (u_join == 1) {
    float ends = max(square.x ? -s : u_half - s, square.y ? s - len : u_half + s - len);
    return max(w, ends);
  }
  return length(vec2(w, max(max(-s, s - len), 0.0)));
}

// Whether the miter join at x1 stays within a canvas's default miter limit
// (10). Past it, as where a line turns back on itself, a canvas bevels the
// join; that close to a full turn the bevel is the two segments' flat ends.
bool mitred(vec2 x0, vec2 x1, vec2 x2) {
  vec2 d1 = x1 - x0;
  vec2 d2 = x2 - x1;
  float l = length(d1) * length(d2);
  // The miter is 1 / sin(half the angle between the segments) widths long.
  return l <= 0.0 || (1.0 + dot(d1, d2) / l) * 0.5 >= 0.01;
}

// Coverage of p by segment ab, whose arc length at a is arcA: its stroke,
// cut into dashes along it. Past either end the dash state of that end holds,
// so a dash that reaches a vertex carries on through the join.
float coverage(vec2 p, vec2 a, vec2 b, bvec2 square, float arcA) {
  float cover = clamp(u_half + 0.5 - dist(p, a, b, square), 0.0, 1.0);
  if (u_dash.x > 0.0 && cover > 0.0) {
    vec2 d = b - a;
    float len = length(d);
    float s = len > 0.0 ? dot(p - a, d / len) : 0.0;
    float period = u_dash.x + u_dash.y;
    float m = mod(arcA + clamp(s, 0.0, len), period);
    // Signed distance to the nearest dash edge, positive inside a dash.
    float e = m < u_dash.x ? min(m, u_dash.x - m) : -min(m - u_dash.x, period - m);
    cover *= clamp(e + 0.5, 0.0, 1.0);
  }
  return cover;
}

// Whether segment x0-x1 rather than x1-x2 draws p, given the arc length at
// x1. The one covering p more draws it (the later one on ties), so where the
// strokes overlap around x1 the fragment is blended once, as covered as their
// union: a dash of either one shows. Both segments ask with the same
// arguments, so they get the same answer and exactly one of them draws it.
bool firstDraws(vec2 p, vec2 x0, vec2 x1, vec2 x2, float arc1) {
  bool m = mitred(x0, x1, x2);
  return coverage(p, x0, x1, bvec2(true, m), arc1 - length(x1 - x0)) > coverage(p, x1, x2, bvec2(m, true), arc1);
}

void main() {
  // The pixel centre in the pane, top-left origin. Taken from the window
  // position rather than a varying, so neighbouring segments see exactly the
  // same point and agree on which of them draws it.
  vec2 p = vec2(gl_FragCoord.x - u_pane.x, u_pane.z - (gl_FragCoord.y - u_pane.y));
  vec2 a = v_ab.xy;
  vec2 b = v_ab.zw;
  bool before = v_info.x > 0.5;
  bool after = v_info.y > 0.5;
  // Neighbouring segments overlap around their shared vertex; one of them
  // draws each fragment there, so the strokes come out as one line with its join.
  if (before && firstDraws(p, v_nb.xy, a, b, v_info.z)) discard;
  if (after && !firstDraws(p, a, b, v_nb.zw, v_info.w)) discard;
  float cover = coverage(p, a, b, bvec2(!before || mitred(v_nb.xy, a, b), !after || mitred(a, b, v_nb.zw)), v_info.z);
  vec2 d = b - a;
  float len = length(d);
  float s = len > 0.0 ? dot(p - a, d / len) : 0.0;
  // Butt ends where a run starts or stops, as on a canvas.
  if (!before) cover *= clamp(s + 0.5, 0.0, 1.0);
  if (!after) cover *= clamp(len - s + 0.5, 0.0, 1.0);
  if (cover <= 0.0) discard;
  vec4 c = p.y < u_split ? u_color : u_below;
  outColor = vec4(c.rgb * c.a, c.a) * cover;
}`;

// Fills under a line (to a level) or between two lines (a band), one instance
// per segment of a LineBatch, read like LINE_VS reads it. Each instance covers
// the pixel columns from its first end up to its second.
const FILL_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_prev;     // index, value - base, lower value - base (bands), 1 = point / 0 = break
layout(location = 2) in vec4 a_a;
layout(location = 3) in vec4 a_b;
layout(location = 4) in vec4 a_next;
uniform vec2 u_x;        // css x = (index - u_origin) * u_x.x + u_x.y
uniform float u_origin;
uniform vec2 u_y;        // css y = coord(value) * u_y.x + u_y.y
uniform vec2 u_log;      // x: 1 = log10 scale, y: base value added back before the log
uniform vec2 u_viewport; // pane size, device px
uniform float u_dpr;
uniform int u_band;      // 1: fill to each vertex's lower value, 0: to u_level
uniform float u_level;   // device px
flat out vec4 v_ab;      // the line's ends (device px)
flat out vec4 v_cd;      // the other edge's ends
flat out vec2 v_ends;    // has the vertex before, has the one after

float coord(float p) {
  return u_log.x > 0.5 ? log(max(p + u_log.y, 1e-12)) * 0.4342944819 : p;
}

vec2 project(float index, float value) {
  return vec2((index - u_origin) * u_x.x + u_x.y, coord(value) * u_y.x + u_y.y) * u_dpr;
}

void main() {
  vec2 a = project(a_a.x, a_a.y);
  vec2 b = project(a_b.x, a_b.y);
  if (a_a.w < 0.5 || a_b.w < 0.5 || !(b.x > a.x)) {
    // A run boundary, or a vertical segment that covers no column: nothing rasterizes.
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 c = u_band == 1 ? project(a_a.x, a_a.z) : vec2(a.x, u_level);
  vec2 d = u_band == 1 ? project(a_b.x, a_b.z) : vec2(b.x, u_level);
  float top = min(min(a.y, b.y), min(c.y, d.y)) - 1.0;
  float bottom = max(max(a.y, b.y), max(c.y, d.y)) + 1.0;
  // A pixel past either end for the antialiased edge where a run starts or stops.
  vec2 pos = vec2(mix(a.x - 1.0, b.x + 1.0, a_corner.x), mix(top, bottom, a_corner.y));
  gl_Position = vec4(pos.x / u_viewport.x * 2.0 - 1.0, 1.0 - pos.y / u_viewport.y * 2.0, 0.0, 1.0);
  v_ab = vec4(a, b);
  v_cd = vec4(c, d);
  v_ends = vec2(a_prev.w, a_next.w);
}`;

const FILL_FS = `#version 300 es
precision highp float;
flat in vec4 v_ab;
flat in vec4 v_cd;
flat in vec2 v_ends;
uniform vec3 u_pane;     // origin x, origin y (GL window coords), height (device px)
uniform vec4 u_top[2];   // colour at the pane's top and bottom (straight alpha)
uniform vec4 u_bottom[2]; // the same where the line is below u_split
uniform float u_split;   // device px
out vec4 outColor;

// Whether pixel column x lies before the vertex at xv. A segment draws the
// columns from its first end up to, but not including, its second; the next
// segment asks with the same arguments for the vertex they share, so every
// column belongs to exactly one of them: no seam, no double blend.
bool beforeVertex(float x, float xv) {
  return x < xv;
}

// Coverage of p by the side of edge y0-y1 (across the column span x0..x1)
// that holds 'inside', from the distance to the edge across its slope.
float side(vec2 p, float x0, float y0, float x1, float y1, float inside) {
  float slope = (y1 - y0) / (x1 - x0);
  float y = y0 + slope * (p.x - x0);
  return clamp(inside * (p.y - y) * inversesqrt(1.0 + slope * slope) + 0.5, 0.0, 1.0);
}

void main() {
  // The pixel centre in the pane, top-left origin, from the window position
  // so both segments sharing a vertex test exactly the same x.
  vec2 p = vec2(gl_FragCoord.x - u_pane.x, u_pane.z - (gl_FragCoord.y - u_pane.y));
  vec2 a = v_ab.xy;
  vec2 b = v_ab.zw;
  vec2 c = v_cd.xy;
  vec2 d = v_cd.zw;
  float cover = 1.0;
  // Inside a run the columns split exactly between segments; at its ends the
  // edge is antialiased, as a canvas fill's is.
  if (v_ends.x > 0.5) {
    if (beforeVertex(p.x, a.x)) discard;
  } else {
    cover *= clamp(p.x - a.x + 0.5, 0.0, 1.0);
  }
  if (v_ends.y > 0.5) {
    if (!beforeVertex(p.x, b.x)) discard;
  } else {
    cover *= clamp(b.x - p.x + 0.5, 0.0, 1.0);
  }
  float t = clamp((p.x - a.x) / (b.x - a.x), 0.0, 1.0);
  float line = mix(a.y, b.y, t);
  // Between the line and the other edge, whichever is on top here.
  float down = line <= mix(c.y, d.y, t) ? 1.0 : -1.0;
  cover *= side(p, a.x, a.y, b.x, b.y, down) * side(p, c.x, c.y, d.x, d.y, -down);
  if (cover <= 0.0) discard;
  float g = clamp(p.y / u_pane.z, 0.0, 1.0);
  vec4 col = line < u_split ? mix(u_top[0], u_top[1], g) : mix(u_bottom[0], u_bottom[1], g);
  outColor = vec4(col.rgb * col.a, col.a) * cover;
}`;

/**
 * Rebase `x = index * scale + offset` onto an origin index near the view:
 * `x = (index - origin) * scale + offset'`, with `offset'` computed here in
 * double precision. The GPU only works in float32, where the two large,
 * opposite terms of the original form cancel and lose whole pixels at large
 * indices; after rebasing both terms stay small. The origin is the integer
 * index at x = 0, so `index - origin` is exact for integer indices.
 */
export function rebaseX([scale, offset]: readonly [number, number]): { scale: number; offset: number; origin: number } {
  const origin = scale !== 0 ? Math.round(-offset / scale) : 0;
  return Number.isFinite(origin) ? { scale, offset: offset + origin * scale, origin } : { scale, offset, origin: 0 };
}

/**
 * The x transform `[scale, offset]` for timeline indices, applied to the
 * indices a batch stores (`index - indexBase`).
 */
function batchX([scale, offset]: readonly [number, number], batch: RectBatch): [number, number] {
  return [scale, offset + scale * batch.indexBase];
}

/** Pane rectangle in device pixels, top-left origin. */
export interface DeviceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RectUniforms {
  x: [number, number];
  y: [number, number];
  /** [1, base] for a log scale (prices are stored relative to base), else [0, 0]. */
  log: [number, number];
  bodyRatio: number;
  columnRatio: number;
  /**
   * Scale body widths by the per-rect weight: [width per unit weight, narrowest
   * fraction of a normal body]. Omitted or [0, 0] keeps normal widths.
   */
  weight?: [number, number] | undefined;
  /** Wick and tick thickness as a fraction of bar spacing; 0 or omitted = one device pixel. */
  stroke?: number | undefined;
}

export interface SpanUniforms {
  /** css x = x * x[0] + x[1], for the x units the spans were written in. */
  x: [number, number];
  y: [number, number];
  /** [1, base] for a log scale (prices are stored relative to base), else [0, 0]. */
  log: [number, number];
  /** Device px kept empty between stacked rows when they are tall enough. */
  gap: number;
}

/** Marker shape of `drawPoints`. */
export const PointShapeCode = { circle: 0, square: 1, diamond: 2 } as const;

export interface PointUniforms {
  x: [number, number];
  y: [number, number];
  /** [1, base] for a log scale (prices are stored relative to base), else [0, 0]. */
  log: [number, number];
  shape: number;
  /**
   * [default diameter, min, max, mode] in css px. Mode 0: sizes are diameters;
   * 1 and 2: sizes map from `domain` to min..max linearly or by square root.
   */
  size: [number, number, number, number];
  domain: [number, number];
  /** Fill opacity, 0..1. */
  opacity: number;
  /** Stroke colour as straight RGBA, 0..1 each. */
  stroke: [number, number, number, number];
  /** Stroke width, css px; 0 for none. */
  strokeWidth: number;
}

/** How `drawLine` joins segments: round (simple lines) or mitred (steps). */
export type LineJoin = 'round' | 'miter';

/** Glyph of a `drawBoxes` instance, in its kind slot. */
export const BoxGlyph = { x: 0, o: 1, fill: 2 } as const;

export interface BoxUniforms {
  x: [number, number];
  y: [number, number];
  /** [1, base] for a log scale (prices are stored relative to base), else [0, 0]. */
  log: [number, number];
  /** Box width as a fraction of bar spacing. */
  ratio: number;
}

export interface LineUniforms {
  x: [number, number];
  y: [number, number];
  /** [1, base] for a log scale (values are stored relative to base), else [0, 0]. */
  log: [number, number];
  /** Straight RGBA, 0..1 each. */
  color: [number, number, number, number];
  /** Line width, css px. */
  width: number;
  /** Dash [on, off] in css px; [0, 0] for a solid line. Measure the batch with the same period. */
  dash: [number, number];
  join: LineJoin;
  /** Draw below this y (css px) in `below` instead: baseline lines. */
  split?: { y: number; below: [number, number, number, number] } | undefined;
}

/** A colour pair from the pane's top to its bottom, blended down the pane like a canvas gradient: straight RGBA, 0..1 each. */
export type FillGradient = [top: [number, number, number, number], bottom: [number, number, number, number]];

export interface FillUniforms {
  x: [number, number];
  y: [number, number];
  /** [1, base] for a log scale (values are stored relative to base), else [0, 0]. */
  log: [number, number];
  /** Fill from the line to this y (css px), or to each point's lower value in a band (`LineBatch.buildBand`). */
  to: number | 'band';
  gradient: FillGradient;
  /** Where the line is below this y (css px), fill with `below` instead: baseline fills. */
  split?: { y: number; below: FillGradient } | undefined;
}

/** GPU mirror of a `RectBatch` or `LineBatch`. */
interface BufferGpu {
  generation: number;
  vao: WebGLVertexArrayObject;
  buffer: WebGLBuffer;
  capacity: number;
  /** Bytes per instance or vertex. */
  stride: number;
  /** Storage slots not uploaded yet (see `UPLOAD_CHUNK_BYTES`). */
  pending: PendingRanges;
  /** Slot near the range drawn last: the waiting slots closest to it upload first. */
  focus: number;
}

/**
 * @internal GPU objects an extension made for one owner (see `GLRenderer.extension`):
 * `release` hands them back to `free`, unless a context loss took them first.
 */
export interface ExtensionGpu {
  /** The renderer's `generation` when they were made. */
  generation: number;
  free(renderer: GLRenderer): void;
}

/** @internal What `GLRenderer.extension` builds may delete its GL objects when the renderer goes. */
export interface RendererExtension {
  dispose(gl: WebGL2RenderingContext): void;
}

/** Anything whose GPU mirror the renderer keeps in `gpu`: a `RectBatch`, `LineBatch`, or an extension's owner such as a heatmap grid. */
export interface GpuOwner {
  gpu: unknown;
}

/** @internal */
export type Uniforms<K extends string> = Record<K, WebGLUniformLocation | null>;

/** The projection uniforms every program has, and the values they take. */
const PROJECTION = ['u_x', 'u_origin', 'u_y', 'u_log', 'u_viewport', 'u_dpr'] as const;
type ProjectionUniforms = Uniforms<(typeof PROJECTION)[number]>;
/** A linked program and the locations of its uniforms: the projection ones and `K`. */
type Program<K extends string> = [WebGLProgram, Uniforms<K | (typeof PROJECTION)[number]>];
type Projection = { x: readonly [number, number]; y: readonly [number, number]; log: readonly [number, number] };

/** The WebGL2 backend: owns the context, programs and GPU mirrors of batches/grids. */
export class GLRenderer implements RenderBackend {
  readonly gl: WebGL2RenderingContext;
  readonly maxTextureSize: number;
  /** @internal Incremented on context restore; stale GPU handles are rebuilt lazily. */
  generation = 0;
  private lost = false;
  /**
   * Where the context stands with the context budget: `evicting` and
   * `restoring` wait for the browser's lost and restored events.
   */
  private budget: 'held' | 'evicting' | 'evicted' | 'restoring' = 'held';
  /** Fetched up front: a lost context hands out no extensions. */
  readonly #loseExt: WEBGL_lose_context | null;
  /** The next restore request while `restoring` (see `#restoreSoon`). */
  #restoreTimer: ReturnType<typeof setTimeout> | undefined;
  /** @internal Two triangles over the unit square, for instanced and full-pane draws. */
  quad!: WebGLBuffer;
  #rect!: Program<'u_ratio' | 'u_weight' | 'u_stroke'>;
  #span!: Program<'u_gap'>;
  #point!: Program<'u_size' | 'u_domain' | 'u_shape' | 'u_opacity' | 'u_stroke' | 'u_strokeWidth'>;
  #box!: Program<'u_ratio'>;
  #line!: Program<'u_half' | 'u_join' | 'u_dash' | 'u_color' | 'u_below' | 'u_split' | 'u_pane'>;
  #fill!: Program<'u_band' | 'u_level' | 'u_pane' | 'u_top' | 'u_bottom' | 'u_split'>;
  #canvasHeight = 0;
  private pane: DeviceRect = { x: 0, y: 0, width: 0, height: 0 };
  #dpr = 1;
  /** GPU bytes held by live owners; reset when a restored context drops every old handle. */
  #bufferBytes = 0;
  #textureBytes = 0;
  /**
   * Work counters for the current frame. The chart sets them while render
   * statistics are on; null (the default) skips all counting.
   */
  counters: FrameCounters | null = null;
  /** What `extension` built, by its `create` function, with the generation it was built in. */
  readonly #extensions = new Map<unknown, { generation: number; value: unknown }>();
  /** Times the GPU layer while counting: made on first use, null without the extension or `makeTimer`. */
  private timer: GpuTimer | null | undefined;
  /** @internal Makes `timer`; set by charts with the `statsOverlay()` plugin, so GPU timing stays out of other bundles. */
  makeTimer: ((gl: WebGL2RenderingContext) => GpuTimer | null) | undefined;
  /** @internal Set by `primeHeatmap`, so the heatmap program stays out of bundles without heatmaps. */
  heatmap: ((r: GLRenderer, grid: HeatmapGrid, u: HeatmapUniforms) => void) | undefined;
  /** Batches with slots still waiting for their upload, by the client that drew them; `flushUploads` works them off. */
  readonly #uploading = new Map<Slots, unknown>();
  /** Bytes uploaded in the current animation frame, against `UPLOAD_CHUNK_BYTES`. */
  #uploaded = 0;
  /** The animation frame `uploaded` counts for (see `beginFrame`); NaN when unknown. */
  #uploadFrame = NaN;
  /** Who is drawing now (a chart), so a chart's frames only wait for its own uploads. */
  #client: unknown = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly events: RendererEvents,
  ) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new ChartError('webgl2-unavailable', /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'WebGL2 is not available in this browser' : '');
    this.gl = gl;
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    this.#loseExt = gl.getExtension('WEBGL_lose_context');
    canvas.addEventListener('webglcontextlost', this.#handleLost);
    canvas.addEventListener('webglcontextrestored', this.#handleRestored);
    try {
      this.#init();
    } catch (error) {
      // The chart is never created: let the context go now instead of waiting for GC.
      this.destroy();
      this.#loseExt?.loseContext();
      throw error;
    }
  }

  destroy(): void {
    this.canvas.removeEventListener('webglcontextlost', this.#handleLost);
    this.canvas.removeEventListener('webglcontextrestored', this.#handleRestored);
    clearTimeout(this.#restoreTimer);
    // What extensions built in the live context; older generations died with theirs.
    for (const entry of this.#extensions.values()) {
      if (entry.generation === this.generation && !this.isLost) (entry.value as Partial<RendererExtension>).dispose?.(this.gl);
    }
    this.#extensions.clear();
    this.#uploading.clear();
  }

  /** Release the context for good; the renderer is unusable afterwards. */
  loseContext(): void {
    this.#loseExt?.loseContext();
  }

  /** Whether the context is live, or coming back for the budget, so it counts against the budget. */
  get holdsContext(): boolean {
    return this.budget === 'restoring' || (this.budget === 'held' && !this.isLost);
  }

  /**
   * Give the context up for the context budget. Draw state stays on the CPU
   * side; `resume` gets a context back and the restore path rebuilds the rest.
   */
  suspend(): void {
    if (this.budget !== 'held' || this.isLost || !this.#loseExt) return;
    this.budget = 'evicting';
    this.#loseExt.loseContext();
  }

  /** Take a context back after `suspend`. */
  resume(): void {
    if (this.budget !== 'evicting' && this.budget !== 'evicted') return;
    // Before the loss lands there is nothing to restore yet: handleLost asks once it has.
    if (this.budget === 'evicted') this.#restoreSoon(0, RESTORE_ATTEMPTS);
    this.budget = 'restoring';
  }

  /**
   * Ask for the context back in a later task. The browser refuses a restore
   * until the lost event has been handled, so not from inside its handler nor
   * a microtask after it. A refused request shows only as a restored event
   * that never comes, so it asks again, waiting longer each time. Past the
   * last attempt it stops counting against the budget; the next `resume`
   * starts over.
   */
  #restoreSoon(delay: number, attempts: number): void {
    clearTimeout(this.#restoreTimer);
    this.#restoreTimer = setTimeout(() => {
      if (this.budget !== 'restoring' || !this.lost) return;
      if (attempts === 0) {
        this.budget = 'evicted';
        this.events.gaveUp?.();
        return;
      }
      this.#loseExt?.restoreContext();
      this.#restoreSoon(Math.max(delay * 2, RESTORE_RETRY_MS), attempts - 1);
    }, delay);
  }

  #handleLost = (e: Event) => {
    // Without preventDefault the browser never restores the context.
    e.preventDefault();
    this.lost = true;
    // The restored context starts over: each batch uploads in full on its next draw.
    this.#uploading.clear();
    const reason: ContextLossReason = this.budget === 'held' ? 'browser' : 'budget';
    if (this.budget === 'evicting') this.budget = 'evicted';
    this.events.lost(reason);
    // Resumed before the loss landed.
    if (this.budget === 'restoring') this.#restoreSoon(0, RESTORE_ATTEMPTS);
  };

  #handleRestored = () => {
    clearTimeout(this.#restoreTimer);
    const reason: ContextLossReason = this.budget === 'restoring' ? 'budget' : 'browser';
    this.budget = 'held';
    // Every handle from the old context is dead; batches and grids see the new
    // generation and re-create theirs once, on their next draw.
    this.generation++;
    this.#bufferBytes = 0;
    this.#textureBytes = 0;
    this.timer?.dispose(true);
    this.timer = undefined;
    try {
      this.#init();
    } catch (error) {
      this.events.restoreFailed(
        new ChartError('webgl-restore-failed', /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? 'The WebGL context was restored but could not be set up again' : '', { cause: error }),
      );
      return;
    }
    this.lost = false;
    this.events.restored(reason);
  };

  /**
   * Create the programs and shared objects. On failure, deletes whatever it
   * made before rethrowing, since after a restore the context itself lives on.
   */
  #init(): void {
    const made: Array<() => void> = [];
    try {
      this.#setup(made);
    } catch (error) {
      for (const remove of made) remove();
      throw error;
    }
  }

  #setup(made: Array<() => void>): void {
    const gl = this.gl;
    const quad = gl.createBuffer()!;
    made.push(() => gl.deleteBuffer(quad));
    this.quad = quad;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);

    // Each program with the locations of the projection uniforms and of its own `names`.
    const program = <K extends string>(vs: string, fs: string, names: K[]): Program<K> => {
      const p = link(gl, vs, fs);
      made.push(() => gl.deleteProgram(p));
      return [p, locations(gl, p, [...PROJECTION, ...names])];
    };

    this.#rect = program(RECT_VS, RECT_FS, ['u_ratio', 'u_weight', 'u_stroke']);
    this.#span = program(SPAN_VS, SPAN_FS, ['u_gap']);
    this.#point = program(POINT_VS, POINT_FS, ['u_size', 'u_domain', 'u_shape', 'u_opacity', 'u_stroke', 'u_strokeWidth']);
    this.#box = program(BOX_VS, BOX_FS, ['u_ratio']);
    this.#line = program(LINE_VS, LINE_FS, ['u_half', 'u_join', 'u_dash', 'u_color', 'u_below', 'u_split', 'u_pane']);
    this.#fill = program(FILL_VS, FILL_FS, ['u_band', 'u_level', 'u_pane', 'u_top', 'u_bottom', 'u_split']);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
  }

  /**
   * Delete the VAO, buffers and textures mirroring a batch or grid, and forget
   * them. Call it when the owner is dropped; drawing it again re-creates them.
   */
  release(owner: GpuOwner): void {
    const gpu = owner.gpu as BufferGpu | ExtensionGpu | null;
    owner.gpu = null;
    this.#uploading.delete(owner as Slots);
    // Handles from before a context loss died with that context.
    if (!gpu || gpu.generation !== this.generation) return;
    if ('free' in gpu) {
      gpu.free(this);
      return;
    }
    const gl = this.gl;
    gl.deleteVertexArray(gpu.vao);
    gl.deleteBuffer(gpu.buffer);
    this.#bufferBytes -= gpu.capacity * gpu.stride;
  }

  /**
   * @internal What `create` builds for this renderer, such as a series kind's
   * program: made on first use and again after a context restore, when the
   * old one died with its context. `create` is the key, so pass the same
   * function each time. Its `dispose`, if any, runs when the renderer is
   * destroyed with its context still live.
   */
  extension<T extends Partial<RendererExtension>>(create: (renderer: GLRenderer) => T): T {
    const entry = this.#extensions.get(create);
    if (entry && entry.generation === this.generation) return entry.value as T;
    const value = create(this);
    this.#extensions.set(create, { generation: this.generation, value });
    return value;
  }

  /** @internal Add `delta` bytes to the texture memory the live owners hold. */
  trackTextureBytes(delta: number): void {
    this.#textureBytes += delta;
  }

  /** @internal The pane being drawn, in device px with a GL window (bottom-up) y, and the device pixel ratio. */
  get devicePane(): { x: number; glY: number; height: number; dpr: number } {
    const pane = this.pane;
    return { x: pane.x, glY: this.#canvasHeight - pane.y - pane.height, height: pane.height, dpr: this.#dpr };
  }

  /** GPU bytes the live batches and grids hold now. */
  gpuMemory(): GpuMemory {
    return { buffers: this.#bufferBytes, textures: this.#textureBytes, total: this.#bufferBytes + this.#textureBytes };
  }

  get isLost(): boolean {
    return this.lost || this.gl.isContextLost();
  }

  /**
   * Start drawing a frame for `client`. Charts sharing the renderer pass the
   * same `frame` (the animation frame's timestamp) and share one upload
   * budget in it; without one, the frame gets a budget of its own.
   */
  beginFrame(dpr: number, client: unknown = null, frame = NaN): void {
    const gl = this.gl;
    this.#dpr = dpr;
    this.#client = client;
    if (!(frame === this.#uploadFrame)) {
      this.#uploaded = 0;
      this.#uploadFrame = frame;
    }
    this.#canvasHeight = this.canvas.height;
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    if (this.counters) {
      // Without `makeTimer` yet (a frame before the plugins), try again on a later frame.
      if (this.timer === undefined && this.makeTimer) this.timer = this.makeTimer(gl);
      this.timer?.begin();
    }
  }

  /** After the last draw of a frame: stops the GPU timing `beginFrame` started. */
  endFrame(): void {
    this.timer?.end();
  }

  /**
   * GPU milliseconds of the newest timed frame whose result is back, or null.
   * Reads results without waiting for the GPU.
   */
  gpuTime(): number | null {
    return this.timer && !this.isLost ? this.timer.poll() : null;
  }

  /** Stop GPU timing and free its queries, e.g. when statistics are turned off. */
  stopTiming(): void {
    this.timer?.dispose(this.isLost);
    this.timer = undefined;
  }

  drawHeatmap(grid: HeatmapGrid, u: HeatmapUniforms): void {
    this.heatmap?.(this, grid, u);
  }

  setPane(rect: DeviceRect): void {
    const gl = this.gl;
    this.pane = rect;
    const y = this.#canvasHeight - rect.y - rect.height;
    gl.viewport(rect.x, y, rect.width, rect.height);
    gl.scissor(rect.x, y, rect.width, rect.height);
  }

  drawRects(batch: RectBatch, first: number, count: number, u: RectUniforms): void {
    const [program, r] = this.#rect;
    const instances = this.#bindRects(batch, first, count, program, r, u);
    if (instances === null) return;
    const gl = this.gl;
    gl.uniform2f(r.u_ratio, u.bodyRatio, u.columnRatio);
    gl.uniform2f(r.u_weight, u.weight?.[0] ?? 0, u.weight?.[1] ?? 0);
    gl.uniform1f(r.u_stroke, u.stroke ?? 0);
    this.#drawInstances(instances);
  }

  /** Draw horizontal spans written with `RectBatch.setSpan` (volume profile rows); they keep their x base in the weight slot. */
  drawSpans(batch: RectBatch, first: number, count: number, u: SpanUniforms): void {
    const [program, s] = this.#span;
    const instances = this.#bindRects(batch, first, count, program, s, u);
    if (instances === null) return;
    this.gl.uniform1f(s.u_gap, u.gap);
    this.#drawInstances(instances);
  }

  /** Draw point markers written with `RectBatch.setPoint`, one instance each. */
  drawPoints(batch: RectBatch, first: number, count: number, u: PointUniforms): void {
    const [program, p] = this.#point;
    const instances = this.#bindRects(batch, first, count, program, p, u);
    if (instances === null) return;
    const gl = this.gl;
    gl.uniform4f(p.u_size, u.size[0], u.size[1], u.size[2], u.size[3]);
    gl.uniform2f(p.u_domain, u.domain[0], u.domain[1]);
    gl.uniform1i(p.u_shape, u.shape);
    gl.uniform1f(p.u_opacity, u.opacity);
    gl.uniform4f(p.u_stroke, u.stroke[0], u.stroke[1], u.stroke[2], u.stroke[3]);
    gl.uniform1f(p.u_strokeWidth, u.strokeWidth * this.#dpr);
    this.#drawInstances(instances);
  }

  /**
   * Draw point & figure boxes: one instance per box, written with
   * `RectBatch.set` as (index, lower edge, upper edge, `BoxGlyph`), each an X
   * or an O filling its box, or a filled span (`BoxGlyph.fill`).
   */
  drawBoxes(batch: RectBatch, first: number, count: number, u: BoxUniforms): void {
    const [program, b] = this.#box;
    const instances = this.#bindRects(batch, first, count, program, b, u);
    if (instances === null) return;
    this.gl.uniform1f(b.u_ratio, u.ratio);
    this.#drawInstances(instances);
  }

  /**
   * Use `program` on instances [first, first + count) of `batch` and set the
   * projection uniforms `l`; returns the number of instances to draw, or null
   * when there is nothing to draw and nothing was bound.
   */
  #bindRects(batch: RectBatch, first: number, count: number, program: WebGLProgram, l: ProjectionUniforms, u: Projection): number | null {
    if (count <= 0 || batch.count === 0) return null;
    const gl = this.gl;
    const gpu = this.#syncRects(batch, first, count);
    gl.useProgram(program);
    gl.bindVertexArray(gpu.vao);
    // WebGL2 has no base-instance draw; offset the instanced attributes instead.
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.buffer);
    const offset = (batch.head + first) * RECT_STRIDE;
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, RECT_STRIDE, offset);
    // Some programs leave it unused, but it is enabled on the batch VAO, so it still needs a pointer or WebGL rejects the draw.
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, RECT_STRIDE, offset + 16);
    gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, RECT_STRIDE, offset + 20);
    this.#project(l, batchX(u.x, batch), u);
    return Math.min(count, batch.count - first);
  }

  /** Draw `instances` instances of the bound quad, count the draw and unbind. */
  #drawInstances(instances: number): void {
    const gl = this.gl;
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, instances);
    this.countDraw(instances);
    gl.bindVertexArray(null);
  }

  /**
   * Stroke the segments of `batch` between vertices [first, end) (see
   * `LineBatch.vertexRange`): one instance per segment, each reading its ends
   * and their neighbours from the same buffer at offset pointers.
   */
  drawLine(batch: LineBatch, first: number, end: number, u: LineUniforms): void {
    const [program, l] = this.#line;
    const segments = this.#bindSegments(batch, first, end, program);
    if (segments <= 0) return;
    const gl = this.gl;
    const dpr = this.#dpr;
    this.#project(l, u.x, u);
    gl.uniform1f(l.u_half, (u.width * dpr) / 2);
    gl.uniform1i(l.u_join, u.join === 'miter' ? 1 : 0);
    gl.uniform2f(l.u_dash, u.dash[0] * dpr, u.dash[1] * dpr);
    const [r, g, b, a] = u.color;
    gl.uniform4f(l.u_color, r, g, b, a);
    const below = u.split?.below ?? u.color;
    gl.uniform4f(l.u_below, below[0], below[1], below[2], below[3]);
    gl.uniform1f(l.u_split, u.split ? u.split.y * dpr : 1e30);
    gl.uniform3f(l.u_pane, this.pane.x, this.#canvasHeight - this.pane.y - this.pane.height, this.pane.height);
    this.#drawInstances(segments);
  }

  /**
   * Fill under the segments of `batch` between vertices [first, end), down or
   * up to a level, or between its two lines when it was built as a band. Reads
   * the batch as `drawLine` does; each segment fills the pixel columns it spans.
   */
  drawFill(batch: LineBatch, first: number, end: number, u: FillUniforms): void {
    const [program, f] = this.#fill;
    const segments = this.#bindSegments(batch, first, end, program);
    if (segments <= 0) return;
    const gl = this.gl;
    const dpr = this.#dpr;
    this.#project(f, u.x, u);
    gl.uniform1i(f.u_band, u.to === 'band' ? 1 : 0);
    gl.uniform1f(f.u_level, u.to === 'band' ? 0 : u.to * dpr);
    gl.uniform3f(f.u_pane, this.pane.x, this.#canvasHeight - this.pane.y - this.pane.height, this.pane.height);
    gl.uniform4fv(f.u_top, u.gradient.flat());
    gl.uniform4fv(f.u_bottom, (u.split?.below ?? u.gradient).flat());
    gl.uniform1f(f.u_split, u.split ? u.split.y * dpr : 1e30);
    this.#drawInstances(segments);
  }

  /**
   * Use `program` on the segments of `batch` between vertices [first, end):
   * one instance per segment, instance j reading vertices j (before), j + 1
   * and j + 2 (the segment) and j + 3 (after) from the same buffer at offset
   * pointers. Returns the number of segments; 0 binds nothing.
   */
  #bindSegments(batch: LineBatch, first: number, end: number, program: WebGLProgram): number {
    const segments = Math.min(end, batch.count - 1) - first - 1;
    if (segments <= 0 || first < 1) return 0;
    const gl = this.gl;
    // Instance j reads vertices first - 1 + j to first + 2 + j.
    const gpu = this.#syncLines(batch, first - 1, first + segments + 2);
    gl.useProgram(program);
    gl.bindVertexArray(gpu.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.buffer);
    const offset = (batch.head + first - 1) * LINE_STRIDE;
    for (let k = 0; k < 4; k++) gl.vertexAttribPointer(1 + k, 4, gl.FLOAT, false, LINE_STRIDE, offset + k * LINE_STRIDE);
    return segments;
  }

  /** Set the projection uniforms every program shares, for the x transform `x`. */
  #project(l: ProjectionUniforms, x: readonly [number, number], u: Projection): void {
    const gl = this.gl;
    const lx = rebaseX(x);
    gl.uniform2f(l.u_x, lx.scale, lx.offset);
    gl.uniform1f(l.u_origin, lx.origin);
    gl.uniform2f(l.u_y, u.y[0], u.y[1]);
    gl.uniform2f(l.u_log, u.log[0], u.log[1]);
    gl.uniform2f(l.u_viewport, this.pane.width, this.pane.height);
    gl.uniform1f(l.u_dpr, this.#dpr);
  }

  /** @internal Count a draw call of `instances` instances while counting is on. */
  countDraw(instances: number): void {
    const c = this.counters;
    if (!c) return;
    c.drawCalls++;
    c.instances += instances;
  }

  /** @internal Count an upload of `bytes` while counting is on. */
  countUpload(kind: 'buffer' | 'texture', bytes: number): void {
    const c = this.counters;
    if (!c) return;
    if (kind === 'buffer') {
      c.bufferUploads++;
      c.bufferBytes += bytes;
    } else {
      c.textureUploads++;
      c.textureBytes += bytes;
    }
  }

  /** Sync `batch` for a draw of instances [first, first + count). */
  #syncRects(batch: RectBatch, first: number, count: number): BufferGpu {
    const from = batch.head + Math.max(0, first);
    const to = batch.head + Math.min(batch.count, first + count);
    const gpu = this.#syncBuffer(batch, Math.min(batch.count, batch.dirtyTo), from, to, (gl) => {
      for (const loc of [1, 2, 3]) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribDivisor(loc, 1);
      }
    });
    batch.markClean();
    return gpu;
  }

  /** The line's vertices are read four ways: the vertex before, the segment's two ends and the one after. */
  /** Sync `batch` for a draw reading vertices [from, to). */
  #syncLines(batch: LineBatch, from: number, to: number): BufferGpu {
    const head = batch.head;
    const gpu = this.#syncBuffer(batch, Math.min(batch.count, batch.dirtyTo), head + from, head + Math.min(to, batch.count), (gl) => {
      for (let k = 1; k <= 4; k++) {
        gl.enableVertexAttribArray(k);
        gl.vertexAttribDivisor(k, 1);
      }
    });
    batch.markClean();
    return gpu;
  }

  /**
   * Create or refresh the GPU buffer of `batch` for a draw that reads storage
   * slots [needFrom, needTo): a whole upload when its capacity changed, else
   * its dirty range. When more than `UPLOAD_CHUNK_BYTES` waits, only the
   * slots the draw reads upload now and the rest is queued for
   * `flushUploads`. `attributes` sets up the batch's instanced attributes
   * with its buffer bound, when the VAO is made.
   */
  #syncBuffer(
    batch: Slots,
    count: number,
    needFrom: number,
    needTo: number,
    attributes: (gl: WebGL2RenderingContext) => void,
  ): BufferGpu {
    const gl = this.gl;
    let gpu = batch.gpu as BufferGpu | null;
    if (!gpu || gpu.generation !== this.generation) {
      this.release(batch);
      const vao = gl.createVertexArray()!;
      const buffer = gl.createBuffer()!;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      attributes(gl);
      gl.bindVertexArray(null);
      gpu = { generation: this.generation, vao, buffer, capacity: 0, stride: batch.stride, pending: new PendingRanges(), focus: 0 };
      batch.gpu = gpu;
      batch.markAllDirty();
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.buffer);
    // Batches keep headroom in front: item 0 sits at slot `head` of the storage.
    const head = batch.head;
    const storage = batch.storage;
    const pending = gpu.pending;
    if (batch.capacity !== gpu.capacity) {
      this.#bufferBytes += (batch.capacity - gpu.capacity) * gpu.stride;
      gpu.capacity = batch.capacity;
      pending.clear();
      if (storage.byteLength <= UPLOAD_CHUNK_BYTES - this.#uploaded) {
        gl.bufferData(gl.ARRAY_BUFFER, storage, gl.DYNAMIC_DRAW);
        this.#uploaded += storage.byteLength;
        this.countUpload('buffer', storage.byteLength);
      } else {
        // Allocate at full size; the instances follow in pieces (headroom holds nothing to draw).
        gl.bufferData(gl.ARRAY_BUFFER, storage.byteLength, gl.DYNAMIC_DRAW);
        pending.add(head, head + batch.count);
      }
    } else if (batch.dirtyFrom < count) {
      // Only the changed range: appended or prepended instances, or a replaced bar.
      pending.add(head + batch.dirtyFrom, head + count);
    }
    batch.dirtyFrom = Infinity;
    clipPending(gpu, batch);
    if (pending.empty) {
      this.#uploading.delete(batch);
      return gpu;
    }
    if (pending.size * gpu.stride <= UPLOAD_CHUNK_BYTES - this.#uploaded) {
      this.#uploadRanges(gpu, storage, pending.all());
      this.#uploading.delete(batch);
      return gpu;
    }
    // More than this frame has left: what this draw reads now, however much
    // that is, and the rest over the next frames.
    this.#uploadRanges(gpu, storage, pending.take(needFrom, needTo));
    gpu.focus = (needFrom + needTo) >> 1;
    if (pending.empty) this.#uploading.delete(batch);
    else this.#uploading.set(batch, this.#client);
    return gpu;
  }

  /** Upload storage slots given as [from, to) pairs into the bound buffer of `gpu`. */
  #uploadRanges(gpu: BufferGpu, storage: Uint8Array, ranges: number[]): void {
    const gl = this.gl;
    for (let i = 0; i < ranges.length; i += 2) {
      const from = ranges[i]! * gpu.stride;
      const length = Math.min(ranges[i + 1]! * gpu.stride, storage.byteLength) - from;
      if (length <= 0) continue;
      gl.bufferSubData(gl.ARRAY_BUFFER, from, storage, from, length);
      this.#uploaded += length;
      this.countUpload('buffer', length);
    }
  }

  /** @internal Whether batch data is still waiting for `flushUploads`, for any client. */
  get uploadsPending(): boolean {
    return this.#uploading.size > 0 && !this.isLost;
  }

  /**
   * @internal Upload more of the data still waiting in the batches the
   * current client (see `beginFrame`) drew, nearest the view first, until the
   * animation frame's uploads reach `UPLOAD_CHUNK_BYTES`. Call it once per
   * drawn frame, after the draws; returns true while the client's data still
   * waits, so it asks for another frame. Other clients' data waits for their
   * own frames: a hidden chart's uploads keep no other chart drawing.
   */
  flushUploads(): boolean {
    if (this.isLost) {
      this.#uploading.clear();
      return false;
    }
    const gl = this.gl;
    let waiting = false;
    for (const [batch, client] of this.#uploading) {
      if (client !== this.#client) continue;
      const gpu = batch.gpu as BufferGpu | null;
      // Released, from an older context, or reallocated since: its next draw starts over.
      if (!gpu || gpu.generation !== this.generation || gpu.capacity !== batch.capacity) {
        this.#uploading.delete(batch);
        continue;
      }
      clipPending(gpu, batch);
      // Whole instances only, so the frame never goes over.
      const room = () => Math.floor((UPLOAD_CHUNK_BYTES - this.#uploaded) / gpu.stride);
      if (room() > 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, gpu.buffer);
        const storage = batch.storage;
        while (room() > 0) {
          const range = gpu.pending.next(gpu.focus, room());
          if (!range) break;
          this.#uploadRanges(gpu, storage, range);
        }
      }
      if (gpu.pending.empty) this.#uploading.delete(batch);
      else waiting = true;
    }
    return waiting;
  }
}

/**
 * Forget waiting slots outside the batch's instances: dropped from the front
 * (`Slots.growFront` with a negative count) or past its end. They hold
 * nothing to draw; slots that hold instances again are marked dirty and wait anew.
 */
function clipPending(gpu: BufferGpu, batch: Slots): void {
  const head = batch.head;
  gpu.pending.take(0, head);
  gpu.pending.take(head + batch.count, Infinity);
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new ChartError('webgl-shader', /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Shader compile failed: ${log}` : '');
  }
  return shader;
}

/** @internal Compile and link a program. Its shaders are deleted either way; the program only on failure. */
export function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const shaders: WebGLShader[] = [];
  const program = gl.createProgram()!;
  try {
    shaders.push(compile(gl, gl.VERTEX_SHADER, vs));
    shaders.push(compile(gl, gl.FRAGMENT_SHADER, fs));
    for (const shader of shaders) gl.attachShader(program, shader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new ChartError('webgl-shader', /* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `Program link failed: ${gl.getProgramInfoLog(program)}` : '');
    }
  } catch (error) {
    gl.deleteProgram(program);
    throw error;
  } finally {
    // An attached shader is only flagged; it goes when the program does.
    for (const shader of shaders) gl.deleteShader(shader);
  }
  return program;
}

/** @internal Uniform locations of `program` by name. */
export function locations<K extends string>(gl: WebGL2RenderingContext, program: WebGLProgram, names: K[]): Uniforms<K> {
  const out = {} as Uniforms<K>;
  for (const name of names) out[name] = gl.getUniformLocation(program, name);
  return out;
}
