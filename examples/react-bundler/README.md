# Component wrapper: bundler example

The charton widget (`<ChartShell>` from `@charton/react/shell`) in a client-rendered app built with the bundler the repository already uses. It shows synthetic bars from `createMockDataSource`, switches the theme through a prop, fits the content through the ref, and reads the crosshair price through the `on` prop.

This package is private and never published. It is not part of the root build, typecheck or size budgets.

```bash
# From the repository root: build the packages the example uses, then the example
pnpm --filter "charton-example-react-bundler..." run build

# Or serve it with live reload (after the packages are built)
pnpm --filter charton-example-react-bundler dev
```

`node scripts/check-examples.mjs` builds this example together with the other example apps; CI runs it.
