import { defineConfig } from 'vite';
import { buildTargets } from '../../scripts/browser-targets.ts';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index' },
    target: buildTargets(pkg.browserslist),
    sourcemap: true,
    emptyOutDir: true,
  },
});
