<!-- Renders `<Chart>` with the props it gets, records every value `bind:chart` takes, and renders `Child` inside. -->
<script lang="ts">
  import type { Component } from 'svelte';
  import type { Chart as ChartInstance } from '@chart-on/core';
  import { Chart, type ChartProps } from '@chart-on/svelte';

  let {
    record,
    Child,
    childProps = {},
    ...rest
  }: ChartProps & { record?: (chart: ChartInstance | null) => void; Child?: Component<any>; childProps?: Record<string, unknown> } = $props();
  let chart: ChartInstance | null = $state.raw(null);
  $effect(() => record?.(chart));
</script>

<Chart bind:chart {...rest}>
  {#if Child}
    <Child {...childProps} />
  {/if}
</Chart>
