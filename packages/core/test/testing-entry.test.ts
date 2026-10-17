import { describe, expect, it } from 'vitest';
import { build, type Rollup } from 'vite';

const index = decodeURIComponent(new URL('../src/index.ts', import.meta.url).pathname);

/** Bundle a one-line app that imports `names` from the main entry; returns the output code. */
async function bundle(names: string): Promise<string> {
  const entry = '\0app';
  const result = (await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'app-entry',
        resolveId: (id) => (id === entry ? id : null),
        load: (id) => (id === entry ? `import { ${names} } from ${JSON.stringify(index)};\nconsole.log(${names});` : null),
      },
    ],
    build: { write: false, minify: false, rollupOptions: { input: entry } },
  })) as Rollup.RollupOutput[] | Rollup.RollupOutput;
  const outputs = Array.isArray(result) ? result : [result];
  return outputs.flatMap((o) => o.output).map((chunk) => ('code' in chunk ? chunk.code : '')).join('\n');
}

describe('testing entry', () => {
  it('stays out of a bundle that imports only createChart', async () => {
    const code = await bundle('createChart');
    // The chart itself is there...
    expect(code).toContain('WebGL2 is not available');
    // ...and none of the test support.
    for (const marker of ['installTestEnvironment', 'describeScene', 'fakeWebgl2', 'Frames still pending']) {
      expect(code).not.toContain(marker);
    }
  }, 60000);
});
