import { afterEach, describe, expect, it, vi } from 'vitest';
import { Star } from 'lucide';
import { dispatch, fakeContainer } from '../../core/test/fake-dom';
import { chooseOption } from './listbox';
import { createPickerDialog, type PickerDialog, type PickerHandlers, type PickerSchema } from '../src/picker-dialog';
import type { PickerItem } from '../src/picker-model';

type El = HTMLElement & {
  children: El[];
  tagName: string;
  textContent: string;
  value: string;
  selectedIndex: number;
};

const dialogs: PickerDialog[] = [];
afterEach(() => {
  dialogs.splice(0).forEach((d) => d.close());
  vi.useRealTimers();
});

const all = (root: El): El[] => root.children.flatMap((c) => [c, ...all(c)]);
const find = (root: El, test: (el: El) => boolean) => all(root).find(test);
const text = (el: El): string => el.textContent + el.children.map(text).join('');
const options = (panel: El) => all(panel).filter((el) => el.getAttribute('role') === 'option');
/** Labels of the listed items, through their ids (the test DOM does not keep text and element order). */
const labels = (panel: El) => options(panel).map((o) => items.find((i) => i.id === o.getAttribute('data-id'))!.label);
const activeLabel = (panel: El) => {
  const input = search(panel);
  const option = options(panel).find((o) => o.getAttribute('id') === input.getAttribute('aria-activedescendant'));
  return option ? items.find((i) => i.id === option.getAttribute('data-id'))!.label : null;
};
const search = (panel: El) => find(panel, (el) => el.getAttribute('role') === 'combobox')!;
const message = (panel: El) => find(panel, (el) => el.className === 'pc-picker-message')!;
const key = (target: El, k: string, init: Record<string, unknown> = {}) => dispatch(target, 'keydown', { key: k, ...init });
const type = (input: El, value: string) => {
  input.value = value;
  dispatch(input, 'input');
};

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

interface Indicator extends PickerItem {
  starred?: boolean;
}

const items: Indicator[] = [
  { id: 'sma', label: 'Moving Average', category: 'trend' },
  { id: 'rsi', label: 'Relative Strength Index', category: 'momentum' },
  { id: 'vol', label: 'Volume', category: 'volume', disabled: true },
  {
    id: 'macd',
    label: 'Moving Average Convergence Divergence',
    category: ['trend', 'momentum'],
  },
];

function open(schema: Partial<PickerSchema<Indicator>> = {}, handlers: Partial<PickerHandlers<Indicator>> = {}) {
  const host = fakeContainer() as unknown as El;
  const onSelect = vi.fn();
  const dialog = createPickerDialog<Indicator>(
    host,
    { title: 'Indicators', source: { items }, ...schema },
    { onSelect, ...handlers },
  );
  dialogs.push(dialog);
  return { host, dialog, onSelect, panel: dialog.el.children[0] as El };
}

describe('picker dialog', () => {
  it('lists items, focuses the search box and makes the first row active', () => {
    const { panel } = open();
    expect(labels(panel)).toEqual(items.map((i) => i.label));
    expect(document.activeElement).toBe(search(panel));
    expect(activeLabel(panel)).toBe('Moving Average');
  });

  it('filters and ranks as you type, and picks with the keyboard', () => {
    const { host, panel, onSelect } = open();
    const input = search(panel);
    type(input, 'mov');
    expect(labels(panel)).toEqual(['Moving Average', 'Moving Average Convergence Divergence']);
    key(input, 'ArrowDown');
    expect(activeLabel(panel)).toBe('Moving Average Convergence Divergence');
    key(input, 'Enter');
    expect(onSelect).toHaveBeenCalledWith([items[3]]);
    expect(host.children).toEqual([]);
  });

  it('does not pick disabled items', () => {
    const { panel, onSelect, dialog } = open();
    const input = search(panel);
    type(input, 'volume');
    key(input, 'Enter');
    expect(onSelect).not.toHaveBeenCalled();
    expect(dialog.isOpen).toBe(true);
  });

  it('can stay open to pick several in a row', () => {
    const { panel, onSelect, dialog } = open({ closeOnSelect: false });
    key(search(panel), 'Enter');
    key(search(panel), 'Enter');
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(dialog.isOpen).toBe(true);
  });

  it('toggles picks with Enter and confirms with Ctrl+Enter in multiple mode', () => {
    const { panel, onSelect, dialog } = open({
      multiple: true,
      selected: ['rsi'],
    });
    const input = search(panel);
    expect(options(panel)[1]!.getAttribute('aria-selected')).toBe('true');
    key(input, 'Enter');
    expect(dialog.selected).toEqual(['rsi', 'sma']);
    key(input, 'ArrowDown');
    key(input, 'Enter');
    expect(dialog.selected).toEqual(['sma']);
    key(input, 'Enter');
    key(input, 'Enter', { ctrlKey: true });
    expect(onSelect).toHaveBeenCalledWith([items[0], items[1]]);
    expect(dialog.isOpen).toBe(false);
  });

  it('switches categories from the category list with the arrow keys', () => {
    const { panel } = open({
      categories: [
        { id: 'trend', label: 'Trend' },
        { id: 'momentum', label: 'Momentum' },
      ],
    });
    const tabs = () => all(panel).filter((el) => el.getAttribute('role') === 'tab');
    expect(tabs().map((t) => t.textContent)).toEqual(['All', 'Trend', 'Momentum']);
    key(tabs()[0]!, 'ArrowDown');
    expect(labels(panel)).toEqual(['Moving Average', 'Moving Average Convergence Divergence']);
    const selected = tabs().find((t) => t.getAttribute('aria-selected') === 'true')!;
    expect(selected.textContent).toBe('Trend');
    expect(document.activeElement).toBe(selected);
    key(selected, 'End');
    expect(labels(panel)).toEqual(['Relative Strength Index', 'Moving Average Convergence Divergence']);
  });

  it('keeps focus on a clicked category, so Escape still closes the dialog', () => {
    const { panel, host } = open({ categories: [{ id: 'trend', label: 'Trend' }] });
    const tabs = () => all(panel).filter((el) => el.getAttribute('role') === 'tab');
    dispatch(tabs()[1]!, 'click');
    expect(labels(panel)).toEqual(['Moving Average', 'Moving Average Convergence Divergence']);
    const selected = tabs().find((t) => t.getAttribute('aria-selected') === 'true')!;
    expect(selected.textContent).toBe('Trend');
    expect(document.activeElement).toBe(selected);
    key(selected, 'Escape');
    expect(host.children).toEqual([]);
  });

  it('shows categories as a select in a narrow host', () => {
    const { panel } = open({
      compactWidth: 1000,
      allLabel: false,
      categories: [
        { id: 'trend', label: 'Trend' },
        { id: 'momentum', label: 'Momentum' },
      ],
    });
    expect(labels(panel)).toEqual(['Moving Average', 'Moving Average Convergence Divergence']);
    const select = find(panel, (el) => el.className.includes('pc-picker-nav-select'))!;
    chooseOption(select.children[0]!, 1);
    expect(document.activeElement).toBe(find(panel, (el) => el.className.includes('pc-picker-nav-select'))!.children[0]);
    expect(labels(panel)).toEqual(['Relative Strength Index', 'Moving Average Convergence Divergence']);
  });

  it('runs row actions and redraws their state; Tab reaches only the active row', () => {
    const onAction = vi.fn((_id: string, item: Indicator, dialog: PickerDialog) => {
      item.starred = !item.starred;
      dialog.refresh();
    });
    const { panel } = open(
      {
        rowActions: [
          {
            id: 'star',
            label: 'Favorite',
            icon: Star,
            pressed: (item) => item.starred === true,
          },
        ],
      },
      { onAction },
    );
    const stars = () => all(panel).filter((el) => el.getAttribute('data-action') === 'star');
    expect(stars().map((s) => s.tabIndex)).toEqual([0, -1, -1, -1]);
    dispatch(stars()[1]!, 'click');
    expect(onAction).toHaveBeenCalledWith('star', items[1], expect.anything());
    expect(stars()[1]!.getAttribute('aria-pressed')).toBe('true');
    key(search(panel), 'ArrowDown');
    expect(stars().map((s) => s.tabIndex)).toEqual([-1, 0, -1, -1]);
    items[1]!.starred = false;
  });

  it('keeps focus on a row button across a redraw, and sends arrows on it back to the list', () => {
    const onAction = vi.fn((_id: string, item: Indicator, dialog: PickerDialog) => {
      item.starred = !item.starred;
      dialog.refresh();
    });
    const { panel, dialog, onSelect } = open({ rowActions: [{ id: 'star', label: 'Favorite', icon: Star, pressed: (item) => item.starred === true }] }, { onAction });
    const stars = () => all(panel).filter((el) => el.getAttribute('data-action') === 'star');
    // Tab reaches the active row's star; using it redraws the rows and picks nothing.
    stars()[0]!.focus();
    dispatch(stars()[0]!, 'click');
    expect(dialog.isOpen).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
    expect(stars()[0]!.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(stars()[0]);
    // Down on the star moves the active row and returns to the search box.
    const list = find(panel, (el) => el.getAttribute('role') === 'listbox')!;
    key(list, 'ArrowDown', { target: stars()[0] });
    expect(document.activeElement).toBe(search(panel));
    expect(activeLabel(panel)).toBe('Relative Strength Index');
    items[0]!.starred = false;
  });

  it('closes with Escape and returns focus', () => {
    const opener = fakeContainer() as unknown as El;
    opener.focus();
    const onClose = vi.fn();
    const { panel, host } = open({}, { onClose });
    key(search(panel), 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(host.children).toEqual([]);
    expect(document.activeElement).toBe(opener);
  });

  it('closes on a press outside the dialog', () => {
    const { host, dialog } = open();
    dispatch(host, 'pointerdown');
    expect(dialog.isOpen).toBe(false);
    expect(host.children).toEqual([]);
  });

  it('stays open and keeps focus when a toast over it is pressed', () => {
    const { panel, dialog } = open();
    const toast = fakeContainer() as unknown as El;
    Object.assign(toast, { closest: (s: string) => (s === '.pc-toasts' ? toast : null) });
    dispatch(toast, 'pointerdown');
    expect(dialog.isOpen).toBe(true);
    // A pressed toast button takes focus; it goes back to the control that had it, not the first one.
    const closeButton = find(panel, (el) => el.getAttribute('aria-label') === 'Close')!;
    closeButton.focus();
    toast.focus();
    dispatch(toast, 'focusin', { relatedTarget: closeButton });
    expect(document.activeElement).toBe(closeButton);
  });

  describe('with a fetch source', () => {
    it('shows loading, then results, and passes the query, page and category', async () => {
      vi.useFakeTimers();
      const fetch = vi.fn(async (query: string) => ({
        items: items.filter((i) => i.label.toLowerCase().includes(query)),
        hasMore: false,
      }));
      const { panel } = open({ source: { fetch } });
      expect(text(message(panel))).toBe('Loading…');
      await flush();
      expect(labels(panel)).toHaveLength(4);
      type(search(panel), 'index');
      expect(fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(200);
      expect(fetch).toHaveBeenLastCalledWith('index', expect.objectContaining({ page: 0, pageSize: 50 }));
      expect(labels(panel)).toEqual(['Relative Strength Index']);
    });

    it('shows an error with a retry, and an empty state', async () => {
      let fail = true;
      const fetch = vi.fn(async () => {
        if (fail) throw new Error('down');
        return [];
      });
      const { panel } = open({
        source: { fetch },
        emptyText: 'No indicators yet.',
      });
      await flush();
      expect(text(message(panel))).toContain('Could not load items.');
      fail = false;
      const retry = find(message(panel), (el) => el.tagName === 'button')!;
      dispatch(retry, 'click');
      await flush();
      expect(text(message(panel))).toBe('No indicators yet.');
      type(search(panel), 'zz');
      await new Promise((resolve) => setTimeout(resolve, 210));
      await flush();
      expect(text(message(panel))).toBe('Nothing matches “zz”.');
    });
  });
});
