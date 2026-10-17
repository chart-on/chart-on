import { build, type Rollup } from 'vite';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';

// The add-on entries (`@charton/ui/templates`) are opt-in: the main entry must not reach their
// modules, so an app that leaves them out ships none of their code.

/** A source file as a bundler module id (forward slashes on Windows too). */
const src = (path: string) => fileURLToPath(new URL(`../src/${path}`, import.meta.url)).replaceAll('\\', '/');

/** Source modules a bundle of `entry` keeps, with the engine and the shell left to their packages. */
async function modulesOf(entry: string): Promise<string[]> {
  const output = (await build({
    configFile: false,
    logLevel: 'silent',
    build: { write: false, minify: false, rollupOptions: { input: entry, external: ['@charton/core', '@charton/ui'], preserveEntrySignatures: 'strict' } },
  })) as Rollup.RollupOutput;
  return output.output.flatMap((chunk) => (chunk.type === 'chunk' ? chunk.moduleIds : [])).map((id) => id.replaceAll('\\', '/'));
}

describe('add-on entries', () => {
  it('stay out of the main entry', async () => {
    const main = await modulesOf(src('index.ts'));
    expect(main).toContain(src('drawing-settings.ts'));
    expect(main).not.toContain(src('templates.ts'));
  }, 60_000);

  it('take the shell from the main entry instead of bundling it', async () => {
    const own = (await modulesOf(src('templates.ts'))).filter((id) => id.includes('/packages/ui/src/'));
    expect(own).toEqual([src('templates.ts')]);
  }, 60_000);
});
