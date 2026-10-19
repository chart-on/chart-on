import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { builtInColorPresets, Chart, colorSafeUpDown, contrastRatio, darkTheme, lightTheme, presetTheme, type ColorPreset } from '@chart-on/core';
import { dispatch, fakeContainer } from '../../core/test/fake-dom';
import { createAppearance, sanitizeSaved, type AppearanceStorage, type SavedAppearance } from '../src/appearance';
import { presetShellTokens, usablePresets } from '../src/color-presets';
import { createChartShell, type ChartShell } from '../src/shell';

const lime = builtInColorPresets.find((p) => p.id === 'terminal-lime')!;
const butter = builtInColorPresets.find((p) => p.id === 'butter-cobalt')!;

const variants = builtInColorPresets.flatMap((p) => (['light', 'dark'] as const).map((mode) => [`${p.label} ${mode}`, p, mode] as const));
describe.each(variants)('%s shell tokens', (_label, preset, mode) => {
  const tokens = presetShellTokens(preset, mode);
  const ratio = (fg: string, bg: string) => contrastRatio(tokens[`--pc-${fg}`]!, tokens[`--pc-${bg}`]!);

  it('meet WCAG AA for chrome text (4.5:1)', () => {
    const pairs = [
      ...['ink', 'muted-strong', 'muted'].flatMap((fg) => ['panel', 'surface', 'popover'].map((bg) => [fg, bg])),
      ['ink', 'hover'],
      ['ink', 'active'],
      ['accent-ink', 'accent'],
      ['tip-ink', 'tip-bg'],
    ];
    for (const [fg, bg] of pairs) expect(ratio(fg!, bg!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it('mark a selected bottom-bar toggle readably, at rest and on hover', () => {
    // Ink text (4.5:1) with an accent underline (3:1), see `.pc-chip.is-active`.
    for (const bg of ['panel', 'hover']) {
      expect(ratio('ink', bg), `ink on ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(ratio('accent', bg), `accent underline on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('keep the accent visible on every surface (3:1)', () => {
    for (const bg of ['shell', 'panel', 'surface', 'popover']) expect(ratio('accent', bg), bg).toBeGreaterThanOrEqual(3);
  });

  it('match the chart theme and leave up and down to the palette', () => {
    const theme = presetTheme(preset, mode);
    expect(tokens['--pc-chart-bg']).toBe(preset[mode].background);
    expect(tokens['--pc-line-series']).toBe(preset[mode].primary);
    expect(tokens['--pc-chart-text']).toBe(theme.text);
    expect(tokens['--pc-heatmap']).toBe(theme.heatmap.join(', '));
    expect(tokens['--pc-up']).toBeUndefined();
    expect(tokens['--pc-down']).toBeUndefined();
  });
});

describe('preset lists', () => {
  it('apply a preset’s own tokens last', () => {
    const fixed = { ...lime, dark: { ...lime.dark, tokens: { '--pc-shell': '#000000' } } };
    expect(presetShellTokens(fixed, 'dark')['--pc-shell']).toBe('#000000');
    expect(presetShellTokens(fixed, 'light')['--pc-shell']).not.toBe('#000000');
  });

  it('drop unusable and duplicate presets', () => {
    const bad = [
      { ...lime, id: '' },
      { ...lime, id: 'x', light: undefined },
      { ...lime, id: 'y', dark: { background: 'nope', primary: '#ffffff' } },
      { ...lime, id: 'z', light: { background: '#ffffff' } },
      lime,
      { ...butter, id: lime.id },
      butter,
    ] as unknown as ColorPreset[];
    expect(usablePresets(bad)).toEqual([lime, butter]);
  });

  it('read the preset id from saved data', () => {
    expect(sanitizeSaved({ preset: 'a', theme: { up: '#00ff00' } })).toEqual({ preset: 'a', theme: { up: '#00ff00' } });
    expect(sanitizeSaved({ preset: null })).toEqual({ preset: null });
    expect(sanitizeSaved({ preset: 5 })).toEqual({});
    expect(sanitizeSaved({ preset: '' })).toEqual({});
  });
});

type Node = {
  children: Node[];
  className: string;
  tabIndex: number;
  getAttribute(k: string): string | null;
  style: Record<string, string>;
  dispatch(type: string): void;
};
function find(root: unknown, match: (n: Node) => boolean): Node | null {
  for (const child of (root as Node).children) {
    if (match(child)) return child;
    const found = find(child, match);
    if (found) return found;
  }
  return null;
}
function findAll(root: unknown, match: (n: Node) => boolean, out: Node[] = []): Node[] {
  for (const child of (root as Node).children) {
    if (match(child)) out.push(child);
    findAll(child, match, out);
  }
  return out;
}
const swatches = (root: unknown) => findAll(root, (n) => n.className === 'pc-preset');
const swatch = (root: unknown, label: string) => swatches(root).find((n) => n.getAttribute('aria-label') === label)!;
const pressed = (root: unknown) => swatches(root).filter((n) => n.getAttribute('aria-pressed') === 'true').map((n) => n.getAttribute('aria-label'));

function memoryStorage(initial: SavedAppearance | null = null): AppearanceStorage & { saved: SavedAppearance | null } {
  return {
    saved: initial,
    load() {
      return this.saved;
    },
    save(state) {
      this.saved = state;
    },
  };
}

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.unstubAllGlobals();
});
function chart() {
  const c = new Chart(fakeContainer());
  charts.push(c);
  return c;
}

describe('appearance presets', () => {
  it('apply a preset to the chart and save its id with the overrides', () => {
    const c = chart();
    const storage = memoryStorage();
    const a = createAppearance(c, { storage });
    expect(a.presets).toHaveLength(10);
    a.set({ theme: { up: '#00ff00' } });
    a.setPreset('terminal-lime');
    expect(a.preset).toBe(lime);
    expect(c.appearance().theme).toMatchObject({ background: lime.dark.background, line: lime.dark.primary, up: '#00ff00' });
    expect(storage.saved).toEqual({ theme: { up: '#00ff00' }, preset: 'terminal-lime' });
    a.setPreset('no-such-preset');
    expect(a.preset).toBe(lime);
    a.setPreset(null);
    expect(c.appearance().theme.background).toBe(darkTheme.background);
    // Remembered, so the default preset does not come back on the next visit.
    expect(storage.saved).toEqual({ theme: { up: '#00ff00' }, preset: null });
    a.destroy();
    expect(createAppearance(chart(), { storage }).preset).toBeNull();
  });

  it('start from Paper & Ink, another default, or none', () => {
    const c = chart();
    const fresh = createAppearance(c, { storage: memoryStorage() });
    expect(fresh.preset?.id).toBe('paper-ink');
    expect(c.appearance().theme.background).toBe(builtInColorPresets[0]!.dark.background);
    fresh.destroy();
    expect(createAppearance(chart(), { storage: null, defaultPreset: 'deep-ocean' }).preset?.id).toBe('deep-ocean');
    expect(createAppearance(chart(), { storage: null, defaultPreset: null }).preset).toBeNull();
    expect(createAppearance(chart(), { storage: memoryStorage({ preset: 'matcha-cream' }), defaultPreset: null }).preset?.id).toBe('matcha-cream');
  });

  it('follow a changed default after saving an unrelated change, and keep a picked one', () => {
    const storage = memoryStorage();
    const a = createAppearance(chart(), { storage });
    a.set({ theme: { up: '#00ff00' } });
    expect(storage.saved).toEqual({ theme: { up: '#00ff00' } });
    a.destroy();
    expect(createAppearance(chart(), { storage, defaultPreset: 'deep-ocean' }).preset?.id).toBe('deep-ocean');
    // A preset saved before, the default included, still wins and is saved again.
    const picked = memoryStorage({ preset: 'paper-ink' });
    const b = createAppearance(chart(), { storage: picked, defaultPreset: 'deep-ocean' });
    b.set({ theme: { up: '#00ff00' } });
    expect(picked.saved).toEqual({ theme: { up: '#00ff00' }, preset: 'paper-ink' });
    b.destroy();
  });

  it('switch the variant with the mode, read from the base theme by default', () => {
    const c = chart();
    const a = createAppearance(c, { storage: null, defaultPreset: 'butter-cobalt' });
    expect(a.mode).toBe('dark');
    expect(c.appearance().theme.background).toBe(butter.dark.background);
    a.setMode('light');
    expect(a.mode).toBe('light');
    expect(c.appearance().theme).toMatchObject({ background: butter.light.background, line: butter.light.primary });
    a.destroy();
    const light = createAppearance(chart(), { storage: null, baseTheme: () => lightTheme });
    expect(light.mode).toBe('light');
  });

  it('hand the mode to the app when it owns the scheme', () => {
    let mode: 'light' | 'dark' = 'light';
    const asked: string[] = [];
    const a = createAppearance(chart(), { storage: null, mode: () => mode, setMode: (m) => asked.push(m) });
    expect(a.theme().background).toBe(builtInColorPresets[0]!.light.background);
    a.setMode('dark');
    expect(asked).toEqual(['dark']);
    mode = 'dark';
    expect(a.theme().background).toBe(builtInColorPresets[0]!.dark.background);
  });

  it('restore a saved preset; an unknown id falls back to the default', () => {
    const restored = createAppearance(chart(), { storage: memoryStorage({ preset: 'deep-ocean' }) });
    expect(restored.preset?.id).toBe('deep-ocean');
    expect(restored.theme().background).toBe('#101f2b');
    restored.destroy();
    const c = chart();
    const unknown = createAppearance(c, { storage: memoryStorage({ preset: 'gone', theme: { down: '#ff0000' } }) });
    expect(unknown.preset).toBeNull();
    expect(c.appearance().theme).toMatchObject({ background: darkTheme.background, down: '#ff0000' });
    unknown.destroy();
  });

  it('keep user overrides across a preset change, and reset to the preset value', () => {
    const c = chart();
    const a = createAppearance(c, { storage: null });
    a.set({ theme: { background: '#010101', text: '#fefefe' } });
    a.setPreset('midnight-violet');
    expect(c.appearance().theme).toMatchObject({ background: '#010101', text: '#fefefe' });
    a.reset('background');
    expect(c.appearance().theme.background).toBe('#171426');
    expect(c.appearance().theme.text).toBe('#fefefe');
    a.reset();
    expect(c.appearance().theme.text).toBe(presetTheme(builtInColorPresets[6]!, 'dark').text);
    expect(a.preset?.id).toBe('midnight-violet');
    a.destroy();
  });

  it('offer only the given presets, or none with false (a saved id is then ignored)', () => {
    const mine: ColorPreset = {
      id: 'mine',
      label: 'Mine',
      light: { background: '#ffffff', primary: '#0033aa' },
      dark: { background: '#000000', primary: '#ffcc00' },
    };
    const c = chart();
    const custom = createAppearance(c, { storage: memoryStorage({ preset: 'terminal-lime' }), presets: [mine, butter] });
    expect(custom.preset).toBeNull();
    custom.open();
    expect(swatches(c.root).map((n) => n.getAttribute('aria-label'))).toEqual(['Default', 'Mine', 'Butter Cobalt']);
    custom.destroy();

    const c2 = chart();
    const off = createAppearance(c2, { storage: memoryStorage({ preset: 'terminal-lime' }), presets: false });
    expect([off.preset, off.presets.length]).toEqual([null, 0]);
    expect(c2.appearance().theme.background).toBe(darkTheme.background);
    off.setPreset('terminal-lime');
    expect(off.preset).toBeNull();
    off.open();
    expect(swatches(c2.root)).toHaveLength(0);
    off.destroy();
  });

  it('mark the chosen swatch and apply one on click', () => {
    const c = chart();
    const a = createAppearance(c, { storage: null, defaultPreset: null });
    a.open();
    expect(pressed(c.root)).toEqual(['Default']);
    swatch(c.root, 'Carbon Coral').dispatch('click');
    expect(a.preset?.id).toBe('carbon-coral');
    expect(pressed(c.root)).toEqual(['Carbon Coral']);
    expect(c.appearance().theme.background).toBe('#1e1b20');
    a.setPreset(null);
    expect(pressed(c.root)).toEqual(['Default']);
    a.destroy();
  });

  it('move between swatches with the arrow keys, Home and End, one Tab stop', () => {
    const c = chart();
    const a = createAppearance(c, { storage: memoryStorage({ preset: 'paper-ink' }) });
    a.open();
    const all = swatches(c.root);
    expect(document.activeElement).toBe(all[1]);
    expect(all.map((n) => n.tabIndex)).toEqual(all.map((_, i) => (i === 1 ? 0 : -1)));
    const key = (k: string) => dispatch(document.activeElement, 'keydown', { key: k });
    key('ArrowRight');
    expect(document.activeElement).toBe(all[2]);
    key('ArrowDown');
    expect(document.activeElement).toBe(all[8]);
    key('ArrowUp');
    key('ArrowLeft');
    expect(document.activeElement).toBe(all[1]);
    key('End');
    expect(document.activeElement).toBe(all[10]);
    expect(all[10]!.tabIndex).toBe(0);
    key('ArrowDown');
    expect(document.activeElement).toBe(all[10]);
    key('Home');
    expect(document.activeElement).toBe(all[0]);
    // Moving does not apply; Enter or Space does, through the button's click.
    expect(a.preset?.id).toBe('paper-ink');
    a.destroy();
  });

  it('show the default swatch in the base theme and the others in the current mode', () => {
    const c = chart();
    const a = createAppearance(c, { storage: null, defaultPreset: null, baseTheme: () => lightTheme });
    a.open();
    expect(swatch(c.root, 'Default').style.background).toBe(lightTheme.background);
    expect(swatch(c.root, 'Deep Ocean').style.background).toBe(builtInColorPresets[8]!.light.background);
    a.setMode('dark');
    expect(swatch(c.root, 'Deep Ocean').style.background).toBe(builtInColorPresets[8]!.dark.background);
    a.destroy();
  });

  it('switch the mode with the Light and Dark buttons under the swatches', () => {
    const c = chart();
    const a = createAppearance(c, { storage: null });
    a.open();
    const mode = (value: string) => find(c.root, (n) => n.className.split(/\s+/).includes('pc-seg-btn') && n.getAttribute('data-value') === value)!;
    expect(a.mode).toBe('dark');
    mode('light').dispatch('click');
    expect(a.mode).toBe('light');
    expect(c.appearance().theme.background).toBe(builtInColorPresets[0]!.light.background);
    a.destroy();
  });
});

const shells: ChartShell[] = [];
/** An inline custom property of the shell element; the fake DOM keeps them as plain keys. */
const token = (s: ChartShell, name: string) => (s.el.style as unknown as Record<string, string>)[name];
describe('shell presets', () => {
  beforeEach(() => {
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
    vi.stubGlobal(
      'MutationObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
  });
  afterEach(() => shells.splice(0).forEach((s) => s.destroy()));
  function shell(options: Parameters<typeof createChartShell>[1] = {}) {
    const s = createChartShell(fakeContainer(), { toolbar: [], ...options });
    shells.push(s);
    return s;
  }

  it('restyles chrome and chart together in the variant of the theme', () => {
    const s = shell({ theme: 'light', appearance: { storage: null } });
    const events: unknown[] = [];
    s.on('preset:change', (e) => events.push(e));
    s.on('theme:change', (e) => events.push(e));
    const applied = vi.spyOn(s.chart, 'applyOptions');
    s.setColorPreset('butter-cobalt');
    expect(applied).toHaveBeenCalledTimes(1);
    expect(s.colorPreset).toBe('butter-cobalt');
    expect([s.theme, s.el.getAttribute('data-theme')]).toEqual(['light', 'light']);
    expect(token(s, '--pc-accent')).toBe(butter.light.primary);
    expect(token(s, '--pc-canvas')).toBe(butter.light.background);
    expect(s.chart.theme).toMatchObject({ background: butter.light.background, line: butter.light.primary, up: lightTheme.up });
    expect(events).toEqual([{ theme: 'light', resolved: 'light' }, { preset: 'butter-cobalt' }]);

    s.setColorPreset(null);
    expect(s.colorPreset).toBeNull();
    expect(token(s, '--pc-accent')).toBe('');
    expect(s.chart.theme.background).toBe(lightTheme.background);
  });

  it('starts from Paper & Ink in the system scheme', () => {
    // The fake DOM's media queries all match: the OS prefers light.
    const s = shell({ appearance: { storage: null } });
    expect([s.theme, s.resolvedTheme, s.colorPreset]).toEqual(['system', 'light', 'paper-ink']);
    expect(s.el.getAttribute('data-theme')).toBeNull();
    expect(s.chart.theme.background).toBe(builtInColorPresets[0]!.light.background);
    expect(shell({ appearance: { storage: null, defaultPreset: null } }).colorPreset).toBeNull();
  });

  it('keeps the colour-safe palette under a preset', () => {
    const s = shell({ theme: 'dark', appearance: { storage: null }, palette: 'color-safe' });
    s.setColorPreset('terminal-lime');
    expect(s.chart.theme).toMatchObject(colorSafeUpDown.dark);
    s.setPalette('default');
    expect(s.chart.theme.up).toBe(darkTheme.up);
    expect(s.chart.theme.background).toBe(lime.dark.background);
  });

  it('keeps the preset and switches its variant when the theme switches', () => {
    const s = shell({ theme: 'dark', appearance: { storage: null } });
    s.setColorPreset('terminal-lime');
    const events: unknown[] = [];
    s.on('preset:change', (e) => events.push(e));
    s.on('theme:change', (e) => events.push(e));
    s.setTheme('light');
    expect(s.colorPreset).toBe('terminal-lime');
    expect(events).toEqual([{ theme: 'light', resolved: 'light' }]);
    expect(s.chart.theme.background).toBe(lime.light.background);
    expect(token(s, '--pc-canvas')).toBe(lime.light.background);
    expect(s.appearance?.mode).toBe('light');
  });

  it('switches the shell theme from the appearance mode', () => {
    const s = shell({ theme: 'dark', appearance: { storage: null } });
    s.appearance!.setMode('light');
    expect([s.theme, s.resolvedTheme]).toEqual(['light', 'light']);
    expect(token(s, '--pc-canvas')).toBe(builtInColorPresets[0]!.light.background);
  });

  it('restores a saved preset in the theme’s variant before the first frame', () => {
    const s = shell({ theme: 'dark', appearance: { storage: memoryStorage({ preset: 'lavender-mist' }) } });
    expect([s.colorPreset, s.theme]).toEqual(['lavender-mist', 'dark']);
    expect(s.chart.theme.background).toBe('#1a1726');
    expect(token(s, '--pc-accent')).toBe('#c9bbff');
  });

  it('leaves the colours to the high-contrast class while it is on', () => {
    let changed = () => {};
    vi.stubGlobal(
      'MutationObserver',
      class {
        constructor(callback: () => void) {
          changed = callback;
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
    const s = shell({ theme: 'dark', appearance: { storage: null } });
    const paper = builtInColorPresets[0]!.dark;
    let on = true;
    Object.assign(s.el, { classList: { ...s.el.classList, contains: (name: string) => on && name === 'pc-theme-high-contrast' } });
    changed();
    expect([s.colorPreset, token(s, '--pc-canvas'), s.chart.theme.background]).toEqual(['paper-ink', '', darkTheme.background]);
    on = false;
    changed();
    expect([token(s, '--pc-canvas'), s.chart.theme.background]).toEqual([paper.background, paper.background]);
  });

  it('ignores presets with presets: false or without the appearance feature', () => {
    const off = shell({ appearance: { storage: memoryStorage({ preset: 'lavender-mist' }), presets: false } });
    expect([off.colorPreset, off.theme]).toEqual([null, 'system']);
    off.setColorPreset('lavender-mist');
    expect(off.colorPreset).toBeNull();
    const none = shell({ appearance: false });
    none.setColorPreset('lavender-mist');
    expect(none.colorPreset).toBeNull();
  });
});
