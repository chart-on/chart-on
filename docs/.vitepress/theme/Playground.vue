<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useData } from 'vitepress';
// Fine to import directly: the playground component itself loads on demand.
import { installShellPalette, siteChartTheme } from './site-theme';
import { codeHash, decodeCode, encodeCode, encodedFromHash } from '../playground/share';
import { ADDONS, STYLES, buildCode, type BuilderStyle } from '../playground/builder';
import { createEditor, type Editor } from '../playground/editor';
import { examples } from '../../examples';
import SelectMenu from './SelectMenu.vue';

/** The docs examples' sources, by id, loaded when picked. */
const sources = import.meta.glob<string>('../../examples/*.ts', { query: '?raw', import: 'default' });
const exampleOptions = Object.entries(examples)
  .filter(([id]) => `../../examples/${id}.ts` in sources)
  .map(([value, info]) => ({ value, label: info.title }));

type Tools = {
  ts: typeof import('typescript');
  runner: typeof import('../playground/runner');
};

/** Re-run this long after the last keystroke. */
const DEBOUNCE_MS = 700;
/** Keep the error panel readable when something fails every frame. */
const MAX_ERRORS = 20;

const { isDark } = useData();
const host = ref<HTMLDivElement | null>(null);
const editorHost = ref<HTMLDivElement | null>(null);
const style = ref<BuilderStyle>('candles');
const chosen = ref(new Set<string>());
const exampleId = ref('');
// The buttons show their choices only while the editor holds the builder's code.
const built = ref(true);
const code = ref('');
const errors = ref<string[]>([]);
const status = ref('Loading the compiler…');
const copied = ref(false);
// Code from a link runs only after the reader presses Run: it is someone else's code, run on this page.
const fromLink = ref(false);

let tools: Tools | null = null;
let dispose: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let hashRun = 0;
// The code last run, so loading it does not schedule a second run.
let ranCode = '';
let editor: Editor | null = null;

function report(error: unknown): void {
  const line = tools ? tools.runner.describeError(error) : String(error);
  if (errors.value.includes(line) || errors.value.length >= MAX_ERRORS) return;
  errors.value = [...errors.value, line];
}

function stop(): void {
  const own = dispose;
  dispose = null;
  try {
    own?.();
  } catch (error) {
    report(error);
  }
  host.value?.replaceChildren();
}

/** The address with the current code in its fragment. */
async function saveToHash(): Promise<string> {
  const mine = ++hashRun;
  const hash = codeHash(await encodeCode(code.value));
  // A newer edit encoded meanwhile.
  if (mine === hashRun) history.replaceState(history.state, '', hash);
  return `${location.origin}${location.pathname}${location.search}${hash}`;
}

function runNow(): void {
  clearTimeout(timer);
  if (!tools || !host.value || fromLink.value) return;
  // Destroy the last chart before the next one asks for a WebGL context.
  stop();
  errors.value = [];
  ranCode = code.value;
  try {
    const js = tools.runner.transpile(tools.ts, code.value);
    dispose = tools.runner.run(js, host.value, { dark: isDark.value, theme: siteChartTheme(isDark.value) });
  } catch (error) {
    report(error);
  }
  saveToHash().catch(report);
}

/** Run on request, which also accepts code from a link. */
function runClicked(): void {
  fromLink.value = false;
  runNow();
}

async function copyLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(await saveToHash());
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    report(new Error('Could not copy the link; copy it from the address bar instead.'));
  }
}

/** Put new code in the editor (one undo step) and run it: it is the page's own code, not a link's. */
function replaceCode(source: string): void {
  editor?.setCode(source);
  fromLink.value = false;
  runNow();
}

/** Rebuild the code from the style and add-on buttons. */
function rebuild(): void {
  exampleId.value = '';
  built.value = true;
  replaceCode(buildCode(style.value, chosen.value));
}

function pickStyle(next: BuilderStyle): void {
  style.value = next;
  rebuild();
}

function toggleAddon(id: string): void {
  const next = new Set(chosen.value);
  if (!next.delete(id)) next.add(id);
  chosen.value = next;
  rebuild();
}

async function loadExample(): Promise<void> {
  const load = sources[`../../examples/${exampleId.value}.ts`];
  if (!load) return;
  try {
    replaceCode(await load());
    built.value = false;
  } catch (error) {
    report(error);
  }
}

// Errors from timers, events and promises the code started, which `run` cannot catch.
const onError = (event: ErrorEvent) => report(event.error ?? event.message);
const onRejection = (event: PromiseRejectionEvent) => report(event.reason);

/** The code in the link, else the first example, with a notice when the link's code was unreadable. */
async function initialCode(): Promise<{ source: string; linked?: boolean; notice?: Error }> {
  const encoded = encodedFromHash(location.hash);
  let notice: Error | undefined;
  if (encoded) {
    try {
      return { source: await decodeCode(encoded), linked: true };
    } catch {
      notice = new Error('The code in this link could not be read; showing the first example instead.');
    }
  }
  return { source: buildCode(style.value, chosen.value), notice };
}

onMounted(async () => {
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  try {
    // Only this page loads the compiler and the packages.
    const [initial, ts, runner] = await Promise.all([initialCode(), import('typescript'), import('../playground/runner')]);
    tools = { ts, runner };
    installShellPalette();
    fromLink.value = !!initial.linked;
    built.value = !initial.linked;
    code.value = initial.source;
    ranCode = initial.source;
    editor = createEditor(editorHost.value!, initial.source, (next) => (code.value = next), runClicked);
    status.value = '';
    runNow();
    // After the run, which clears the panel.
    if (initial.notice) report(initial.notice);
  } catch (error) {
    status.value = '';
    report(error);
  }
});

watch(code, () => {
  clearTimeout(timer);
  if (code.value === ranCode || fromLink.value) return;
  timer = setTimeout(runNow, DEBOUNCE_MS);
});

watch(isDark, () => runNow());

onBeforeUnmount(() => {
  clearTimeout(timer);
  window.removeEventListener('error', onError);
  window.removeEventListener('unhandledrejection', onRejection);
  tools = null;
  editor?.destroy();
  editor = null;
  stop();
});
</script>

<template>
  <div class="playground">
    <h1>Playground</h1>
    <p class="playground-intro">
      Edit the code and the chart re-runs. It is a docs example: a default export that draws into <code>el</code> and
      returns its clean-up. Import <code>@charton/core</code>, <code>@charton/ui</code>, <code>@charton/indicators</code>,
      <code>@charton/ta</code> and <code>./sample-data</code>. The address always holds the code, so a copied link
      reproduces it.
    </p>
    <div class="playground-toolbar">
      <button type="button" :disabled="!!status" @click="runClicked">Run</button>
      <button type="button" :disabled="!!status" @click="copyLink">{{ copied ? 'Link copied' : 'Copy link' }}</button>
      <button type="button" :aria-pressed="isDark" @click="isDark = !isDark">Dark theme</button>
      <span class="playground-status" role="status">{{ status }}</span>
    </div>
    <div class="playground-builder">
      <div class="playground-row" role="group" aria-label="Chart style">
        <span class="playground-row-label">Style</span>
        <button
          v-for="[id, label] in STYLES"
          :key="id"
          type="button"
          class="playground-chip"
          :aria-pressed="built && style === id"
          :disabled="!!status"
          @click="pickStyle(id)"
        >
          {{ label }}
        </button>
      </div>
      <div class="playground-row" role="group" aria-label="Add-ons">
        <span class="playground-row-label">Add</span>
        <button
          v-for="addon in ADDONS"
          :key="addon.id"
          type="button"
          class="playground-chip"
          :aria-pressed="built && chosen.has(addon.id)"
          :disabled="!!status"
          @click="toggleAddon(addon.id)"
        >
          {{ addon.label }}
        </button>
      </div>
      <div class="playground-row">
        <span class="playground-row-label">Example</span>
        <SelectMenu
          v-model="exampleId"
          :options="exampleOptions"
          label="Docs example"
          placeholder="Start from a docs example…"
          :disabled="!!status"
          @change="loadExample"
        />
      </div>
    </div>
    <p v-if="fromLink" class="playground-link-notice" role="note">
      This code came from a link and has not run. Read it first: pressing Run runs it on this page.
    </p>
    <div class="playground-panes">
      <div class="playground-code">
        <div ref="editorHost" class="playground-editor" />
        <p id="playground-keys" class="playground-hint">
          Runs as you type. Ctrl+Enter or Cmd+Enter runs now. The buttons above rewrite the code; Undo brings your edits
          back. Tab indents; press Escape, then Tab, to leave the editor.
        </p>
        <div class="playground-errors" role="log" aria-label="Errors">
          <p v-if="errors.length === 0" class="playground-no-errors">No errors.</p>
          <pre v-for="line in errors" :key="line">{{ line }}</pre>
        </div>
      </div>
      <div class="playground-chart">
        <div ref="host" class="playground-chart-host" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.playground {
  /* Editor token colours (editor.ts). */
  --pg-keyword: #b04d27;
  --pg-string: #4c7a3d;
  --pg-number: #7b4fb8;
  --pg-call: #2d5ea8;
  --pg-type: #8a6a1f;
  --pg-selection: rgb(224 108 62 / 0.22);
  max-width: 1440px;
  margin: 0 auto;
  padding: 24px 24px 48px;
}

.playground h1 {
  margin: 0 0 8px;
  font-size: 28px;
  font-weight: 600;
  line-height: 1.3;
}

.playground-intro {
  max-width: 820px;
  margin: 0 0 16px;
  color: var(--vp-c-text-2);
  line-height: 1.6;
}

.playground-intro code {
  font-family: var(--vp-font-family-mono);
  font-size: 0.875em;
}

.playground-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.playground-toolbar button {
  padding: 4px 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font-size: 14px;
  font-weight: 500;
  line-height: 24px;
}

.playground-toolbar button:hover:not(:disabled) {
  border-color: var(--vp-c-brand-1);
}

.playground-toolbar button:disabled {
  opacity: 0.5;
}

.playground-toolbar button[aria-pressed='true'] {
  background: var(--vp-c-default-soft);
}

.dark .playground {
  --pg-keyword: #f09875;
  --pg-string: #a9cc8f;
  --pg-number: #c6a6f2;
  --pg-call: #93b8f2;
  --pg-type: #e3c27a;
  --pg-selection: rgb(224 108 62 / 0.3);
}

.playground-builder {
  display: grid;
  gap: 8px;
  margin-bottom: 14px;
  padding: 12px 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
}

.playground-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.playground-row-label {
  width: 72px;
  color: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.playground-chip {
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  font-size: 13px;
  font-weight: 500;
  transition:
    color 0.15s,
    border-color 0.15s,
    background-color 0.15s;
}

.playground-chip:hover:not(:disabled) {
  border-color: var(--vp-c-text-3);
  color: var(--vp-c-text-1);
}

.playground-chip[aria-pressed='true'] {
  border-color: var(--vp-c-text-1);
  background: var(--vp-c-default-soft);
  color: var(--vp-c-text-1);
}

.playground-chip:disabled {
  opacity: 0.5;
}

.playground-status {
  color: var(--vp-c-text-2);
  font-size: 14px;
}

.playground-link-notice {
  margin: 0 0 12px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--vp-c-warning-soft);
  color: var(--vp-c-text-1);
  font-size: 14px;
}

.playground-panes {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
}

.playground-code {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.playground-editor {
  height: 520px;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-code-block-bg);
}

.playground-editor:focus-within {
  border-color: var(--vp-c-text-3);
}

.playground-hint {
  margin: 6px 0 10px;
  color: var(--vp-c-text-3);
  font-size: 13px;
}

.playground-errors {
  max-height: 200px;
  overflow: auto;
  padding: 8px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  font-size: 13px;
}

.playground-errors pre {
  margin: 4px 0;
  color: var(--vp-c-danger-1);
  font-family: var(--vp-font-family-mono);
  white-space: pre-wrap;
  word-break: break-word;
}

.playground-no-errors {
  margin: 0;
  color: var(--vp-c-text-3);
}

.playground-chart {
  height: 520px;
  min-width: 0;
  background: var(--vp-c-bg-alt);
}

.playground-chart-host {
  width: 100%;
  height: 100%;
}

@media (max-width: 960px) {
  .playground {
    padding: 16px 16px 32px;
  }

  .playground-panes {
    grid-template-columns: minmax(0, 1fr);
  }

  .playground-chart {
    order: -1;
    height: 400px;
  }

  .playground-editor {
    height: 360px;
  }
}
</style>
