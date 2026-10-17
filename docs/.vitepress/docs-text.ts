import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DefaultTheme, SiteConfig } from 'vitepress';
import { expandExamplesPlain } from './examples-markdown';

/** A sidebar page as plain Markdown, for the text copies of the docs. */
export interface DocsPage {
  section: string;
  title: string;
  /** Site path without extension, e.g. `/guide/series`. */
  link: string;
  description: string;
  /** The page body without front matter, examples expanded to their source. */
  markdown: string;
}

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)+/;

/** The `description` of a page's front matter, without quotes; empty when missing. */
export function frontMatterDescription(source: string): string {
  const yaml = FRONT_MATTER.exec(source)?.[1] ?? '';
  const line = /^description:[ \t]*(.*)$/m.exec(yaml)?.[1]?.trim() ?? '';
  return line.replace(/^(["'])(.*)\1$/, '$2').trim();
}

/** Every page linked from the sidebar, in sidebar order, read from `srcDir`. */
export function sidebarPages(sidebar: DefaultTheme.SidebarItem[], srcDir: string): DocsPage[] {
  const pages: DocsPage[] = [];
  const visit = (items: DefaultTheme.SidebarItem[], section: string) => {
    for (const item of items) {
      if (item.items) visit(item.items, item.text ?? section);
      if (!item.link) continue;
      // A folder link (`/upgrading/`) is that folder's index page.
      const link = item.link.endsWith('/') ? `${item.link}index` : item.link;
      if (pages.some((p) => p.link === link)) continue;
      // Normalise CRLF checkouts so front matter parses and text copies match LF ones.
      const source = readFileSync(join(srcDir, `${link}.md`), 'utf8').replace(/\r\n?/g, '\n');
      pages.push({
        section,
        title: item.text ?? link,
        link,
        description: frontMatterDescription(source),
        markdown: expandExamplesPlain(source.replace(FRONT_MATTER, '')).trim(),
      });
    }
  };
  visit(sidebar, '');
  return pages;
}

/** Throw, naming them, when sidebar pages have no front-matter `description`. */
export function checkDescriptions(pages: DocsPage[]): void {
  const missing = pages.filter((p) => !p.description).map((p) => `${p.link}.md`);
  if (missing.length > 0) {
    throw new Error(`Docs pages need a front-matter description (used by the docs index and search previews): ${missing.join(', ')}`);
  }
}

/**
 * The docs index: project summary, then each sidebar section with its pages'
 * titles, Markdown URLs and descriptions, then the full-text file.
 */
export function docsIndex(title: string, summary: string, base: string, pages: DocsPage[]): string {
  const sections = new Map<string, DocsPage[]>();
  for (const page of pages) sections.set(page.section, [...(sections.get(page.section) ?? []), page]);
  const lines = [`# ${title}`, '', `> ${summary}`, ''];
  for (const [section, list] of sections) {
    lines.push(`## ${section}`, '', ...list.map((p) => `- [${p.title}](${base}${p.link.slice(1)}.md): ${p.description}`), '');
  }
  lines.push('## Optional', '', `- [Full text](${base}llms-full.txt): every page above in one file, in this order`, '');
  return lines.join('\n');
}

/** Every page's Markdown in sidebar order, each under a line naming its URL. */
export function docsFullText(base: string, pages: DocsPage[]): string {
  return pages.map((p) => `Source: ${base}${p.link.slice(1)}.md\n\n${p.markdown}\n`).join('\n---\n\n');
}

/**
 * After `vitepress build`: write the docs index (`llms.txt`) and full text
 * (`llms-full.txt`) at the site root, and each sidebar page's Markdown next to
 * its HTML (`/guide/series.md`). Fails the build when a sidebar page has no
 * description.
 */
export function writeDocsText(config: SiteConfig<DefaultTheme.Config>): void {
  const sidebar = config.site.themeConfig.sidebar;
  if (!Array.isArray(sidebar)) throw new Error('The docs text files expect a single sidebar array');
  const pages = sidebarPages(sidebar, config.srcDir);
  checkDescriptions(pages);
  const { base, title, description } = config.site;
  const write = (path: string, text: string) => {
    const file = join(config.outDir, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  write('llms.txt', docsIndex(title, description, base, pages));
  write('llms-full.txt', docsFullText(base, pages));
  for (const page of pages) write(`${page.link.slice(1)}.md`, `${page.markdown}\n`);
}
