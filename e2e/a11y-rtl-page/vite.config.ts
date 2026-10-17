import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export const A11Y_RTL_PAGE_PORT = 4183;

// Built and previewed like the visual page, so the scenes draw from a production build.
export default defineConfig({
  root: src('.'),
  logLevel: 'warn',
  build: { chunkSizeWarningLimit: 4096 },
  preview: { port: A11Y_RTL_PAGE_PORT, strictPort: true },
  resolve: {
    alias: {
      // Subpaths before the package names, which would otherwise take them as paths inside their entries.
      '@charton/core/testing': src('../../packages/core/src/testing.ts'),
      '@charton/core': src('../../packages/core/src/index.ts'),
      '@charton/ui/style.css': src('../../packages/ui/src/style.css'),
      '@charton/ui': src('../../packages/ui/src/index.ts'),
    },
  },
});
