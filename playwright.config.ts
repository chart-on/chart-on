import { defineConfig, devices } from '@playwright/test';
import { STRICT_PAGE_PORT } from './e2e/strict-page/vite.config';
import { VISUAL_PAGE_PORT } from './e2e/visual/vite.config';
import { HEATMAP_PAGE_PORT } from './e2e/heatmap-page/vite.config';
import { KEYBOARD_PAGE_PORT } from './e2e/keyboard-page/vite.config';
import { A11Y_RTL_PAGE_PORT } from './e2e/a11y-rtl-page/vite.config';
import { DEMO_PAGE_PORT } from './e2e/demo/vite.config';

const LANDING_PORT = 4186;

// The projects named on the command line (`--project=demo` or `--project demo`); none means all.
// CI runs a few projects per job, so each job builds only the pages its projects load.
const selected = process.argv.flatMap((arg, i, argv) =>
  arg.startsWith('--project=') ? [arg.slice('--project='.length)] : arg === '--project' ? [argv[i + 1]] : [],
);
const runs = (project: string) => selected.length === 0 || selected.includes(project);

// Each preview page in `e2e/`, with its port and the project that loads it.
const pages: [dir: string, port: number, project: string][] = [
  ['strict-page', STRICT_PAGE_PORT, 'chromium'],
  ['visual', VISUAL_PAGE_PORT, 'visual'],
  ['heatmap-page', HEATMAP_PAGE_PORT, 'heatmap'],
  ['keyboard-page', KEYBOARD_PAGE_PORT, 'chromium'],
  ['a11y-rtl-page', A11Y_RTL_PAGE_PORT, 'a11y-rtl'],
  ['demo', DEMO_PAGE_PORT, 'demo'],
];

/**
 * Browser tests in `e2e/`, run with `pnpm test:browser`. They need Chromium once:
 * `pnpm exec playwright install chromium`.
 */
export default defineConfig({
  testDir: 'e2e',
  reporter: 'list',
  // A failed test keeps a screenshot of its page in test-results/, which CI uploads.
  use: { screenshot: 'only-on-failure' },
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
    ...pages
      .filter(([, , project]) => runs(project))
      .map(([dir, port]) => ({
        command: `vite build --config e2e/${dir}/vite.config.ts && vite preview --config e2e/${dir}/vite.config.ts`,
        url: `http://localhost:${port}`,
      })),
    // Building the docs site takes a minute or two.
    ...(runs('landing')
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
