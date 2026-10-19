---
description: "What a charton version number promises, why every @chart-on package shares one version, which ranges to depend on, and where to read what changed."
---

# Versioning

The `@chart-on/*` packages follow [semantic versioning](https://semver.org/) and are released together. This page covers what a version number tells you and how to keep an app on compatible versions:

- [What a version promises](#what-a-version-promises): which releases can break your code.
- [One version for every package](#one-version-for-every-package): why the packages move in lockstep.
- [Depending on charton](#depending-on-charton): the ranges to put in `package.json`, for apps and for plugins.
- [Upgrading](#upgrading): where each release's changes are described.

## What a version promises

A version is `major.minor.patch`. While charton is before 1.0, the minor number does the job the major number does later:

| Release | Before 1.0 (0.3.1 to …) | From 1.0 (1.3.1 to …) |
| --- | --- | --- |
| Patch | 0.3.2: fixes and backwards-compatible additions | 1.3.2: fixes |
| Minor | 0.4.0: may contain breaking changes | 1.4.0: backwards-compatible additions |
| Major | 1.0.0: the stable API | 2.0.0: breaking changes |

A breaking change is anything that can stop working code: a removed or renamed export, option, event, method, CSS class or variable; a type that no longer accepts what it did; or a changed default or behaviour that apps rely on. New optional options, exports and events are not breaking. The full rules are in [the contributing guide](https://github.com/chart-on/charton/blob/main/CONTRIBUTING.md#deprecations-and-breaking-changes).

Breaking changes are announced before they land. A deprecated API keeps working for at least one minor release before 1.0 (until the next major from 1.0), and development builds log one `charton [deprecated]` warning per API, linking to its entry on the [upgrading page](../upgrading/). Production builds log nothing.

One entry has no stability promise: `@chart-on/core/internal`, which exposes engine internals for tests and experiments.

## One version for every package

`@chart-on/core`, `@chart-on/ui`, `@chart-on/indicators`, `@chart-on/locales`, `@chart-on/ta`, `@chart-on/react`, `@chart-on/vue` and `@chart-on/svelte` always share one version. A release bumps all of them, even the ones whose code did not change, so the rule for staying compatible is simple: **install the same version of every `@chart-on/*` package you use.**

The packages that build on core declare it as a peer dependency (`@chart-on/ui`, the indicators, the locale packs and the framework wrappers), so your app has a single copy of the engine. A mismatch shows up as a peer dependency warning at install time.

To move every package to the newest release at once:

```sh
pnpm update --latest "@chart-on/*"
# or: npm install @chart-on/core@latest @chart-on/ui@latest
```

## Depending on charton

### Apps

Package managers write a caret range by default (`"@chart-on/core": "^0.3.1"`), and it is the right choice before and after 1.0. A caret range never crosses the release that may break:

| Range | Accepts | Excludes |
| --- | --- | --- |
| `^0.3.1` | 0.3.1 to 0.3.x | 0.4.0, which may break |
| `^1.3.1` | 1.3.1 to 1.x.x | 2.0.0 |

So `pnpm update` without `--latest` takes fixes and additions only, and moving to a release that may break is a deliberate edit of the range. Use the same range for every `@chart-on/*` package.

### Plugins and packages that build on charton

A plugin declares the core versions it works with in its `requires` range, which `chart.install` checks against the running core's `CORE_VERSION`, and lists `@chart-on/core` as a peer dependency rather than a dependency, so the app's copy is used. Use a caret range from the oldest version you tested:

```ts
export const myPlugin: ChartPlugin = {
  name: 'my-plugin',
  version: '1.0.0',
  requires: '^0.3.0', // core 0.3.x
  install(ctx) {
    // ctx.registerIndicator(…), ctx.attachPrimitive(…)
  },
};
```

```json
{
  "peerDependencies": { "@chart-on/core": "^0.3.0" }
}
```

Widen the range (`'^0.3.0 || ^0.4.0'`) once you have tested the plugin against the new release. [Plugins](./plugins) covers the rest of the plugin contract.

## Upgrading

Every release is described in three places:

- [`CHANGELOG.md`](https://github.com/chart-on/charton/blob/main/CHANGELOG.md): one line per change, naming the package, grouped by release.
- [Upgrading](../upgrading/): the deprecated APIs with their replacements, and for each release that changes the public API the code to change, with before and after examples.
- [GitHub releases](https://github.com/chart-on/charton/releases): one per version, tagged `v0.3.1`, with that version's changelog.

To upgrade across several releases, read the upgrading page from your current version up, and fix the `charton [deprecated]` warnings your development build logs before moving to the release that removes them.
