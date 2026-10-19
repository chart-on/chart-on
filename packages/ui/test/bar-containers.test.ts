import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Chart, type SettingsAdapter } from '@chart-on/core';
import { dispatch, fakeContainer } from '../../core/test/fake-dom';
import {
  bottomBarToolbarOptions,
  clock,
  createBottomBar,
  defaultBottomBarItems,
  goToDate,
  scaleMode,
  sessionMenu,
  timezoneMenu,
} from '../src/bottombar';
import { defaultIntervals, defaultToolbarItems } from '../src/default-toolbar';
import { placePopover } from '../src/dom';
import { createChartGrid } from '../src/grid';
import { createChartShell, type ChartShell } from '../src/shell';
import { createToolbar, type ToolbarHandle } from '../src/toolbar';
import { createToolbarCustomization } from '../src/toolbar-customization';
import { screenshot } from '../src/toolbar-presets';

type El = HTMLElement & { children: El[]; parent: El | null; textContent: string };
const all = (root: El): El[] => root.children.flatMap((c) => [c, ...all(c)]);
const named = (root: unknown, name: string) => all(root as El).find((el) => el.getAttribute('aria-label') === name);
const ids = (items: readonly { id?: string }[]) => items.map((item) => item.id);

const charts: Chart[] = [];
const bars: ToolbarHandle[] = [];
const shells: ChartShell[] = [];
beforeEach(() => {
  // The fake DOM installs `document` on first use.
  fakeContainer();
  // Bars measure their items to fit them; menus and forms measure the viewport as they open.
  vi.stubGlobal('getComputedStyle', () => ({ paddingRight: '0', getPropertyValue: () => '' }));
  vi.stubGlobal('document', Object.assign(Object.create(document), { documentElement: { clientWidth: 800, clientHeight: 600 } }));
  vi.stubGlobal('MutationObserver', class { observe(): void {} disconnect(): void {} });
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
});
afterEach(() => {
  shells.splice(0).forEach((s) => s.destroy());
  bars.splice(0).forEach((b) => b.destroy());
  charts.splice(0).forEach((c) => c.destroy());
  vi.unstubAllGlobals();
});

function chart() {
  const c = new Chart(fakeContainer(), { timezone: 'UTC' });
  c.addCandles();
  charts.push(c);
  return c;
}

const zones = { value: 'UTC', options: [{ value: 'UTC', label: 'UTC' }, { value: 'Asia/Tokyo', label: 'Tokyo' }] };

describe('bottom bar items', () => {
  it('lists the default items for the shorthand options', () => {
    expect(ids(defaultBottomBarItems())).toEqual(['go-to-date', 'clock', 'clock-separator', 'scale-mode']);
    expect(ids(defaultBottomBarItems({ goToDate: false, clock: false, scaleToggles: false }))).toEqual([]);
    expect(ids(defaultBottomBarItems({ scaleToggles: 'inline', clock: false, goToDate: false }))).toEqual(['scale-mode', 'scale-auto']);
    expect(
      ids(defaultBottomBarItems({ ranges: [{ label: '1W', span: 7 * 86400 }], timezones: zones, sessions: { options: [] } })),
    ).toEqual(['ranges', 'go-to-date', 'timezone', 'clock', 'clock-separator', 'session', 'session-separator', 'scale-mode']);
  });

  it('takes items as given, toolbar options as given, and saves customization under its own key', () => {
    const items = [goToDate()];
    expect(bottomBarToolbarOptions(items)).toEqual({ storageKey: 'bottomBar', items });
    expect(bottomBarToolbarOptions({ items, storageKey: 'mine' }).storageKey).toBe('mine');
    expect(ids(bottomBarToolbarOptions({ clock: false }).items)).toEqual(['go-to-date', 'scale-mode']);
  });

  it('shows a top toolbar preset in the bottom bar', () => {
    const bar = createBottomBar(fakeContainer(), chart(), [screenshot()]);
    bars.push(bar);
    expect(ids(bar.items)).toEqual(['screenshot']);
    expect(bar.get('screenshot')!.el.getAttribute('data-id')).toBe('screenshot');
    // The strip around the bar marks the bottom edge, so popups open upwards.
    expect((bar.el as El).parent!.getAttribute('data-pc-edge')).toBe('bottom');
  });
});

describe('bottom bar presets in the top toolbar', () => {
  function setup() {
    const c = chart();
    const bar = createToolbar(fakeContainer(), c, [goToDate(), timezoneMenu(zones), clock(), scaleMode()]);
    bars.push(bar);
    return { c, bar };
  }

  it('opens go to date from its action, wherever it is mounted', () => {
    const { c, bar } = setup();
    const goTo = vi.spyOn(c, 'goToTime').mockResolvedValue();
    const form = all(bar.get('go-to-date')!.el as El).find((el) => el.getAttribute('role') === 'dialog') as unknown as HTMLFormElement & {
      children: HTMLInputElement[];
    };
    expect(form.hidden).toBe(true);
    expect(c.actions.run('go-to-date')).not.toBe(false);
    expect(form.hidden).toBe(false);
    // Away from the bottom edge, the form opens downwards.
    expect(form.className).not.toContain('pc-popover--up');
    form.children[0]!.value = '1970-01-02';
    dispatch(form, 'submit');
    expect(goTo).toHaveBeenCalledWith(86400);
    bar.remove('go-to-date');
    expect(c.actions.has('go-to-date')).toBe(false);
  });

  it('sets the timezone from the menu and follows changes made elsewhere', () => {
    const { c, bar } = setup();
    dispatch(named(bar.el, 'Timezone')!, 'click');
    const tokyo = all(bar.el as El).find((el) => el.getAttribute('role') === 'option' && all(el).some((x) => x.textContent === 'Tokyo'))!;
    dispatch(tokyo, 'click');
    expect(c.options.timezone).toBe('Asia/Tokyo');
    c.applyOptions({ timezone: 'UTC' });
    const face = all(named(bar.el, 'Timezone')!).find((el) => el.className === 'pc-menu-face')!;
    expect(face.children[0]!.textContent).toBe('UTC');
  });

  it('shows the price scale mode on the menu button', () => {
    const { c, bar } = setup();
    const trigger = named(bar.el, 'Price scale')!;
    expect(all(trigger).map((el) => el.textContent)).toContain('linear · auto');
    c.setPriceScaleMode('log', 0);
    expect(all(trigger).map((el) => el.textContent)).toContain('log · auto');
  });
});

describe('the toolbar "more" button', () => {
  it('sits at the right edge when no end item is shown', () => {
    const c = chart();
    const bar = createToolbar(fakeContainer(), c, [{ type: 'button', id: 'a', label: 'A', onClick() {} }]);
    bars.push(bar);
    const more = (bar.el as El).children.find((el) => el.className.includes('pc-toolbar-more'))!;
    const toggle = vi.fn();
    Object.assign(more, { classList: { toggle } });
    const pushed = () => toggle.mock.calls.filter(([name]) => name === 'pc-toolbar-end').at(-1)?.[1];
    // Only start items: the button takes the auto margin.
    bar.add({ type: 'button', id: 'b', label: 'B', onClick() {} });
    expect(pushed()).toBe(true);
    // An end item takes it instead, and the button follows it.
    bar.add({ type: 'button', id: 'c', label: 'C', align: 'end', onClick() {} });
    expect(pushed()).toBe(false);
  });
});

describe('session menu preset', () => {
  it('applies the picked session', () => {
    const c = chart();
    const regular = { weekly: { mon: [{ start: '09:30', end: '16:00' }] } };
    const bar = createToolbar(fakeContainer(), c, [
      sessionMenu({ options: [{ value: 'all', label: 'All hours' }, { value: 'regular', label: 'Regular', session: regular }] }),
    ]);
    bars.push(bar);
    dispatch(named(bar.el, 'Trading session')!, 'click');
    const option = all(bar.el as El).find((el) => el.getAttribute('role') === 'option' && all(el).some((x) => x.textContent === 'Regular'))!;
    dispatch(option, 'click');
    expect(c.options.session).toEqual(regular);
    expect(c.options.sessionShading).toBe(true);
  });
});

describe('popups at the bottom edge', () => {
  const box = { left: 0, right: 40, top: 560, bottom: 590, width: 40, height: 30 };
  const trigger = (edge: unknown) => ({ getBoundingClientRect: () => box, closest: () => edge }) as unknown as HTMLElement;

  it('open upwards in a bar at the bottom edge, and downwards elsewhere', () => {
    const place = (edge: unknown) => {
      const toggle = vi.fn();
      const list = { offsetWidth: 200, scrollHeight: 100, style: {} as Record<string, string>, classList: { toggle } } as unknown as HTMLElement;
      placePopover(list, trigger(edge));
      return { up: toggle.mock.calls.find(([name]) => name === 'pc-popover--up')![1], maxHeight: list.style.maxHeight };
    };
    // Room above, not below: the list opens upwards uncapped.
    expect(place({})).toEqual({ up: true, maxHeight: '' });
    expect(place(null).up).toBe(false);
  });
});

describe('shell bars as containers', () => {
  function shell(options: Parameters<typeof createChartShell>[1] = {}) {
    const s = createChartShell(fakeContainer(), options);
    shells.push(s);
    return s;
  }
  const strip = (s: ChartShell) => (s.bottomBar!.el as El).parent!;

  it('shows a minimal top toolbar and no bottom bar by default', () => {
    const s = shell();
    expect(ids(s.toolbar!.items)).toEqual(['symbol', 'interval', 'indicators', 'indicator-templates', 'replay', 'fullscreen', 'chart-settings']);
    expect(ids(defaultToolbarItems())).toEqual(ids(s.toolbar!.items));
    // What the chart shows on the left; templates, replay, fullscreen and settings at the right end.
    const right = ['indicator-templates', 'replay', 'fullscreen', 'chart-settings'];
    for (const item of s.toolbar!.items) expect(item.group === 'view').toBe(right.includes(item.id!));
    // The default bar has the replay button, so the shell brings the strip that drives a replay.
    expect(s.replayControls).not.toBeNull();
    expect(shell({ toolbar: [] }).replayControls).toBeNull();
    expect(s.bottomBar).toBeNull();
    expect(shell({ toolbar: [] }).toolbar).toBeNull();
  });

  it('lists intervals from a minute to a week, each 3 to 7 times the one before', () => {
    const seconds = { m: 60, h: 3600, d: 86400, w: 604800 } as const;
    const spans = defaultIntervals.map((i) => Number.parseInt(i, 10) * seconds[i.slice(-1) as keyof typeof seconds]);
    expect(spans[0]).toBe(60);
    expect(spans.at(-1)).toBe(604800);
    for (let i = 1; i < spans.length; i++) {
      const ratio = spans[i]! / spans[i - 1]!;
      expect(ratio).toBeGreaterThanOrEqual(3);
      expect(ratio).toBeLessThanOrEqual(7);
    }
  });

  it('gives grid cells no toolbar of their own', () => {
    const grid = createChartGrid(fakeContainer(), { layout: '1x1' });
    expect(grid.cells[0]!.toolbar).toBeNull();
    expect(grid.cells[0]!.bottomBar).toBeNull();
    grid.destroy();
  });

  it('shows the default bottom bar on request, the items given, or none', () => {
    expect(shell().bottomBar).toBeNull();
    expect(ids(shell({ bottomBar: true }).bottomBar!.items)).toEqual(['go-to-date', 'clock', 'clock-separator', 'scale-mode']);
    expect(ids(shell({ bottomBar: {} }).bottomBar!.items)).toEqual(['go-to-date', 'clock', 'clock-separator', 'scale-mode']);
    expect(ids(shell({ bottomBar: [scaleMode()] }).bottomBar!.items)).toEqual(['scale-mode']);
    expect(shell({ bottomBar: [] }).bottomBar).toBeNull();
    expect(shell({ bottomBar: { items: [] } }).bottomBar).toBeNull();
    expect(shell({ bottomBar: false }).bottomBar).toBeNull();
  });

  it('moves bottom bar controls to the top toolbar and shows only that bar', () => {
    const s = shell({ toolbar: [goToDate(), timezoneMenu(zones), scaleMode()], bottomBar: false });
    expect(ids(s.toolbar!.items)).toEqual(['go-to-date', 'timezone', 'scale-mode']);
    expect(s.chart.actions.has('go-to-date')).toBe(true);
    expect(s.bottomBar).toBeNull();
  });

  it('hides either bar with its feature flag', () => {
    const s = shell({ toolbar: [screenshot()], bottomBar: true });
    s.applyFeatures({ bottomBar: false });
    expect(strip(s).hidden).toBe(true);
    expect(s.features.bottomBar).toBe(false);
    expect((s.toolbar!.el as El).parent!.hidden).toBe(false);
    s.applyFeatures({ bottomBar: true, toolbar: false });
    expect(strip(s).hidden).toBe(false);
    expect((s.toolbar!.el as El).parent!.hidden).toBe(true);
  });
});

describe('customization storage key', () => {
  it('reads the saved layout under the toolbar storage key', () => {
    const get = vi.fn(() => null);
    const settings = { get, set: () => {}, remove: () => {} } as unknown as SettingsAdapter;
    const c = chart();
    const custom = createToolbarCustomization(fakeContainer(), () => c, { items: [screenshot()], settings, storageKey: 'bottomBar' }, () => {});
    expect(get).toHaveBeenCalledWith('bottomBar');
    custom.destroy();
  });
});
