<script setup lang="ts">
import { computed } from 'vue';
import { useData, withBase } from 'vitepress';

const { page } = useData();
// Guide pages are also published as Markdown next to their HTML (see docs-text.ts).
const href = computed(() => (page.value.relativePath.startsWith('guide/') ? withBase(`/${page.value.relativePath}`) : null));
</script>

<template>
  <p v-if="href" class="markdown-link">
    <a :href="href" target="_blank" rel="noopener">View this page as Markdown</a>
  </p>
</template>
