<script setup lang="ts">
// Only mounts the plain-TypeScript landing page; see landing-html.ts and landing.ts.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useData } from 'vitepress';
import { landingHtml } from './landing-html';
import type { Section } from './section';

const { isDark, site } = useData();
const root = ref<HTMLElement | null>(null);
let landing: Section | null = null;
let unmounted = false;

onMounted(async () => {
  const { mountLanding } = await import('./landing');
  if (unmounted || !root.value) return;
  landing = mountLanding(root.value, isDark.value, (dark) => (isDark.value = dark));
});

watch(isDark, (dark) => landing?.setDark(dark));

onBeforeUnmount(() => {
  unmounted = true;
  landing?.destroy();
});
</script>

<template>
  <div ref="root" v-html="landingHtml(site.base)" />
</template>
