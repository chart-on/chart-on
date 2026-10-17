import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * Read by `svelte-package` and `svelte-check`. The components ship as source,
 * compiled by the app, with the types taken out of their scripts so an app
 * compiles them without a TypeScript set-up.
 */
export default {
  preprocess: vitePreprocess({ script: true }),
};
