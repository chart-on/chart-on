# Component wrapper: server rendering example

A chart (`<Chart>` from `@charton/vue`) rendered to HTML on the server and hydrated in the browser, with no application framework on top. The components are render functions, so no compiler plugin is needed:

- `src/App.ts` renders the same markup on both sides. On the server, `<Chart>` is only its container `div`; the chart is created in the browser after hydration.
- `src/entry-server.ts` renders the app to a string with `renderToString` from `vue/server-renderer`.
- `src/entry-client.ts` hydrates the server markup by mounting an app made with `createSSRApp`.
- `server.mjs` serves the built page with the server-rendered app in it, plus the client files.

This package is private and never published. It is not part of the root build, typecheck or size budgets.

```bash
# From the repository root: build the packages the example uses, then the example
pnpm --filter "charton-example-vue-ssr..." run build

# Serve it on http://localhost:4173 (set PORT to change it)
pnpm --filter charton-example-vue-ssr start
```

`node scripts/check-examples.mjs` builds this example, renders the page in Node and checks that it contains the chart container; CI runs it.
