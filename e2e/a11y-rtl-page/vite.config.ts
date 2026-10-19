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
      '@chart-on/core/testing': src('../../packages/core/src/testing.ts'),
      '@chart-on/core': src('../../packages/core/src/index.ts'),
      '@chart-on/ui/style.css': src('../../packages/ui/src/style.css'),
      '@chart-on/ui': src('../../packages/ui/src/index.ts'),
    },
  },
});
