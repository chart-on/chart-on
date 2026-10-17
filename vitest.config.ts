import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';

/** The wrapper tests that mount components in a DOM; the server tests next to them stay in `node`. */
const svelteBrowserTests = ['packages/svelte/test/{chart,shell,action}.test.ts'];

export default defineConfig({
  // Compiles the wrapper's components: for the browser in DOM tests, for a server in the others.
  plugins: [svelte({ configFile: false })],
  resolve: {
    alias: {
      // Before `@charton/core`, which would otherwise take them as paths inside its entry.
      '@charton/core/internal': fileURLToPath(new URL('./packages/core/src/internal.ts', import.meta.url)),
      '@charton/core/testing': fileURLToPath(new URL('./packages/core/src/testing.ts', import.meta.url)),
      '@charton/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@charton/ta': fileURLToPath(new URL('./packages/ta/src/index.ts', import.meta.url)),
      '@charton/indicators': fileURLToPath(new URL('./packages/indicators/src/index.ts', import.meta.url)),
      // Before `@charton/ui`, which would otherwise take it as a path inside its entry.
      '@charton/ui/style.css': fileURLToPath(new URL('./packages/ui/src/style.css', import.meta.url)),
      '@charton/ui/templates': fileURLToPath(new URL('./packages/ui/src/templates.ts', import.meta.url)),
      // Before `@charton/react`, which would otherwise take it as a path inside its entry.
      '@charton/react/shell': fileURLToPath(new URL('./packages/react/src/shell.ts', import.meta.url)),
      '@charton/react': fileURLToPath(new URL('./packages/react/src/index.ts', import.meta.url)),
      // Before `@charton/vue`, which would otherwise take it as a path inside its entry.
      '@charton/vue/shell': fileURLToPath(new URL('./packages/vue/src/shell.ts', import.meta.url)),
      '@charton/vue': fileURLToPath(new URL('./packages/vue/src/index.ts', import.meta.url)),
      // Before `@charton/svelte`, which would otherwise take it as a path inside its entry.
      '@charton/svelte/shell': fileURLToPath(new URL('./packages/svelte/src/shell.ts', import.meta.url)),
      '@charton/svelte': fileURLToPath(new URL('./packages/svelte/src/index.ts', import.meta.url)),
      '@charton/ui': fileURLToPath(new URL('./packages/ui/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./packages/core/test/builtin-plugins.setup.ts'],
    // Vitest loads CSS as an empty string unless included here, even `?raw` imports.
    css: { include: [/\.css\?raw$/] },
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'examples/*/test/**/*.test.ts'],
          exclude: [...svelteBrowserTests, '**/node_modules/**'],
        },
      },
      {
        // The component framework ships a browser runtime and a server runtime under the same
        // import, picked by the `browser` condition. Its DOM tests need the browser one, and the
        // others the server one, so they run as two projects.
        extends: true,
        resolve: { conditions: ['browser'] },
        test: { name: 'svelte-browser', include: svelteBrowserTests, environment: 'happy-dom' },
      },
    ],
  },
});
