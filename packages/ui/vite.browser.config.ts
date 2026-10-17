import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { buildTargets } from '../../scripts/browser-targets.ts';
import { glslMinify, libraryOutput } from '../../scripts/build-shrink.ts';
import { NOTICES_FILE, thirdPartyNotices } from '../../scripts/third-party-notices.ts';
import pkg from './package.json' with { type: 'json' };

/**
 * Script-tag build: core, shell and icons bundled into one file per format, plus
 * `style.css`, in `dist/browser/`. Runs after the package build, so it only
 * empties its own folder.
 */
export default defineConfig({
  // Shaders come from core's source here, so this build minifies them too.
  plugins: [glslMinify(), thirdPartyNotices()],
  // A script tag has no `process`, so the development checks never run here (see `util/dev.ts`).
  // Folding the test drops them from the file instead of shipping dead code.
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  resolve: {
    // Bundle the engine from source, so this build does not depend on core's `dist`.
    // The add-ons import the shell by package name; here that is the same source as `./index`.
    alias: {
      '@charton/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@charton/ui': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist/browser',
    emptyOutDir: true,
    lib: {
      entry: 'src/browser.ts',
      name: 'charton',
      formats: ['es', 'iife'],
      fileName: (format) => (format === 'es' ? 'charton.js' : 'charton.iife.js'),
      cssFileName: 'style',
    },
    target: buildTargets(pkg.browserslist),
    minify: true,
    // Vite keeps whitespace in ES library output; this file is for script tags, so drop it. Script
    // tags are not tree shaken, so the pure annotations that help bundlers go too.
    // The banner points a copied script at the licenses of the code it bundles.
    rollupOptions: { output: { ...libraryOutput, comments: { annotation: false }, postBanner: `/*! Third-party licenses: ${NOTICES_FILE} */` } },
    sourcemap: true,
  },
});
