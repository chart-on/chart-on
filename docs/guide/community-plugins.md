---
description: "Plugins made by the community, and how to get yours listed."
---

# Community plugins

Plugins built on the [plugin contract](./plugins), maintained by their authors. Exchange data adapters belong here too: the repository ships generic data adapters only.

No plugins are listed yet.

| Plugin | What it adds | Works with core |
| --- | --- | --- |

## Get yours listed

Open a pull request that adds one row to the table above. A listed plugin:

- is published on npm with the `charton-plugin` keyword, and installs with `chart.install(plugin)`;
- has a `requires` range that includes the current core release, and its tests pass against it;
- prefixes its ids with its package name and keeps `@chart-on/core` a peer dependency (see [Writing and publishing a plugin](./plugins#writing-and-publishing-a-plugin));
- has an open source license and a README that says what it adds;
- describes other products and companies by their role, not by name, in its listing.

Listing is not an endorsement or a review of the code. A plugin that stops working with the current core, or whose repository goes away, is removed.
