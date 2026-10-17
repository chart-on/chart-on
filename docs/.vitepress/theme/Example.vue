<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useData, withBase } from 'vitepress';
import { examples, type ExampleId } from '../../examples/index';
import type { MountExample } from '../../examples/types';

const props = defineProps<{
  id: ExampleId;
  /** The example's source encoded for a playground link, from the Markdown pass. */
  playground?: string;
}>();

// Loaded on demand: an example only runs in the browser (WebGL2), never during SSR.
const modules = import.meta.glob<{ default: MountExample }>([
  '../../examples/*.ts',
  '!../../examples/index.ts',
  '!../../examples/types.ts',
  '!../../examples/sample-data.ts',
]);

const { isDark } = useData();
const host = ref<HTMLDivElement | null>(null);
const height = examples[props.id]?.height ?? 420;
const failed = ref<string | null>(null);
const playgroundHref = props.playground ? `${withBase('/playground')}#code=${props.playground}` : null;

let dispose: (() => void) | null = null;
let visible = false;
let run = 0;
let observer: IntersectionObserver | null = null;

async function mount(): Promise<void> {
  unmount();
  const el = host.value;
  const load = modules[`../../examples/${props.id}.ts`];
  if (!el || !visible) return;
  if (!load) {
    failed.value = `No example "${props.id}"`;
    return;
  }
  const mine = ++run;
  try {
    const [{ default: start }, { installShellPalette, siteChartTheme }] = await Promise.all([
      load(),
      import('./site-theme'),
    ]);
    installShellPalette();
    // Scrolled away, switched theme or unmounted while loading.
    if (mine !== run || !visible) return;
    failed.value = null;
    dispose = start(el, { dark: isDark.value, theme: siteChartTheme(isDark.value) });
  } catch (error) {
    failed.value = error instanceof Error ? error.message : String(error);
  }
}

function unmount(): void {
  run++;
  dispose?.();
  dispose = null;
  host.value?.replaceChildren();
}

onMounted(() => {
  // Only examples near the screen hold a chart, so a page of many keeps few WebGL contexts.
  observer = new IntersectionObserver(
    ([entry]) => {
      if (!entry || entry.isIntersecting === visible) return;
      visible = entry.isIntersecting;
      if (visible) void mount();
      else unmount();
    },
    { rootMargin: '200px 0px' },
  );
  if (host.value) observer.observe(host.value);
});

watch(isDark, () => {
  if (visible) void mount();
});

onBeforeUnmount(() => {
  observer?.disconnect();
  visible = false;
  unmount();
});
</script>

<template>
  <div class="example-chart" :style="{ height: `${height}px` }">
    <div ref="host" class="example-chart-host" />
    <p v-if="failed" class="example-chart-error">{{ failed }}</p>
  </div>
  <p v-if="playgroundHref" class="example-playground-link">
    <a :href="playgroundHref">Open in playground</a>
  </p>
</template>
