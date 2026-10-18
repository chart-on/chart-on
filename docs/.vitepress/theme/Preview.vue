<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useData, withBase } from 'vitepress';
import type { Preview } from './preview';

const { isDark } = useData();
const home = withBase('/');
const host = ref<HTMLDivElement | null>(null);
const failed = ref<string | null>(null);
// Shown on every visit: closing it lasts for this page view only.
const sourceOpen = ref(true);

let preview: Preview | null = null;
let unmounted = false;

// Loaded in the browser only: the chart needs WebGL2 and the feed opens a WebSocket.
onMounted(async () => {
  try {
    const { mountPreview } = await import('./preview');
    if (unmounted || !host.value) return;
    preview = mountPreview(host.value, isDark.value);
  } catch (error) {
    failed.value = error instanceof Error ? error.message : String(error);
  }
});

watch(isDark, (dark) => preview?.setDark(dark));

onBeforeUnmount(() => {
  unmounted = true;
  preview?.destroy();
  preview = null;
});
</script>

<template>
  <div class="preview">
    <div ref="host" class="preview-chart" />
    <p v-if="failed" class="preview-error" role="alert">{{ failed }}</p>
    <aside v-if="sourceOpen" class="preview-source" aria-label="Data source">
      <a :href="home" class="preview-icon" aria-label="Home" title="Home">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 7.5 8 3l5.5 4.5V13a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1zM6.5 14v-4h3v4" /></svg>
      </a>
      <span class="preview-divider" aria-hidden="true" />
      <span class="preview-dot" aria-hidden="true" />
      <span>
        Live market data from
        <a href="https://hyperliquid.xyz" target="_blank" rel="noreferrer">Hyperliquid</a>
        via
        <a href="https://github.com/ccxt/ccxt" target="_blank" rel="noreferrer">CCXT</a>
      </span>
      <button type="button" class="preview-icon" aria-label="Close" title="Close" @click="sourceOpen = false">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
      </button>
    </aside>
  </div>
</template>

<style scoped>
.preview {
  position: relative;
  height: 100dvh;
  min-height: 480px;
}

.preview-chart {
  height: 100%;
}

.preview-error {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  margin: 0;
  padding: 24px;
  color: var(--vp-c-text-2);
  font-size: 14px;
  text-align: center;
}

.preview-source {
  position: absolute;
  /* Centred at the top of the plot, just under the shell's floating toolbar (40px tall, 4px inset). */
  top: 52px;
  right: 0;
  left: 0;
  z-index: 20;
  width: fit-content;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: calc(100% - 32px);
  padding: 6px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: color-mix(in srgb, var(--vp-c-bg) 88%, transparent);
  backdrop-filter: blur(12px);
  box-shadow: 0 8px 24px -12px rgb(0 0 0 / 0.35);
  color: var(--vp-c-text-2);
  font-size: 13px;
  line-height: 1.4;
}

.preview-source span a {
  color: var(--vp-c-text-1);
  font-weight: 500;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.preview-divider {
  flex: none;
  width: 1px;
  height: 16px;
  background: var(--vp-c-divider);
}

.preview-dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--vp-c-green-1);
  box-shadow: 0 0 0 3px var(--vp-c-green-soft);
}

.preview-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: var(--vp-c-text-3);
}

.preview-icon:hover {
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
}

.preview-icon:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 1px;
}

.preview-icon svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
