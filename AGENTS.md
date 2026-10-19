# Agent instructions

Instructions for AI coding agents working in this repository. Human contributors follow the same process, described in [`CONTRIBUTING.md`](CONTRIBUTING.md). Read that file too; this one is the short, strict version.

## Before writing any code

1. **Find the issue.** Every change starts from a GitHub issue.
   - List the open work: `gh issue list --state open`.
   - Read the roadmap: `gh issue list --label epic`, then `gh issue view <n>`.
   - Read the issue you are working on, including its comments. Its scope and acceptance criteria define "done".
2. **No issue yet?** Do not start. Ask the person you are working for whether to open one. Only open one yourself if they ask you to, and give it a clear goal, scope and acceptance criteria.
3. **Already assigned to someone else, or claimed in a comment?** Stop and say so. Two people building the same thing is exactly what this process prevents.
4. **Claim it before starting.** Leave a short comment with the plan and the branch name. People with write access also assign themselves (`gh issue edit <n> --add-assignee @me`); other contributors ask a maintainer to assign them.
5. **Scope changes go in the issue.** If the work turns out bigger or different than the issue describes, comment there before expanding it.

## Branches, commits and pull requests

- **Never commit or push to `main`.**
- **Branch from an up-to-date `main`:** `feat/<issue>-short-name`, `fix/<issue>-…`, `docs/<issue>-…` or `chore/<issue>-…`. Contributors without write access work on the same branch names in a fork.
- **Use Conventional Commits:** `type(scope): summary`, with scope `core`, `ui`, `ta`, `indicators` or `demo`. Commits should be small and focused, and each should build. Explain the *why* in the body.
- **Sync with `main` by merging** (`git merge origin/main`). Never rebase or force-push a branch that has been pushed.
- **One PR per issue.** Put `Closes #<n>` in the description and fill in the template. Call out public API changes under **API notes**.
- **Do not merge PRs.** A maintainer reviews and merges.

## Verify before opening a PR

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm api:check
```

All four must pass. Report failures honestly, never paper over them. When `pnpm api:check` fails because you meant to change the public API, run `pnpm api:report`, commit the updated `etc/*.api.md` and describe the change under **API notes**. For rendering or UI changes, also check the demo (`pnpm dev`, http://localhost:5173) in both the dark and light themes.

## Hard rules

- **Vendor-neutral language.** Refer to other products, companies and exchanges by their role ("an exchange", "a market data provider"), not by name, in code, comments, docs, demo data, commits, branch names, issues and PRs.
- **Documented defaults.** Default values, level sets, orderings, labels and keyboard shortcuts each follow a stated rule, written next to the data (see `CONTRIBUTING.md`). A change that replaces such values adds their hashes to `packages/core/test/retired-palette.ts`.
- **Do not add dependencies** to `@chart-on/core` without agreement in the issue. The engine stays framework-free.
- **Do not edit generated output** (`dist/`) or the lockfile by hand.

## Keep the packages light

Every byte in a published package ships to every app that embeds the chart. Write the smallest code that does the job, and measure it.

- **Reuse before writing.** Search `packages/*/src` for an existing helper (maths, colour, formatting, DOM, GL buffers) before adding one. Extend it instead of writing a near-copy.
- **Build only what the issue asks for.** No speculative options, abstractions, fallbacks or "might need it later" code paths.
- **Keep optional features tree-shakeable.** A feature a minimal `createChart` does not use (extra series types, drawing tools, indicators) is an opt-in export, not registered from module top level. No top-level side effects; the packages declare `sideEffects: false` (only `@chart-on/ui` lists its CSS). `packages/core/test/tree-shaking.test.ts` checks what a consumer keeps.
- **Prefer the platform.** Use `Intl`, typed arrays and built-in DOM and WebGL2 APIs instead of hand-rolled equivalents.
- **Prefer data to code.** A table and a loop beat repeated branches that differ only in values.
- **Delete what your change makes dead:** unused exports, helpers, options and CSS rules.
- **Measure the delta.** Run `pnpm build && pnpm size` on `main` and on your branch, and put the gzip change of each bundle in the PR. `pnpm size` measures what apps ship: minified, with `process.env.NODE_ENV` set to `"production"`, then gzipped. Growth over 1 KiB gzip in any bundle needs a reason in the PR. Before running `pnpm size --update` to make room, try to make the change smaller first.

## Project decisions

These are settled. Do not revisit them without an issue discussing the change.

- **Architecture:** a headless engine (`@chart-on/core`, usable on its own with any UI) plus an optional batteries-included widget (`@chart-on/ui`). Core must not depend on the UI package.
- **Rendering:** WebGL2 is required. Do not add a Canvas2D fallback for the GPU-rendered series.
- **License:** Apache-2.0.
- **Independent implementation:** all code is written for this repository; do not copy or adapt code from other projects, whatever their license. Public documentation, papers and standard domain knowledge are good sources: work from the concepts and implement them in the project's own design. New APIs follow `roadmap/design-principles.md`.
- **Data sources:** the repository ships the data source API with generic adapters only (REST, WebSocket, CSV, mock). Exchange-specific adapters belong in separate community packages, not here.
- **Indicators:** authored in TypeScript only, as pure functions with declared inputs and outputs. Do not add a scripting language without an issue agreeing to it.

## Repository map

| Path | Contents |
| --- | --- |
| `packages/core/src/chart.ts` | Chart orchestration: layout, frame loop, axes, crosshair, public view API |
| `packages/core/src/series.ts` | Series types (candles and other styles, histogram, line, heatmap) |
| `packages/core/src/scales.ts` | Time and price scales, including log/percent modes and easing |
| `packages/core/src/gl/` | WebGL2 renderer, shaders and GPU buffers |
| `packages/core/src/drawing/` | Drawing manager and the built-in drawing tools (plugin contract in `types.ts`) |
| `packages/core/src/interaction.ts` | Pointer, wheel, touch and keyboard input |
| `packages/core/test/` | Vitest unit tests |
| `packages/ui/src/` | Shell, toolbar, tool rail, bottom bar, controls; `style.css` theme variables |
| `apps/demo/src/` | Demo app with synthetic data |
| `docs/` | User documentation site (VitePress): `pnpm docs:dev` |
| `roadmap/` | Roadmap notes and proposed APIs |

## Conventions worth knowing

- Redraw through `chart.invalidate()` (whole scene) or `invalidateOverlay()` (crosshair, drawings, labels). Never draw outside the frame loop, except the synchronous redraw in `resize()`.
- `PriceScale.min` and `max` are in coordinate space (log10 in log mode). Use `minPrice`/`maxPrice`, `priceToY` and `yToPrice` for prices.
- Animations step with a frame delta `dt`, respect `prefers-reduced-motion`, and are cancelled by user input.
- Match the style of the surrounding code: naming, comment density, and small functions.
