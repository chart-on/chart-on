<!-- Adds a line series once the chart exists, and removes it in the effect's clean-up. -->
<script lang="ts">
  import type { Chart } from '@charton/core';
  import { useChart } from '@charton/svelte';

  let { charts, order }: { charts: (Chart | null)[]; order: string[] } = $props();
  const shared = useChart();
  $effect(() => {
    const chart = shared.current;
    charts.push(chart);
    if (!chart) return;
    const series = chart.addLine();
    return () => {
      order.push('clean-up');
      chart.removeSeries(series);
    };
  });
</script>
