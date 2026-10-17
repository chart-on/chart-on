<!-- The widget with synthetic data, a theme switch and a crosshair readout. -->
<script lang="ts">
  import { createMockDataSource } from '@charton/core';
  import type { ChartShell as Shell } from '@charton/ui';
  import { ChartShell } from '@charton/svelte/shell';

  // Created once with the component, so the source stays stable and the symbol loads once.
  const dataSource = createMockDataSource();
  let shell: Shell | null = $state(null);
  let theme: 'dark' | 'light' = $state('dark');
  let price: number | null = $state(null);
</script>

<div style="display: flex; flex-direction: column; height: 100vh">
  <header style="display: flex; gap: 12px; align-items: center; padding: 8px; font-family: system-ui">
    <button type="button" onclick={() => (theme = theme === 'dark' ? 'light' : 'dark')}>Theme: {theme}</button>
    <button type="button" onclick={() => shell?.chart.fitContent()}>Fit</button>
    <span>Crosshair: {price === null ? '-' : price.toFixed(2)}</span>
  </header>
  <ChartShell
    bind:shell
    style="flex: 1; min-height: 0"
    {theme}
    {dataSource}
    symbol="DEMO"
    interval="1h"
    on={{ 'crosshair:move': (e) => (price = e ? e.price : null) }}
  />
</div>
