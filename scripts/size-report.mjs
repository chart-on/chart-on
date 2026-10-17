// Lists what each source module contributes to the built bundles, to find where size goes.
// Run after `pnpm build`; it reads the shipped files and their source maps, so it measures
// exactly what `pnpm size` checks.
//
//   node scripts/size-report.mjs                 the browser bundle (core and ui), 25 largest modules
//   node scripts/size-report.mjs --top 60        more modules
//   node scripts/size-report.mjs packages/ui/dist/index.js
//
// Per module: `min` is the minified bytes the source map attributes to it, and `gzip` is how much
// the gzipped file shrinks without those bytes, so modules that repeat code found elsewhere in the
// bundle cost less than their size suggests. Directory totals sum `min`. A source that is bundled
// from two different paths (two copies of one package, say) is reported as a duplicate.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('..', import.meta.url));
// The core ships one file per source module, so the browser bundle shows core and ui modules together.
const DEFAULT_FILES = ['packages/ui/dist/browser/charton.js'];

const args = process.argv.slice(2);
const topAt = args.indexOf('--top');
const top = topAt >= 0 ? Number(args[topAt + 1]) : 25;
const files = args.filter((arg, i) => !arg.startsWith('--') && i !== topAt + 1);

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
const gzip = (text) => gzipSync(text, { level: 9 }).length;

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DIGIT = new Map([...BASE64].map((c, i) => [c, i]));

/** The values of one base64 VLQ source map segment. */
function decodeSegment(segment) {
  const values = [];
  let value = 0;
  let shift = 0;
  for (const c of segment) {
    const digit = DIGIT.get(c);
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
    } else {
      values.push(value & 1 ? -(value >>> 1) : value >>> 1);
      value = 0;
      shift = 0;
    }
  }
  return values;
}

/** Source index per character range of `code`: `[start, end, source]`, `source` -1 when unmapped. */
function ranges(code, map) {
  const out = [];
  const lines = code.split('\n');
  let offset = 0;
  let source = 0;
  const mappings = map.mappings.split(';');
  for (let line = 0; line < lines.length; line++) {
    const length = lines[line].length;
    let column = 0;
    let previous = { column: 0, source: -1 };
    for (const segment of (mappings[line] ?? '').split(',')) {
      if (!segment) continue;
      const values = decodeSegment(segment);
      column += values[0];
      if (values.length > 1) source += values[1];
      out.push([offset + previous.column, offset + column, previous.source]);
      previous = { column, source: values.length > 1 ? source : -1 };
    }
    out.push([offset + previous.column, Math.min(offset + length + 1, code.length), previous.source]);
    offset += length + 1;
  }
  return out.filter(([start, end]) => end > start);
}

/** `path` inside the repository, or the package-relative path for a dependency. */
function moduleName(path) {
  const inPackage = /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+\/.*)$/.exec(path);
  return inPackage ? inPackage[1] : path;
}

function report(file) {
  const path = resolve(root, file);
  if (!existsSync(path) || !existsSync(`${path}.map`)) {
    console.error(`${file}: not found (or no source map); run \`pnpm build\` first`);
    process.exitCode = 1;
    return;
  }
  const code = readFileSync(path, 'utf8');
  const map = JSON.parse(readFileSync(`${path}.map`, 'utf8'));
  const sources = map.sources.map((s) => relative(root, resolve(dirname(path), map.sourceRoot ?? '', s)).replaceAll('\\', '/'));
  const spans = ranges(code, map);
  const total = gzip(code);

  const modules = new Map();
  for (const [start, end, index] of spans) {
    const name = index < 0 ? '(no source)' : sources[index];
    const entry = modules.get(name) ?? { name, min: 0, spans: [] };
    entry.min += end - start;
    entry.spans.push([start, end]);
    modules.set(name, entry);
  }
  for (const entry of modules.values()) {
    let rest = '';
    let at = 0;
    for (const [start, end] of entry.spans) {
      rest += code.slice(at, start);
      at = end;
    }
    entry.gzip = total - gzip(rest + code.slice(at));
  }

  const sorted = [...modules.values()].sort((a, b) => b.gzip - a.gzip);
  console.log(`\n${file}: ${kb(code.length)} minified, ${kb(total)} gzip, ${modules.size} modules`);
  console.table(
    sorted.slice(0, top).map((m) => ({
      module: m.name,
      min: kb(m.min),
      gzip: kb(m.gzip),
      share: `${((m.gzip / total) * 100).toFixed(1)}%`,
    })),
  );

  const folders = new Map();
  for (const m of modules.values()) {
    const folder = m.name.includes('/') ? m.name.slice(0, m.name.lastIndexOf('/')) : m.name;
    folders.set(folder, (folders.get(folder) ?? 0) + m.min);
  }
  console.table(
    [...folders]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([folder, min]) => ({ folder, min: kb(min), share: `${((min / code.length) * 100).toFixed(1)}%` })),
  );

  const copies = new Map();
  for (const name of sources) {
    const key = moduleName(name);
    copies.set(key, [...(copies.get(key) ?? []), name]);
  }
  const duplicates = [...copies.values()].filter((paths) => new Set(paths).size > 1);
  if (duplicates.length > 0) {
    console.warn(`Bundled more than once:\n${duplicates.map((paths) => `  - ${paths.join(', ')}`).join('\n')}`);
  } else {
    console.log('No module is bundled more than once.');
  }
}

for (const file of files.length > 0 ? files : DEFAULT_FILES) report(file);
