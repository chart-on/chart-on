import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Resolve workspace packages to source for instant HMR across packages.
export default defineConfig({
  // More pages: static charts (`interactive: false`) as sparklines, a grid of linked charts, a seasonality view, charts with a numeric horizontal axis, and order-flow charts (footprint and TPO).
  build: {
    rollupOptions: {
      input: {
        main: src('index.html'),
        sparklines: src('sparklines.html'),
        grid: src('grid.html'),
        seasonality: src('seasonality.html'),
        numeric: src('numeric.html'),
        'order-flow': src('order-flow.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@charton/core/internal': src('../../packages/core/src/internal.ts'),
      '@charton/core': src('../../packages/core/src/index.ts'),
      // Before `@charton/ui`, which would otherwise take it as a path inside its entry.
      '@charton/ui/style.css': src('../../packages/ui/src/style.css'),
      '@charton/ui/templates': src('../../packages/ui/src/templates.ts'),
      '@charton/ui': src('../../packages/ui/src/index.ts'),
      '@charton/ta': src('../../packages/ta/src/index.ts'),
      '@charton/indicators': src('../../packages/indicators/src/index.ts'),
      // `@charton/locales/<tag>` resolves to `src/<tag>.ts`.
      '@charton/locales': src('../../packages/locales/src'),
    },
  },
});
