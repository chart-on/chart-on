import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Benchmarks (`pnpm bench`) run against the built engine in `packages/core/dist`, the code that
 * ships, so build first. `CHARTON_BENCH_CORE` points them at another build instead: CI runs the
 * same benchmarks against the base branch's build to compare the two.
 */
const core = process.env.CHARTON_BENCH_CORE ?? fileURLToPath(new URL('./packages/core/dist', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Before `@chart-on/core`, which would otherwise take it as a path inside its entry.
      '@chart-on/core/testing': `${core}/testing.js`,
      '@chart-on/core': `${core}/index.js`,
    },
  },
  test: {
    environment: 'node',
    benchmark: { include: ['packages/*/test/**/*.bench.ts'] },
  },
});
