/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { LOADS, UNSAFE, scanBuilt, type Rule } from '../../../scripts/csp-rules';

/**
 * Stands in for a lint rule: the library must run under a strict content
 * security policy with Trusted Types enforced, and make no network requests
 * of its own. See docs/guide/security.md.
 */
const sources = import.meta.glob<string>(['../../*/src/**/*.ts', '../../*/src/**/*.svelte', '../../*/src/**/*.css'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Requests the library would make itself. Only the data adapters, which call URLs the app configures, may. */
const NETWORK: Rule[] = [
  [/(^|[^.\w])fetch\s*\(|\bXMLHttpRequest\b|\bnew WebSocket\b|\bnew EventSource\b|\bsendBeacon\b/, 'network request'],
  ...LOADS,
];
/** Files allowed to make requests, and why. */
const NETWORK_ALLOWED: Record<string, string> = {
  'core/src/data/adapters.ts': 'the REST and WebSocket adapters call the URLs the app gives them',
  // `fetch` there is the indicator definition's own function, called with a request object.
  'core/src/indicators/external.ts': "calls the indicator's fetch hook, not the global fetch",
  // Same for the picker dialog's search source.
  'ui/src/picker-model.ts': "calls the picker source's fetch hook, not the global fetch",
};

/** `core/src/...`, `ui/src/...`: glob keys of this package's own files come back as `../src/...`. */
const fileOf = (path: string) => {
  const file = path.replace(/^(\.\.\/)+/, '');
  return file.startsWith('src/') ? `core/${file}` : file;
};

function scan(rules: Rule[], allowed: Record<string, string> = {}, files = sources): string[] {
  const found: string[] = [];
  for (const [path, text] of Object.entries(files)) {
    const file = fileOf(path);
    if (allowed[file]) continue;
    text.split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '').trim();
      if (code.startsWith('*') || code.startsWith('/*')) return;
      for (const [pattern, why] of rules) if (pattern.test(code)) found.push(`${file}:${i + 1}: ${why}`);
    });
  }
  return found;
}

describe('library sources', () => {
  it('cover every package', () => {
    const packages = new Set(Object.keys(sources).map((p) => fileOf(p).split('/')[0]));
    expect([...packages].sort()).toEqual(['core', 'indicators', 'locales', 'react', 'svelte', 'ta', 'ui', 'vue']);
  });

  it('parse no markup, evaluate no code and write no inline styles', () => {
    expect(scan(UNSAFE)).toEqual([]);
  });

  it('make no network requests outside the data adapters', () => {
    expect(scan(NETWORK, NETWORK_ALLOWED)).toEqual([]);
  });

  it('catch the patterns they guard against', () => {
    const bad = {
      '../../ui/src/x.ts': [
        "b.innerHTML = '<svg/>';",
        'el.insertAdjacentHTML("beforeend", html);',
        "setTimeout('tick()', 10);",
        "el.setAttribute('style', 'color: red');",
        'const f = new Function(code);',
        'const r = await fetch(url);',
        "const w = new Worker('w.js');",
        '// innerHTML in a comment is fine',
        "el.textContent = 'safe';",
        "frame.srcdoc = page;",
        "el.setAttribute('onclick', 'go()');",
        "a.href = 'javascript:void 0';",
        "document.createElement('script');",
      ].join('\n'),
    };
    expect(scan(UNSAFE, {}, bad).map((f) => f.split(':')[1])).toEqual(['1', '2', '3', '4', '5', '10', '11', '12', '13']);
    expect(scan(NETWORK, {}, bad).map((f) => f.split(':')[1])).toEqual(['6', '7']);
  });
});

/** The rules scripts/check-csp.mjs runs over each package's dist folder after the build. */
describe('built files check', () => {
  const lines = (found: string[]) => found.map((f) => f.split(':')[1]).sort();

  it('flags unsafe code and remote URLs in minified JS', () => {
    const js = [
      'var a=`http://www.w3.org/2000/svg`;e.textContent=t;',
      'function f(e,t){e.innerHTML=t}',
      'const g=new Function(`return this`)();',
      'n.setAttribute(`style`,`color:red`);',
      'const u=`https://cdn.example.com/font.woff2`;',
      'throw Error(`see https://github.com/chart-on/charton/blob/main/docs/guide/errors.md`)',
      'import(`https://cdn.example.com/x.js`)',
    ].join('\n');
    expect(lines(scanBuilt('index.js', js))).toEqual(['2', '3', '4', '5', '7', '7']);
  });

  it('flags resources loaded from CSS, but not data URLs', () => {
    const css = [
      '.pc-a{color:red}',
      '@import url(theme.css);',
      '@font-face{font-family:x;src:url(x.woff2)}',
      '.pc-b{background:url(data:image/png;base64,AAAA)}',
      '.pc-c{background:url("icon.svg")}',
    ].join('\n');
    expect(lines(scanBuilt('style.css', css))).toEqual(['2', '2', '3', '3', '5']);
  });
});
