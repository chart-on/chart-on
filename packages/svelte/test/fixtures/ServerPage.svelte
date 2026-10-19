<!-- A page with one of the components and, inside it, what the context helpers hold while rendering. -->
<script lang="ts">
  import { Chart } from '@chart-on/svelte';
  import { ChartShell } from '@chart-on/svelte/shell';
  import Contexts from './Contexts.svelte';

  let { shell = false }: { shell?: boolean } = $props();
</script>

{#if shell}
  <ChartShell class="shell" theme="light"><Contexts /></ChartShell>
{:else}
  <Chart id="price" class="chart" style="height: 300px" options={{ barSpacing: 8 }}><Contexts /></Chart>
{/if}
