import { describe, expect, it } from 'vitest';
import { Emitter } from '../src/util/emitter';

interface Events {
  ping: number;
  other: string;
}

function emitter() {
  const errors: unknown[] = [];
  return { e: new Emitter<Events>((error) => errors.push(error)), errors };
}

describe('Emitter', () => {
  it('calls listeners in order and stops after unsubscribe', () => {
    const { e } = emitter();
    const calls: string[] = [];
    const off = e.on('ping', (n) => calls.push(`a${n}`));
    e.on('ping', (n) => calls.push(`b${n}`));
    e.emit('ping', 1);
    off();
    e.emit('ping', 2);
    expect(calls).toEqual(['a1', 'b1', 'b2']);
    expect(e.has('ping')).toBe(true);
    expect(e.has('other')).toBe(false);
  });

  it('lets a listener unsubscribe itself or a later one during emit', () => {
    const { e } = emitter();
    const calls: string[] = [];
    const offA: () => void = e.on('ping', () => {
      calls.push('a');
      offA();
      offC();
    });
    e.on('ping', () => calls.push('b'));
    const offC = e.on('ping', () => calls.push('c'));
    e.emit('ping', 1);
    // c was removed before its turn, so this emit skipped it too.
    expect(calls).toEqual(['a', 'b']);
    e.emit('ping', 2);
    expect(calls).toEqual(['a', 'b', 'b']);
  });

  it('reports a throwing listener and still calls the rest', () => {
    const { e, errors } = emitter();
    const calls: number[] = [];
    e.on('ping', () => {
      throw new Error('boom');
    });
    e.on('ping', (n) => calls.push(n));
    e.emit('ping', 3);
    expect(calls).toEqual([3]);
    expect(errors).toEqual([new Error('boom')]);
  });

  it('forgets every listener on clear', () => {
    const { e } = emitter();
    const calls: number[] = [];
    e.on('ping', (n) => calls.push(n));
    e.clear();
    e.emit('ping', 1);
    expect(calls).toEqual([]);
    expect(e.has('ping')).toBe(false);
  });
});
