/**
 * GPU time of the heatmap per `cellReduce` mode, on this machine's GPU. Not part of
 * the test suite: run it by hand with `node e2e/heatmap-page/bench.ts` (Node 23.6 or
 * later runs TypeScript directly). It builds and serves the heatmap page on port 4184,
 * unless something already serves it there (such as the same page built from another
 * checkout, to compare versions), opens the `bench` scene in Chromium on the hardware
 * renderer (new headless mode, or `--headed`) and pans the grid by sub-pixel steps
 * every frame. The page times each frame with its own GPU timer query
 * (`EXT_disjoint_timer_query_webgl2`) and drops frames the chart did not draw in.
 * Prints the median and 95th percentile per case and mode as Markdown.
 *
 * Options: `--frames=240`, `--dpr=2`, `--headed`, and `--gl=<backend>`, passed to
 * Chromium as `--use-angle=<backend>` to pick the GL backend under WebGL. Without it
 * Chromium picks one; pass the platform's native backend to measure on that.
 */
import { chromium } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cpus, platform, release } from 'node:os';
import type { BenchFrame, HeatmapPage } from './main';

/** HEATMAP_PAGE_PORT in vite.config.ts, which Node cannot import without its extension. */
const PORT = 4184;

const arg = (name: string, fallback: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const FRAMES = Number(arg('frames', '240'));
const WARMUP = 30;
const DPR = Number(arg('dpr', '2'));
const GL = arg('gl', '');
const HEADED = process.argv.includes('--headed');
const MODES = ['nearest', 'max', 'sum'] as const;
const GIB = 2 ** 30;

/**
 * Zoomed out in a short pane, as the issue asks, then deeper and further out: up to 64
 * texel reads a pixel, the column cap (8 a pixel) and rows read from a reduction level.
 */
const CASES = [
  { name: 'zoomed out, short pane: 2 cols × 4 rows a px (8 reads)', query: { colsPerPx: 2, rowsPerPx: 4, rows: 2000, width: 1600, height: 300 } },
  { name: 'deep book, short pane: 2 cols × 12 rows a px (24 reads)', query: { colsPerPx: 2, rowsPerPx: 12, rows: 8000, width: 1600, height: 300, memoryBudget: GIB } },
  { name: 'far out: 8 cols × 4 rows a px (32 reads)', query: { colsPerPx: 8, rowsPerPx: 4, rows: 2000, width: 800, height: 300, memoryBudget: GIB } },
  { name: 'far out, deep book: 8 cols × 16 rows a px (rows from level 1, up to 64 reads)', query: { colsPerPx: 8, rowsPerPx: 16, rows: 9000, width: 400, height: 300, memoryBudget: GIB } },
];

const root = fileURLToPath(new URL('../..', import.meta.url));
const url = `http://localhost:${PORT}`;

async function reachable(): Promise<boolean> {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

/** Build and preview the page unless something already serves it. */
async function serve(): Promise<ChildProcess | null> {
  if (await reachable()) return null;
  const config = 'e2e/heatmap-page/vite.config.ts';
  const child = spawn('sh', ['-c', `pnpm exec vite build --config ${config} && pnpm exec vite preview --config ${config}`], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'], detached: true });
  for (let i = 0; i < 600 && !(await reachable()); i++) await new Promise((r) => setTimeout(r, 200));
  if (!(await reachable())) throw new Error(`The heatmap page did not come up on ${url}`);
  return child;
}

function stats(values: number[]): { median: number; p95: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? NaN;
  return { median: at(0.5), p95: at(0.95) };
}

const ms = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : 'n/a');

async function main(): Promise<void> {
  const server = await serve();
  const args = ['--enable-gpu', '--ignore-gpu-blocklist', ...(GL ? [`--use-angle=${GL}`] : [])];
  // The `chromium` channel is the full browser, whose new headless mode keeps the GPU.
  const browser = await chromium.launch({ channel: 'chromium', headless: !HEADED, args });
  const lines: string[] = [];
  let renderer = '';
  let dropped = 0;
  try {
    for (const c of CASES) {
      lines.push(`\n**${c.name}**\n`, '| mode | GPU ms median | GPU ms p95 | frame CPU ms median | frame interval ms median | grid |', '| --- | --- | --- | --- | --- | --- |');
      for (const mode of MODES) {
        const page = await browser.newPage({ viewport: { width: c.query.width, height: c.query.height + 20 }, deviceScaleFactor: DPR });
        const query = new URLSearchParams({ scene: 'bench', reduce: mode, ...Object.fromEntries(Object.entries(c.query).map(([k, v]) => [k, String(v)])) });
        await page.goto(`${url}/?${query}`);
        await page.locator('html[data-done]').waitFor();
        const result = await page.evaluate((n) => (window as unknown as { heatmapPage: HeatmapPage }).heatmapPage.bench!(n), FRAMES + WARMUP);
        await page.close();
        renderer = result.renderer;
        if (result.glError !== 0) throw new Error(`GL error ${result.glError} in ${c.name}, ${mode}`);
        if (result.frames.length < FRAMES + WARMUP) throw new Error(`Only ${result.frames.length} of ${FRAMES + WARMUP} frames drew in ${c.name}, ${mode}`);
        dropped += result.dropped;
        const frames: BenchFrame[] = result.frames.slice(WARMUP);
        const gpu = stats(frames.flatMap((f) => (f.gpuTime === null ? [] : [f.gpuTime])));
        const cpu = stats(frames.map((f) => f.cpuTime));
        const interval = stats(frames.map((f) => f.interval));
        const grid = `${result.columns} × ${result.rows}, ${result.colsPerPx.toFixed(2)} cols × ${result.rowsPerPx.toFixed(2)} rows a px`;
        lines.push(`| \`${mode}\` | ${ms(gpu.median)} | ${ms(gpu.p95)} | ${ms(cpu.median)} | ${ms(interval.median)} | ${grid} |`);
      }
    }
  } finally {
    await browser.close();
    // The whole group, so the preview server under the shell stops too.
    if (server?.pid) process.kill(-server.pid);
  }
  console.log(`Renderer: ${renderer}; ${cpus()[0]?.model ?? 'unknown CPU'}, ${platform()} ${release()}; Chromium ${browser.version()}, GL backend ${GL || 'default'}, ${HEADED ? 'headed' : 'new headless'}, device pixel ratio ${DPR}, ${FRAMES} frames after ${WARMUP} warm-up frames (${dropped} frames without a chart draw dropped).`);
  console.log(lines.join('\n'));
}

await main();
