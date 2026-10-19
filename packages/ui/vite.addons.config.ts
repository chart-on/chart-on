import { defineConfig } from 'vite';
import { buildTargets } from '../../scripts/browser-targets.ts';
import { libraryOutput } from '../../scripts/build-shrink.ts';
import { thirdPartyNotices } from '../../scripts/third-party-notices.ts';
import pkg from './package.json' with { type: 'json' };

/**
 * Opt-in add-on entries (`@chart-on/ui/templates`). They import the shell from `@chart-on/ui`
 * instead of bundling it, so they share the app's copy and the main entry stays as it is.
 * Runs after the main build, so it keeps its output.
 */
export default defineConfig({
  plugins: [thirdPartyNotices()],
  build: {
    lib: { entry: { templates: 'src/templates.ts' }, formats: ['es'] },
    rollupOptions: { external: ['@chart-on/core', '@chart-on/ui'], output: libraryOutput },
    target: buildTargets(pkg.browserslist),
    sourcemap: true,
    emptyOutDir: false,
  },
});
