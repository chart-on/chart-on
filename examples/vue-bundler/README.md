# Component wrapper: bundler example

The charton widget (`<ChartShell>` from `@charton/vue/shell`) in a client-rendered app, written with render functions so it needs no compiler plugin, built with the bundler the repository already uses. It shows synthetic bars from `createMockDataSource`, switches the theme through a prop, fits the content through a template ref, and reads the crosshair price through the `on` prop.

This package is private and never published. It is not part of the root build, typecheck or size budgets.

```bash
# From the repository root: build the packages the example uses, then the example
pnpm --filter "charton-example-vue-bundler..." run build

# Or serve it with live reload (after the packages are built)
pnpm --filter charton-example-vue-bundler dev
```

`pnpm --filter "charton-example-vue-bundler..." run build` checks that it type-checks and bundles.
