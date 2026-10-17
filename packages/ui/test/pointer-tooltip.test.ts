import { afterEach, describe, expect, it, vi } from 'vitest';
import { Chart } from '@charton/core';
import { dispatch, fakeContainer, runFrame } from '../../core/test/fake-dom';
import { createPointerTooltip, placePointerTooltip, pointerTooltipContent, type PointerTooltipOptions } from '../src/pointer-tooltip';

const size = { width: 160, height: 60 };
const area = { width: 800, height: 400 };

describe('placePointerTooltip', () => {
  it('goes right of the bar slot, centred on the pointer', () => {
    expect(placePointerTooltip({ x: 300, halfWidth: 5 }, 200, size, area)).toEqual({ x: 317, y: 170 });
  });

  it('goes left when the right side has no room, still clear of the bar slot', () => {
    const at = placePointerTooltip({ x: 700, halfWidth: 5 }, 200, size, area);
    expect(at).toEqual({ x: 523, y: 170 });
    expect(at.x + size.width).toBeLessThanOrEqual(700 - 5);
  });

  it('pins to the top without a pointer height, and stays inside vertically', () => {
    expect(placePointerTooltip({ x: 300, halfWidth: 5 }, null, size, area).y).toBe(4);
    expect(placePointerTooltip({ x: 300, halfWidth: 5 }, 0, size, area).y).toBe(4);
    expect(placePointerTooltip({ x: 300, halfWidth: 5 }, 400, size, area).y).toBe(336);
  });

  it('takes the roomier side, clamped, when neither side has room', () => {
    const narrow = { width: 200, height: 400 };
    expect(placePointerTooltip({ x: 60, halfWidth: 5 }, 100, size, narrow).x).toBe(36);
    expect(placePointerTooltip({ x: 150, halfWidth: 5 }, 100, size, narrow).x).toBe(4);
  });
});

const charts: Chart[] = [];
afterEach(() => {
  charts.splice(0).forEach((c) => c.destroy());
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function setup(options: PointerTooltipOptions = {}) {
  const c = new Chart(fakeContainer(), { timezone: 'UTC' });
  charts.push(c);
  c.addCandles({ animate: false }).setData(
    Array.from({ length: 50 }, (_, i) => ({ time: i * 60, open: 10, high: 20, low: 0, close: 10 + i })),
  );
  const tip = createPointerTooltip(c, { format: (v) => `bar ${v.index}`, ...options });
  return { c, tip };
}

/** Move the crosshair over the plot and run the tooltip's frame. */
function hover(c: Chart) {
  c.setCrosshair({ x: 300, y: 200, pane: 0 });
  runFrame(0);
}

describe('createPointerTooltip', () => {
  it('shows the crosshair bar beside it and hides when the crosshair leaves', () => {
    const { c, tip } = setup();
    expect(tip.el.hidden).toBe(true);
    hover(c);
    expect(tip.el.hidden).toBe(false);
    expect(tip.el.textContent).toBe(`bar ${c.valuesAt()!.index}`);
    expect(tip.el.style.transform).toMatch(/^translate\(\d+px, \d+px\)$/);
    expect(tip.el.getAttribute('aria-hidden')).toBe('true');
    c.setCrosshair(null);
    runFrame(0);
    expect(tip.el.hidden).toBe(true);
  });

  it('shows nothing where format returns null', () => {
    const { c, tip } = setup({ format: () => null });
    hover(c);
    expect(tip.el.hidden).toBe(true);
  });

  it('waits for the delay each time the crosshair appears', () => {
    vi.useFakeTimers();
    const { c, tip } = setup({ delay: 300 });
    hover(c);
    expect(tip.el.hidden).toBe(true);
    vi.advanceTimersByTime(300);
    runFrame(0);
    expect(tip.el.hidden).toBe(false);
    // Moving on shows at once.
    c.setCrosshair({ x: 320, y: 200, pane: 0 });
    runFrame(0);
    expect(tip.el.hidden).toBe(false);
    c.setCrosshair(null);
    hover(c);
    expect(tip.el.hidden).toBe(true);
  });

  it('stays hidden on touch unless a long-press inspects or the crosshair is locked', () => {
    const { c, tip } = setup();
    dispatch(c.root, 'pointermove', { pointerType: 'touch' });
    hover(c);
    expect(tip.el.hidden).toBe(true);

    const inspecting = vi.spyOn(c, 'inspecting', 'get').mockReturnValue(true);
    hover(c);
    expect(tip.el.hidden).toBe(false);

    inspecting.mockReturnValue(false);
    c.lockCrosshair(true);
    runFrame(0);
    expect(tip.el.hidden).toBe(false);
  });

  it('shows again for a mouse after a touch', () => {
    const { c, tip } = setup();
    dispatch(c.root, 'pointermove', { pointerType: 'touch' });
    hover(c);
    expect(tip.el.hidden).toBe(true);
    dispatch(c.root, 'pointermove', { pointerType: 'mouse' });
    hover(c);
    expect(tip.el.hidden).toBe(false);
  });

  it('removes itself and its listeners on destroy', () => {
    const { c, tip } = setup();
    expect(c.root.querySelector('.pc-pointer-tip')).toBe(tip.el);
    tip.destroy();
    expect(c.root.querySelector('.pc-pointer-tip')).toBeNull();
    hover(c);
    expect(tip.el.hidden).toBe(true);
  });

  it('lists the time and each visible series by default', () => {
    const { c } = setup();
    c.setCrosshair({ x: 300, y: 200, pane: 0 });
    const content = pointerTooltipContent(c.valuesAt()!);
    const [time, ...rows] = content.children as unknown as { className: string; textContent: string }[];
    expect(time!.textContent).toBe(c.valuesAt()!.timeText);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.className === 'pc-ptip-row')).toBe(true);
  });
});
