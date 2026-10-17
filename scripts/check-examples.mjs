// Builds the framework example apps under examples/ together with the packages they
// use, then renders each server-rendering example in Node and checks that the page
// contains the chart container. The examples stay out of the root build, typecheck and
// size budgets; CI runs this script in its own job.
//
//   node scripts/check-examples.mjs

import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/**
 * The examples, by package name. `ssr` names the module that renders the full page
 * (it exports `renderPage()`) and a string the page must contain.
 */
const examples = [
  { name: 'charton-example-react-bundler' },
  { name: 'charton-example-react-ssr', ssr: { module: 'examples/react-ssr/server.mjs', expect: '<div id="chart"' } },
  { name: 'charton-example-vue-bundler' },
  { name: 'charton-example-vue-ssr', ssr: { module: 'examples/vue-ssr/server.mjs', expect: '<div id="chart"' } },
  { name: 'charton-example-svelte-bundler' },
  { name: 'charton-example-svelte-ssr', ssr: { module: 'examples/svelte-ssr/server.mjs', expect: '<div id="chart"' } },
];

// `name...` also builds the workspace packages each example depends on, in dependency order.
const filters = examples.map(({ name }) => `--filter "${name}..."`).join(' ');
execSync(`pnpm ${filters} run build`, { cwd: root, stdio: 'inherit' });

let failed = 0;
for (const { name, ssr } of examples) {
  if (!ssr) continue;
  const { renderPage } = await import(pathToFileURL(root + ssr.module).href);
  const html = await renderPage();
  if (html.includes(ssr.expect) && !html.includes('<!--app-->')) {
    console.log(`ok  ${name}: server-rendered page contains ${ssr.expect}`);
  } else {
    console.error(`FAIL ${name}: server-rendered page lacks ${ssr.expect}\n${html}`);
    failed++;
  }
}
process.exit(failed ? 1 : 0);
