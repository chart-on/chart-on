import { describe, expect, it, vi } from 'vitest';
import { AnnotationManager, type AnnotationHost } from '../src/annotations/manager';
import { lines, tradingManager } from './trading-manager';
import type { DraftLine, TradeLine } from '../src/annotations/lines';
import type { DraftEditEvent, OrderCreateEvent } from '../src/annotations/types';
import { Chart } from '../src/chart';
import { Pane } from '../src/pane';
import { TimeScale } from '../src/scales';
import { darkTheme } from '../src/theme';
import { Timeline } from '../src/timeline';
import type { Point } from '../src/types';
import { fakeContainer } from './fake-dom';

/** A 1000 × 500 px pane; linear prices 0..500, so price = 500 - y. */
function setup(extra: Partial<AnnotationHost> = {}) {
  const timeline = new Timeline();
  timeline.set(Array.from({ length: 100 }, (_, i) => i * 60));
  const time = new TimeScale({ barSpacing: 10, minBarSpacing: 1, maxBarSpacing: 50, rightOffset: 0 });
  time.width = 1000;
  time.barCount = 100;
  const pane = new Pane(0, { stretch: 1, marginTop: 0, marginBottom: 0 });
  pane.height = 500;
  pane.price.height = 500;
  pane.price.fit(0, 500);
  const edits: DraftEditEvent[] = [];
  const orders: OrderCreateEvent[] = [];
  const host: AnnotationHost = {
    theme: darkTheme,
    timeline,
    time,
    panes: [pane],
    plotLeft: 0,
    main: null,
    formatPrice: (_pane, price) => price.toFixed(2),
    formatAxis: (_pane, price) => price.toFixed(2),
    measureText: (text) => text.length * 7,
    axisLabel: () => {},
    requestOverlay: () => {},
    attachPrimitive: () => () => {},
    draftEdit: (e) => edits.push(e),
    orderCreate: (e) => orders.push(e),
    ...extra,
  };
  return { manager: tradingManager(host), pane, edits, orders };
}

interface View {
  line: unknown;
  part: string;
  price: number;
  top: number;
  height: number;
  segments: { x: number; width: number; text: string; button: string | null; grip?: boolean; edit?: string }[];
}

const views = (m: AnnotationManager): View[] => (lines(m) as any).partViews();

function view(m: AnnotationManager, line: TradeLine | DraftLine, part = 'entry'): View | undefined {
  return views(m).find((v) => v.line === line && v.part === part);
}

/** Centre of the segment of `line`'s `part` block that matches. */
function segmentAt(m: AnnotationManager, line: TradeLine | DraftLine, match: (s: View['segments'][number]) => boolean, part = 'entry'): Point {
  const v = view(m, line, part)!;
  const s = v.segments.find(match)!;
  return { x: s.x + s.width / 2, y: v.top + v.height / 2 };
}

function drag(m: AnnotationManager, from: Point, to: Point): void {
  expect(m.pointerDown(from)).toBe(true);
  m.pointerMove(to);
  m.pointerUp(to);
}

function click(m: AnnotationManager, p: Point): void {
  expect(m.pointerDown(p)).toBe(true);
  m.pointerUp(p);
}

const button = (name: string) => (s: View['segments'][number]) => s.button === name;
const grip = (s: View['segments'][number]) => !!s.grip;

describe('label blocks and pane buttons', () => {
  it('keep a block in the corner of the pane buttons below them', () => {
    const right = { height: 26, side: 'right' } as const;
    const left = { height: 26, side: 'left' } as const;
    const cases = [
      [null, 'right', 0],
      [right, 'right', 30],
      [right, 'left', 0],
      [left, 'left', 30],
      [left, 'right', 0],
      [right, 'center', 0],
    ] as const;
    for (const [buttons, labelAnchor, top] of cases) {
      const { manager } = setup({ paneButtons: () => buttons });
      // Price 498 is 2 px below the pane top, where the block would sit under the buttons.
      const alert = manager.addAlertLine({ price: 498, labelAnchor });
      expect(views(manager).find((v) => v.line === alert)!.top, `${buttons?.side} ${labelAnchor}`).toBe(top);
    }
  });

  it('leave a block on its line once the line is below the buttons', () => {
    const { manager } = setup({ paneButtons: () => ({ height: 26, side: 'right' }) });
    const alert = manager.addAlertLine({ price: 400 });
    const v = views(manager).find((v) => v.line === alert)!;
    expect(v.top + v.height / 2).toBe(100);
  });
});

describe('confirmChanges', () => {
  it('holds a dragged order at the new price until confirmed', () => {
    const { manager } = setup();
    const onChange = vi.fn();
    const line = manager.addTradeLine({ price: 300, side: 'buy', tickSize: 1, onChange });
    drag(manager, { x: 300, y: 200 }, { x: 300, y: 150 });
    expect(onChange).not.toHaveBeenCalled();
    expect(line.options.price).toBe(300);
    expect(view(manager, line)!.price).toBe(350);
    expect(view(manager, line)!.segments.map((s) => s.button).filter(Boolean)).toEqual(['confirm', 'discard']);
    click(manager, segmentAt(manager, line, button('confirm')));
    expect(onChange).toHaveBeenCalledWith({ part: 'entry', price: 350, from: 300 });
    expect(line.options.price).toBe(350);
    expect(view(manager, line)!.segments.some((s) => s.button === 'confirm')).toBe(false);
  });

  it('restores the price on discard and on Escape, replaying onDrag', () => {
    const { manager } = setup();
    const onChange = vi.fn();
    const onDrag = vi.fn();
    const line = manager.addTradeLine({ price: 300, side: 'buy', tickSize: 1, onChange, onDrag });
    drag(manager, { x: 300, y: 200 }, { x: 300, y: 150 });
    click(manager, segmentAt(manager, line, button('discard')));
    expect(onDrag).toHaveBeenLastCalledWith({ part: 'entry', price: 300 });
    expect(view(manager, line)!.price).toBe(300);

    drag(manager, { x: 300, y: 200 }, { x: 300, y: 120 });
    expect(manager.keyDown({ key: 'Escape' } as KeyboardEvent)).toBe(true);
    expect(view(manager, line)!.price).toBe(300);
    expect(onChange).not.toHaveBeenCalled();
    expect(manager.keyDown({ key: 'Escape' } as KeyboardEvent)).toBe(false);
  });

  it('drags a pending price again, still reporting the committed one as from', () => {
    const { manager } = setup();
    const onChange = vi.fn();
    const line = manager.addTradeLine({ price: 300, side: 'buy', tickSize: 1, onChange });
    drag(manager, { x: 300, y: 200 }, { x: 300, y: 150 });
    drag(manager, { x: 300, y: 150 }, { x: 300, y: 100 });
    click(manager, segmentAt(manager, line, button('confirm')));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ part: 'entry', price: 400, from: 300 });
  });

  it('drops a pending change when the app moves that part', () => {
    const { manager } = setup();
    const line = manager.addTradeLine({ price: 300, side: 'buy', tickSize: 1, onChange: () => {} });
    drag(manager, { x: 300, y: 200 }, { x: 300, y: 150 });
    line.applyOptions({ quantity: 2 });
    expect(view(manager, line)!.price).toBe(350);
    line.applyOptions({ price: 310 });
    expect(view(manager, line)!.price).toBe(310);
  });

  it('commits at once when off, and by default for positions', () => {
    const { manager } = setup();
    const onOrder = vi.fn();
    const onPosition = vi.fn();
    manager.addTradeLine({ price: 300, side: 'buy', tickSize: 1, confirmChanges: false, onChange: onOrder });
    manager.addTradeLine({ kind: 'position', price: 100, side: 'buy', takeProfit: 200, tickSize: 1, onChange: onPosition });
    drag(manager, { x: 300, y: 200 }, { x: 300, y: 150 });
    expect(onOrder).toHaveBeenCalledWith({ part: 'entry', price: 350, from: 300 });
    drag(manager, { x: 300, y: 300 }, { x: 300, y: 280 });
    expect(onPosition).toHaveBeenCalledWith({ part: 'takeProfit', price: 220, from: 200 });
  });
});

describe('bracket handles', () => {
  it('proposes a take-profit above a buy and a stop-loss below it, previewed until the app answers', () => {
    const { manager } = setup();
    const onBracketCreate = vi.fn();
    const line = manager.addTradeLine({ price: 300, side: 'buy', tickSize: 1, onBracketCreate });
    const handle = segmentAt(manager, line, grip);
    drag(manager, handle, { x: handle.x, y: 100 });
    expect(onBracketCreate).toHaveBeenLastCalledWith({ part: 'takeProfit', price: 400 });
    expect(view(manager, line, 'takeProfit')!.price).toBe(400);
    // A proposal has no buttons to press yet.
    expect(view(manager, line, 'takeProfit')!.segments.some((s) => s.button)).toBe(false);

    drag(manager, segmentAt(manager, line, grip), { x: handle.x, y: 260.4 });
    expect(onBracketCreate).toHaveBeenLastCalledWith({ part: 'stopLoss', price: 240 });
    // Both proposed: no handle left.
    expect(view(manager, line)!.segments.some(grip)).toBe(false);

    // An unrelated change answers neither proposal.
    line.applyOptions({ quantity: 2 });
    expect(view(manager, line, 'takeProfit')!.price).toBe(400);
    expect(view(manager, line, 'stopLoss')!.price).toBe(240);

    // The app accepts the stop-loss: the take-profit stays proposed.
    line.applyOptions({ stopLoss: 240 });
    expect(view(manager, line, 'stopLoss')!.price).toBe(240);
    expect(view(manager, line, 'takeProfit')!.price).toBe(400);
    expect(view(manager, line)!.segments.some(grip)).toBe(false);

    // ... and rejects the take-profit.
    line.applyOptions({ takeProfit: null });
    expect(view(manager, line, 'takeProfit')).toBeUndefined();
    expect(view(manager, line)!.segments.some(grip)).toBe(true);
  });

  it('measures the side from a pending entry price', () => {
    const { manager } = setup();
    const onBracketCreate = vi.fn();
    const line = manager.addTradeLine({ price: 300, side: 'buy', tickSize: 1, onChange: () => {}, onBracketCreate });
    drag(manager, { x: 300, y: 200 }, { x: 300, y: 150 });
    expect(view(manager, line)!.price).toBe(350);
    const handle = segmentAt(manager, line, grip);
    // 330 is above the committed 300 but below the pending 350: a stop-loss.
    drag(manager, handle, { x: handle.x, y: 170 });
    expect(onBracketCreate).toHaveBeenCalledWith({ part: 'stopLoss', price: 330 });
  });

  it('flips the sides for a sell and ignores a side that is already set', () => {
    const { manager } = setup();
    const onBracketCreate = vi.fn();
    const line = manager.addTradeLine({ price: 300, side: 'sell', stopLoss: 350, tickSize: 1, onBracketCreate });
    const handle = segmentAt(manager, line, grip);
    // Above a sell is the stop-loss, which is set: nothing is proposed.
    drag(manager, handle, { x: handle.x, y: 120 });
    expect(onBracketCreate).not.toHaveBeenCalled();
    drag(manager, handle, { x: handle.x, y: 250 });
    expect(onBracketCreate).toHaveBeenCalledWith({ part: 'takeProfit', price: 250 });
  });

  it('reads the bracket price through a log scale', () => {
    const { manager, pane } = setup();
    pane.price.setMode('log');
    pane.price.fit(10, 1000);
    const onBracketCreate = vi.fn();
    // 100 sits in the middle of the pane (y 250).
    const line = manager.addTradeLine({ price: 100, side: 'buy', tickSize: 0.01, onBracketCreate });
    const handle = segmentAt(manager, line, grip);
    drag(manager, handle, { x: handle.x, y: 125 });
    expect(onBracketCreate).toHaveBeenCalledWith({ part: 'takeProfit', price: 316.23 });
  });

  it('shows no handle without onBracketCreate or with both brackets set', () => {
    const { manager } = setup();
    const plain = manager.addTradeLine({ price: 300, side: 'buy', onChange: () => {} });
    const full = manager.addTradeLine({ price: 200, side: 'buy', takeProfit: 250, stopLoss: 150, onBracketCreate: () => {} });
    expect(view(manager, plain)!.segments.some(grip)).toBe(false);
    expect(view(manager, full)!.segments.some(grip)).toBe(false);
  });
});

describe('read-only flags', () => {
  const callbacks = { onChange: () => {}, onAction: () => {}, onBracketCreate: () => {} };

  it('turns off each control on its own, and all of them with readOnly', () => {
    const { manager } = setup();
    const controls = (line: TradeLine) => {
      const v = view(manager, line)!;
      manager.pointerDown({ x: 300, y: v.top + v.height / 2 });
      const dragging = manager.isBusy;
      manager.cancelGesture();
      return { drag: dragging, buttons: v.segments.some((s) => s.button), grip: v.segments.some(grip) };
    };
    const at = (price: number, flags: object) => manager.addTradeLine({ price, side: 'buy', ...callbacks, ...flags });
    expect(controls(at(450, {}))).toEqual({ drag: true, buttons: true, grip: true });
    expect(controls(at(350, { dragReadOnly: true }))).toEqual({ drag: false, buttons: true, grip: true });
    expect(controls(at(250, { actionsReadOnly: true }))).toEqual({ drag: true, buttons: false, grip: true });
    expect(controls(at(150, { bracketReadOnly: true }))).toEqual({ drag: true, buttons: true, grip: false });
    expect(controls(at(50, { readOnly: true }))).toEqual({ drag: false, buttons: false, grip: false });
  });

  it('hides and ignores the confirm and discard buttons of a pending change once read-only', () => {
    for (const flag of ['readOnly', 'dragReadOnly'] as const) {
      const { manager } = setup();
      const onChange = vi.fn();
      const line = manager.addTradeLine({ price: 300, side: 'buy', tickSize: 1, actions: [], onChange });
      drag(manager, { x: 300, y: 200 }, { x: 300, y: 150 });
      const confirm = segmentAt(manager, line, button('confirm'));
      // Locked between press and release.
      expect(manager.pointerDown(confirm)).toBe(true);
      line.applyOptions({ [flag]: true });
      manager.pointerUp(confirm);
      expect(onChange).not.toHaveBeenCalled();
      expect(view(manager, line)!.segments.some((s) => s.button)).toBe(false);
      // Nothing left to press there.
      expect(manager.pointerDown(confirm)).toBe(false);
      manager.pointerUp(confirm);
      expect(onChange).not.toHaveBeenCalled();
      expect(line.options.price).toBe(300);
    }
  });
});

describe('order drafts', () => {
  it('lays out side, quantity, type, price, handle and place / discard buttons', () => {
    const { manager } = setup();
    const draft = manager.startOrderDraft({ price: 300, side: 'buy' });
    const v = view(manager, draft)!;
    expect(v.segments.map((s) => s.edit ?? s.button ?? (s.grip ? 'grip' : s.text))).toEqual([
      'Buy',
      'quantity',
      'type',
      '300.00',
      'grip',
      'confirm',
      'discard',
    ]);
    expect(manager.draftLines).toEqual([draft]);
  });

  it('emits draft:edit for the quantity and type segments, anchored below the segment', () => {
    const { manager, edits } = setup();
    const draft = manager.startOrderDraft({ price: 300, side: 'buy', quantity: 2 });
    const at = segmentAt(manager, draft, (s) => s.edit === 'quantity');
    click(manager, at);
    click(manager, segmentAt(manager, draft, (s) => s.edit === 'type'));
    expect(edits.map((e) => e.segment)).toEqual(['quantity', 'type']);
    expect(edits[0]!.draft).toBe(draft);
    const v = view(manager, draft)!;
    expect(edits[0]!.anchor).toEqual({ x: at.x, y: v.top + v.height });
    expect(edits[0]!.defaultPrevented).toBe(false);
  });

  it('drags its price and takes brackets from the handle at once', () => {
    const { manager } = setup();
    const draft = manager.startOrderDraft({ price: 300, side: 'sell', tickSize: 1 });
    drag(manager, { x: 100, y: 200 }, { x: 100, y: 180 });
    expect(draft.options.price).toBe(320);
    const handle = segmentAt(manager, draft, grip);
    drag(manager, handle, { x: handle.x, y: 130 });
    expect(draft.options.stopLoss).toBe(370);
    // A draft bracket's button removes it.
    click(manager, segmentAt(manager, draft, button('discard'), 'stopLoss'));
    expect(draft.options.stopLoss).toBeNull();
  });

  it('places the order from the place button, with its brackets', () => {
    const { manager, orders } = setup();
    const draft = manager.startOrderDraft({ price: 300, side: 'buy', quantity: 5, type: 'stop', takeProfit: 400 });
    click(manager, segmentAt(manager, draft, button('confirm')));
    expect(orders).toEqual([{ side: 'buy', type: 'stop', price: 300, quantity: 5, takeProfit: 400 }]);
    expect(manager.draftLines).toHaveLength(0);
  });

  it('discards without placing, from the button or the handle', () => {
    const { manager, orders } = setup();
    const a = manager.startOrderDraft({ price: 300, side: 'buy' });
    click(manager, segmentAt(manager, a, button('discard')));
    const b = manager.startOrderDraft({ price: 300, side: 'buy' });
    b.discard();
    b.commit();
    expect(orders).toHaveLength(0);
    expect(manager.draftLines).toHaveLength(0);
  });

  it('rejects invalid draft options', () => {
    const { manager } = setup();
    expect(() => manager.startOrderDraft({ price: 300, side: 'buy', quantity: 0 })).toThrow(/quantity/);
    const draft = manager.startOrderDraft({ price: 300, side: 'buy' });
    expect(() => draft.applyOptions({ type: 'iceberg' as never })).toThrow(/order type/);
  });

  it('reaches chart listeners as draft:edit and order:create', () => {
    const c = new Chart(fakeContainer());
    c.addCandles().setData([{ time: 0, open: 1, high: 2, low: 0, close: 1 }]);
    const created = vi.fn();
    c.on('order:create', created);
    c.annotations.startOrderDraft({ price: 1, side: 'sell', quantity: 1 }).commit();
    expect(created).toHaveBeenCalledWith({ side: 'sell', type: 'limit', price: 1, quantity: 1 });
    c.destroy();
  });
});
