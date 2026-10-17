import { describe, expect, it } from 'vitest';
import { commandScore, fuzzyScore, rankCommands, type CommandEntry } from '../src/command-palette-model';

const entry = (label: string, extra: Partial<CommandEntry> = {}): CommandEntry => ({ id: label, label, run: () => {}, ...extra });
const labels = (entries: CommandEntry[]) => entries.map((e) => e.label);

describe('fuzzyScore', () => {
  it('ranks whole, prefix, word, initials, substring and scattered matches in that order', () => {
    expect(fuzzyScore('zoom in', 'zoom in')).toBe(0);
    expect(fuzzyScore('zoom in', 'zoo')).toBe(1);
    expect(fuzzyScore('reset view', 'vie')).toBe(2);
    expect(fuzzyScore('fit content', 'fc')).toBe(3);
    expect(fuzzyScore('auto scale', 'uto')).toBe(4);
    const scattered = fuzzyScore('lock drawings', 'lkdr')!;
    expect(scattered).toBeGreaterThanOrEqual(5);
    expect(scattered).toBeLessThan(6);
    expect(fuzzyScore('undo', 'xyz')).toBeNull();
    // Characters must come in order.
    expect(fuzzyScore('undo', 'odnu')).toBeNull();
  });

  it('prefers scattered matches with fewer skipped characters', () => {
    expect(fuzzyScore('group drawings', 'grdr')!).toBeLessThan(fuzzyScore('group drawings', 'gpds')!);
  });
});

describe('commandScore', () => {
  it('matches keywords and descriptions after the label', () => {
    const e = entry('Auto scale', { keywords: ['fit-price'], description: 'Price axis' });
    expect(commandScore(e, 'auto')).toBe(1);
    expect(commandScore(e, 'fit')).toBe(1.5);
    expect(commandScore(e, 'axis')).toBe(3);
    expect(commandScore(e, 'nothing')).toBeNull();
  });

  it('matches several words in any order', () => {
    const e = entry('Hide drawings');
    expect(commandScore(e, 'drawings hide')).not.toBeNull();
    expect(commandScore(e, 'hide  drawings')).toBe(0);
    expect(commandScore(e, 'hide zoom')).toBeNull();
  });

  it('keeps everything for an empty query', () => {
    expect(commandScore(entry('Undo'), '  ')).toBe(0);
  });
});

describe('rankCommands', () => {
  const list = [
    entry('Lock drawings'),
    entry('Zoom out'),
    entry('Zoom in'),
    entry('Draw: Horizontal zone'),
    entry('Undo', { disabled: true }),
    entry('Redo'),
  ];

  it('orders the best matches first and drops the rest', () => {
    expect(labels(rankCommands(list, 'zo'))).toEqual(['Zoom out', 'Zoom in', 'Draw: Horizontal zone']);
    expect(labels(rankCommands(list, 'zoom in'))).toEqual(['Zoom in']);
    expect(labels(rankCommands(list, 'ldr'))).toEqual(['Lock drawings']);
  });

  it('lists disabled entries after the enabled ones, even when they match better', () => {
    expect(labels(rankCommands(list, 'do'))).toEqual(['Redo', 'Draw: Horizontal zone', 'Undo']);
    const all = labels(rankCommands(list, ''));
    expect(all[all.length - 1]).toBe('Undo');
    expect(all.slice(0, -1)).toEqual(['Lock drawings', 'Zoom out', 'Zoom in', 'Draw: Horizontal zone', 'Redo']);
  });

  it('keeps disabled entries that match, so users see the command exists', () => {
    expect(labels(rankCommands(list, 'undo'))).toEqual(['Undo']);
  });
});
