<!-- A `div` with `use:chart`, given the parameters this component gets, shown while `shown` is true. -->
<script lang="ts">
  import { chart, type ChartActionParameters } from '@charton/svelte';

  let { parameters, shown = true }: { parameters: ChartActionParameters; shown?: boolean } = $props();
</script>

{#if shown}
  <div class="plain" use:chart={parameters}></div>
{/if}
