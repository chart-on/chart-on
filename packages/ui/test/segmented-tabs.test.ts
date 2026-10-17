// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { segmentedTabs } from '../src/controls';
import { rovingFocus } from '../src/keyboard';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

const options = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
  { value: 'c', label: 'C' },
];
const press = (el: HTMLElement, key: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
const radios = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('[role="radio"]')];

describe('segmentedTabs keyboard', () => {
  it('is one tab stop on the checked radio; arrows, Home and End check and focus another', () => {
    const onChange = vi.fn();
    const seg = segmentedTabs(options, 'b', onChange, 'Pick');
    document.body.append(seg.el);
    expect(radios(seg.el).map((b) => b.tabIndex)).toEqual([-1, 0, -1]);

    radios(seg.el)[1]!.focus();
    press(radios(seg.el)[1]!, 'ArrowRight');
    expect(onChange).toHaveBeenLastCalledWith('c');
    expect(document.activeElement).toBe(radios(seg.el)[2]);
    expect(radios(seg.el).map((b) => b.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
    expect(radios(seg.el).map((b) => b.tabIndex)).toEqual([-1, -1, 0]);

    // Wraps around the ends.
    press(radios(seg.el)[2]!, 'ArrowRight');
    expect(onChange).toHaveBeenLastCalledWith('a');
    press(radios(seg.el)[0]!, 'End');
    expect(onChange).toHaveBeenLastCalledWith('c');
    press(radios(seg.el)[2]!, 'Home');
    expect(onChange).toHaveBeenLastCalledWith('a');
    expect(document.activeElement).toBe(radios(seg.el)[0]);

    // `set` moves the tab stop without calling onChange.
    onChange.mockClear();
    seg.set('b');
    expect(radios(seg.el).map((b) => b.tabIndex)).toEqual([-1, 0, -1]);
    expect(onChange).not.toHaveBeenCalled();
    seg.destroy();
  });

  it('skips hidden radios', () => {
    const onChange = vi.fn();
    const seg = segmentedTabs(options, 'a', onChange, 'Pick');
    document.body.append(seg.el);
    radios(seg.el)[1]!.hidden = true;
    press(radios(seg.el)[0]!, 'ArrowRight');
    expect(onChange).toHaveBeenLastCalledWith('c');
    press(radios(seg.el)[2]!, 'ArrowLeft');
    expect(onChange).toHaveBeenLastCalledWith('a');
    seg.destroy();
  });

  it('leaves Tab and the arrows to a roving group around it', () => {
    const onChange = vi.fn();
    const group = document.createElement('div');
    const seg = segmentedTabs(options, 'a', onChange, 'Pick');
    group.append(seg.el);
    document.body.append(group);
    const roving = rovingFocus(group);
    radios(seg.el)[0]!.focus();
    press(radios(seg.el)[0]!, 'ArrowRight');
    // The group moved focus; nothing was checked.
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(radios(seg.el)[1]);
    seg.set('c');
    expect(radios(seg.el).filter((b) => b.tabIndex === 0)).toEqual([radios(seg.el)[1]]);
    roving.destroy();
    seg.destroy();
  });
});
