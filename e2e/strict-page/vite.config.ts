import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** The policy from docs/guide/security.md, with nothing allowed beyond this page's own files. */
export const STRICT_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "require-trusted-types-for 'script'",
].join('; ');

export const STRICT_PAGE_PORT = 4180;

// A production build only: the development server injects inline scripts the policy blocks.
export default defineConfig({
  root: src('.'),
  logLevel: 'warn',
  build: { chunkSizeWarningLimit: 4096 },
  preview: { port: STRICT_PAGE_PORT, strictPort: true, headers: { 'Content-Security-Policy': STRICT_POLICY } },
  resolve: {
    alias: {
      '@charton/core': src('../../packages/core/src/index.ts'),
      // Before `@charton/ui`, which would otherwise take it as a path inside its entry.
      '@charton/ui/style.css': src('../../packages/ui/src/style.css'),
      '@charton/ui': src('../../packages/ui/src/index.ts'),
      '@charton/ta': src('../../packages/ta/src/index.ts'),
      '@charton/indicators': src('../../packages/indicators/src/index.ts'),
    },
  },
});
