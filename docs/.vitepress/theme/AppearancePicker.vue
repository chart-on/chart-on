<script setup lang="ts">
// Stands in for the default theme's sun/moon switch (aliased in config.ts), so
// the nav, its overflow menu and the mobile menu use the landing footer's picker.
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useData } from 'vitepress';
import { APPEARANCES, mountAppearance } from './site/appearance';

const { isDark } = useData();
const root = ref<HTMLElement | null>(null);
let unmount: (() => void) | undefined;

onMounted(() => {
  unmount = mountAppearance(root.value!, (dark) => (isDark.value = dark));
});

onBeforeUnmount(() => unmount?.());
</script>

<template>
  <div ref="root" class="lp-appearance" role="radiogroup" aria-label="Colour scheme">
    <button
      v-for="[mode, label, svg] in APPEARANCES"
      :key="mode"
      type="button"
      role="radio"
      aria-checked="false"
      :aria-label="label"
      :title="label"
      :data-appearance="mode"
      v-html="svg"
    />
  </div>
</template>
