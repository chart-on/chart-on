import { afterEach, describe, expect, it, vi } from 'vitest';
import { Chart, type DraftEditEvent, type DraftLine, type DraftSegment } from '@chart-on/core';
import { fakeContainer } from '../../core/test/fake-dom';
import { createDraftEditor, presetLabel, presetQuantity, type DraftEditorHandle, type DraftEditorOptions } from '../src/draft-editor';

type El = HTMLElement & { children: El[]; tagName: string; textContent: string; value: string; dispatch(type: string, e?: object): void };

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((fn) => fn()));

function setup(options?: DraftEditorOptions) {
  const chart = new Chart(fakeContainer());
  chart.addCandles().setData([{ time: 0, open: 1, high: 2, low: 0, close: 1 }]);
  const editor = createDraftEditor(chart, options);
  // The fake DOM has no input selection.
  const proto = Object.getPrototypeOf(chart.root) as { select?: () => void };
  proto.select = () => {};
  cleanup.push(() => {
    delete proto.select;
    editor.destroy();
    chart.destroy();
  });
  const draft = chart.annotations.startOrderDraft({ price: 1, side: 'buy' });
  return { chart, editor, draft };
}

/** Emit `draft:edit` and let the editor answer it, which it does after every listener ran. */
async function edit(chart: Chart, draft: DraftLine, segment: DraftSegment, prevent = false): Promise<void> {
  let prevented = prevent;
  const e: DraftEditEvent = {
    draft,
    segment,
    anchor: { x: 100, y: 100 },
    preventDefault: () => (prevented = true),
    get defaultPrevented() {
      return prevented;
    },
  };
  chart.emit('draft:edit', e);
  await Promise.resolve();
}

/** Capture animation frames so a test can run them. */
function frames() {
  const queue: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => queue.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  cleanup.push(() => vi.unstubAllGlobals());
  return () => queue.splice(0).forEach((cb) => cb(0));
}

/** Every descendant button, depth first. */
function buttons(el: El): El[] {
  return el.children.flatMap((c) => (c.tagName === 'button' ? [c] : buttons(c)));
}

const open = (editor: DraftEditorHandle) => editor.el as El;

describe('quantity presets', () => {
  it('resolves numbers, the maximum and shares of it', () => {
    expect(presetQuantity(5, null)).toBe(5);
    expect(presetQuantity('max', 40)).toBe(40);
    expect(presetQuantity('25%', 40)).toBe(10);
    expect(presetQuantity('max', null)).toBeNull();
    expect(presetQuantity('50%', 0)).toBeNull();
    expect(presetQuantity(0, 10)).toBeNull();
    expect(presetLabel('max')).toBe('Max');
    expect(presetLabel('25%')).toBe('25%');
  });
});

describe('draft editor', () => {
  it('sets the quantity from a preset, including shares of the maximum', async () => {
    const { chart, editor, draft } = setup({ maxQuantity: () => 40 });
    await edit(chart, draft, 'quantity');
    const chips = buttons(open(editor)).filter((b) => b.className === 'pc-chip');
    expect(chips.map((b) => b.textContent)).toEqual(['1', '5', '25', 'Max', '25%']);
    chips[4]!.dispatch('click');
    expect(draft.options.quantity).toBe(10);
    expect(editor.el).toBeNull();
  });

  it('hides presets that need an unknown maximum, and takes a typed quantity on Enter', async () => {
    const { chart, editor, draft } = setup();
    await edit(chart, draft, 'quantity');
    const el = open(editor);
    expect(buttons(el).filter((b) => b.className === 'pc-chip').map((b) => b.textContent)).toEqual(['1', '5', '25']);
    const input = el.querySelector('.pc-draft-qty') as unknown as El;
    input.value = '-2';
    input.dispatch('keydown', { key: 'Enter' });
    expect(draft.options.quantity).toBeUndefined();
    input.value = '3';
    input.dispatch('keydown', { key: 'Enter' });
    expect(draft.options.quantity).toBe(3);
  });

  it('sets the order type from the menu', async () => {
    const { chart, editor, draft } = setup();
    await edit(chart, draft, 'type');
    const items = buttons(open(editor));
    expect(items.map((b) => [b.textContent, b.getAttribute('aria-checked')])).toEqual([
      ['Limit', 'true'],
      ['Stop', 'false'],
      ['Market', 'false'],
    ]);
    items[1]!.dispatch('click');
    expect(draft.options.type).toBe('stop');
    expect(editor.el).toBeNull();
  });

  it('stays closed when the app prevents the default', async () => {
    const { chart, editor, draft } = setup();
    await edit(chart, draft, 'type', true);
    expect(editor.el).toBeNull();
  });

  it('stays closed when an app listener added after the editor prevents the default', async () => {
    const { chart, editor, draft } = setup();
    cleanup.push(chart.on('draft:edit', (e) => e.preventDefault()));
    await edit(chart, draft, 'quantity');
    expect(editor.el).toBeNull();
  });

  it('does not open for a draft removed before it could', async () => {
    const { chart, editor, draft } = setup();
    cleanup.push(chart.on('draft:edit', (e) => e.draft.discard()));
    await edit(chart, draft, 'quantity');
    expect(editor.el).toBeNull();
  });

  it('closes when its draft is discarded, committed, cleared or hidden', async () => {
    const run = frames();
    const { chart, editor } = setup();
    const removals: ((d: DraftLine) => void)[] = [
      (d) => d.discard(),
      (d) => d.commit(),
      () => chart.annotations.clear(),
      (d) => d.setVisible(false),
    ];
    for (const remove of removals) {
      const draft = chart.annotations.startOrderDraft({ price: 1, side: 'buy' });
      await edit(chart, draft, 'type');
      run();
      expect(editor.el).not.toBeNull();
      remove(draft);
      run();
      expect(editor.el).toBeNull();
    }
  });

  it('closes without applying when its draft is gone', async () => {
    const { chart, editor, draft } = setup();
    await edit(chart, draft, 'type');
    const items = buttons(open(editor));
    draft.discard();
    items[1]!.dispatch('click');
    expect(draft.options.type).toBe('limit');
    expect(editor.el).toBeNull();
  });

  it('closes on a symbol change', async () => {
    const { chart, editor, draft } = setup();
    await edit(chart, draft, 'quantity');
    chart.emit('data:loading', { symbol: 'B', interval: '1m', kind: 'initial' });
    expect(editor.el).toBeNull();
  });
});
