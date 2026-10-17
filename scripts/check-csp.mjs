// Scans the built packages (every JS and CSS file under packages/*/dist, the script-tag
// bundle included) for what a strict content security policy with Trusted Types blocks,
// and for code or resources the library would load itself. The source scan in
// packages/core/test/safe-sources.test.ts cannot see what the bundler or a bundled
// dependency adds; this can. Run after `pnpm build`.
//
//   node scripts/check-csp.mjs

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanBuilt } from './csp-rules.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Every `.js`, `.mjs`, `.cjs` and `.css` file under `dir`, recursively. */
function builtFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return builtFiles(path);
    return /\.(m|c)?js$|\.css$/.test(entry.name) ? [path] : [];
  });
}

const dists = readdirSync(join(root, 'packages'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(root, 'packages', entry.name, 'dist'))
  .filter((dir) => existsSync(dir));

const files = dists.flatMap(builtFiles);
if (files.length === 0) {
  console.error('No built files found under packages/*/dist. Run pnpm build first.');
  process.exit(1);
}

const problems = files.flatMap((path) =>
  scanBuilt(relative(root, path).split('\\').join('/'), readFileSync(path, 'utf8')),
);
if (problems.length > 0) {
  console.error(`Built files break a strict policy (docs/guide/security.md):\n${problems.map((p) => `  ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`${files.length} built files checked: no code evaluation, markup parsing, inline styles or remote loads.`);
