import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index' },
    // The chart is the app's copy: a plugin never bundles it.
    rollupOptions: { external: ['@chart-on/core'] },
    sourcemap: true,
    emptyOutDir: true,
  },
});
