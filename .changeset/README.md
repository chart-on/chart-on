# Changesets

Each file here records the release type of a change: `patch`, `minor` or `major`. Add one with `pnpm changeset` in any pull request that changes a published package. The `@charton/*` packages share one version, so the highest type among the pending changesets sets the next release for all of them.

The changelog itself is the root [`CHANGELOG.md`](../CHANGELOG.md), not these files. How releases work: [`CONTRIBUTING.md`](../CONTRIBUTING.md#releases).
