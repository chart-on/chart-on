import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultShellFeatures, resolveShellFeatures, type ShellFeatures } from '../src/features';
import { devCheck } from '../src/options-schema';

describe('resolveShellFeatures', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows every part by default, without the tooltip and compact layout', () => {
    expect(resolveShellFeatures(defaultShellFeatures)).toEqual({
      toolbar: true,
      rail: true,
      bottomBar: true,
      tooltip: false,
      railSheet: false,
      commandPalette: true,
    });
  });

  it('merges partial updates and ignores undefined values', () => {
    const a = resolveShellFeatures(defaultShellFeatures, { rail: false });
    const b = resolveShellFeatures(a, { bottomBar: false, rail: undefined });
    expect(b).toEqual({ ...defaultShellFeatures, rail: false, bottomBar: false });
    expect(defaultShellFeatures.rail).toBe(true);
  });

  it('ignores unknown flags', () => {
    const f = resolveShellFeatures(defaultShellFeatures, { sidebar: false } as unknown as Partial<ShellFeatures>);
    expect(f).toEqual(defaultShellFeatures);
  });
});

describe('shell options in development builds', () => {
  afterEach(() => vi.restoreAllMocks());

  it('warn about unknown keys, unknown flags and wrong values', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    devCheck('createChartShell', { themes: 'dark', theme: 'blue', features: { raill: false }, bottomBar: { clok: true } }, 'shell');
    devCheck('applyFeatures', { sidebar: false }, 'features');
    const text = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(text).toContain('createChartShell: unknown option "themes" is ignored; did you mean "theme"?');
    expect(text).toContain('[option-range]: createChartShell: "theme" should be one of "dark", "light", "system"');
    expect(text).toContain('unknown option "features.raill" is ignored; did you mean "rail"?');
    expect(text).toContain('unknown option "bottomBar.clok" is ignored; did you mean "clock"?');
    expect(text).toContain('applyFeatures: unknown option "sidebar" is ignored');
    devCheck('createChartShell', { tooltip: { anchor: 'left' } }, 'shell');
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('"tooltip.anchor" should be one of "pointer", "top"');
  });

  it('accept valid options', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    devCheck('createChartShell', { theme: 'system', rail: false, bottomBar: { clock: true }, features: { rail: false }, chart: { barSpacing: 4 } }, 'shell');
    devCheck(
      'createChartShell',
      { features: { tooltip: true, railSheet: true }, tooltip: { anchor: 'top', delay: 200, format: () => null }, railBreakpoint: 480 },
      'shell',
    );
    expect(warn).not.toHaveBeenCalled();
  });
});
