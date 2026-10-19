import { defineConfig } from 'vitepress';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { examplesMarkdown } from './examples-markdown';
import { writeDocsText } from './docs-text';

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const base = process.env.DOCS_BASE ?? '/';
/** The published address, for canonical links, the sitemap and social cards. */
const siteUrl = (process.env.DOCS_SITE_URL ?? 'https://charton.dev/').replace(/\/?$/, '/');
const description =
  'WebGL2 financial charts in TypeScript: a headless engine with candles, heatmaps, order flow, indicators and drawing tools, plus an optional UI toolkit.';
const ogImage = `${siteUrl}og-image.png`;
const ogImageAlt = 'charton: next gen charting library for the web';

/**
 * A description for a generated API page, which has no front matter: the first sentence of the
 * doc comment under the heading, or the symbol and its package when there is no comment.
 */
function apiDescription(path: string, markdown: string): string {
  const match = markdown.match(/^# (.+)$/m);
  const heading = match?.[1] ?? '';
  // The comment comes before the first section; a function's first section is its call signature,
  // so skip that heading. Signatures are block quotes, not comments.
  const body = markdown.slice(match?.index ?? 0).replace('## Call Signature', '');
  const comment = body
    .split(/^#{2,} /m)[0]
    .split(/\n\s*\n/)
    .slice(1)
    .map((p) => p.replace(/\[([^\]]*)\]\([^)]*\)|[`*]|\\/g, '$1').replace(/\s+/g, ' ').trim())
    .find((p) => p && !p.startsWith('>') && !p.startsWith('Defined in:'));
  if (comment) {
    // VitePress does not escape quotes in its description tag. Search results cut near 160 characters.
    const sentence = (comment.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? comment).replace(/"/g, "'");
    return sentence.length > 160 ? `${sentence.slice(0, 159).replace(/\s\S*$/, '')}…` : sentence;
  }
  const [kind, name] = heading.replace(/\\/g, '').split(': ');
  const pkg = path.match(/^api\/(@[^/]+\/[^/]+)/)?.[1] ?? 'charton';
  return name ? `The ${name} ${kind.toLowerCase()} in ${pkg}.` : `API reference for ${pkg}.`;
}

export default defineConfig({
  lang: 'en-US',
  title: 'charton',
  description,
  // Set DOCS_BASE=/<repo>/ when hosting under a sub-path (e.g. project pages),
  // and DOCS_SITE_URL to the full published address when it is not the default.
  base,
  cleanUrls: true,
  markdown: { config: examplesMarkdown },
  lastUpdated: true,
  // Plain-text copies of the docs for coding assistants: an index, the full text and each page's Markdown.
  buildEnd: writeDocsText,
  sitemap: { hostname: siteUrl },
  head: [
    // The .ico is for browsers and link previews that cannot use the SVG.
    ['link', { rel: 'icon', href: `${base}favicon.ico`, sizes: '48x48' }],
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}logo.svg` }],
    ['link', { rel: 'apple-touch-icon', href: `${base}apple-touch-icon.png` }],
    ['meta', { name: 'theme-color', content: '#f5f1e8', media: '(prefers-color-scheme: light)' }],
    ['meta', { name: 'theme-color', content: '#242424', media: '(prefers-color-scheme: dark)' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'charton' }],
    ['meta', { property: 'og:image', content: ogImage }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],
    ['meta', { property: 'og:image:alt', content: ogImageAlt }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:image', content: ogImage }],
    ['meta', { name: 'twitter:image:alt', content: ogImageAlt }],
  ],
  // Generated API pages have no front matter, so describe each from its own doc comment.
  transformPageData(pageData, { siteConfig }) {
    if (!pageData.relativePath.startsWith('api/') || pageData.frontmatter.description) return;
    const markdown = readFileSync(join(siteConfig.srcDir, pageData.relativePath), 'utf8');
    pageData.description = apiDescription(pageData.relativePath, markdown);
  },
  // Each page's own title, description and address for search engines and link previews.
  transformHead({ pageData, title, description: pageDescription }) {
    const path = pageData.relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '');
    const url = siteUrl + path;
    return [
      ['link', { rel: 'canonical', href: url }],
      ['meta', { property: 'og:url', content: url }],
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: pageDescription }],
      ['meta', { name: 'twitter:title', content: title }],
      ['meta', { name: 'twitter:description', content: pageDescription }],
    ];
  },
  themeConfig: {
    logo: '/logo.svg',
    socialLinks: [{ icon: 'github', link: 'https://github.com/chart-on/chart-on' }],
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Examples', link: '/guide/examples' },
      { text: 'Playground', link: '/playground' },
      // Each item names what its page shows: the shell on live market data, or every feature on synthetic data.
      {
        text: 'Demos',
        items: [
          { text: 'Live market', link: '/preview' },
          // The demo app, copied under `demo/` by the Pages workflow; `_self` loads it as its own page
          // instead of a docs route. Not served by `docs:dev`: run `pnpm dev` for it.
          { text: 'Feature showcase', link: '/demo/', target: '_self' },
        ],
      },
      // Generated by `pnpm api:docs`, which `docs:dev` and `docs:build` run first.
      { text: 'API', link: '/api/' },
    ],
    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'Core concepts', link: '/guide/concepts' },
          { text: 'Embedding the chart', link: '/guide/embedding' },
          { text: 'Frameworks and plain pages', link: '/guide/frameworks' },
          { text: 'Component wrapper', link: '/guide/component-wrapper' },
          { text: 'Template component wrapper', link: '/guide/template-wrapper' },
          { text: 'Compiled component wrapper', link: '/guide/compiled-wrapper' },
        ],
      },
      {
        text: 'Chart',
        items: [
          { text: 'Series and data', link: '/guide/series' },
          { text: 'Data sources', link: '/guide/data-sources' },
          { text: 'Exchange libraries', link: '/guide/exchange-libraries' },
          { text: 'Panes', link: '/guide/panes' },
          { text: 'Custom series', link: '/guide/custom-series' },
          { text: 'Indicators', link: '/guide/indicators' },
          { text: 'Primitives', link: '/guide/primitives' },
          { text: 'Watermark', link: '/guide/watermark' },
          { text: 'Session bands', link: '/guide/session-bands' },
          { text: 'View and price scale', link: '/guide/view-and-scale' },
          { text: 'Replay and go to date', link: '/guide/replay' },
          { text: 'Volume profile', link: '/guide/volume-profile' },
          { text: 'Depth lane', link: '/guide/depth-lane' },
          { text: 'Seasonality', link: '/guide/seasonality' },
          { text: 'Numeric axis charts', link: '/guide/numeric-axis' },
          { text: 'Events', link: '/guide/events' },
          { text: 'Interaction', link: '/guide/interaction' },
          { text: 'Sonification', link: '/guide/sonification' },
          { text: 'Feature flags', link: '/guide/features' },
          { text: 'Annotations', link: '/guide/annotations' },
          { text: 'Reference lines', link: '/guide/reference-lines' },
          { text: 'Options', link: '/guide/options' },
          { text: 'Save and restore layouts', link: '/guide/layouts' },
          { text: 'Storage and autosave', link: '/guide/storage' },
          { text: 'Link charts', link: '/guide/link-groups' },
        ],
      },
      {
        text: 'Drawings',
        items: [
          { text: 'Drawing tools', link: '/guide/drawings' },
          { text: 'Custom drawing tools', link: '/guide/custom-drawing-tools' },
          { text: 'Plugins', link: '/guide/plugins' },
          { text: 'Community plugins', link: '/guide/community-plugins' },
        ],
      },
      {
        text: 'Indicators',
        items: [{ text: 'Technical-analysis helpers', link: '/guide/technical-analysis' }],
      },
      {
        text: 'UI shell',
        items: [
          { text: 'Shell, toolbar and rail', link: '/guide/ui-shell' },
          { text: 'Chart grid', link: '/guide/chart-grid' },
          { text: 'Theming', link: '/guide/theming' },
          { text: 'Theme builder', link: '/theme-builder' },
          { text: 'Localization', link: '/guide/localization' },
          { text: 'Keyboard and accessibility', link: '/guide/accessibility' },
          { text: 'Symbol search', link: '/guide/symbol-search' },
          { text: 'Indicator picker', link: '/guide/indicator-picker' },
          { text: 'Form and picker dialogs', link: '/guide/dialogs' },
        ],
      },
      {
        text: 'More',
        items: [
          { text: 'Examples', link: '/guide/examples' },
          { text: 'Performance and limits', link: '/guide/performance' },
          { text: 'Testing your integration', link: '/guide/testing' },
          { text: 'Errors and warnings', link: '/guide/errors' },
          { text: 'Upgrading', link: '/upgrading/' },
          { text: 'Versioning', link: '/guide/versioning' },
          { text: 'Security and strict pages', link: '/guide/security' },
          { text: 'Sponsor', link: '/sponsor' },
        ],
      },
    ],
    // No detailed-view toggle: results stay a plain list of page titles.
    search: { provider: 'local', options: { detailedView: false } },
    outline: [2, 3],
  },
  vite: {
    // Resolve workspace packages to source so docs always match the code.
    resolve: {
      alias: [
        { find: '@chart-on/core/internal', replacement: src('../../packages/core/src/internal.ts') },
        { find: '@chart-on/core', replacement: src('../../packages/core/src/index.ts') },
        // Before `@chart-on/ui`, which would otherwise take it as a path inside its entry.
        { find: '@chart-on/ui/style.css', replacement: src('../../packages/ui/src/style.css') },
        { find: '@chart-on/ui', replacement: src('../../packages/ui/src/index.ts') },
        { find: '@chart-on/ta', replacement: src('../../packages/ta/src/index.ts') },
        { find: '@chart-on/indicators', replacement: src('../../packages/indicators/src/index.ts') },
        // The default theme's sun/moon switch becomes the landing footer's scheme picker.
        { find: /^.*\/VPSwitchAppearance\.vue$/, replacement: src('./theme/AppearancePicker.vue') },
      ],
    },
  },
});
