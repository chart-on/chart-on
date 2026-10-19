import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export const HEATMAP_PAGE_PORT = 4184;

// Built and previewed like the visual page, so the heatmap draws from a production build.
export default defineConfig({
  root: src('.'),
  logLevel: 'warn',
  build: { chunkSizeWarningLimit: 4096 },
  preview: { port: HEATMAP_PAGE_PORT, strictPort: true },
  resolve: {
    alias: {
      '@chart-on/core/internal': src('../../packages/core/src/internal.ts'),
      '@chart-on/core/testing': src('../../packages/core/src/testing.ts'),
      '@chart-on/core': src('../../packages/core/src/index.ts'),
    },
  },
});
