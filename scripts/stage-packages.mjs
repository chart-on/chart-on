// Stages every published package whose version npm does not have yet, for an owner to approve with
// two-factor authentication (CONTRIBUTING.md#releasing-an-update). `pnpm pack` turns the
// `workspace:` ranges into versions, then `npm stage publish` (npm 11.15.0 or later) uploads the
// tarball. Run after `pnpm build`; `pnpm release` does both. `--dry-run` packs and checks each
// package without uploading it.
//
//   node scripts/stage-packages.mjs [--dry-run]

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dryRun = process.argv.includes('--dry-run');
const run = (command, args, options) =>
  execFileSync(command, args, { encoding: 'utf8', shell: process.platform === 'win32', ...options });

/** Whether npm has `name@version`. A version it does not know fails with E404. */
function published(name, version) {
  try {
    return run('npm', ['view', `${name}@${version}`, 'version'], { stdio: 'pipe' }).trim() === version;
  } catch (error) {
    if (String(error.stderr).includes('E404')) return false;
    throw error;
  }
}

const out = mkdtempSync(join(tmpdir(), 'stage-'));
const failed = [];
try {
  for (const entry of readdirSync(join(root, 'packages'))) {
    const dir = join(root, 'packages', entry);
    if (!existsSync(join(dir, 'package.json'))) continue;
    const { name, version, private: isPrivate } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    if (isPrivate) continue;
    if (published(name, version)) {
      console.log(`${name}@${version} is already on npm`);
      continue;
    }
    const { filename } = JSON.parse(run('pnpm', ['pack', '--json', '--pack-destination', out], { cwd: dir }));
    try {
      const args = ['stage', 'publish', `./${basename(filename)}`, '--access', 'public'];
      run('npm', dryRun ? [...args, '--dry-run'] : args, { cwd: out, stdio: 'inherit' });
    } catch {
      failed.push(`${name}@${version}`);
    }
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
if (failed.length > 0) {
  console.error(`Not staged: ${failed.join(', ')}`);
  process.exit(1);
}
