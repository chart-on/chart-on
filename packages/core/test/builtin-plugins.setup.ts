import { builtins } from '../src/builtins';
import { Chart } from '../src/chart';
import type { ChartPlugin } from '../src/plugins';

// Heatmaps, volume profiles and the built-in drawing tools are opt-in plugins. Most tests use
// them on a chart made with `new Chart(container)`, so in tests a chart created without a
// `plugins` option gets `builtins()`, as an app passing it would. A test that passes `plugins`
// gets exactly those. `opt-in-features.test.ts` loads fresh modules to see a chart without them.
type Installing = { installCreationPlugins(plugins: readonly ChartPlugin[] | undefined): void };
const proto = Chart.prototype as unknown as Installing;
const install = proto.installCreationPlugins;
proto.installCreationPlugins = function (this: Installing, plugins) {
  install.call(this, plugins ?? builtins());
};
