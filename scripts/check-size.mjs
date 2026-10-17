// Checks the gzip size of the built packages against the budgets in `size-budget.json`, and
// fails when one is exceeded. Run after `pnpm build`.
//
//   node scripts/check-size.mjs            check and print a table
//   node scripts/check-size.mjs --update   set every budget to the current size plus headroom
//
// A budget is a ceiling, not a target: raise it in the same PR as the change that needs the
// room, and say why in the PR description.
//
// Sizes are what an app ships: minified, with `process.env.NODE_ENV` set to "production" so
// development-only code folds away, then gzipped. `files` are built files, each minified on its
// own with its imports left out (stylesheets and Svelte components are measured as built). The
// core ships one file per source module, so the `everything` bundle measures it as a whole.
// `bundles` are small apps bundled from the built core the way a consumer's bundler would, named
// by what they import, so the budget covers what an app pays for those imports after tree shaking.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('..', import.meta.url));
const budgetFile = fileURLToPath(new URL('size-budget.json', import.meta.url));
/** Room `--update` leaves above the current size, so small changes do not each need a new budget. */
const HEADROOM = 1.1;
const CORE = 'packages/core/dist/index.js';

const budgets = JSON.parse(readFileSync(budgetFile, 'utf8'));
budgets.bundles ??= {};
const update = process.argv.includes('--update');
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
const gzip = (data) => gzipSync(data, { level: 9 }).length;

/** Production code Vite builds from `input`, minified and with development checks folded away. */
async function shipped(input, { plugins = [], external } = {}) {
  const { build } = await import('vite');
  const output = await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins,
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: { write: false, minify: true, rollupOptions: { input, external, preserveEntrySignatures: 'strict' } },
  });
  return (Array.isArray(output) ? output : [output])
    .flatMap((result) => result.output)
    .map((chunk) => (chunk.type === 'chunk' ? chunk.code : ''))
    .join('\n');
}

/** A built file as an app ships it; its imports are measured separately or are not ours. */
const shippedFile = (path) => (path.endsWith('.js') ? shipped(path, { external: (_id, importer) => importer !== undefined }) : readFileSync(path));

/** Minified code of an app that imports `names` (or `'*'`, the whole entry) from the built core and uses them. */
function bundleOf(names) {
  const entry = '\0size-entry';
  const corePath = join(root, CORE).replaceAll('\\', '/');
  const plugin = {
    name: 'size-entry',
    resolveId: (id) => (id === 'size-entry' ? entry : null),
    load: (id) => {
      if (id !== entry) return null;
      if (names === '*') return `import * as core from '${corePath}';\nconsole.log(core);\n`;
      return `import { ${names.join(', ')} } from '${corePath}';\nconsole.log(${names.join(', ')});\n`;
    },
  };
  return shipped('size-entry', { plugins: [plugin] });
}

const rows = [];
const problems = [];
/** Check `size` against the budget stored in `table[key]`, or reset it with `--update`. */
function measure(table, key, size) {
  const budget = typeof table[key] === 'object' ? table[key].budget : table[key];
  const next = Math.ceil((size * HEADROOM) / 256) * 256;
  if (update) {
    if (typeof table[key] === 'object') table[key].budget = next;
    else table[key] = next;
  } else if (size > budget) {
    problems.push(`${key}: ${kb(size)} gzip is over its ${kb(budget)} budget`);
  }
  const limit = update ? next : budget;
  rows.push({ file: key, gzip: kb(size), budget: kb(limit), used: `${Math.round((size / limit) * 100)}%` });
}

for (const file of Object.keys(budgets.files)) {
  const path = join(root, file);
  if (!existsSync(path)) {
    problems.push(`${file}: not found; run \`pnpm build\` first`);
    continue;
  }
  measure(budgets.files, file, gzip(await shippedFile(path)));
}
for (const [name, entry] of Object.entries(budgets.bundles)) {
  if (!existsSync(join(root, CORE))) {
    problems.push(`${name}: ${CORE} not found; run \`pnpm build\` first`);
    continue;
  }
  measure(budgets.bundles, name, gzip(await bundleOf(entry.imports)));
}

console.table(rows);
if (problems.length > 0) {
  console.error(`\nSize budget check failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  if (!update) console.error('\nIf the growth is intended, run `pnpm size --update` and explain it in the PR.');
  process.exit(1);
}
if (update) {
  writeFileSync(budgetFile, `${JSON.stringify(budgets, null, 2)}\n`);
  console.log(`\nBudgets in scripts/size-budget.json set to the current sizes + ${Math.round((HEADROOM - 1) * 100)}%.`);
}
