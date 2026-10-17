import { defineConfig } from 'vite';
import { buildTargets } from '../../scripts/browser-targets.ts';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  build: {
    // `shell` is its own entry, so apps that only use the engine never need `@charton/ui`.
    lib: { entry: { index: 'src/index.ts', shell: 'src/shell.ts' }, formats: ['es'] },
    rollupOptions: {
      external: [/^react($|\/)/, /^@charton\//],
      // Bundling drops module-level directives, so the client-component marker goes in as a
      // banner on every output file. Frameworks with server components read it and treat the
      // components as client components: rendered to HTML on the server, hydrated in the browser.
      // The code both entries share goes in one chunk with a stable name, so the size budget
      // can track it.
      output: { banner: "'use client';", chunkFileNames: '[name].js' },
    },
    target: buildTargets(pkg.browserslist),
    sourcemap: true,
    emptyOutDir: true,
  },
});
