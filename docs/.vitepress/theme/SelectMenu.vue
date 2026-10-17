<script setup lang="ts">
// A styled single-choice dropdown: a button that opens a listbox. Arrow keys,
// Home and End move, Enter or Space picks, Escape closes; a click outside closes.
import { nextTick, onBeforeUnmount, ref, useId } from 'vue';

const props = defineProps<{
  options: readonly { value: string; label: string }[];
  placeholder: string;
  label: string;
  disabled?: boolean;
}>();
const model = defineModel<string>({ required: true });
const emit = defineEmits<{ change: [value: string] }>();

const id = useId();
const open = ref(false);
const active = ref(0);
const root = ref<HTMLElement | null>(null);
const button = ref<HTMLButtonElement | null>(null);
const list = ref<HTMLUListElement | null>(null);

const current = () => props.options.find((o) => o.value === model.value);

function onOutside(event: PointerEvent): void {
  if (!root.value?.contains(event.target as Node)) close(false);
}

async function show(): Promise<void> {
  if (props.disabled || open.value) return;
  open.value = true;
  active.value = Math.max(0, props.options.findIndex((o) => o.value === model.value));
  document.addEventListener('pointerdown', onOutside);
  await nextTick();
  list.value?.focus();
  scrollActive();
}

function close(focusButton = true): void {
  if (!open.value) return;
  open.value = false;
  document.removeEventListener('pointerdown', onOutside);
  if (focusButton) button.value?.focus();
}

function pick(index: number): void {
  const option = props.options[index];
  close();
  if (!option || option.value === model.value) return;
  model.value = option.value;
  emit('change', option.value);
}

function scrollActive(): void {
  list.value?.children[active.value]?.scrollIntoView({ block: 'nearest' });
}

function onListKey(event: KeyboardEvent): void {
  const last = props.options.length - 1;
  const moves: Record<string, number> = { ArrowDown: active.value + 1, ArrowUp: active.value - 1, Home: 0, End: last };
  if (event.key in moves) {
    event.preventDefault();
    active.value = Math.min(last, Math.max(0, moves[event.key]!));
    scrollActive();
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    pick(active.value);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    close();
  } else if (event.key === 'Tab') {
    close(false);
  }
}

function onButtonKey(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    void show();
  }
}

onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside));
</script>

<template>
  <div ref="root" class="select-menu">
    <button
      ref="button"
      type="button"
      class="select-menu-button"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="`${id}-list`"
      :aria-label="`${label}: ${current()?.label ?? placeholder}`"
      :disabled="disabled"
      @click="open ? close() : show()"
      @keydown="onButtonKey"
    >
      <span :class="{ 'select-menu-placeholder': !current() }">{{ current()?.label ?? placeholder }}</span>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
    </button>
    <ul
      v-show="open"
      :id="`${id}-list`"
      ref="list"
      class="select-menu-list"
      role="listbox"
      tabindex="-1"
      :aria-label="label"
      :aria-activedescendant="`${id}-${active}`"
      @keydown="onListKey"
    >
      <li
        v-for="(option, i) in options"
        :id="`${id}-${i}`"
        :key="option.value"
        role="option"
        :aria-selected="option.value === model"
        :class="{ 'is-active': i === active }"
        @pointermove="active = i"
        @click="pick(i)"
      >
        {{ option.label }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.select-menu {
  position: relative;
}

.select-menu-button {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 260px;
  height: 30px;
  padding: 0 10px 0 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 13px;
  font-weight: 500;
  transition: border-color 0.15s;
}

.select-menu-button:hover:not(:disabled),
.select-menu-button[aria-expanded='true'] {
  border-color: var(--vp-c-text-3);
}

.select-menu-button:disabled {
  opacity: 0.5;
}

.select-menu-placeholder {
  color: var(--vp-c-text-3);
}

.select-menu-button svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: var(--vp-c-text-2);
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform 0.15s;
}

.select-menu-button[aria-expanded='true'] svg {
  transform: rotate(180deg);
}

.select-menu-list {
  position: absolute;
  z-index: 20;
  top: calc(100% + 6px);
  left: 0;
  width: max-content;
  min-width: 100%;
  max-width: min(360px, calc(100vw - 32px));
  max-height: min(340px, 60vh);
  margin: 0;
  padding: 4px;
  overflow-y: auto;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg-elv);
  box-shadow: 0 16px 40px -12px rgb(0 0 0 / 0.45);
  list-style: none;
  outline: none;
}

.select-menu-list li {
  padding: 6px 10px;
  border-radius: 6px;
  color: var(--vp-c-text-2);
  font-size: 13px;
  line-height: 1.4;
  cursor: pointer;
}

.select-menu-list li.is-active {
  background: var(--vp-c-default-soft);
  color: var(--vp-c-text-1);
}

.select-menu-list li[aria-selected='true'] {
  color: var(--vp-c-text-1);
  font-weight: 600;
}

@media (prefers-reduced-motion: reduce) {
  .select-menu-button,
  .select-menu-button svg {
    transition: none;
  }
}
</style>
