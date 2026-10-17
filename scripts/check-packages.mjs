// Checks the manifests of the published packages for the fields bundlers, type checkers and
// registries read, and that each tarball ships a README, the License and the NOTICE. Run after
// `pnpm build`, because it also checks that every entry point exists.
//
//   node scripts/check-packages.mjs

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const REPOSITORY = 'git+https://github.com/chart-on/charton.git';

const problems = [];
const manifests = readdirSync(join(root, 'packages'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(root, 'packages', entry.name, 'package.json')))
  .map((entry) => {
    const dir = join(root, 'packages', entry.name);
    return { dir, pkg: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) };
  })
  .filter(({ pkg }) => !pkg.private);

/** Source maps under `dir`, recursively; a missing `dir` has none. */
function mapFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.js.map'))
    .map((f) => join(dir, f));
}

/** The paths `pnpm pack` puts in the package's tarball, read from a dry run. */
function packedFiles(dir) {
  const out = execFileSync('pnpm', ['pack', '--dry-run', '--json'], {
    cwd: dir,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return JSON.parse(out).files.map((f) => f.path);
}

/** A text file with its line endings normalized, so a CRLF checkout compares equal. */
const readText = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

if (manifests.length === 0) problems.push('no published packages found under packages/');
const browsers = JSON.stringify(manifests[0]?.pkg.browserslist);

for (const { dir, pkg } of manifests) {
  const name = pkg.name ?? relative(root, dir);
  const fail = (message) => problems.push(`${name}: ${message}`);
  const directory = relative(root, dir).split('\\').join('/');

  for (const field of ['name', 'version', 'description', 'homepage', 'bugs']) {
    if (!pkg[field]) fail(`missing "${field}"`);
  }
  if (pkg.license !== 'Apache-2.0') fail('"license" must be "Apache-2.0"');
  if (pkg.type !== 'module') fail('"type" must be "module"');
  if (pkg.repository?.url !== REPOSITORY) fail(`"repository.url" must be "${REPOSITORY}"`);
  if (pkg.repository?.directory !== directory) fail(`"repository.directory" must be "${directory}"`);
  if (!pkg.engines?.node) fail('missing "engines.node"');
  if (!Array.isArray(pkg.browserslist) || pkg.browserslist.length === 0) fail('missing "browserslist"');
  else if (JSON.stringify(pkg.browserslist) !== browsers) fail('"browserslist" differs from the other packages');
  if (pkg.sideEffects !== false && !Array.isArray(pkg.sideEffects)) {
    fail('"sideEffects" must be false or a list of files, or bundlers keep unused modules');
  }
  // Scoped packages publish as restricted unless told otherwise.
  if (pkg.publishConfig?.access !== 'public') fail('"publishConfig.access" must be "public"');
  if (!Array.isArray(pkg.files) || !pkg.files.includes('dist')) fail('"files" must include "dist"');

  // Apache-2.0 section 4(a) and 4(d): every tarball gives its recipients the License and the
  // NOTICE. The package folders hold copies of the root files, which must stay identical.
  const packed = packedFiles(dir);
  for (const file of ['README.md', 'LICENSE', 'NOTICE']) {
    if (!packed.includes(file)) fail(`the packed tarball lacks ${file} (add it to the folder and to "files")`);
  }
  for (const file of ['LICENSE', 'NOTICE']) {
    const copy = join(dir, file);
    if (existsSync(copy) && readText(copy) !== readText(join(root, file))) fail(`${file} differs from the root ${file}`);
  }

  const exportsField = pkg.exports;
  if (!exportsField || typeof exportsField !== 'object' || Array.isArray(exportsField)) {
    fail('"exports" must be an object of subpaths');
    continue;
  }
  if (exportsField['./package.json'] !== './package.json') fail('"exports" must expose "./package.json"');

  const checkTarget = (subpath, condition, target) => {
    const where = condition ? `"${subpath}" > "${condition}"` : `"${subpath}"`;
    if (typeof target !== 'string' || !target.startsWith('./')) return fail(`${where} must be a "./" path`);
    if (!existsSync(join(dir, target))) return fail(`${where} points to missing ${target} (run pnpm build first)`);
    const published = target === './package.json' || pkg.files?.some((f) => target.startsWith(`./${f}/`));
    if (!published) fail(`${where} points to ${target}, which "files" leaves out of the package`);
    if (condition === 'types' && !target.endsWith('.d.ts')) fail(`${where} must point to a .d.ts file`);
  };

  for (const [subpath, value] of Object.entries(exportsField)) {
    if (!subpath.startsWith('.')) fail(`export "${subpath}" must start with "."`);
    if (typeof value === 'string') {
      checkTarget(subpath, null, value);
      if (/\.(js|css)$/.test(value)) fail(`"${subpath}" needs a "types" condition`);
      continue;
    }
    const conditions = Object.keys(value ?? {});
    if (!conditions.includes('types')) fail(`"${subpath}" needs a "types" condition`);
    else if (conditions[0] !== 'types') fail(`"${subpath}": "types" must come first, or older resolvers skip it`);
    if (conditions.at(-1) !== 'default') fail(`"${subpath}" needs a "default" condition, listed last`);
    for (const condition of conditions) checkTarget(subpath, condition, value[condition]);
  }

  // A bundle with third-party code ships those packages' licenses next to it
  // (scripts/third-party-notices.ts); the source map names the packages it bundles.
  for (const map of mapFiles(join(dir, 'dist'))) {
    const { sources } = JSON.parse(readFileSync(map, 'utf8'));
    const bundled = new Set(sources.flatMap((s) => /.*node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(s)?.[1] ?? []));
    if (bundled.size === 0) continue;
    const notices = join(dirname(map), 'THIRD-PARTY-NOTICES.txt');
    const text = existsSync(notices) ? readFileSync(notices, 'utf8') : '';
    const missing = [...bundled].filter((name) => !text.includes(`${name} `));
    const where = relative(dir, map.slice(0, -'.map'.length));
    if (missing.length > 0) fail(`${where} bundles ${missing.join(', ')} without its license in ${relative(dir, notices)}`);
  }

  const main = exportsField['.'];
  if (main && typeof main === 'object') {
    if (pkg.main !== main.default) fail('"main" must match the "." default export');
    if (pkg.types !== main.types) fail('"types" must match the "." types export');
  }
}

if (problems.length > 0) {
  console.error(`Package manifest check failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`Package manifests OK: ${manifests.map(({ pkg }) => pkg.name).join(', ')}`);
