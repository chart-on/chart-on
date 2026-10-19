# Changesets

Each file here records the release type of a change: `patch`, `minor` or `major`. Add one with `pnpm changeset` in any pull request that changes a published package. The `@chart-on/*` packages share one version, so the highest type among the pending changesets sets the next release for all of them.

The changelog itself is the root [`CHANGELOG.md`](../CHANGELOG.md), not these files. A maintainer turns the pending changesets into a release with `pnpm version-packages`: [`CONTRIBUTING.md`](../CONTRIBUTING.md#releases).
