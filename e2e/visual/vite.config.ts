import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export const VISUAL_PAGE_PORT = 4181;

// Built and previewed like the strict page, so the scenes draw from a production build.
export default defineConfig({
  root: src('.'),
  logLevel: 'warn',
  build: { chunkSizeWarningLimit: 4096 },
  preview: { port: VISUAL_PAGE_PORT, strictPort: true },
  resolve: {
    alias: {
      // Subpaths before the package names, which would otherwise take them as paths inside their entries.
      '@charton/core/testing': src('../../packages/core/src/testing.ts'),
      '@charton/core': src('../../packages/core/src/index.ts'),
      '@charton/ui/style.css': src('../../packages/ui/src/style.css'),
      '@charton/ui': src('../../packages/ui/src/index.ts'),
      '@charton/ta': src('../../packages/ta/src/index.ts'),
      '@charton/indicators': src('../../packages/indicators/src/index.ts'),
    },
  },
});
