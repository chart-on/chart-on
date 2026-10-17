<!--
  Renders the same markup on the server and in the browser. On the server the
  chart is only its container `div`; the chart itself is created after
  hydration, when the component mounts.
-->
<script lang="ts">
  import { createMockDataSource } from '@charton/core';
  import { Chart } from '@charton/svelte';

  const intervals = ['1m', '1h', '1d'] as const;

  // Creating the source does not touch the network or the DOM, so it is safe on the server too.
  const dataSource = createMockDataSource();
  let interval: (typeof intervals)[number] = $state('1h');
</script>

<main style="font-family: system-ui; padding: 16px">
  <h1 style="font-size: 20px">Server-rendered chart</h1>
  <div role="group" aria-label="Interval" style="display: flex; gap: 8px; margin-bottom: 8px">
    {#each intervals as value (value)}
      <button type="button" aria-pressed={value === interval} onclick={() => (interval = value)}>{value}</button>
    {/each}
  </div>
  <Chart id="chart" style="height: 420px" {dataSource} symbol="DEMO" {interval} />
</main>
