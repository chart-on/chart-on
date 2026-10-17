import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// The plugin compiles the components, for the browser and for the server build.
export default defineConfig({
  plugins: [svelte()],
});
