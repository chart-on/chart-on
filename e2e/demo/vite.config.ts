import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import demo from '../../apps/demo/vite.config';

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export const DEMO_PAGE_PORT = 4185;

// The demo app built for production in the `e2e` mode, which keeps its charts on `window`
// (apps/demo/src/expose.ts), and previewed. Built into this folder so it never overwrites the demo's own `dist`.
export default mergeConfig(
  demo,
  defineConfig({
    root: src('../../apps/demo'),
    mode: 'e2e',
    logLevel: 'warn',
    build: { outDir: src('dist'), emptyOutDir: true, chunkSizeWarningLimit: 4096 },
    preview: { port: DEMO_PAGE_PORT, strictPort: true },
  }),
);
