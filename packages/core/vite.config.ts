import { defineConfig } from 'vite';
import { buildTargets } from '../../scripts/browser-targets.ts';
import { glslMinify, libraryOutput } from '../../scripts/build-shrink.ts';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  plugins: [glslMinify()],
  build: {
    // `testing` is its own entry, so test helpers never land in an app's bundle. `internal`
    // re-exports engine internals for code that reaches below the public API.
    lib: { entry: { index: 'src/index.ts', internal: 'src/internal.ts', testing: 'src/testing.ts' }, formats: ['es'] },
    target: buildTargets(pkg.browserslist),
    sourcemap: true,
    emptyOutDir: true,
    rollupOptions: {
      // Keep constants in their own module: inlining them across files leaves bare `import './x.js'`
      // statements, which bundlers warn about since the package declares `sideEffects: false`.
      optimization: { inlineConst: false },
      output: {
        ...libraryOutput,
        // One file per source module, which the entries re-export, so classes keep one identity
        // across entries and a consumer's bundler drops whole unused modules (`sideEffects: false`)
        // instead of judging each top-level statement of one large shared file.
        preserveModules: true,
        preserveModulesRoot: 'src',
        entryFileNames: '[name].js',
      },
    },
  },
});
