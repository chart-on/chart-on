# Contributing

Thanks for helping build charton. This guide covers how work is coordinated, how to set up the repo, and the conventions every change follows. The same rules apply to people and to AI coding agents (agents: see also [`AGENTS.md`](AGENTS.md)).

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md). Questions go to Discussions rather than issues: see [`SUPPORT.md`](SUPPORT.md). Report vulnerabilities privately as described in [`SECURITY.md`](SECURITY.md).

## Maintainers

| Maintainer | GitHub |
| --- | --- |
| Chia | [@sherwinchia](https://github.com/sherwinchia) |
| Boy Sugijakko | [@boysugi20](https://github.com/boysugi20) |

The maintainers are the only members of the `chart-on` GitHub organization and the only people with write access to this repository. They triage and assign issues, review and merge pull requests, cut releases ([Releases](#releases)) and own the `@chart-on/*` packages on npm.

Everyone else takes part through issues, Discussions and pull requests from a fork: open or comment on an issue, claim it, and send the change as a pull request that a maintainer reviews. Nobody, maintainers included, pushes to `main` directly: a ruleset lets changes land only through a pull request, after the CI checks pass (typecheck, tests and build, the browser tests and the framework examples), and blocks force pushes and deleting the branch. A maintainer may merge their own pull request once it is green. Workflows on pull requests from first-time contributors run after a maintainer approves them.

## Workflow: every change starts from an issue

Issues are how we avoid two people building the same thing, and how scope gets agreed before code is written.

1. **Find or open an issue.**
   - Browse [open issues](../../issues) and the roadmap epic (label `epic`) first.
   - If nothing fits, open one with the **Feature request** or **Bug report** form. Describe the goal, scope and acceptance criteria.
   - Small fixes such as typos can skip this step. Anything that changes behaviour or public API needs an issue.
2. **Claim it.** Comment that you are taking it. Maintainers assign themselves; other contributors are assigned by a maintainer. If an issue is already assigned or claimed, ask in the thread before starting.
3. **Agree on scope in the issue.** Raise design questions, API shape and trade-offs there, not in the PR. If scope changes while you work, update the issue.
4. **Branch from an up-to-date `main`** (in a fork if you do not have write access).

   | Kind | Branch name |
   | --- | --- |
   | Feature | `feat/<issue>-short-name` (e.g. `feat/2-indicator-framework`) |
   | Bug fix | `fix/<issue>-short-name` |
   | Docs | `docs/<issue>-short-name` |
   | Tooling / CI | `chore/<issue>-short-name` |

5. **Commit in small, focused steps** using [Conventional Commits](#commit-messages).
6. **Open one pull request per issue** with `Closes #<issue>` in the description, and fill in the PR template.
7. **Review and merge.** A maintainer reviews. Address feedback with new commits so reviewers can see what changed.

Never commit directly to `main`; the [ruleset](#maintainers) rejects it.

### Keeping your branch current

Bring in new `main` commits by **merging** (`git merge origin/main`), not by rebasing a branch you have already pushed. Rebasing rewrites commits other people or open reviews may depend on, and requires a force-push. Rebasing a local branch that nobody else has seen is fine.

When you resolve conflicts, explain the resolution in the merge commit message.

## Development setup

Requirements: Node.js 22.18+ (`pnpm check:csp` runs a TypeScript file directly) and pnpm 10 (the exact version is pinned in `packageManager`; `corepack enable` picks it up).

```bash
pnpm install
pnpm dev        # demo at http://localhost:5173
pnpm test       # vitest
pnpm typecheck
pnpm build
```

Run **`pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm api:check`** before opening a PR. All four must pass.

### Repository layout

| Path | What lives there |
| --- | --- |
| `packages/core` | `@chart-on/core`: framework-free engine (WebGL2 + Canvas2D rendering, scales, series, drawings, interaction) |
| `packages/core/test` | Unit tests (vitest) for core logic |
| `packages/ui` | `@chart-on/ui`: vanilla TS shell (toolbar, tool rail, bottom bar, menus) and `style.css` |
| `apps/demo` | Playground with synthetic data; resolves packages from source for instant reloads |
| `e2e` | Browser tests (Playwright): the strict-policy page, keyboard, focus and accessibility-tree tests, and screenshot tests, run with `pnpm test:browser` |
| `docs` | Documentation site (VitePress); `pnpm docs:dev` serves it, live examples render real charts from source |
| `examples` | Private example packages, never published: a plugin starter, a script-tag page, and framework example apps that `node scripts/check-examples.mjs` builds and renders (outside the root build, typecheck and size budgets) |
| `etc` | API reports of the published entries (`pnpm api:report`), one `*.api.md` each |
| `roadmap` | Roadmap notes and proposed APIs |

## Conventions

### Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`.

- **Types:** `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `chore`.
- **Scopes:** `core`, `ui`, `ta`, `indicators`, `demo`, or omit the scope for repo-wide changes.
- **Summary:** imperative, lower case, no trailing period, under ~72 characters.
- **Body:** explain *what* and *why* when the summary is not enough. Reference issues as `Refs #12`. Use `Closes #12` in the PR description rather than in individual commits.

```text
fix(core): keep drawing shape when moving it on a log scale

Moves were applied as a fixed price delta, which stretches drawings in
log mode. Apply the move as a price ratio there instead.

Refs #10
```

### Code

- **TypeScript strict mode.** No `any` in public APIs. Keep public types exported from each package's `src/index.ts`.
- **Match the surrounding code:** naming, comment density, and small focused functions.
- **Tests:** add unit tests in `packages/core/test` for new logic (math, scales, data handling, serialization). Rendering changes should be checked in the demo, in both the dark and light themes.
- **Performance:** keep per-frame work proportional to what is visible, avoid allocations in hot paths, and redraw only through `invalidate()` / `invalidateOverlay()`.
- **Motion:** animations must respect `prefers-reduced-motion`, and be cancellable by user input.
- **Accessibility:** interactive controls need accessible names and keyboard access.
- **Indicators:** written in TypeScript only, as pure functions with declared inputs and outputs. Do not add a scripting language without an issue that agrees to it first.

### Vendor-neutral language

Charton is vendor-neutral. Refer to other products, companies and exchanges by their role ("an exchange", "a broker", "a market data provider"), not by name, in code, comments, docs, demo data, commit messages, branch names, issues and PRs.

There is one exception. The `/preview` docs page credits the market data provider and the library it reads live data through, by name, because the maintainers asked for that credit in [#3](https://github.com/chart-on/charton/issues/3). The exception covers only:

- the credit banner in `docs/.vitepress/theme/Preview.vue`
- the data-source code and its comment in `docs/.vitepress/theme/preview.ts`
- the market data library's dependency in the private `docs` package
- the issue and PR that added the page (#3, PR #12)

Everything else stays vendor-neutral, including the other docs pages, the demo and the examples. A new exception needs its own issue agreeing to it first.

### Independent design and implementation

Charton is designed and written independently, and every contribution must be your own work. Do not copy, port, translate or closely paraphrase another project's source, bundles, type declarations, shaders, CSS, colour palettes, font stacks, icons, SVG paths, images, documentation or sample data. Design API names, option shapes and file layout from charton's own requirements. Standard industry terms (OHLC, candle, crosshair, bar spacing, log scale) are shared vocabulary and fine to use. To propose a behaviour, describe it in the issue in terms of what users need, and implement from that description. If you are unsure whether something is original enough, raise it in the issue before committing.

Design data is designed too: default values and level sets, menu and catalogue orders, group names, labels, keyboard shortcuts, settings structure and example payloads. Each follows a stated requirement or rule, written next to the data in a code comment or in the docs, so a reviewer can check the value against it and the next contributor can extend it consistently. Good rules are a domain definition (powers of the golden ratio), a platform default (`Intl`), a convention in [`roadmap/design-principles.md`](roadmap/design-principles.md), or a stated order such as anchor count or alphabetical. The rule is the justification for a value; it does not need comparing with other software. Defaults the project has replaced are kept as hashes in `packages/core/test/retired-palette.ts`, and the `default-palette.test.ts` tests in `packages/core/test` and `packages/ui/test` fail if one returns. A change that replaces such values adds their hashes there, computed from the code on `main` before the change.

### Public API changes

Breaking or notable API changes must be called out in the PR description under an **API notes** heading, and reflected in `README.md`.

Every public entry of a published package (`@chart-on/core`, `@chart-on/core/testing`, `@chart-on/ui`, `@chart-on/react/shell` and so on) has an API report in [`etc/`](etc/), written by API Extractor from the built declarations: each export with its full signature, plus warnings such as a type that is used but not exported (`ae-forgotten-export`). After `pnpm build`, `pnpm api:check` fails when a report no longer matches the API; CI runs it. When the change is intended, run `pnpm api:report` and commit the updated report, so the API change shows up as a diff in review.

`@chart-on/core/internal` re-exports engine internals that the main entry leaves out, such as the `Pane` and `Timeline` classes, for tests and code that reach below the public API. It has no stability promise and no page in the API reference. Plugin-author APIs (primitives, custom series, the drawing tool contract) stay in the main entry; a type that public signatures use stays nameable there, as a type if its class moves.

The API reference on the docs site is generated from the same doc comments: `pnpm api:docs` writes it as Markdown into `docs/api/` (not checked in), and `pnpm docs:dev` and `pnpm docs:build` run it first.

### Deprecations and breaking changes

Users upgrade when upgrades are predictable. These rules cover APIs that shipped in a published release. An API no release has contained yet can be renamed or removed outright, without a deprecation: no app depends on it. So:

- **What is breaking.** Removing or renaming an export, option, event, method, CSS class or token; changing a type so that code which compiled no longer does (narrowing a parameter, widening a return or payload type, making an optional field required); changing a default or behaviour that existing code relies on. Adding optional fields, exports or events is not.
- **Deprecate before removing.** Keep the old name working and point it at the new one. A deprecation breaks nothing, so it can ship in a patch release. Before 1.0 the old API then lives until a later minor release at the earliest (deprecated in 0.3.1, removed in 0.4.0 at the earliest); from 1.0, until the next major.
- **Mark it.** A JSDoc `@deprecated` tag on the old symbol that names the replacement. Where the tag would mislead (one form of a union type), say it in the comment instead.
- **Warn once.** Where the old API is used, log `charton [deprecated]: <message> (<upgrading page>#<id>)` once per page load, in development builds only, with `id` the anchor of its entry on the upgrading page. Guard it like `devWarn` in `packages/core/src/util/dev.ts`, so production bundles drop it.
- **Document it in the same PR.** An entry under "Deprecated APIs" in `docs/upgrading/index.md`, headed with the old name in backticks, with the removal release and before/after code. A test fails when an `@deprecated` tag has no entry.
- **Removal.** Removing a deprecated API is a breaking change: note it in the release's section of the upgrading page.

### Versioning and changelog

The packages follow [semantic versioning](https://semver.org/), with the usual pre-1.0 reading:

- **Before 1.0:** a minor release (0.3 to 0.4) may contain breaking changes, still announced through the deprecation steps above. A patch release (0.3.1 to 0.3.2) has fixes and backwards-compatible additions only.
- **From 1.0:** breaking changes only in a major release, additions in a minor release, fixes in a patch release.

Each change gets the release type of the first row it matches, read from the top:

| Change | Before 1.0 | From 1.0 |
| --- | --- | --- |
| Breaking, as defined in [Deprecations and breaking changes](#deprecations-and-breaking-changes), including removing a deprecated API | `minor` | `major` |
| New option, export, event, method, CSS class or token, or new behaviour behind an option that is off by default | `patch` | `minor` |
| Deprecation that keeps the old API working | `patch` | `minor` |
| Changed default look or behaviour that keeps every API working and needs no change in app code | `patch` | `minor` |
| Fix that changes no API | `patch` | `patch` |
| Publishes nothing: tests, docs, the demo, CI | no changeset | no changeset |

A change that matches several rows takes the highest. When it is unclear whether apps rely on a default, treat changing it as breaking. The reviewer checks the type in the PR, and the maintainer cutting a release checks every pending changeset against this table ([Releasing an update](#releasing-an-update), step 1). A published version number is never used again, even when a release went wrong (see [Releases](#releases)).

All published packages (`packages/*`) share one version and are released together, so an app installs the same version of each; `pnpm check:packages` fails when their versions differ. What this means for users, and which ranges to depend on, is in the [versioning guide](docs/guide/versioning.md).

A PR that changes a published package records two things:

- **A changeset**, the release type. Run `pnpm changeset`, pick any package the PR changes and `patch`, `minor` or `major` from the table above, and commit the file it writes to `.changeset/`. The summary can be one line; the changelog is written separately. The highest type among the pending changesets sets the next version of every package. Changes that publish nothing (tests, docs, the demo, CI) need none.
- **A changelog line** under **Unreleased** in [`CHANGELOG.md`](CHANGELOG.md) for user-facing changes (features, fixes, deprecations, breaking changes), one line each, naming the package. A release moves those lines under its version.

### Releases

Releases are cut by a [maintainer](#maintainers) whenever the changes on `main` should reach npm: there is no fixed schedule. Every release stages all eight packages on npm at one new version and creates a GitHub release `v<version>` whose notes are that version's `CHANGELOG.md` section. The versions go public once an owner approves them. Pushes to `main` that are not a release publish nothing.

#### Releasing an update

1. **Check what is pending.** Every PR that changed a published package added a changeset to `.changeset/` and a line under **Unreleased** in `CHANGELOG.md` ([Versioning and changelog](#versioning-and-changelog)). `pnpm changeset status --verbose` prints the next version of every package: the highest type among the pending changesets (`patch` gives 0.1.0 to 0.1.1, `minor` gives 0.1.0 to 0.2.0). If it lists no packages, there is nothing to release. Read each changeset against the [release type table](#versioning-and-changelog) and correct the ones that do not match in the release pull request, saying which and why in its description.
2. **Open a release issue** titled `Release <version>`, as for any other change, and claim it.
3. **Version the packages** on a branch from an up-to-date `main`:

   ```bash
   git switch -c chore/<issue>-release-<version> origin/main
   pnpm install
   pnpm version-packages
   ```

   `changeset version` bumps every package to the new version and deletes the changesets. `scripts/version-packages.mjs` then sets `CORE_VERSION` (with its line in `etc/core.api.md`), moves the **Unreleased** notes of `CHANGELOG.md` and of the [upgrading page](docs/upgrading/index.md) under the new version, dated today, and points the changelog's upgrading links at it.
4. **Edit the notes.** Read the new `CHANGELOG.md` section as a user would: one line per change, naming the package, with breaking changes and deprecations linked to their upgrading entries. It becomes the GitHub release text.
5. **Check and open the pull request.** Run `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm api:check` and `pnpm check:packages`, and `node scripts/version-packages.mjs notes <version>` to print the release notes. Open a pull request titled `chore: release <version>` with `Closes #<issue>`. Nothing else goes in it.
6. **Merge it.** Fix the date in `## <version> (<date>)` first if it merges on a later day. Merging runs [`.github/workflows/release.yml`](.github/workflows/release.yml): on a push to `main` with no pending changesets, when the current version has a `CHANGELOG.md` section and no GitHub release yet, it runs `pnpm release` (build, `pnpm check:packages`, then [`scripts/stage-packages.mjs`](scripts/stage-packages.mjs), which packs each package npm does not have yet with `pnpm pack`, so `workspace:` ranges become real versions, and stages it with `npm stage publish`) and creates the GitHub release. `pnpm release --dry-run` shows what would be staged without uploading anything.
7. **Approve the staged versions.** A staged version is not public until an [owner](#npm-setup) approves it with two-factor authentication: on npmjs.com, on the package's **Staged Packages** tab, or with `npm stage list @chart-on/<package>` and `npm stage approve <stage-id>` (npm 11.15.0 or later). Approve all eight soon after the run, since the GitHub release is already out: `core` and `ta` first, then `ui`, then the rest, so each package's dependencies are public before it is.
8. **Check the release.** The **Release** workflow run on the merge commit is green, the GitHub release `v<version>` exists, and every package shows the new version: `npm view @chart-on/core version` (and the same for `ui`, `indicators`, `locales`, `ta`, `react`, `vue` and `svelte`). A first version of a new package can take a few minutes to show up on the public registry.

**When staging fails**, read the `Stage` step of the run. A rerun skips the packages npm already has, but staging a version that is already staged fails, so first approve the versions the failed run did stage (step 7). Then, after fixing the cause, rerun the workflow (`gh run rerun <run id>`, or the **Re-run jobs** button): it stages the rest and creates the GitHub release. A version npm has accepted can never be published again, even after unpublishing it, so never fix a broken release by reusing its number: release the fix as the next patch. `npm deprecate @chart-on/<package>@<version> "<reason>"` marks a bad version so installs warn about it.

**To publish by hand** (when the workflow cannot), a maintainer who is an owner on npm logs in with `npm login`, checks out `main` at the release commit, runs `pnpm release` (npm 11.15.0 or later) and approves the staged versions as in step 7. The next workflow run then only creates the GitHub release; rerun the last one to get it at once.

#### npm setup

- **Scope and owners.** The packages publish under the `@chart-on` scope, which belongs to the `chart-on` npm account (the `@charton` scope belongs to another account). The maintainers are the packages' owners (`npm owner ls @chart-on/core`); add or remove one with `npm owner add <npm user> @chart-on/<package>` or `npm owner rm`, for all eight packages. Every owner account has two-factor authentication with a security key or passkey (npm no longer sets up authenticator-app codes).
- **Trusted publishing.** The workflow stages releases with npm trusted publishing (OIDC), so no npm token is stored anywhere: npm checks that the request comes from `release.yml` in this repository. Each package's **Settings** page on npmjs.com has the trusted publisher (GitHub Actions, organization `chart-on`, repository `chart-on`, workflow `release.yml`, no environment, allowed actions `npm stage publish` only), and its publishing access is set to require two-factor authentication and disallow tokens. Renaming the repository or the workflow file breaks publishing until the trusted publisher of every package is updated. Leave **Allow npm publish** off: with staging only, no version goes public without an owner's approval. Staging needs npm 11.15.0 or later, which the workflow installs.
- **New packages.** Trusted publishing can only be configured for a package that already exists on npm. The first version of a new package is published by hand (above) by an owner, then its trusted publisher and publishing access are set like the others before the next release.

### Package manifests

The published packages (`packages/*`) declare the fields bundlers and type checkers read: `exports` with `types` first and `default` last, `./package.json`, `sideEffects`, `engines`, `browserslist`, `repository` and `publishConfig.access` set to `public` (scoped packages publish as restricted otherwise). `browserslist` is also the Vite build target, so changing the supported browsers means changing it in every package. After `pnpm build`, `pnpm check:packages` validates the manifests, that every entry point exists, that every bundle with third-party code has a `THIRD-PARTY-NOTICES.txt` beside it, and that every tarball (`pnpm pack --dry-run`) ships the package's `README.md` and copies of the root `LICENSE` and `NOTICE` (when you change a root file, copy it into each package; links in a package README are absolute URLs, because the API reference copies the README into the docs site, where relative links do not resolve), and `pnpm check:csp` scans the built files for what a strict content security policy blocks (docs/guide/security.md); CI runs both. `packages/core/test/tree-shaking.test.ts` checks what a consumer's bundle keeps.

### Bundle size budget

After `pnpm build`, `pnpm size` measures the built bundles and fails when one is over its budget in [`scripts/size-budget.json`](scripts/size-budget.json): `@chart-on/core`, `@chart-on/ui` (its modules and stylesheet) and the single-file browser build. It measures what an app ships: each built JavaScript file is minified with `process.env.NODE_ENV` set to `"production"`, so development-only code folds away the way it does in an app's production build, then gzipped. Stylesheets and Svelte components are gzipped as built. It also bundles small apps from the built core (`bundles`, named by what they import, such as `createChart` with a data source) and checks what they cost after tree shaking. CI runs it. Budgets sit about 10% above the current sizes, rounded up to a quarter KiB. When a change needs more room, run `pnpm size --update` to reset every budget to the current size plus 10%, commit the JSON file, and say in the PR what grew and why. The `createChart` bundle is the minimal chart from the [scope](roadmap/design-principles.md#scope), a chart with no plugins and no data source. It has no fixed size target; when a change moves a part out of it, lower its budget by what was saved.

The budget is a ceiling, not an allowance. Every change should be as small as it can be: reuse existing helpers, build only what the issue asks for, keep optional features as opt-in exports that tree-shake away, prefer platform APIs (`Intl`, typed arrays) to hand-rolled code, and delete code your change leaves unused. Put the gzip change of each bundle (`pnpm size` on `main` and on your branch) in the PR. Growth over 1 KiB gzip in any bundle needs a reason there, and `pnpm size --update` comes only after trying to make the change smaller.

To see where the size goes, run `pnpm size:report` after `pnpm build`. It reads the built `@chart-on/core` and `@chart-on/ui` modules with their source maps and lists the largest source modules: the minified bytes each one contributes, and how much the gzipped file would shrink without them. It also totals each folder and warns when a module is bundled from two paths (two copies of a package). Pass `--top <n>` for more rows, or the path of another built file, such as `packages/ui/dist/browser/charton.js`.

The package builds minify their output fully, keeping only the pure annotations bundlers need for tree shaking, and strip comments and spacing from the GLSL shaders (`scripts/build-shrink.ts`). `packages/core/test/build-shrink.test.ts` checks that the shaders keep their tokens and lines.

### Browser tests

`pnpm test:browser` runs the [Playwright](https://playwright.dev) tests in `e2e/` in headless Chromium. They are not part of `pnpm test` and download nothing: install the browser once with `pnpm exec playwright install chromium` (again after a Playwright upgrade asks for it). The configuration is [`playwright.config.ts`](playwright.config.ts); new browser tests go in `e2e/` as `*.spec.ts` files.

`e2e/strict-page.spec.ts` builds the page in `e2e/strict-page/` and serves it with the strict content security policy from the [Security page](docs/guide/security.md) (Trusted Types required, no inline scripts or styles, no other origins). The page draws a core chart with candles, a heatmap, drawings and indicators, and the UI shell with its settings, drawing, indicator and symbol search dialogs open, with markup in titles, drawing text and search results. The test fails on any policy violation, console error, page error or request to another origin, in the dark and light themes. Run it when a change touches the DOM, styles or anything that loads resources. CI runs it in its own job; while CI is off, run it locally.

`e2e/keyboard.spec.ts` drives the UI shell in `e2e/keyboard-page/` (toolbar, rail, chart with a legend, navigator, bottom bar and a symbol search) with real key presses, in the dark and light themes: one Tab stop per bar in order with a visible focus ring on each stop, arrow keys, Home and End in the bars, Enter, Space and Shift+Enter on their buttons, F6 and Shift+F6 between areas (hidden ones skipped, nothing while the symbol search is open), menus opened from the keyboard taking focus and giving it back on Escape, and Tab reach of the legend and scroll-to-newest buttons. `e2e/a11y-tree.spec.ts` checks what a screen reader reads from the same page, through the browser's accessibility tree: the bars as named toolbars with their orientation, the chart as a chart with its summary as description, polite live regions for announcements and the crosshair readout, and menus opened from the keyboard as named lists of options or menu items with their selected or checked state. Run both when a change touches focus, keys, focus styles, roles or labels; a pass with a real screen reader is still worth doing before a release.

`e2e/visual.spec.ts` is a set of screenshot tests. The page in `e2e/visual/` draws fixed-size scenes from seeded data: candles with a volume pane, a line on a percent scale, an RSI pane under a log-scale chart, drawings (a trend line and a Fibonacci retracement) and the UI shell. The test screenshots each scene in the dark and light themes and compares it with a baseline PNG in `e2e/visual/__screenshots__/<platform>/`, using Playwright's built-in comparison (no differing pixel allowed, after its small per-pixel color threshold). The `visual` project in `playwright.config.ts` fixes what would make pixels vary: viewport and device pixel ratio 1, UTC time zone, `en-US` locale, reduced motion, a fixed clock, and WebGL on the software renderer so the GPU does not matter.

- **Updating baselines.** After a deliberate rendering change, run `pnpm test:browser --project=visual --update-snapshots`, look at the changed PNGs, and commit them with the change so the review shows old and new images side by side. Never update them to make an unexplained difference go away. On a failure Playwright writes the expected, actual and diff images to `test-results/`.
- **Per platform.** Text renders differently on each operating system, so baselines are kept per platform (`darwin`, `linux`, `win32`) and compared only on the platform that made them. Baselines are checked in for macOS and Linux; on a platform without baselines the test fails with "A snapshot doesn't exist" and writes candidates you can commit after checking them.
- **Linux baselines.** CI runs the browser tests in the official Playwright container image for the locked `@playwright/test` version (`ci.yml`, `browser` job), and the Linux baselines are made in that same image, so they match on any machine with Docker. To update them, run from the repository root:

  ```bash
  docker run --rm --platform linux/amd64 --ipc=host -v "$PWD":/src mcr.microsoft.com/playwright:v1.63.0-noble \
    bash -c 'mkdir /work && tar -C /src --exclude=node_modules --exclude=dist --exclude=.git -cf - . | tar -xf - -C /work &&
      cd /work && corepack enable && pnpm install --frozen-lockfile &&
      pnpm test:browser --project=visual --update-snapshots; cp -r e2e/visual/__screenshots__/linux /src/e2e/visual/__screenshots__/'
  ```

  The repository is copied without `node_modules`, since the host's installed packages are built for the host. `linux/amd64` matches the CI runners; on an Arm machine Docker emulates it, which is slower. Use the image tag of the locked Playwright version, and bump it in `ci.yml` and here when Playwright is updated.
- **Keep them small.** Add a scene only for something the existing ones do not draw, and keep it at the fixed small sizes in `e2e/visual/page.css`.

`e2e/demo/*.demo.ts` drive the demo app the way a user would, in the dark and light themes: the data pages, symbol search, the command palette, favourites, toolbar customization, toasts, bar replay, order drafts and folded order labels, drawing and indicator templates and defaults, pasted and picked images, the watermark row, the depth lane and ladder, area and baseline fills, and the scroll-to-newest button. Run them with `pnpm test:browser --project=demo`. `e2e/demo/vite.config.ts` builds the demo for production in the `e2e` mode, which keeps its charts on `window` (`apps/demo/src/expose.ts`), and the tests read chart state from there; only pasted images, fills and the depth lane are checked on pixels, sampled from screenshots rather than compared with baselines. Each test also saves screenshots to `test-results/demo-review/` for a person to look at. When a demo check is left on a pull request ("check in the demo, dark and light"), add it here instead.

`e2e/heatmap.spec.ts` (the `heatmap` project) checks heatmap cell reduction on the GPU: the page in `e2e/heatmap-page/` draws one bright cell in a 2,000-row grid at 2 columns and 4 rows per device pixel, the test pans it by sub-pixel steps and reads pixels back from screenshots, expecting the cell in exactly the pixel holding its centre at every offset with `cellReduce: 'max'` and `'sum'`, two cells sharing a pixel at their max and their sum, and the cell missing at some offsets with `'nearest'`. It also compares a zoomed-out heatmap in a short pane with baselines in `e2e/heatmap-page/__screenshots__/<platform>/`, in both themes. Update them like the `visual` ones: `pnpm test:browser --project=heatmap --update-snapshots` for the macOS baselines, and for the Linux baselines the container command above with the project and the copy changed:

```bash
docker run --rm --platform linux/amd64 --ipc=host -v "$PWD":/src mcr.microsoft.com/playwright:v1.63.0-noble \
  bash -c 'mkdir /work && tar -C /src --exclude=node_modules --exclude=dist --exclude=.git -cf - . | tar -xf - -C /work &&
    cd /work && corepack enable && pnpm install --frozen-lockfile &&
    pnpm test:browser --project=heatmap --update-snapshots; cp -r e2e/heatmap-page/__screenshots__/linux /src/e2e/heatmap-page/__screenshots__/'
```

`e2e/a11y-rtl.spec.ts` (project `a11y-rtl`, page `e2e/a11y-rtl-page/`) checks the UI shell in forced-colours mode and in a right-to-left layout. With `forced-colors: active` emulated in the dark and light system palettes, it checks that the chart theme takes the system colours, that the axis text is drawn in them and that the rail and chart focus rings show. In a right-to-left shell in Arabic (`ar-EG`, grouped prices) it checks that the rail, bottom bar, main price axis and legend sit on the mirrored side while time runs left to right, that prices use the locale's digits and grouping, and that drawing text mixing scripts is drawn in the base direction the browser gives the same text with `dir="auto"`. Each case also has screenshot baselines in `e2e/a11y-rtl-page/__screenshots__/<platform>/`, with the same fixed settings as the `visual` project; update them with `--project=a11y-rtl --update-snapshots`.

`e2e/landing.spec.ts` (the `landing` project) builds the docs site with `pnpm docs:build`, serves it with `vitepress preview` on port 4186 and drives the landing page at 1280 × 800 and 375 px wide, in the dark and light schemes: the hero, the floating nav, the scheme pickers, the order flow tile with its depth lane, the "Make it yours" tile and text that runs off the page. It reads behaviour from the DOM and samples pixels of the chart tiles, fails on any console error, and compares a few regions with baselines in `e2e/landing/__screenshots__/<platform>/`, taken with the clock paused. Run it with `pnpm test:browser --project=landing` (update the baselines as above with `--update-snapshots`). The docs build takes a minute or two, so the docs server only starts when the landing tests can run; it is built fresh on every run, so port 4186 must be free. Run it when a change touches the landing page (`docs/.vitepress/theme/site/`) or the theme around it.

### Benchmarks

`pnpm build && pnpm bench` runs [`packages/core/test/render.bench.ts`](packages/core/test/render.bench.ts) against the built engine: `setData` with 100,000 and 1,000,000 candles, and the time of one frame while panning and zooming over 1,000,000 candles (including fully zoomed out with bar grouping). The benchmarks run under Node with the test environment, where WebGL and Canvas2D calls do nothing, so frame times measure the chart's CPU-side work (layout, autoscale, scans, grouping, vertex packing, axes and labels), not GPU time or paint. Use them to compare changes on one machine, not to predict frame rates in a browser.

GPU time needs a real GPU, so it is measured by hand: `node e2e/heatmap-page/bench.ts` opens the heatmap page in Chromium on the hardware renderer, pans a large grid every frame and prints the GPU milliseconds per frame (from a timer query, counting only frames the chart drew in) for each `cellReduce` mode in a few zoom cases. Chromium picks the GL backend under WebGL; `--gl=<backend>` passes `--use-angle=<backend>` to it, to measure on the platform's native backend. `--frames`, `--dpr` and `--headed` are described at the top of the script. To compare with another version, serve that checkout's build of the page on the same port first; the script uses whatever answers there.

On a pull request, CI runs the same benchmark file against the base branch's build and the branch's build, twice each and alternating, and fails when a benchmark's median is more than 25% slower than on the base branch (the faster of the two runs counts on each side). The comparison table is in the job summary. To compare locally, save runs with `pnpm bench --reporter=json --outputFile=<file>` (set `CHARTON_BENCH_CORE` to another build's `packages/core/dist` to benchmark that build) and run `node scripts/compare-bench.mjs --base <file> --head <file>`.

A benchmark measures the same work on every run. tinybench runs as many iterations as fit in its time, and a frame's cost can depend on what is in view, so a task that pans or zooms resets its position and state in its `beforeAll` and cycles over a fixed window instead of carrying on from where the last task or run stopped ([`order-flow.bench.ts`](packages/core/test/order-flow.bench.ts) shows how). Otherwise the base and head runs measure different data and the check fails on changes that touch no engine code.

[`packages/core/test/render-counts.test.ts`](packages/core/test/render-counts.test.ts) runs the same scenarios with `renderStats` on and checks what each frame asks of the GPU: draw calls, instances against the bars on screen, buffer and texture uploads and their bytes, and the memory held. Counts do not depend on the machine, so these checks are part of `pnpm test` and fail a change that adds GPU work per frame, such as re-sending every bar while panning, even when the timings barely move.

## Labels

| Label | Meaning |
| --- | --- |
| `epic` | Tracking issue that groups related issues |
| `area: core` / `area: ui` / `area: demo` / `area: infra` | Which package or part of the repo is affected |
| `enhancement`, `bug`, `documentation`, `question` | Kind of work |
| `good first issue`, `help wanted` | Good entry points for new contributors |

### Finding a first issue

New here? Start with [`good first issue`](../../issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22+no%3Aassignee) (small and well scoped, with pointers to the code involved) or [`help wanted`](../../issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22+no%3Aassignee) (larger, and not planned by the maintainers soon). Both links show only unassigned issues. Comment on the one you pick and a maintainer assigns it to you.

Maintainers triage new issues weekly. An issue gets `good first issue` when its scope and acceptance criteria are clear, it touches one area, and it needs no design decision; the issue names the files to start from. It gets `help wanted` when the scope is agreed but nobody on the team is planning to do it. Both labels come off once someone is assigned. If a labelled issue turns out bigger than it looked, say so in the thread and we relabel it.

## License

The project is licensed under the [Apache License 2.0](LICENSE). By submitting a contribution, you agree that it is licensed under the same terms (section 5 of the license). Only contribute code you wrote yourself. Do not copy or adapt code from other projects, even under compatible licenses. Learning from public documentation is fine, but design and write the implementation independently. New APIs follow [`roadmap/design-principles.md`](roadmap/design-principles.md).

## Reporting bugs and requesting features

Use the issue forms. A good bug report includes steps to reproduce, the expected vs. actual behaviour, and browser/OS details. A good feature request describes the problem first, then a proposed API or behaviour.
