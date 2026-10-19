import { defineConfig, type Plugin } from 'vite';
import { buildTargets } from '../../scripts/browser-targets.ts';
import { libraryOutput } from '../../scripts/build-shrink.ts';
import { thirdPartyNotices } from '../../scripts/third-party-notices.ts';
import pkg from './package.json' with { type: 'json' };

/**
 * Emits the declaration behind the `types` condition of `@chart-on/ui/style.css`, so a side-effect
 * import of the stylesheet type-checks under `noUncheckedSideEffectImports`.
 */
function stylesheetTypes(): Plugin {
  return {
    name: 'charton-stylesheet-types',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'style.css.d.ts', source: 'export {};\n' });
    },
  };
}

export default defineConfig({
  plugins: [stylesheetTypes(), thirdPartyNotices()],
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index', cssFileName: 'style' },
    rollupOptions: { external: ['@chart-on/core'], output: libraryOutput },
    target: buildTargets(pkg.browserslist),
    sourcemap: true,
    emptyOutDir: true,
  },
});
