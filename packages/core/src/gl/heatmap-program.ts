import type { HeatmapGrid } from './heatmap-grid';
import { REDUCE_MODES, type CellReduce } from './heatmap-reduce';
import type { RenderBackend } from './backend';
import { GLRenderer, link, locations, rebaseX, type ExtensionGpu, type RendererExtension, type Uniforms } from './renderer';

// The heatmap's GPU side, kept out of `GLRenderer` so charts without heatmaps
// do not carry it. `addHeatmap` primes the renderer (`primeHeatmap`): it hands
// it `drawHeatmap` and builds the program, so a compile failure throws from
// that call; after a context restore it is built again on the next draw.

const HEATMAP_VS = `#version 300 es
layout(location = 0) in vec2 a_corner;
void main() {
  gl_Position = vec4(a_corner * 2.0 - 1.0, 0.0, 1.0);
}`;

// Built twice, with a constant NEAREST added after the first line (see
// heatmapProgram): true for cellReduce 'nearest', so its single read does not
// share a program with the reducing path, which slowed it even behind a
// uniform branch (#846).
const HEATMAP_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D u_values; // R32F, width = rows, height = columns
uniform sampler2D u_levels; // R32F, each column's reduction levels side by side, height = columns
uniform sampler2D u_lut;
uniform vec2 u_x;           // css x = (index - origin) * u_x.x + u_x.y
uniform vec2 u_y;           // css y = coord * u_y.x + u_y.y (coord = price - priceStart, or log10(price))
uniform vec2 u_log;         // x: 1 = log10 scale, y: priceStart
uniform vec3 u_pane;        // origin x, origin y (GL window coords), height (device px)
uniform float u_dpr;
uniform vec4 u_grid;        // first column index relative to the origin, columns, rows, price step
uniform vec2 u_range;       // value min, max
uniform float u_gap;        // gap between cells, device px
uniform float u_opacity;
uniform int u_reduce;       // cells under one pixel: 1 their max, 2 their sum (the one at its centre is NEAREST)
uniform int u_levelCount;   // levels in u_levels; level k combines 4^k rows per texel
out vec4 outColor;

// Texels read per fragment at most; columns past EXACT_COLS per pixel are read evenly spaced.
const int MAX_READS = 64;
const int EXACT_COLS = 8;
const int MAX_LEVELS = 8;

float colAt(float x) {
  return (x - u_x.y) / u_x.x - u_grid.x + 0.5;
}

float rowAt(float y) {
  float coord = (y - u_y.y) / u_y.x;
  float rel = u_log.x > 0.5 ? pow(10.0, coord) - u_log.y : coord;
  return rel / u_grid.w;
}

// Column and row at a window coordinate. Pixel edges are whole numbers, so
// neighbouring pixels compute a shared edge from identical arguments.
float colAtPx(float x) {
  return colAt((x - u_pane.x) / u_dpr);
}

float rowAtPx(float y) {
  return rowAt((u_pane.z - (y - u_pane.y)) / u_dpr);
}

// Cells of one axis this pixel stands for, clamped to [0, n): the cell at the
// centre while cells are at least a pixel, else those whose centres lie in
// the pixel, so each cell counts in exactly one pixel. Mirrored by
// footprintCells in heatmap-reduce.ts.
ivec2 cells(float a, float b, float centre, float n) {
  float lo = min(a, b);
  float hi = max(a, b);
  if (hi - lo <= 1.0) return ivec2(floor(centre));
  return ivec2(max(ceil(lo - 0.5), 0.0), min(ceil(hi - 0.5), n) - 1.0);
}

// Finest level whose texels cover the rows a..b of a pixel in at most
// maxRows reads, keeping four spare for the texels its upper edge can add.
int levelOf(float a, float b, int maxRows) {
  float span = abs(b - a);
  int level = 0;
  for (int k = 0; k < MAX_LEVELS; k++) {
    if (level >= u_levelCount || ceil(span / float(1 << (2 * level))) + 4.0 <= float(maxRows)) break;
    level++;
  }
  return level;
}

// First row past edge e (in rows), rounded up to a multiple of size.
float edgeRow(float e, int level) {
  float size = float(1 << (2 * level));
  return size * ceil(ceil(e - 0.5) / size);
}

// The cells this pixel stands for combined by u_reduce (max or sum);
// discards where there are none. Mirrored by reducePixel.
float reduced(float colF, float rowF) {
  vec2 px = floor(gl_FragCoord.xy);
  float c0 = colAtPx(px.x);
  float c1 = colAtPx(px.x + 1.0);
  float r0 = rowAtPx(px.y);
  float r1 = rowAtPx(px.y + 1.0);
  ivec2 cs = cells(c0, c1, colF, u_grid.y);
  ivec2 rs = cells(r0, r1, rowF, u_grid.z);
  if (cs.x < 0 || cs.y >= int(u_grid.y) || cs.x > cs.y) discard;
  if (rs.x < 0 || rs.y >= int(u_grid.z) || rs.x > rs.y) discard;
  // Rows: the finest level that fits the reads left by the columns. An edge
  // between pixels on different levels rounds up to the coarser texel, so
  // each row counts in exactly one pixel while rows per pixel do not shrink
  // as rows grow (linear and log scales). Mirrored by reducePixel.
  int maxRows = MAX_READS / clamp(int(ceil(abs(c1 - c0))), 1, EXACT_COLS);
  int level = levelOf(r0, r1, maxRows);
  int before = levelOf(rowAtPx(px.y - 1.0), r0, maxRows);
  int after = levelOf(r1, rowAtPx(px.y + 2.0), maxRows);
  int offset = 0;
  if (max(level, max(before, after)) > 0) {
    float e0 = edgeRow(r0, max(level, before));
    float e1 = edgeRow(r1, max(level, after));
    float size = float(1 << (2 * level));
    rs = ivec2(max(min(e0, e1) / size, 0.0), min(max(e0, e1) / size, ceil(u_grid.z / size)) - 1.0);
    if (rs.x > rs.y) discard;
    for (int k = 1; k < MAX_LEVELS; k++) {
      if (k >= level) break;
      offset += int(ceil(u_grid.z / float(1 << (2 * k))));
    }
  }
  int nc = cs.y - cs.x + 1;
  int nr = rs.y - rs.x + 1;
  int stepR = (nr + MAX_READS - 1) / MAX_READS;
  int readR = (nr - 1) / stepR + 1;
  int maxCols = MAX_READS / readR;
  int stepC = (nc + maxCols - 1) / maxCols;
  int readC = (nc - 1) / stepC + 1;
  float v = u_reduce == 2 ? 0.0 : -3.0e38;
  for (int i = 0; i < MAX_READS; i++) {
    if (i >= readC * readR) break;
    int c = cs.x + (i / readR) * stepC;
    int r = rs.x + (i % readR) * stepR;
    float cell = level == 0 ? texelFetch(u_values, ivec2(r, c), 0).r : texelFetch(u_levels, ivec2(offset + r, c), 0).r;
    v = u_reduce == 2 ? v + cell : max(v, cell);
  }
  // A sum over evenly spaced cells stands for all of them.
  return u_reduce == 2 ? v * float(nc * nr) / float(readC * readR) : v;
}

void main() {
  vec2 local = vec2(gl_FragCoord.x - u_pane.x, u_pane.z - (gl_FragCoord.y - u_pane.y)) / u_dpr;
  float colF = colAt(local.x);
  float rowF = rowAt(local.y);
  if (u_gap > 0.0) {
    float cellW = u_x.x * u_dpr;
    float cellH = abs(u_grid.w * u_y.x) * u_dpr;
    if (u_log.x > 0.5) cellH /= max(rowF * u_grid.w + u_log.y, 1e-12) * 2.302585093;
    if (cellW > u_gap * 3.0 && fract(colF) * cellW < u_gap) discard;
    if (cellH > u_gap * 3.0 && (1.0 - fract(rowF)) * cellH < u_gap) discard;
  }
  float v;
  if (NEAREST) {
    // The cell at the pixel centre: one read and none of the footprint and level maths.
    vec2 cell = floor(vec2(colF, rowF));
    if (cell.x < 0.0 || cell.x >= u_grid.y || cell.y < 0.0 || cell.y >= u_grid.z) discard;
    v = texelFetch(u_values, ivec2(cell.y, cell.x), 0).r;
  } else {
    v = reduced(colF, rowF);
  }
  float t = (v - u_range.x) / (u_range.y - u_range.x);
  if (!(t > 0.0)) discard;
  vec4 c = texture(u_lut, vec2(clamp(t, 0.0, 1.0), 0.5));
  float a = c.a * u_opacity;
  outColor = vec4(c.rgb * a, a);
}`;


export interface HeatmapUniforms {
  x: [number, number];
  y: [number, number];
  /** [1, priceStart] for a log scale, else [0, 0]. */
  log: [number, number];
  firstIndex: number;
  min: number;
  max: number;
  gap: number;
  opacity: number;
  /** How the cells under one device pixel combine; see `HeatmapSeriesOptions.cellReduce`. */
  reduce: CellReduce;
  lut: Uint8Array;
}

type HeatmapUniformName =
  | 'u_values'
  | 'u_levels'
  | 'u_lut'
  | 'u_x'
  | 'u_y'
  | 'u_log'
  | 'u_pane'
  | 'u_dpr'
  | 'u_grid'
  | 'u_range'
  | 'u_gap'
  | 'u_opacity'
  | 'u_reduce'
  | 'u_levelCount';

/** One heatmap program and its uniform locations. */
interface HeatmapVariant {
  program: WebGLProgram;
  u: Uniforms<HeatmapUniformName>;
}

/** The heatmap programs of one renderer and context, sharing one full-pane quad. */
interface HeatmapProgram extends RendererExtension {
  /** For `'max'` and `'sum'`, and for `'nearest'`. */
  variants: [HeatmapVariant, HeatmapVariant];
  vao: WebGLVertexArrayObject;
}

/** A grid's textures; `release` frees them. */
interface HeatmapGpu extends ExtensionGpu {
  values: WebGLTexture;
  /** The grid's reduction levels, same layout: one row per column. */
  levels: WebGLTexture;
  lut: WebGLTexture;
  layoutVersion: number;
  lutSource: Uint8Array | null;
  /** Bytes of the value and level textures plus the colour ramp, for memory accounting. */
  bytes: number;
}

/** Build the heatmap programs and their full-pane quad; passed to `renderer.extension`. */
function heatmapProgram(r: GLRenderer): HeatmapProgram {
  const gl = r.gl;
  const made: WebGLProgram[] = [];
  const vao = gl.createVertexArray()!;
  const dispose = (g: WebGL2RenderingContext) => {
    g.deleteVertexArray(vao);
    for (const program of made) g.deleteProgram(program);
  };
  const build = (nearest: boolean) => {
    const program = link(gl, HEATMAP_VS, HEATMAP_FS.replace('\n', `\nconst bool NEAREST = ${nearest};\n`));
    made.push(program);
    const u = locations<HeatmapUniformName>(gl, program, [
      'u_values', 'u_levels', 'u_lut', 'u_x', 'u_y', 'u_log', 'u_pane', 'u_dpr', 'u_grid', 'u_range', 'u_gap', 'u_opacity',
      'u_reduce', 'u_levelCount',
    ]);
    return { program, u };
  };
  try {
    const variants: HeatmapProgram['variants'] = [build(false), build(true)];
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, r.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return { variants, vao, dispose };
  } catch (error) {
    dispose(gl);
    throw error;
  }
}

/**
 * Teach a WebGL2 renderer to draw heatmaps, and build the program now (once per
 * renderer and context), so a shader failure throws here and not in a frame.
 */
export function primeHeatmap(r: RenderBackend): void {
  // Another backend would bring its own heatmap program.
  if (!(r instanceof GLRenderer)) return;
  r.heatmap = drawHeatmap;
  if (!r.isLost) r.extension(heatmapProgram);
}

/** Draw `grid` into the renderer's current pane. */
function drawHeatmap(r: GLRenderer, grid: HeatmapGrid, u: HeatmapUniforms): void {
  if (grid.cols === 0) return;
  const gl = r.gl;
  const { variants, vao } = r.extension(heatmapProgram);
  const { program, u: loc } = variants[u.reduce === 'nearest' ? 1 : 0];
  const gpu = syncHeatmap(r, grid, u.lut);
  gl.useProgram(program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, gpu.values);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, gpu.lut);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, gpu.levels);
  gl.activeTexture(gl.TEXTURE0);
  const pane = r.devicePane;
  gl.uniform1i(loc.u_values, 0);
  gl.uniform1i(loc.u_lut, 1);
  gl.uniform1i(loc.u_levels, 2);
  const hx = rebaseX(u.x);
  gl.uniform2f(loc.u_x, hx.scale, hx.offset);
  gl.uniform2f(loc.u_y, u.y[0], u.y[1]);
  gl.uniform2f(loc.u_log, u.log[0], u.log[1]);
  gl.uniform3f(loc.u_pane, pane.x, pane.glY, pane.height);
  gl.uniform1f(loc.u_dpr, pane.dpr);
  gl.uniform4f(loc.u_grid, u.firstIndex - hx.origin, grid.cols, grid.rows, grid.priceStep);
  gl.uniform2f(loc.u_range, u.min, u.max);
  gl.uniform1f(loc.u_gap, u.gap);
  gl.uniform1f(loc.u_opacity, u.opacity);
  gl.uniform1i(loc.u_reduce, REDUCE_MODES[u.reduce]);
  gl.uniform1i(loc.u_levelCount, grid.levelCount);
  gl.bindVertexArray(vao);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  r.countDraw(1);
  gl.bindVertexArray(null);
}

function syncHeatmap(r: GLRenderer, grid: HeatmapGrid, lut: Uint8Array): HeatmapGpu {
  const gl = r.gl;
  let gpu = grid.gpu as HeatmapGpu | null;
  if (!gpu || gpu.generation !== r.generation) {
    r.release(grid);
    const made: HeatmapGpu = {
      generation: r.generation,
      values: createTexture(gl, gl.NEAREST),
      levels: createTexture(gl, gl.NEAREST),
      lut: createTexture(gl, gl.LINEAR),
      layoutVersion: -1,
      lutSource: null,
      bytes: 0,
      free: (renderer) => {
        const g = renderer.gl;
        g.deleteTexture(made.values);
        g.deleteTexture(made.levels);
        g.deleteTexture(made.lut);
        renderer.trackTextureBytes(-made.bytes);
      },
    };
    gpu = made;
    grid.gpu = gpu;
  }
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  const full = gpu.layoutVersion !== grid.layoutVersion;
  syncColumns(r, gpu.values, grid.values, grid.rows, grid, full);
  syncColumns(r, gpu.levels, grid.levels, grid.levelWidth, grid, full);
  if (full) {
    gpu.layoutVersion = grid.layoutVersion;
    resizeTexture(r, gpu, grid.values.byteLength + grid.levels.byteLength, gpu.lutSource?.byteLength ?? 0);
  }
  grid.dirtyFrom = Infinity;
  if (gpu.lutSource !== lut) {
    gl.bindTexture(gl.TEXTURE_2D, gpu.lut);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, lut.length / 4, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut);
    resizeTexture(r, gpu, gpu.bytes - (gpu.lutSource?.byteLength ?? 0), lut.byteLength);
    gpu.lutSource = lut;
    r.countUpload('texture', lut.byteLength);
  }
  return gpu;
}

/**
 * Upload a heatmap texture holding `width` texels per column (one texture
 * row each): all of `data` when `full`, else the columns from `dirtyFrom`.
 * With no texels it holds one placeholder texel, so its sampler is never
 * bound to an empty texture.
 */
function syncColumns(r: GLRenderer, texture: WebGLTexture, data: Float32Array, width: number, grid: HeatmapGrid, full: boolean): void {
  const gl = r.gl;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  if (full && width === 0) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 1, 1, 0, gl.RED, gl.FLOAT, PLACEHOLDER_TEXEL);
  } else if (full) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, grid.capacity, 0, gl.RED, gl.FLOAT, data);
    r.countUpload('texture', data.byteLength);
  } else if (grid.dirtyFrom < grid.cols && width > 0) {
    const from = grid.dirtyFrom;
    const part = data.subarray(from * width, grid.cols * width);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, from, width, grid.cols - from, gl.RED, gl.FLOAT, part);
    r.countUpload('texture', part.byteLength);
  }
}

/** Record a heatmap's new texture sizes: its value and level textures and colour ramp, in bytes. */
function resizeTexture(r: GLRenderer, gpu: HeatmapGpu, values: number, lut: number): void {
  r.trackTextureBytes(values + lut - gpu.bytes);
  gpu.bytes = values + lut;
}

const PLACEHOLDER_TEXEL = new Float32Array(1);

function createTexture(gl: WebGL2RenderingContext, filter: number): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}
