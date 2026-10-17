import { defineConfig, devices } from '@playwright/test';
import { STRICT_PAGE_PORT } from './e2e/strict-page/vite.config';
import { VISUAL_PAGE_PORT } from './e2e/visual/vite.config';
import { HEATMAP_PAGE_PORT } from './e2e/heatmap-page/vite.config';
import { KEYBOARD_PAGE_PORT } from './e2e/keyboard-page/vite.config';
import { A11Y_RTL_PAGE_PORT } from './e2e/a11y-rtl-page/vite.config';
import { DEMO_PAGE_PORT } from './e2e/demo/vite.config';

const LANDING_PORT = 4186;
// Building the docs site takes a minute or two: only when the landing tests may run.
const landing = !process.argv.some((arg) => arg.startsWith('--project')) || process.argv.some((arg) => /\blanding\b/.test(arg));

/**
 * Browser tests in `e2e/`, run with `pnpm test:browser`. They need Chromium once:
 * `pnpm exec playwright install chromium`.
 */
export default defineConfig({
  testDir: 'e2e',
  reporter: 'list',
  forbidOnly: true,
  projects: [
    {
      name: 'chromium',
      testIgnore: ['visual.spec.ts', 'heatmap.spec.ts', 'a11y-rtl.spec.ts', 'landing.spec.ts'],
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${STRICT_PAGE_PORT}` },
    },
    {
      // Screenshot tests. Fonts render differently on each operating system, so baselines are
      // kept per platform; WebGL runs on the software renderer so the GPU does not matter. The
      // default tolerance (no differing pixel, after a small per-pixel color threshold) holds.
      name: 'visual',
      testMatch: 'visual.spec.ts',
      snapshotPathTemplate: '{testDir}/visual/__screenshots__/{platform}/{arg}{ext}',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${VISUAL_PAGE_PORT}`,
        viewport: { width: 800, height: 1600 },
        timezoneId: 'UTC',
        locale: 'en-US',
        reducedMotion: 'reduce',
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
      },
    },
    {
      // The demo app driven like a user, in both themes (e2e/demo/). Its files end in `.demo.ts`,
      // so the other projects leave them out.
      name: 'demo',
      testMatch: 'demo/*.demo.ts',
      // Each test drives a full shell on the software renderer, so tests and their waits get longer.
      timeout: 90_000,
      expect: { timeout: 15_000 },
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${DEMO_PAGE_PORT}`,
        viewport: { width: 1280, height: 800 },
        timezoneId: 'UTC',
        locale: 'en-US',
        reducedMotion: 'reduce',
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
      },
    },
    {
      // Heatmap cell reduction read back from pixels, plus screenshots of a zoomed-out heatmap.
      // Software renderer like `visual`, so the shader runs the same everywhere.
      name: 'heatmap',
      testMatch: 'heatmap.spec.ts',
      snapshotPathTemplate: '{testDir}/heatmap-page/__screenshots__/{platform}/{arg}{ext}',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${HEATMAP_PAGE_PORT}`,
        timezoneId: 'UTC',
        locale: 'en-US',
        reducedMotion: 'reduce',
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
      },
    },
    {
      // Forced-colours and right-to-left checks (#309, #311): DOM and chart state, plus
      // screenshots with the same fixed settings as `visual`.
      name: 'a11y-rtl',
      testMatch: 'a11y-rtl.spec.ts',
      snapshotPathTemplate: '{testDir}/a11y-rtl-page/__screenshots__/{platform}/{arg}{ext}',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${A11Y_RTL_PAGE_PORT}`,
        viewport: { width: 800, height: 600 },
        timezoneId: 'UTC',
        locale: 'en-US',
        reducedMotion: 'reduce',
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
      },
    },
    {
      // The docs site landing page, built and previewed (see landing.spec.ts).
      name: 'landing',
      testMatch: 'landing.spec.ts',
      // Software WebGL makes chart screenshots slow, more so on a busy machine.
      timeout: 90_000,
      expect: { timeout: 15_000 },
      snapshotPathTemplate: '{testDir}/landing/__screenshots__/{platform}/{arg}{ext}',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${LANDING_PORT}`,
        timezoneId: 'UTC',
        locale: 'en-US',
        reducedMotion: 'reduce',
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
      },
    },
  ],
  webServer: [
    {
      command: 'vite build --config e2e/strict-page/vite.config.ts && vite preview --config e2e/strict-page/vite.config.ts',
      url: `http://localhost:${STRICT_PAGE_PORT}`,
    },
    {
      command: 'vite build --config e2e/visual/vite.config.ts && vite preview --config e2e/visual/vite.config.ts',
      url: `http://localhost:${VISUAL_PAGE_PORT}`,
    },
    {
      command: 'vite build --config e2e/heatmap-page/vite.config.ts && vite preview --config e2e/heatmap-page/vite.config.ts',
      url: `http://localhost:${HEATMAP_PAGE_PORT}`,
    },
    {
      command: 'vite build --config e2e/keyboard-page/vite.config.ts && vite preview --config e2e/keyboard-page/vite.config.ts',
      url: `http://localhost:${KEYBOARD_PAGE_PORT}`,
    },
    {
      command: 'vite build --config e2e/a11y-rtl-page/vite.config.ts && vite preview --config e2e/a11y-rtl-page/vite.config.ts',
      url: `http://localhost:${A11Y_RTL_PAGE_PORT}`,
    },
    {
      command: 'vite build --config e2e/demo/vite.config.ts && vite preview --config e2e/demo/vite.config.ts',
      url: `http://localhost:${DEMO_PAGE_PORT}`,
    },
    ...(landing
      ? [
          {
            command: `pnpm docs:build && pnpm --filter docs exec vitepress preview --port ${LANDING_PORT}`,
            url: `http://localhost:${LANDING_PORT}`,
            timeout: 1_200_000,
            // Always build: a running preview may serve an older build than the sources.
            reuseExistingServer: false,
          },
        ]
      : []),
  ],
});
