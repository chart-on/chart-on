<!-- Shows what `useChart()` and `useChartShell()` hold. -->
<script lang="ts">
  import { useChart } from '@charton/svelte';
  import { useChartShell } from '@charton/svelte/shell';

  const chart = useChart();
  const shell = useChartShell();
</script>

<span>{String(chart.current)} {String(shell.current)}</span>
