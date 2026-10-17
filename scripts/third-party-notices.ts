/**
 * Ships the license of each third-party package a build bundles, as those licenses ask, in
 * `THIRD-PARTY-NOTICES.txt` next to the bundles. Shared by the package Vite configs;
 * `scripts/check-packages.mjs` fails when a bundle with third-party code has no notice beside it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

export const NOTICES_FILE = 'THIRD-PARTY-NOTICES.txt';

const PACKAGE_DIR = /^(.*[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/;

export function thirdPartyNotices(): Plugin {
  return {
    name: 'charton-third-party-notices',
    generateBundle(_, bundle) {
      const packages = new Set<string>();
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const [id, module] of Object.entries(chunk.modules)) {
          const dir = module.renderedLength > 0 && PACKAGE_DIR.exec(id)?.[1];
          if (dir) packages.add(dir);
        }
      }
      if (packages.size === 0) return;
      const notices = [...packages].sort().map((dir) => {
        const { name, version } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name: string; version: string };
        const file = readdirSync(dir).find((f) => /^licen[cs]e/i.test(f));
        if (!file) throw new Error(`No license file in ${name}`);
        return `${name} ${version}\n\n${readFileSync(join(dir, file), 'utf8').trim()}\n`;
      });
      const source = `The files in this folder bundle code from the packages below, under their licenses.\n\n${notices.join('\n')}`;
      this.emitFile({ type: 'asset', fileName: NOTICES_FILE, source });
    },
  };
}
