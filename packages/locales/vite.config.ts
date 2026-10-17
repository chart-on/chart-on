import { defineConfig } from 'vite';
import { buildTargets } from '../../scripts/browser-targets.ts';
import pkg from './package.json' with { type: 'json' };

/** One entry per language: `src/<tag>.ts` builds `dist/<tag>.js`, the `./<tag>` export. */
const entries = Object.keys(pkg.exports)
  .filter((subpath) => subpath !== './package.json')
  .map((subpath) => subpath.slice(2));

export default defineConfig({
  build: {
    lib: { entry: Object.fromEntries(entries.map((tag) => [tag, `src/${tag}.ts`])), formats: ['es'] },
    target: buildTargets(pkg.browserslist),
    sourcemap: true,
    emptyOutDir: true,
  },
});
