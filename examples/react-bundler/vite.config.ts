import { defineConfig } from 'vite';

// The bundler compiles JSX with the automatic runtime, so no plugin is needed.
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
});
