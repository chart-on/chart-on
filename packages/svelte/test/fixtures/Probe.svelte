<!-- Records every value `useChart()` (and `useChartShell()` with `shell`) holds. -->
<script lang="ts">
  import { useChart } from '@chart-on/svelte';
  import { useChartShell } from '@chart-on/svelte/shell';

  let { record, shell = false }: { record: (...values: unknown[]) => void; shell?: boolean } = $props();
  const chart = useChart();
  const shellContext = useChartShell();
  $effect(() => (shell ? record(shellContext.current, chart.current) : record(chart.current)));
</script>

<span>legend</span>
