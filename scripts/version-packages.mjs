// The release steps `changeset version` does not do. With no arguments, run after it by
// `pnpm version-packages`, it sets `CORE_VERSION` (and its line in the core API report) to the new
// version, moves the Unreleased notes of CHANGELOG.md and the upgrading guide under that version,
// and points the changelog's upgrading links at it. `notes <version>` prints that version's
// changelog section, the body of its GitHub release, and fails when there is none.
//
//   node scripts/version-packages.mjs
//   node scripts/version-packages.mjs notes 0.2.0

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (file) => readFileSync(join(root, file), 'utf8').replace(/\r\n/g, '\n');

/** Writes `file` with `from` replaced by `to`, failing when `from` is not in it. */
function replace(file, from, to) {
  const text = read(file);
  if (!(typeof from === 'string' ? text.includes(from) : from.test(text))) throw new Error(`${file}: ${from} not found`);
  writeFileSync(join(root, file), text.replace(from, to));
}

/** GitHub's anchor for a heading: lower case, punctuation dropped, spaces as hyphens. */
const anchor = (heading) =>
  heading
    .toLowerCase()
    .replace(/[^\w\- ]/g, '')
    .replace(/ /g, '-');

const [command, wanted] = process.argv.slice(2);
const version = wanted ?? JSON.parse(read('packages/core/package.json')).version;

if (command === 'notes') {
  const text = read('CHANGELOG.md');
  const start = text.indexOf(`\n## ${version} `);
  if (start < 0) throw new Error(`CHANGELOG.md: no "## ${version}" section`);
  const body = text.slice(text.indexOf('\n', start + 1) + 1);
  const end = body.indexOf('\n## ');
  process.stdout.write(`${(end < 0 ? body : body.slice(0, end)).trim()}\n`);
} else if (command === undefined) {
  if (read('CHANGELOG.md').includes(`\n## ${version} (`)) throw new Error(`CHANGELOG.md: ${version} is already released`);
  replace('packages/core/src/version.ts', /CORE_VERSION = '[^']*'/, `CORE_VERSION = '${version}'`);
  replace('etc/core.api.md', /CORE_VERSION = "[^"]*"/, `CORE_VERSION = "${version}"`);
  // A new heading under an emptied Unreleased one, so the notes below it belong to the release.
  const date = new Date().toISOString().slice(0, 10);
  replace('CHANGELOG.md', '\n## Unreleased\n', `\n## Unreleased\n\n## ${version} (${date})\n`);
  replace('docs/upgrading/index.md', '\n### Unreleased\n', `\n### Unreleased\n\n### ${version}\n`);
  // The emptied Unreleased section has no entries yet, so every link to it is a released one.
  const changelog = read('CHANGELOG.md').replaceAll('upgrading/index.md#unreleased', `upgrading/index.md#${anchor(version)}`);
  writeFileSync(join(root, 'CHANGELOG.md'), changelog);
} else {
  throw new Error(`unknown command "${command}"; expected none or "notes <version>"`);
}
