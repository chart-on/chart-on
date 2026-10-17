<!-- Renders `<ChartShell>` with the props it gets, records what `bind:shell` and `bind:chart` take, and renders `Child` inside. -->
<script lang="ts">
  import type { Component } from 'svelte';
  import type { Chart } from '@charton/core';
  import type { ChartShell as ShellInstance } from '@charton/ui';
  import { ChartShell, type ChartShellProps } from '@charton/svelte/shell';

  let {
    record,
    Child,
    childProps = {},
    ...rest
  }: ChartShellProps & {
    record?: (shell: ShellInstance | null, chart: Chart | null) => void;
    Child?: Component<any>;
    childProps?: Record<string, unknown>;
  } = $props();
  let shell: ShellInstance | null = $state.raw(null);
  let chart: Chart | null = $state.raw(null);
  $effect(() => record?.(shell, chart));
</script>

<ChartShell bind:shell bind:chart {...rest}>
  {#if Child}
    <Child {...childProps} />
  {/if}
</ChartShell>
