---
description: "Content security policy, Trusted Types and offline use: what the chart needs and what it never does."
---

# Security and strict pages

charton is built to run on pages with a strict content security policy (CSP), with Trusted Types enforced, and without network access.

## What the library never does

- **No code evaluation:** no `eval`, `new Function` or string timers, so `script-src` needs no `'unsafe-eval'`.
- **No markup parsing:** every element, including icons, is built with DOM calls (`createElement`, `createElementNS`), and text goes through `textContent` or the canvas. Icons you give as SVG markup strings are read the same way: the UI package builds only drawing elements from them and drops scripts, links, event handlers, inline styles and external references. Series titles, drawing text, symbol names and other text from your app or your data source show as text, never as markup. So `require-trusted-types-for 'script'` passes with no policy of your own.
- **No inline style markup:** styles are set on `element.style` (the CSSOM), which `style-src` without `'unsafe-inline'` allows. The chart root's base rule is a constructed stylesheet (`new CSSStyleSheet()`, adopted by the document), also CSSOM, so it needs no directive either. `@chart-on/ui`'s look comes from its stylesheet file.
- **No requests of its own:** no fonts (system font stacks), no remote icons or images, no workers, no analytics. The only requests are the ones your [data source](./data-sources) makes; the built-in REST and WebSocket adapters call the URLs you give them.

The repository checks this on every change:

- A scan of every package's sources rejects the APIs above, along with the other Trusted Types sinks (`srcdoc`, `setHTMLUnsafe`, inline `on…` handler attributes, `javascript:` URLs, script and frame elements).
- After the build, `pnpm check:csp` runs the same rules over the published files in each package's `dist` folder, the script-tag bundle included, so code added by the bundler or a bundled dependency is covered too. It also fails on any hard-coded remote URL other than XML namespaces and links to this documentation in development messages.
- A browser test (`pnpm test:browser`) serves a page with the policy below and draws a chart with candles, a heatmap, drawings and indicators, and a UI shell with its dialogs open, in both themes. It fails on any policy violation, error or request to another origin.
- Tests draw a chart, and a UI shell with its dialogs open in both themes, with the network APIs replaced by ones that throw, and check that no element gets a `style` or event handler attribute or parsed markup, and that markup in a series title or a symbol search result shows as text.

## Policy directives

A policy as strict as this works:

```text
default-src 'none';
script-src 'self';
style-src 'self';
img-src 'self' data:;
connect-src 'self' https://your-data-host.example;
require-trusted-types-for 'script';
```

| Directive | Why the chart needs it |
| --- | --- |
| `script-src` | Your bundle, which includes charton. Nothing inline, nothing evaluated |
| `style-src` | Only if you use `@chart-on/ui`: its stylesheet, loaded as a file (`import '@chart-on/ui/style.css'` through your bundler, or a `<link>`). Core needs none |
| `img-src` | Only for images you supply: symbol logos in the [symbol search](./symbol-search) (`logo` URLs, which it shows in `<img>` elements) and any image you load for a [watermark](./watermark) or a drawing. `data:` if those are data URLs, and for the `icon` drawing tool, which draws its SVG markup as a data URL. `captureImage()` draws into a canvas and needs nothing |
| `connect-src` | Your data source's HTTP and WebSocket hosts |

WebGL needs no directive. Nothing needs `worker-src`, `font-src`, `frame-src` or `'unsafe-inline'`.

## Offline and air-gapped use

The packages ship as plain ES modules with no runtime downloads. Bundle them with your app (or serve them from your own host), give the chart a data source that reads from your own network, and the chart works without internet access. The [mock data source](./data-sources) runs entirely in the page, for demos and kiosks.

