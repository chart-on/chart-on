import { defineConfig } from 'vite';
import { buildTargets } from '../../scripts/browser-targets.ts';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  build: {
    // `shell` is its own entry, so apps that only use the engine never need `@chart-on/ui`.
    lib: { entry: { index: 'src/index.ts', shell: 'src/shell.ts' }, formats: ['es'] },
    rollupOptions: {
      external: [/^vue($|\/)/, /^@chart-on\//],
      // The code both entries share (the injection key and the prop syncing) goes in one chunk
      // with a stable name, so the size budget can track it. Both entries must use the same key,
      // or `useChart()` inside a shell would not find the shell's chart.
      output: { chunkFileNames: '[name].js' },
    },
    target: buildTargets(pkg.browserslist),
    sourcemap: true,
    emptyOutDir: true,
  },
});
