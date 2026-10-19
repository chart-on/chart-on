import { afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';
import { builtinTools, Chart, type DrawingToolDef } from '@chart-on/core';
import { dispatch, fakeContainer, installFakeDom } from '../../core/test/fake-dom';
import { overflowMore } from '../src/controls';
import { h } from '../src/dom';
import { allowedItems, defaultRailItems, fitBeside, groupSections, mountToolRail, railSections, toolRailItems, type RailItem } from '../src/rail';
import { defaultShellMessages, keyOf } from '../src/messages';
import { drawingIcons, groupFaces, groupIcons } from '../src/icons';
import { createChartShell } from '../src/shell';

const tool = (type: string, group?: string): DrawingToolDef => ({
  type,
  label: type,
  points: 1,
  ...(group ? { group } : {}),
  render() {},
  hitTest: () => false,
});

describe('toolRailItems', () => {
  it('builds one flyout per group in order of first appearance', () => {
    const items = toolRailItems([tool('a', 'lines'), tool('solo'), tool('b', 'annotate'), tool('c', 'lines'), tool('d', 'annotate'), tool('x', 'mine')]);
    expect(items).toEqual([
      { type: 'group', label: 'Lines', tools: [{ tool: 'a' }, { tool: 'c' }] },
      { type: 'tool', tool: 'solo' },
      { type: 'group', label: 'Annotate', tools: [{ tool: 'b' }, { tool: 'd' }] },
      { type: 'tool', tool: 'x' },
    ]);
  });

  it('shows the seven built-in groups in the catalogue order, then the eraser and zoom box', () => {
    const items = defaultRailItems(builtinTools).slice(0, 10);
    const groups = ['lines', 'annotate', 'parallels', 'ratios', 'time', 'patterns', 'measure'];
    const labels = ['Lines', 'Annotate', 'Parallels', 'Ratios', 'Time', 'Patterns', 'Measure'];
    expect(items).toEqual([
      { type: 'cursor' },
      ...groups.map((group, i) => ({
        type: 'group',
        label: labels[i],
        tools: builtinTools.filter((t) => t.group === group).map((t) => ({ tool: t.type })),
      })),
      { type: 'tool', tool: 'eraser' },
      { type: 'tool', tool: 'zoom-box' },
    ]);
  });

  it("starts each group's button on its face, a tool of that group, whose icon is the group's", () => {
    expect(Object.keys(groupFaces)).toEqual(['lines', 'annotate', 'parallels', 'ratios', 'time', 'patterns', 'measure']);
    for (const [group, face] of Object.entries(groupFaces)) {
      expect(builtinTools.find((t) => t.type === face)?.group).toBe(group);
      expect(groupIcons[group]).toBe(drawingIcons[face]);
    }
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
    vi.stubGlobal('MutationObserver', class { observe(): void {} disconnect(): void {} });
    const s = createChartShell(fakeContainer(), { toolbar: [] });
    const faces = [...(s.rail!.el as unknown as { children: { children: { getAttribute(n: string): string | null }[] }[] }).children]
      .filter((wrap) => wrap.children?.length === 2)
      .map((wrap) => wrap.children[0]!.getAttribute('aria-label'));
    expect(faces).toEqual(['Crosshair', 'Trend line', 'Text', 'Parallel channel', 'Fib retracement', 'Cyclic lines', 'ABCD pattern', 'Measure']);
    s.destroy();
    vi.unstubAllGlobals();
  });

  it('keeps the icon map in the catalogue order, with an icon for every built-in tool', () => {
    const keys = Object.keys(drawingIcons);
    const builtin = builtinTools.map((t) => t.type);
    expect(keys.slice(0, builtin.length)).toEqual(builtin);
    const rest = keys.slice(builtin.length);
    expect(rest).toEqual([...rest].sort());
    expect(rest.some((k) => builtin.includes(k))).toBe(false);
  });
});

describe('flyout sections', () => {
  it('puts every built-in tool of a group in exactly one section, each with a title', () => {
    expect(Object.keys(groupSections)).toEqual(Object.keys(groupFaces));
    for (const [group, sections] of Object.entries(groupSections)) {
      const members = Object.values(sections).flat();
      expect(members.sort()).toEqual(builtinTools.filter((t) => t.group === group).map((t) => t.type).sort());
      // The face's section comes first.
      expect(Object.values(sections)[0]).toContain(groupFaces[group]);
      for (const id of Object.keys(sections)) expect(defaultShellMessages[keyOf('railSection', id)]).toBeTruthy();
    }
  });

  it('keeps the tools in order and puts unknown ones last, untitled', () => {
    const tools = ['brush', 'mine', 'text', 'arrow', 'note'].map((tool) => ({ tool }));
    expect(railSections('annotate', tools)).toEqual([
      { id: 'text', tools: [{ tool: 'text' }, { tool: 'note' }] },
      { id: 'arrows', tools: [{ tool: 'arrow' }] },
      { id: 'freehand', tools: [{ tool: 'brush' }] },
      { tools: [{ tool: 'mine' }] },
    ]);
    expect(railSections('custom', tools)).toEqual([{ tools }]);
  });

  it('opens a group on a right-click, in titled columns when it is long', () => {
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
    vi.stubGlobal('MutationObserver', class { observe(): void {} disconnect(): void {} });
    const s = createChartShell(fakeContainer(), { toolbar: [] });
    type Node = { children: Node[]; getAttribute(n: string): string | null; style: Record<string, string> };
    const wraps = (s.rail!.el as unknown as Node).children.filter((n) => n.children?.length === 2);
    const annotate = wraps[2]!;
    expect(annotate.children[1]!.getAttribute('aria-label')).toBe('More annotate');
    dispatch(annotate, 'contextmenu');
    const menu = annotate.children[2]!;
    expect(menu.getAttribute('role')).toBe('menu');
    expect(menu.style['--pc-rail-columns']).toBe('3');
    expect(menu.children.map((c) => c.getAttribute('aria-label'))).toEqual(['Notes and labels', 'Shapes', 'Arrows', 'Freehand']);
    s.destroy();
    vi.unstubAllGlobals();
  });
});

describe('flyout opening', () => {
  type Node = { children: Node[]; getAttribute(n: string): string | null };
  const setup = () => {
    vi.useFakeTimers();
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
    vi.stubGlobal('MutationObserver', class { observe(): void {} disconnect(): void {} });
    const s = createChartShell(fakeContainer(), { toolbar: [] });
    const lines = (s.rail!.el as unknown as Node).children.filter((n) => n.children?.length === 2)[1]!;
    const menu = () => lines.children.find((n) => n.getAttribute('role') === 'menu');
    return { s, lines, menu };
  };
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('opens on a resting mouse and closes a moment after it leaves', () => {
    const { s, lines, menu } = setup();
    dispatch(lines, 'pointerenter', { pointerType: 'mouse' });
    vi.advanceTimersByTime(299);
    expect(menu()).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(menu()).toBeDefined();
    dispatch(lines, 'pointerleave', { pointerType: 'mouse' });
    vi.advanceTimersByTime(200);
    // Back in time (crossing to the menu): it stays.
    dispatch(lines, 'pointerenter', { pointerType: 'mouse' });
    vi.advanceTimersByTime(500);
    expect(menu()).toBeDefined();
    dispatch(lines, 'pointerleave', { pointerType: 'mouse' });
    vi.advanceTimersByTime(300);
    expect(menu()).toBeUndefined();
    s.destroy();
  });

  it('does not open when the mouse presses the button, or passes over it', () => {
    const { s, lines, menu } = setup();
    dispatch(lines, 'pointerenter', { pointerType: 'mouse' });
    dispatch(lines, 'pointerdown', { pointerType: 'mouse' });
    vi.advanceTimersByTime(500);
    expect(menu()).toBeUndefined();
    dispatch(lines, 'pointerenter', { pointerType: 'mouse' });
    vi.advanceTimersByTime(100);
    dispatch(lines, 'pointerleave', { pointerType: 'mouse' });
    vi.advanceTimersByTime(500);
    expect(menu()).toBeUndefined();
    s.destroy();
  });

  it('fills the menu on a horizontal rail too', () => {
    const { s, lines, menu } = setup();
    (s.rail!.el as unknown as { dataset: Record<string, string> }).dataset.orientation = 'horizontal';
    // `placePopover` reads the window's size; the fake DOM has no root element.
    Object.defineProperty(document, 'documentElement', { value: { clientWidth: 800, clientHeight: 600 }, configurable: true });
    dispatch(lines, 'contextmenu');
    expect(menu()?.children.length).toBeGreaterThan(0);
    delete (document as { documentElement?: unknown }).documentElement;
    s.destroy();
  });

  it('opens on a tap instead of arming the tool, and keeps Enter arming it', () => {
    const { s, lines, menu } = setup();
    const main = lines.children[0];
    dispatch(lines, 'pointerdown', { pointerType: 'touch' });
    dispatch(main, 'click', { detail: 1, target: main });
    expect(menu()?.children.length).toBeGreaterThan(0);
    expect(s.chart.drawings.tool).toBeNull();
    dispatch(main, 'click', { detail: 0, target: main });
    expect(s.chart.drawings.tool).toBe('trendline');
    s.destroy();
  });
});

describe('fitBeside', () => {
  /** A flyout `height` px tall whose top is `top` px down the window, as far as `fitBeside` reads it. */
  const menu = (top: number, height: number) => {
    const style: Record<string, string> = {};
    const el = { style, offsetHeight: height, getBoundingClientRect: () => ({ top, bottom: top + Math.min(height, parseFloat(style.maxHeight ?? 'Infinity')) }) };
    return el as unknown as HTMLElement & { style: Record<string, string> };
  };
  afterEach(() => vi.unstubAllGlobals());

  it('scrolls a flyout taller than the window and moves it up to fit', () => {
    vi.stubGlobal('window', { innerHeight: 600 });
    vi.stubGlobal('document', {});
    const tall = menu(100, 1200);
    fitBeside(tall);
    expect(tall.style).toEqual({ maxHeight: '584px', overflowY: 'auto', top: '-92px' });
    const low = menu(400, 300);
    fitBeside(low);
    expect(low.style).toEqual({ top: '-108px' });
    const fits = menu(100, 300);
    fitBeside(fits);
    expect(fits.style).toEqual({});
  });
});

describe('allowedItems', () => {
  it('drops denied tools and groups left empty', () => {
    const items = [
      { type: 'cursor' as const },
      { type: 'group' as const, label: 'Lines', tools: [{ tool: 'a' }, { tool: 'b' }] },
      { type: 'group' as const, label: 'Annotate', tools: [{ tool: 'c' }] },
      { type: 'tool' as const, tool: 'd' },
      { type: 'tool' as const, tool: 'e' },
    ];
    expect(allowedItems(items, (t) => t === 'b' || t === 'e')).toEqual([
      { type: 'cursor' },
      { type: 'tool', tool: 'b' },
      { type: 'tool', tool: 'e' },
    ]);
  });

  it('collapses a group filtered down to one tool, like toolRailItems', () => {
    const items = [
      { type: 'group' as const, label: 'Lines', tools: [{ tool: 'a', label: 'A' }, { tool: 'b' }, { tool: 'c' }] },
      { type: 'group' as const, label: 'Solo', tools: [{ tool: 'd' }] },
    ];
    expect(allowedItems(items, (t) => t !== 'b' && t !== 'c')).toEqual([
      { type: 'tool', tool: 'a', label: 'A' },
      { type: 'tool', tool: 'd' },
    ]);
    expect(allowedItems(items, (t) => t !== 'c')[0]).toMatchObject({ type: 'group', tools: [{ tool: 'a' }, { tool: 'b' }] });
  });
});

interface FakeNode {
  children: FakeNode[];
  parent: FakeNode | null;
  getAttribute(name: string): string | null;
  dispatch(type: string): void;
}
const fake = (el: unknown) => el as FakeNode;

/** Give `el` room for `room` children along both axes, each child one pixel long. */
function sized(el: unknown, room: () => number): void {
  const bar = fake(el);
  for (const [content, box] of [
    ['scrollHeight', 'clientHeight'],
    ['scrollWidth', 'clientWidth'],
  ] as const) {
    Object.defineProperty(bar, content, { get: () => bar.children.length, configurable: true });
    Object.defineProperty(bar, box, { get: room, configurable: true });
  }
}

describe('overflowMore', () => {
  beforeAll(() => installFakeDom());

  it('moves the trailing children that do not fit into its popover, in order, and back', () => {
    const bar = h('div');
    const kids = [0, 1, 2, 3, 4].map((i) => h('button', { 'data-i': String(i) }));
    bar.append(...kids);
    let room = 3;
    sized(bar, () => room);
    const button = h('button');
    const more = overflowMore(bar, button, 'wrap', 'pop');
    more.fit();
    // Two children and the button fill the room; the rest wait in the popover, in order.
    expect(fake(bar).children).toEqual([kids[0], kids[1], more.wrap]);
    expect(fake(more.panel).children).toEqual([kids[2], kids[3], kids[4]]);

    // The button opens and closes the popover, and says so. It is a disclosure, not a menu
    // button: the popover is a group of the bar's own buttons, named after the button.
    button.setAttribute('aria-label', 'More');
    fake(button).dispatch('click');
    expect(fake(more.panel).parent).toBe(fake(more.wrap));
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-haspopup')).toBeNull();
    expect([more.panel.getAttribute('role'), more.panel.getAttribute('aria-label')]).toEqual(['group', 'More']);
    fake(button).dispatch('click');
    expect(fake(more.panel).parent).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');

    // Room again: everything is back in place and the button goes.
    room = 10;
    more.fit();
    expect(fake(bar).children).toEqual(kids);
    expect(fake(more.panel).children).toEqual([]);
    more.stop();
  });

  it('shows its popover again after a fade out, also when reopened during the fade', async () => {
    const bar = h('div');
    bar.append(h('button'), h('button'));
    sized(bar, () => 2);
    const button = h('button');
    const more = overflowMore(bar, button, 'wrap', 'pop');
    more.fit();
    // A platform that animates: each close fades the popover, which fills forwards.
    const fades: { cancel: ReturnType<typeof vi.fn>; finish: () => void }[] = [];
    Object.assign(more.panel, {
      getBoundingClientRect: () => ({ width: 100 }),
      animate: () => {
        let finish = () => {};
        const finished = new Promise<void>((resolve) => (finish = resolve));
        const fade = { cancel: vi.fn(), finished, finish };
        fades.push(fade);
        return fade;
      },
    });
    const click = () => fake(button).dispatch('click');
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });

    click();
    click();
    expect(more.panel.inert).toBe(true);
    fades[0]!.finish();
    await Promise.resolve();
    // Gone, and left visible and usable for the next open.
    expect(fake(more.panel).parent).toBeNull();
    expect(fades[0]!.cancel).toHaveBeenCalled();
    expect(more.panel.inert).toBe(false);

    click();
    expect(fake(more.panel).parent).toBe(fake(more.wrap));
    click();
    // Opened again before the fade ends: the end of the fade keeps it.
    click();
    fades[1]!.finish();
    await Promise.resolve();
    expect(fake(more.panel).parent).toBe(fake(more.wrap));
    expect(more.panel.inert).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    more.stop();
  });

  it('closes an open popover and drops its dismiss listeners when stopped', () => {
    vi.useFakeTimers();
    try {
      const bar = h('div');
      bar.append(h('button'), h('button'));
      sized(bar, () => 1);
      const button = h('button');
      const more = overflowMore(bar, button, 'wrap', 'pop');
      more.fit();
      fake(button).dispatch('click');
      vi.runAllTimers(); // the dismiss listeners attach after the opening click
      const removed = vi.spyOn(document, 'removeEventListener');
      more.stop();
      expect(fake(more.panel).parent).toBeNull();
      expect(button.getAttribute('aria-expanded')).toBe('false');
      expect(removed.mock.calls.map(([type]) => type).sort()).toEqual(['keydown', 'pointerdown']);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it('leaves a bar that measures zero alone', () => {
    const bar = h('div');
    bar.append(h('button'), h('button'));
    sized(bar, () => 0);
    Object.defineProperty(bar, 'scrollWidth', { value: 0 });
    const more = overflowMore(bar, h('button'), 'wrap', 'pop');
    more.fit();
    expect(fake(bar).children).toHaveLength(2);
    more.stop();
  });
});

describe('tool rail overflow', () => {
  const charts: Chart[] = [];
  afterEach(() => charts.splice(0).forEach((c) => c.destroy()));

  it('moves the groups a short rail cannot hold into a "more" button at its end', () => {
    const chart = new Chart(fakeContainer());
    charts.push(chart);
    const items: RailItem[] = [
      { type: 'cursor' },
      { type: 'tool', tool: 'trendline' },
      { type: 'tool', tool: 'ray' },
      { type: 'separator' },
      { type: 'tool', tool: 'hline' },
      { type: 'tool', tool: 'vline' },
    ];
    const { handle } = mountToolRail(fakeContainer(), chart, items);
    let room = 4;
    sized(handle.el, () => room);
    handle.setItems(items);
    const rail = fake(handle.el).children;
    expect(rail).toHaveLength(4);
    const more = rail[3]!.children[0]!;
    expect(more.getAttribute('aria-label')).toBe('More');
    // The cursor and two tools stay; the separator and the last tools sit behind the button.
    const label = (n: FakeNode) => n.getAttribute('aria-label');
    expect(rail.slice(1, 3).map(label)).toEqual(['Trend line', 'Ray']);
    more.dispatch('click');
    const panel = rail[3]!.children[1]!;
    expect(panel.children.map((n) => n.getAttribute('role') ?? label(n))).toEqual(['separator', 'Horizontal line', 'Vertical line']);

    // A hidden tool still shows its state, and works from the popover.
    panel.children[2]!.dispatch('click');
    expect(chart.drawings.tool).toBe('vline');
    expect(panel.children[2]!.getAttribute('aria-pressed')).toBe('true');

    // A taller rail gets every button back in order, and no "more" button.
    room = 20;
    handle.setItems(items);
    expect(fake(handle.el).children.map((n) => n.getAttribute('role') ?? label(n)).slice(1)).toEqual([
      'Trend line',
      'Ray',
      'separator',
      'Horizontal line',
      'Vertical line',
    ]);
    handle.destroy();
  });
});
