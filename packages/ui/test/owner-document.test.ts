import { afterEach, expect, it, vi } from 'vitest';
import { installFakeDom } from '../../core/test/fake-dom';
import { onDismiss } from '../src/dom';

installFakeDom();
afterEach(() => vi.useRealTimers());

type Doc = { listenerCount(type: string): number; invoke(e: unknown, capture: boolean): void };

it("popovers close on keys and presses in their own document, not the global one", () => {
  vi.useFakeTimers();
  // A popover in a popup window: it belongs to another document than the global one.
  const other = new (document.constructor as new () => Doc)();
  const owner = document.createElement('div');
  Object.defineProperty(owner, 'ownerDocument', { value: other });
  const global = document as unknown as Doc;
  const before = global.listenerCount('keydown');
  const close = vi.fn();
  const off = onDismiss(owner, close);
  vi.runAllTimers();
  expect(global.listenerCount('keydown')).toBe(before);
  other.invoke({ type: 'keydown', key: 'Escape', target: other }, false);
  expect(close).toHaveBeenCalledTimes(1);
  other.invoke({ type: 'pointerdown', target: document.createElement('div') }, true);
  expect(close).toHaveBeenCalledTimes(2);
  off();
  expect([other.listenerCount('keydown'), other.listenerCount('pointerdown')]).toEqual([0, 0]);
});

it('Escape closes a popover right after it opens; a press only once the opening click is over', () => {
  vi.useFakeTimers();
  const owner = document.createElement('div');
  const doc = document as unknown as Doc;
  const close = vi.fn();
  const off = onDismiss(owner, close);
  doc.invoke({ type: 'pointerdown', target: document.createElement('div') }, true);
  expect(close).not.toHaveBeenCalled();
  doc.invoke({ type: 'keydown', key: 'Escape', target: doc }, false);
  expect(close).toHaveBeenCalledTimes(1);
  off();
});
