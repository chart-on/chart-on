import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALWAYS_OPEN, Chart, zoneOf, type SessionSchedule } from '@chart-on/core';
import { dispatch, fakeContainer } from '../../core/test/fake-dom';
import { applyRange, clockText, createBottomBar, defaultRanges, sessionPatch, type BottomBarHandle, type BottomBarOptions } from '../src/bottombar';
import { createChartSettings } from '../src/chart-settings';

// The bar is a toolbar, which measures its items to fit them.
beforeEach(() => {
  vi.stubGlobal('getComputedStyle', () => ({ paddingRight: '0', getPropertyValue: () => '' }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const stub = (timezone: string, times: number[] = []) =>
  ({ zone: zoneOf(timezone), timeline: { times }, setVisibleTimeRange: vi.fn(), fitContent: vi.fn() }) as unknown as Chart;

describe('bottom bar time', () => {
  it('shows the clock in the chart timezone with its UTC offset', () => {
    const now = Date.UTC(2024, 6, 1, 12, 0, 5);
    expect(clockText(stub('UTC'), now)).toBe('12:00:05 UTC');
    expect(clockText(stub('America/New_York'), now)).toBe('08:00:05 UTC-4');
    expect(clockText(stub('Asia/Kolkata'), now)).toBe('17:30:05 UTC+5:30');
  });

  it('starts year to date at local midnight on January 1', () => {
    const last = Date.UTC(2024, 6, 1) / 1000;
    const chart = stub('Asia/Tokyo', [last]);
    applyRange(chart, { label: 'YTD', span: 'ytd' });
    // 2024-01-01 00:00 in Tokyo is 2023-12-31 15:00 UTC.
    expect(chart.setVisibleTimeRange).toHaveBeenCalledWith(Date.UTC(2023, 11, 31, 15) / 1000, last);
  });
});

describe('bottom bar session menu', () => {
  it('shades a set session and clears shading for always open', () => {
    const day = [{ start: '09:30', end: '16:00' }];
    const session: SessionSchedule = { weekly: { mon: day } };
    expect(sessionPatch({ value: 'regular', label: 'Regular', session })).toEqual({ session, sessionShading: true });
    expect(sessionPatch({ value: 'always', label: 'Always open' })).toEqual({ session: ALWAYS_OPEN, sessionShading: false });
  });
});

type El = HTMLElement & { children: El[]; tagName: string; textContent: string };
const all = (root: El): El[] => root.children.flatMap((c) => [c, ...all(c)]);
const byClass = (root: El, cls: string) => all(root).find((el) => el.className.split(/\s+/).includes(cls));
const zoneTrigger = (bar: BottomBarHandle) => all(bar.el as El).find((el) => el.getAttribute('aria-label') === 'Timezone')!;
/** Let the clock find the bar's timezone menu, as `querySelector` does in a browser (the fake DOM has none). */
const linkZoneMenu = (bar: BottomBarHandle) => {
  const trigger = zoneTrigger(bar);
  const found = { click: () => dispatch(trigger, 'click') };
  Object.assign(bar.el, { querySelector: (selector: string) => (selector === '[data-id="timezone"] .pc-menu-trigger' ? found : null) });
};

describe('bottom bar clock', () => {
  const charts: Chart[] = [];
  const bars: BottomBarHandle[] = [];
  afterEach(() => {
    bars.splice(0).forEach((b) => b.destroy());
    charts.splice(0).forEach((c) => c.destroy());
  });

  function setup(options: BottomBarOptions = {}) {
    // The clock looks again at the settings and menus once a second.
    vi.useFakeTimers();
    const chart = new Chart(fakeContainer(), { timezone: 'UTC' });
    charts.push(chart);
    const bar = createBottomBar(fakeContainer(), chart, { goToDate: false, scaleToggles: false, ...options });
    bars.push(bar);
    if (options.timezones) {
      linkZoneMenu(bar);
      vi.advanceTimersByTime(1000);
    }
    const clock = () => byClass(bar.el as El, 'pc-clock')!;
    const addSettings = () => createChartSettings(chart, fakeContainer(), { storage: null, appearance: null });
    return { chart, bar, clock, addSettings };
  }

  const zones: BottomBarOptions['timezones'] = {
    value: 'UTC',
    options: [
      { value: 'UTC', label: 'UTC' },
      { value: 'Asia/Tokyo', label: 'Tokyo' },
    ],
  };

  it('opens the chart settings on the Time section', async () => {
    const { chart, bar, clock, addSettings } = setup();
    const settings = addSettings();
    // The settings came after the bar, as in the shell; the clock turns into a button once the shell is done.
    expect(clock().tagName.toLowerCase()).toBe('span');
    await Promise.resolve();
    const button = clock();
    expect(button.tagName.toLowerCase()).toBe('button');
    expect(button.getAttribute('aria-label')).toBe('Timezone: UTC, change');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    dispatch(button, 'click');
    expect(settings.isOpen).toBe(true);
    expect(settings.dialog!.section).toBe('time');
    expect(chart.options.timezone).toBe('UTC');
    settings.destroy();
  });

  it('shows a timezone change at once, wherever it came from, and keeps the menu in step', () => {
    const { chart, bar, clock } = setup({ timezones: zones });
    chart.applyOptions({ timezone: 'Asia/Tokyo' });
    expect(clock().getAttribute('aria-label')).toBe('Timezone: UTC+9, change');
    expect(clock().textContent).toMatch(/ UTC\+9$/);
    const face = byClass(zoneTrigger(bar), 'pc-menu-face')!;
    expect(face.children[0]!.textContent).toBe('Tokyo');
  });

  it('opens the timezone menu without chart settings', () => {
    const { bar, clock } = setup({ timezones: zones });
    const button = clock();
    expect(button.tagName.toLowerCase()).toBe('button');
    expect(button.getAttribute('aria-haspopup')).toBe('listbox');
    const trigger = zoneTrigger(bar);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    // The list measures the viewport as it opens.
    vi.stubGlobal('document', Object.assign(Object.create(document), { documentElement: { clientWidth: 800, clientHeight: 600 } }));
    try {
      dispatch(button, 'click');
    } finally {
      vi.unstubAllGlobals();
    }
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('stays plain text without chart settings or a timezone menu', () => {
    const { clock } = setup();
    vi.advanceTimersByTime(1000);
    expect(clock().tagName.toLowerCase()).toBe('span');
    expect(clock().getAttribute('aria-label')).toBeNull();
    expect(() => dispatch(clock(), 'click')).not.toThrow();
  });
});

describe('bottom bar scale controls', () => {
  const charts: Chart[] = [];
  const bars: BottomBarHandle[] = [];
  afterEach(() => {
    bars.splice(0).forEach((b) => b.destroy());
    charts.splice(0).forEach((c) => c.destroy());
  });

  function setup() {
    const chart = new Chart(fakeContainer());
    charts.push(chart);
    chart.addCandles();
    const bar = createBottomBar(fakeContainer(), chart, { goToDate: false, clock: false, scaleToggles: 'inline' });
    bars.push(bar);
    const group = all(bar.el as El).find((el) => el.getAttribute('role') === 'radiogroup')!;
    const radios = () => all(group).filter((el) => el.getAttribute('role') === 'radio');
    // The fake DOM keeps `dataset` apart from the `data-` attributes, which the radios are matched by.
    for (const r of radios()) r.dataset.value = r.getAttribute('data-value')!;
    bar.setValue('scale-mode', 'normal');
    return { chart, bar, group, radios };
  }

  it('picks normal, log or percent in one radio group with one Tab stop', () => {
    const { chart, bar, group, radios } = setup();
    expect(group.getAttribute('aria-label')).toBe('Price scale');
    expect(radios().map((r) => r.textContent)).toEqual(['linear', 'log', '%']);
    // The short texts get full names, also as tooltips.
    expect(radios().map((r) => r.getAttribute('aria-label'))).toEqual([null, 'Logarithmic scale', 'Percent scale']);
    expect(radios()[1]!.getAttribute('data-tip')).toBe('Logarithmic scale');
    const checked = () => radios().map((r) => r.getAttribute('aria-checked'));
    expect(checked()).toEqual(['true', 'false', 'false']);
    expect(radios().map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    dispatch(radios()[1]!, 'click');
    expect(chart.getPriceScaleMode(0)).toBe('log');
    expect(checked()).toEqual(['false', 'true', 'false']);
    // A change made elsewhere checks its radio once the bar refreshes (on `scale:change` in a running chart).
    chart.setPriceScaleMode('percent', 0);
    bar.refresh();
    expect(checked()).toEqual(['false', 'false', 'true']);
    expect(radios().map((r) => r.tabIndex)).toEqual([-1, -1, 0]);
  });

  it('checks % for an indexed scale, so one radio stays checked and tabbable', () => {
    const { chart, bar, radios } = setup();
    chart.setPriceScaleMode('indexed', 0);
    bar.refresh();
    expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
    expect(radios().map((r) => r.tabIndex)).toEqual([-1, -1, 0]);
    dispatch(radios()[0]!, 'click');
    expect(chart.getPriceScaleMode(0)).toBe('normal');
  });

  it('keeps auto-fit as a toggle beside the modes and has no ratio lock', () => {
    const { chart, bar, group } = setup();
    const items = (bar.el as El).children;
    const auto = items.find((el) => el.getAttribute('aria-label') === 'Auto-fit the price scale')!;
    expect(auto).toBeDefined();
    expect(all(auto).map((el) => el.textContent)).toContain('auto');
    expect(all(bar.el as El).some((el) => el.textContent === 'lock')).toBe(false);
    expect(items.indexOf(auto)).toBe(items.findIndex((el) => all(el).includes(group)) + 1);
    chart.setAutoScale(true, 0);
    bar.refresh();
    expect(auto.getAttribute('aria-pressed')).toBe('true');
    dispatch(auto, 'click');
    expect(chart.isAutoScale(0)).toBe(false);
  });
});

describe('bottom bar defaults', () => {
  const charts: Chart[] = [];
  const bars: BottomBarHandle[] = [];
  afterEach(() => {
    bars.splice(0).forEach((b) => b.destroy());
    charts.splice(0).forEach((c) => c.destroy());
    vi.unstubAllGlobals();
  });

  function setup(options: BottomBarOptions = {}) {
    const chart = new Chart(fakeContainer());
    charts.push(chart);
    chart.addCandles();
    const bar = createBottomBar(fakeContainer(), chart, { goToDate: false, clock: false, ...options });
    bars.push(bar);
    const named = (name: string) => all(bar.el as El).find((el) => el.getAttribute('aria-label') === name);
    return { chart, bar, named };
  }
  const texts = (root: El) => all(root).map((el) => el.textContent);

  it('shows no range presets unless given some', () => {
    expect(setup().named('Date range')).toBeUndefined();
    const { named } = setup({ ranges: defaultRanges });
    expect(texts(named('Date range')!)).toContain('1D');
  });

  it('puts the scale modes and auto-fit in one menu that shows the current mode', () => {
    const { chart, bar, named } = setup();
    // The list measures the viewport as it opens.
    vi.stubGlobal('document', Object.assign(Object.create(document), { documentElement: { clientWidth: 800, clientHeight: 600 } }));
    expect(all(bar.el as El).some((el) => el.getAttribute('role') === 'radiogroup')).toBe(false);
    const trigger = named('Price scale')!;
    expect(texts(trigger)).toContain('linear · auto');

    dispatch(trigger, 'click');
    const items = () => all(bar.el as El).filter((el) => el.getAttribute('role') === 'menuitemcheckbox');
    const labelled = (text: string) => items().find((el) => texts(el).includes(text))!;
    expect(items().map((el) => el.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'true']);
    dispatch(labelled('Logarithmic scale'), 'click');
    expect(chart.getPriceScaleMode(0)).toBe('log');
    expect(texts(trigger)).toContain('log · auto');

    // Changes made elsewhere show too.
    chart.setAutoScale(false, 0);
    bar.refresh();
    expect(texts(trigger)).toContain('log');
    dispatch(trigger, 'click');
    dispatch(labelled('Auto-fit the price scale'), 'click');
    expect(chart.isAutoScale(0)).toBe(true);
  });

  it('keeps the inline controls on request', () => {
    const { bar } = setup({ scaleToggles: 'inline' });
    expect(all(bar.el as El).some((el) => el.getAttribute('role') === 'radiogroup')).toBe(true);
  });
});
