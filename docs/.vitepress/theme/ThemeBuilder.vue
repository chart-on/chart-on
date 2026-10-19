<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useData } from 'vitepress';
import type { ChartShell, ColorControl } from '@chart-on/ui';
import type { Builder, BuilderState, ContrastCheck, Scheme, Token } from '../theme-builder/model';

type Model = typeof import('../theme-builder/model');
type Ui = typeof import('@chart-on/ui');

/** Write the state to the address this long after the last change. */
const HASH_DELAY_MS = 300;
const schemes: readonly Scheme[] = ['dark', 'light'];
/** Choices of the chart font weight token. */
const WEIGHTS = ['100', '200', '300', '400', '500', '600', '700', '800', '900', 'normal', 'bold'];

const { isDark } = useData();
// The server renders the light scheme, so the page's scheme is read only after hydration.
const mounted = ref(false);
const pageDark = computed(() => mounted.value && isDark.value);
const model = shallowRef<Model | null>(null);
const builder = shallowRef<Builder | null>(null);
const state = ref<BuilderState>({ dark: {}, light: {} });
const editing = ref<Scheme>('light');
const filter = ref('');
const preset = ref('');
const importText = ref('');
const message = ref('');
const invalid = ref<Record<string, boolean>>({});
const copied = ref('');
const status = ref('Loading…');
const hosts: Record<Scheme, HTMLDivElement | null> = { dark: null, light: null };
const controlsEl = ref<HTMLElement | null>(null);

let ui: Ui | null = null;
const shells: Partial<Record<Scheme, ChartShell>> = {};
/** Properties set on each preview shell, to remove them when they go away. */
const applied: Record<Scheme, string[]> = { dark: [], light: [] };
const colorControls = new Map<string, ColorControl>();
let hashTimer: ReturnType<typeof setTimeout> | undefined;
let hashRun = 0;
/** Set on unmount, so loads that finish later build nothing. */
let disposed = false;

const SECTIONS: { id: string; title: string; match: (t: Token) => boolean }[] = [
  { id: 'chart-colors', title: 'Chart colours', match: (t) => t.group === 'chart' && (t.kind === 'color' || t.kind === 'heatmap') },
  { id: 'chart-text', title: 'Chart text', match: (t) => t.group === 'chart' && t.kind !== 'color' && t.kind !== 'heatmap' },
  { id: 'shell-colors', title: 'Shell colours', match: (t) => t.group === 'shell' && t.kind === 'color' },
  { id: 'shell-other', title: 'Shell fonts, sizes and effects', match: (t) => t.group === 'shell' && t.kind !== 'color' },
];

const sections = computed(() => {
  const b = builder.value;
  if (!b) return [];
  const q = filter.value.trim().toLowerCase();
  return SECTIONS.map((s) => ({
    ...s,
    tokens: b.tokens.filter((t) => s.match(t) && (!q || t.name.includes(q) || (t.key ?? '').toLowerCase().includes(q))),
  })).filter((s) => s.tokens.length > 0);
});

const overrides = computed(() => state.value[editing.value]);

function display(token: Token): string {
  const m = model.value;
  const b = builder.value;
  return m && b ? m.resolvedValue(b, editing.value, overrides.value, token.name) : '';
}

const exportedObject = computed(() => {
  const m = model.value;
  const b = builder.value;
  return m && b ? m.themeObjectCode(m.exportTheme(b, state.value)) : '';
});

const exportedCss = computed(() => {
  const m = model.value;
  const b = builder.value;
  return m && b ? m.exportCss(b, state.value) : '';
});

const checks = computed<Record<Scheme, ContrastCheck[]>>(() => {
  const m = model.value;
  const b = builder.value;
  if (!m || !b) return { dark: [], light: [] };
  return { dark: m.contrastChecks(b, 'dark', state.value.dark), light: m.contrastChecks(b, 'light', state.value.light) };
});

const failing = computed(() => [...checks.value.dark, ...checks.value.light].filter((c) => !c.ok).length);

/** One table row per checked pair, with its ratio in each scheme. */
const checkRows = computed(() =>
  checks.value.dark.map((check) => ({
    label: check.label,
    cells: schemes.map((scheme) => {
      const found = checks.value[scheme].find((c) => c.label === check.label);
      return { scheme, low: !!found && !found.ok, text: found ? `${found.ratio.toFixed(1)}${found.ok ? '' : ' (low)'}` : '–' };
    }),
  })),
);

function setHost(scheme: Scheme, el: unknown): void {
  hosts[scheme] = el instanceof HTMLDivElement ? el : null;
}

function setOverride(name: string, value: string | undefined): void {
  const next = { ...state.value[editing.value] };
  if (value === undefined) delete next[name];
  else next[name] = value;
  state.value = { ...state.value, [editing.value]: next };
  preset.value = '';
}

function commitText(token: Token, event: Event): void {
  const m = model.value;
  const b = builder.value;
  if (!m || !b) return;
  const input = event.target as HTMLInputElement | HTMLSelectElement;
  const value = input.value.trim();
  if (value === display(token)) {
    invalid.value = { ...invalid.value, [token.name]: false };
    return;
  }
  if (!value) {
    setOverride(token.name, undefined);
    invalid.value = { ...invalid.value, [token.name]: false };
    return;
  }
  const ok = m.safeValue(b, token.name, value);
  invalid.value = { ...invalid.value, [token.name]: !ok };
  if (ok) setOverride(token.name, value);
}

/** Mount the library's colour control into each colour row Vue rendered, reusing controls across renders. */
function mountColors(): void {
  const b = builder.value;
  if (!ui || !b || !controlsEl.value) return;
  for (const slot of controlsEl.value.querySelectorAll<HTMLElement>('[data-color-token]')) {
    const name = slot.dataset.colorToken!;
    let control = colorControls.get(name);
    if (!control) {
      const token = b.tokens.find((t) => t.name === name);
      if (!token) continue;
      control = ui.createColorControl({
        label: token.key ? `${token.key} (${token.name})` : token.name,
        value: display(token) || '#000000',
        onInput: (color) => setOverride(name, color),
      });
      colorControls.set(name, control);
    }
    // A row rendered again, e.g. after filtering, gets its control back.
    if (control.el.parentElement !== slot) slot.replaceChildren(control.el);
  }
}

/** Show the edited scheme's values in the colour controls. */
function paintColors(): void {
  const b = builder.value;
  if (!b) return;
  for (const [name, control] of colorControls) {
    const token = b.tokens.find((t) => t.name === name);
    const value = token ? display(token) : '';
    if (value && model.value && /^(#|rgba?\()/i.test(value)) control.setValue(value);
  }
}

function applyToPreviews(): void {
  for (const scheme of ['dark', 'light'] as Scheme[]) {
    const shell = shells[scheme];
    if (!shell) continue;
    const style = shell.el.style;
    const next = state.value[scheme];
    for (const name of applied[scheme]) if (!(name in next)) style.removeProperty(name);
    for (const [name, value] of Object.entries(next)) style.setProperty(name, value);
    applied[scheme] = Object.keys(next);
  }
}

async function saveToHash(): Promise<string> {
  const m = model.value;
  const mine = ++hashRun;
  const empty = Object.keys(state.value.dark).length === 0 && Object.keys(state.value.light).length === 0;
  const { encodeCode } = await import('../playground/share');
  const hash = empty || !m ? '' : `#${m.HASH_KEY}${await encodeCode(JSON.stringify(state.value))}`;
  if (mine === hashRun && !disposed) history.replaceState(history.state, '', hash || location.pathname + location.search);
  return `${location.origin}${location.pathname}${location.search}${hash}`;
}

async function stateFromHash(m: Model, b: Builder): Promise<BuilderState | null> {
  const body = location.hash.replace(/^#/, '');
  if (!body.startsWith(m.HASH_KEY)) return null;
  const { decodeCode } = await import('../playground/share');
  try {
    return m.sanitizeState(b, JSON.parse(await decodeCode(body.slice(m.HASH_KEY.length))));
  } catch {
    message.value = 'The theme in this link could not be read; showing the default theme.';
    return null;
  }
}

function choosePreset(event: Event): void {
  const id = (event.target as HTMLSelectElement).value;
  const found = builder.value?.presets.find((p) => p.id === id);
  if (!found) return;
  preset.value = id;
  state.value = { dark: { ...found.state.dark }, light: { ...found.state.light } };
  invalid.value = {};
  message.value = `Loaded the ${found.label} preset.`;
}

function resetAll(): void {
  state.value = { dark: {}, light: {} };
  preset.value = '';
  invalid.value = {};
  message.value = 'Back to the default theme.';
}

function runImport(): void {
  const m = model.value;
  const b = builder.value;
  if (!m || !b) return;
  const text = importText.value.trim();
  try {
    state.value = text.includes('--pc-') || text.includes('.pc-shell') ? m.importCss(b, text) : m.importThemeObject(b, text, state.value);
    preset.value = '';
    invalid.value = {};
    message.value = 'Imported.';
  } catch (error) {
    message.value = error instanceof Error ? error.message : String(error);
  }
}

async function copy(what: 'object' | 'css' | 'link'): Promise<void> {
  try {
    const text = what === 'object' ? exportedObject.value : what === 'css' ? exportedCss.value : await saveToHash();
    await navigator.clipboard.writeText(text);
    copied.value = what;
    setTimeout(() => (copied.value = ''), 2000);
  } catch {
    message.value = 'Could not copy; select the text and copy it instead.';
  }
}

onMounted(async () => {
  mounted.value = true;
  editing.value = isDark.value ? 'dark' : 'light';
  try {
    const [m, loadedUi, css, data] = await Promise.all([
      import('../theme-builder/model'),
      import('@chart-on/ui'),
      import('../../../packages/ui/src/style.css?raw'),
      import('../../examples/sample-data'),
      import('@chart-on/ui/style.css'),
    ]);
    if (disposed) return;
    ui = loadedUi;
    const b = m.createBuilder(css.default);
    model.value = m;
    builder.value = b;
    state.value = (await stateFromHash(m, b)) ?? { dark: {}, light: {} };
    if (disposed) return;
    for (const scheme of ['dark', 'light'] as Scheme[]) {
      const host = hosts[scheme];
      if (!host) continue;
      // No appearance overrides: the preview shows the builder's tokens only.
      const shell = loadedUi.createChartShell(host, { theme: scheme, appearance: false });
      shell.chart.addCandles({ title: 'SAMPLE' }).setData(data.sampleBars(160));
      shell.chart.fitContent();
      shells[scheme] = shell;
    }
    applyToPreviews();
    status.value = '';
  } catch (error) {
    status.value = error instanceof Error ? error.message : String(error);
  }
});

watch(
  state,
  () => {
    applyToPreviews();
    paintColors();
    clearTimeout(hashTimer);
    hashTimer = setTimeout(() => void saveToHash().catch(() => {}), HASH_DELAY_MS);
  },
  { deep: true },
);

// After Vue renders the rows: the colour controls are plain DOM, mounted into them.
watch(sections, () => void nextTick(mountColors), { flush: 'post' });

watch(editing, () => {
  invalid.value = {};
  paintColors();
});

onBeforeUnmount(() => {
  // After a client-side navigation a pending write would put this page's fragment on the next page.
  disposed = true;
  clearTimeout(hashTimer);
  for (const control of colorControls.values()) control.destroy();
  colorControls.clear();
  for (const scheme of ['dark', 'light'] as Scheme[]) shells[scheme]?.destroy();
});
</script>

<template>
  <div class="tb">
    <h1>Theme builder</h1>
    <p class="tb-intro">
      Edit the chart tokens and the shell variables, see them in a dark and a light shell, then copy the theme. The CSS
      block holds the whole theme for the UI shell; the theme object holds the chart colours for <code>createChart</code>
      or <code>applyOptions</code>. Paste either back to keep editing. The address always holds the theme, so a copied
      link shares it. See <a href="./guide/theming">Theming</a> for what each token does.
    </p>
    <div class="tb-toolbar">
      <label class="tb-field">
        <span>Preset</span>
        <select :value="preset" :disabled="!builder" @change="choosePreset">
          <option value="" disabled>Choose…</option>
          <option v-for="p in builder?.presets ?? []" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
      </label>
      <div class="tb-segmented" role="group" aria-label="Scheme to edit">
        <button type="button" :aria-pressed="editing === 'dark'" @click="editing = 'dark'">Edit dark</button>
        <button type="button" :aria-pressed="editing === 'light'" @click="editing = 'light'">Edit light</button>
      </div>
      <button type="button" :disabled="!builder" @click="resetAll">Reset all</button>
      <button type="button" :disabled="!builder" @click="copy('link')">{{ copied === 'link' ? 'Link copied' : 'Copy link' }}</button>
      <span class="tb-status" role="status">{{ status || message }}</span>
    </div>

    <div class="tb-previews">
      <figure v-for="scheme in schemes" :key="scheme" class="tb-preview" :class="{ 'is-editing': editing === scheme }">
        <figcaption>{{ scheme === 'dark' ? 'Dark' : 'Light' }}<span v-if="editing === scheme"> (editing)</span></figcaption>
        <div :ref="(el) => setHost(scheme, el)" class="tb-preview-host" />
      </figure>
    </div>

    <div class="tb-panes">
      <section ref="controlsEl" class="tb-controls pc-shell" :data-theme="pageDark ? 'dark' : 'light'" aria-label="Tokens">
        <input v-model="filter" class="tb-filter" type="search" placeholder="Filter tokens, e.g. up or --pc-accent" aria-label="Filter tokens" />
        <div v-for="section in sections" :key="section.id" class="tb-section">
          <h2>{{ section.title }}</h2>
          <div v-for="token in section.tokens" :key="token.name" class="tb-row" :class="{ 'is-set': token.name in overrides }">
            <span class="tb-label">
              <span v-if="token.key" class="tb-key">{{ token.key }}</span>
              <code>{{ token.name }}</code>
            </span>
            <span v-if="token.kind === 'color'" :data-color-token="token.name" class="tb-color" />
            <select v-else-if="token.kind === 'weight'" :value="display(token)" :aria-label="token.name" @change="commitText(token, $event)">
              <option v-for="w in WEIGHTS" :key="w" :value="w">{{ w }}</option>
            </select>
            <select v-else-if="token.kind === 'numerals'" :value="display(token)" :aria-label="token.name" @change="commitText(token, $event)">
              <option value="tabular">tabular</option>
              <option value="proportional">proportional</option>
            </select>
            <input
              v-else
              class="tb-text"
              :value="display(token)"
              :aria-label="token.name"
              :aria-invalid="invalid[token.name] ? 'true' : undefined"
              spellcheck="false"
              @change="commitText(token, $event)"
            />
            <button v-if="token.name in overrides" type="button" class="tb-reset" :aria-label="`Reset ${token.name}`" @click="setOverride(token.name, undefined)">
              Reset
            </button>
          </div>
        </div>
      </section>

      <div class="tb-side">
        <section class="tb-card" aria-labelledby="tb-contrast">
          <h2 id="tb-contrast">Contrast</h2>
          <p class="tb-note">
            Text needs {{ model?.MIN_TEXT_CONTRAST ?? 4.5 }}:1 on its background (WCAG AA).
            <strong v-if="failing > 0">{{ failing }} {{ failing === 1 ? 'pair is' : 'pairs are' }} below it.</strong>
            <span v-else-if="builder">Every pair passes.</span>
          </p>
          <table class="tb-checks">
            <thead>
              <tr><th>Text</th><th>Dark</th><th>Light</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in checkRows" :key="row.label">
                <td>{{ row.label }}</td>
                <td v-for="cell in row.cells" :key="cell.scheme" :class="{ 'is-low': cell.low }">{{ cell.text }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="tb-card" aria-labelledby="tb-css">
          <div class="tb-card-head">
            <h2 id="tb-css">CSS for the UI shell</h2>
            <button type="button" :disabled="!builder" @click="copy('css')">{{ copied === 'css' ? 'Copied' : 'Copy' }}</button>
          </div>
          <textarea class="tb-code" readonly :value="exportedCss" aria-labelledby="tb-css" spellcheck="false" />
        </section>

        <section class="tb-card" aria-labelledby="tb-object">
          <div class="tb-card-head">
            <h2 id="tb-object">Theme object</h2>
            <button type="button" :disabled="!builder" @click="copy('object')">{{ copied === 'object' ? 'Copied' : 'Copy' }}</button>
          </div>
          <textarea class="tb-code" readonly :value="exportedObject" aria-labelledby="tb-object" spellcheck="false" />
        </section>

        <section class="tb-card" aria-labelledby="tb-import">
          <h2 id="tb-import">Import</h2>
          <p class="tb-note">Paste an exported CSS block (restores everything) or theme object (restores the chart colours).</p>
          <textarea v-model="importText" class="tb-code tb-import" aria-labelledby="tb-import" spellcheck="false" />
          <button type="button" :disabled="!builder || !importText.trim()" @click="runImport">Import</button>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tb {
  max-width: 1440px;
  margin: 0 auto;
  padding: 24px 24px 48px;
}

.tb h1 {
  margin: 0 0 8px;
  font-size: 28px;
  font-weight: 600;
  line-height: 1.3;
}

.tb h2 {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 600;
}

.tb-intro {
  max-width: 820px;
  margin: 0 0 16px;
  color: var(--vp-c-text-2);
  line-height: 1.6;
}

.tb-intro code {
  font-family: var(--vp-font-family-mono);
  font-size: 0.875em;
}

.tb-intro a {
  color: var(--vp-c-brand-1);
  text-decoration: underline;
}

.tb-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.tb button,
.tb select {
  padding: 4px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font-size: 14px;
  line-height: 24px;
}

.tb button:hover:not(:disabled) {
  border-color: var(--vp-c-brand-1);
}

.tb button:disabled {
  opacity: 0.5;
}

.tb button[aria-pressed='true'] {
  background: var(--vp-c-default-soft);
  border-color: var(--vp-c-brand-1);
}

.tb-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
}

.tb-segmented {
  display: inline-flex;
  gap: 4px;
}

.tb-status {
  color: var(--vp-c-text-2);
  font-size: 14px;
}

.tb-previews {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  margin: 0 0 16px;
}

.tb-preview {
  margin: 0;
  min-width: 0;
}

.tb-preview figcaption {
  margin-bottom: 4px;
  color: var(--vp-c-text-2);
  font-size: 13px;
}

.tb-preview.is-editing figcaption {
  color: var(--vp-c-text-1);
  font-weight: 600;
}

.tb-preview-host {
  height: 380px;
  border-radius: 12px;
  overflow: hidden;
  background: var(--vp-c-bg-alt);
}

.tb-panes {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

/* The shell class gives the colour controls their tokens; undo its layout here. */
.tb-controls.pc-shell {
  display: block;
  height: auto;
  max-height: 760px;
  overflow: auto;
  container: none;
  padding: 12px 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-family: var(--vp-font-family-base);
}

.tb-filter {
  width: 100%;
  margin-bottom: 12px;
  padding: 6px 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font-size: 14px;
}

.tb-section + .tb-section {
  margin-top: 16px;
}

.tb-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 2px 0;
  border-bottom: 1px solid var(--vp-c-divider);
}

.tb-row.is-set .tb-label code {
  color: var(--vp-c-brand-1);
}

.tb-label {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 8px;
  min-width: 0;
  font-size: 13px;
}

.tb-key {
  font-weight: 500;
}

.tb-label code {
  color: var(--vp-c-text-2);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
}

.tb-text {
  width: 220px;
  padding: 3px 8px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
}

.tb-text[aria-invalid='true'] {
  border-color: var(--vp-c-danger-1);
}

.tb .tb-reset {
  padding: 0 8px;
  font-size: 12px;
}

.tb-side {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.tb-card {
  padding: 12px 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
}

.tb-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.tb-note {
  margin: 0 0 8px;
  color: var(--vp-c-text-2);
  font-size: 13px;
}

.tb-checks {
  display: table;
  width: 100%;
  margin: 0;
  font-size: 13px;
}

.tb-checks td.is-low {
  color: var(--vp-c-danger-1);
  font-weight: 600;
}

.tb-code {
  width: 100%;
  height: 220px;
  padding: 8px 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-code-block-bg);
  color: var(--vp-c-text-1);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre;
  resize: vertical;
}

.tb-import {
  height: 120px;
  margin-bottom: 8px;
}

@media (max-width: 960px) {
  .tb {
    padding: 16px 16px 32px;
  }

  .tb-previews,
  .tb-panes {
    grid-template-columns: minmax(0, 1fr);
  }

  .tb-preview-host {
    height: 320px;
  }

  .tb-text {
    width: 160px;
  }
}
</style>
