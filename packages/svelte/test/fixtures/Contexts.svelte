<!-- Shows what `useChart()` and `useChartShell()` hold. -->
<script lang="ts">
  import { useChart } from '@chart-on/svelte';
  import { useChartShell } from '@chart-on/svelte/shell';

  const chart = useChart();
  const shell = useChartShell();
</script>

<span>{String(chart.current)} {String(shell.current)}</span>
