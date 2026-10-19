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
      '@chart-on/core/internal': src('../../packages/core/src/internal.ts'),
      '@chart-on/core': src('../../packages/core/src/index.ts'),
      // Before `@chart-on/ui`, which would otherwise take it as a path inside its entry.
      '@chart-on/ui/style.css': src('../../packages/ui/src/style.css'),
      '@chart-on/ui/templates': src('../../packages/ui/src/templates.ts'),
      '@chart-on/ui': src('../../packages/ui/src/index.ts'),
      '@chart-on/ta': src('../../packages/ta/src/index.ts'),
      '@chart-on/indicators': src('../../packages/indicators/src/index.ts'),
      // `@chart-on/locales/<tag>` resolves to `src/<tag>.ts`.
      '@chart-on/locales': src('../../packages/locales/src'),
    },
  },
});
