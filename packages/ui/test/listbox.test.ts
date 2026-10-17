/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatch, fakeContainer } from '../../core/test/fake-dom';
import { createFormDialog, type FormDialog } from '../src/form-dialog';
import { createListbox } from '../src/listbox';
import { listOptions } from './listbox';

type El = HTMLElement & { children: El[]; tagName: string };

const sources = import.meta.glob<string>(['../src/**/*.ts'], { query: '?raw', import: 'default', eager: true });

const all = (root: El): El[] => root.children.flatMap((c) => [c, ...all(c)]);
const key = (target: HTMLElement, k: string, timeStamp = 0) => dispatch(target, 'keydown', { key: k, timeStamp });
const focused = () => document.activeElement as unknown as El;
const months = ['January', 'February', 'March', 'April', 'May', 'June'];

function setup() {
  const set = vi.fn();
  const box = createListbox({ options: months.map((m, i) => ({ value: i, label: m })), value: 2, label: 'Month', set });
  const host = fakeContainer() as unknown as El;
  host.append(box.el);
  const trigger = box.focusTarget;
  const list = () => all(box.el as El).find((el) => el.getAttribute('role') === 'listbox');
  const active = () => list()!.getAttribute('aria-activedescendant');
  const idOf = (i: number) => listOptions(trigger)[i]!.getAttribute('id');
  return { box, trigger, set, list, active, idOf };
}

const dialogs: FormDialog[] = [];
afterEach(() => dialogs.splice(0).forEach((d) => d.close()));

describe('listbox select', () => {
  it('leaves no native select in the UI sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20);
    for (const [path, text] of Object.entries(sources)) expect(/h\('select'|createElement\('select'\)/.test(text), path).toBe(false);
  });

  it('renders select fields and the compact section nav without native selects', () => {
    const dialog = createFormDialog(
      fakeContainer(),
      {
        id: 'f',
        title: 'F',
        sections: ['a', 'b'].map((id) => ({
          id,
          title: id.toUpperCase(),
          groups: [
            {
              id: `${id}-g`,
              inputs: [
                { kind: 'select', id: `${id}-pick`, label: 'Pick', default: 1, options: [{ value: 1, label: 'One' }, { value: 2, label: 'Two' }] },
                { kind: 'source', id: `${id}-source`, label: 'Source', default: 'close' },
              ],
            },
          ],
        })),
      },
      { compactWidth: 1000 },
    );
    dialogs.push(dialog);
    const panel = dialog.el as El;
    expect(all(panel).filter((el) => el.tagName === 'select')).toEqual([]);
    expect(all(panel).filter((el) => el.getAttribute('aria-haspopup') === 'listbox').length).toBeGreaterThanOrEqual(3);
  });

  it('opens a short list without a search box, with focus in the list', () => {
    const { box, trigger, set, list, active, idOf } = setup();
    expect(trigger.getAttribute('aria-label')).toBe('Month');
    expect(trigger.getAttribute('aria-labelledby')).toBe(`${trigger.getAttribute('id')} ${trigger.getAttribute('id')}-value`);
    expect(trigger.getAttribute('title')).toBe('March');

    key(trigger, 'ArrowDown');
    expect(all(box.el as El).some((el) => el.getAttribute('role') === 'combobox')).toBe(false);
    expect(focused()).toBe(list());
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(active()).toBe(idOf(2));
    expect(listOptions(trigger)[2]!.getAttribute('aria-selected')).toBe('true');

    key(list()!, 'End');
    expect(active()).toBe(idOf(5));
    key(list()!, 'Home');
    expect(active()).toBe(idOf(0));
    // Type-ahead: a letter jumps to the next option starting with it, again to the one after.
    key(list()!, 'j');
    expect(active()).toBe(idOf(5));
    key(list()!, 'j');
    expect(active()).toBe(idOf(0));
    key(list()!, 'j');
    // After a pause typing starts over; letters typed together match the start of a label.
    key(list()!, 'm', 1000);
    expect(active()).toBe(idOf(2));
    key(list()!, 'a', 1100);
    key(list()!, 'y', 1200);
    expect(active()).toBe(idOf(4));

    // Escape closes without a change and stays with the list.
    const outer = vi.fn();
    (box.el.parentElement as HTMLElement).addEventListener('keydown', outer);
    key(list()!, 'Escape');
    expect(outer).not.toHaveBeenCalled();
    expect(list()).toBeUndefined();
    expect(focused()).toBe(trigger);
    expect(set).not.toHaveBeenCalled();

    // Space picks the active option.
    dispatch(trigger, 'click');
    key(list()!, 'ArrowUp');
    key(list()!, ' ', 3000);
    expect(list()).toBeUndefined();
    expect(set).toHaveBeenCalledWith(1);
    expect(trigger.getAttribute('title')).toBe('February');

    // Typing on the closed trigger opens the list at the match.
    key(trigger, 'a', 5000);
    expect(active()).toBe(idOf(3));
    key(list()!, 'Enter');
    expect(set).toHaveBeenLastCalledWith(3);

    box.setDisabled(true);
    dispatch(trigger, 'click');
    expect(list()).toBeUndefined();
  });

  it('pages through the list, and Tab closes it from the trigger without a change', () => {
    const { trigger, set, list, active, idOf } = setup();
    key(trigger, 'ArrowDown');
    // Page keys move several rows, stopping at the ends.
    key(list()!, 'PageDown');
    expect(active()).toBe(idOf(5));
    key(list()!, 'PageUp');
    expect(active()).toBe(idOf(0));
    key(list()!, 'Tab');
    expect(list()).toBeUndefined();
    expect(focused()).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(set).not.toHaveBeenCalled();
  });
});
