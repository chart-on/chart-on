// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { Eye } from 'lucide';
import css from '../src/style.css?raw';
import { menuButton, menuMark } from '../src/controls';

afterEach(() => document.body.replaceChildren());

/** The open menu's entries: role, checked state and the classes of each child around the label. */
function entries(el: HTMLElement) {
  return [...el.querySelectorAll<HTMLElement>('.pc-popover-item')].map((b) => ({
    role: b.getAttribute('role'),
    checked: b.getAttribute('aria-checked'),
    slots: [...b.children].filter((c) => c.className || c.tagName === 'svg').map((c) => `${c.tagName.toLowerCase()}${c.className ? `.${c.className.split(' ').join('.')}` : ''}${c.querySelector('svg') ? '>svg' : ''}`),
  }));
}

describe('checkable menu entries', () => {
  it('give each row one lead slot, the icon or else the mark, with a checked icon row marked at its end', () => {
    const on = new Set(['a', 'c']);
    const menu = menuButton({
      label: 'View',
      options: [
        { value: 'a', label: 'With icon', icon: Eye },
        { value: 'b', label: 'With icon, off', icon: Eye },
        { value: 'c', label: 'No icon' },
        { value: 'd', label: 'No icon, off' },
      ],
      onSelect: () => {},
      isChecked: (v) => on.has(v),
    });
    document.body.append(menu.el);
    menu.open();
    expect(entries(menu.el)).toEqual([
      { role: 'menuitemcheckbox', checked: 'true', slots: ['svg', 'span.pc-menu-icon.pc-menu-end>svg'] },
      { role: 'menuitemcheckbox', checked: 'false', slots: ['svg'] },
      { role: 'menuitemcheckbox', checked: 'true', slots: ['span.pc-menu-icon>svg'] },
      { role: 'menuitemcheckbox', checked: 'false', slots: ['span.pc-menu-icon'] },
    ]);
  });

  it('pads an iconless option in a list where others have icons', () => {
    const menu = menuButton({ label: 'Type', options: [{ value: 'a', label: 'A', icon: Eye }, { value: 'b', label: 'B' }], value: 'a', onSelect: () => {} });
    document.body.append(menu.el);
    menu.open();
    expect(entries(menu.el).map((e) => e.slots)).toEqual([['svg'], ['span.pc-menu-icon']]);
  });

  it('adds no slots to a plain list without icons', () => {
    const menu = menuButton({ label: 'Type', options: [{ value: 'a', label: 'A' }], value: 'a', onSelect: () => {} });
    document.body.append(menu.el);
    menu.open();
    expect(entries(menu.el)).toEqual([{ role: 'option', checked: null, slots: [] }]);
  });

  it('names the list after its button, also after a relabel', () => {
    const menu = menuButton({ label: 'Type', options: [{ value: 'a', label: 'A' }], value: 'a', onSelect: () => {} });
    document.body.append(menu.el);
    menu.open();
    expect(menu.el.querySelector('[role=listbox]')!.getAttribute('aria-label')).toBe('Type');
    menu.update({ label: 'Style' });
    menu.open();
    expect(menu.el.querySelector('[role=listbox]')!.getAttribute('aria-label')).toBe('Style');
  });

  it('leaves hidden options and their emptied headings out', () => {
    let hide = 'b';
    const menu = menuButton({
      label: 'Interval',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B', section: 'Ticks' },
        { value: 'c', label: 'C', section: 'Volume' },
      ],
      onSelect: () => {},
      isHidden: (v) => v === hide,
    });
    document.body.append(menu.el);
    const shown = () => [...menu.el.querySelectorAll('.pc-popover > *')].map((el) => el.textContent);
    menu.open();
    expect(shown()).toEqual(['A', 'Volume', 'C']);
    menu.update({});
    hide = 'c';
    menu.open();
    expect(shown()).toEqual(['A', 'Ticks', 'B']);
  });

  it('draws a radio dot from the checked state, not a check mark', () => {
    expect(menuMark(true, true).childElementCount).toBe(0);
    expect(menuMark(true, true).className).toBe('pc-menu-icon pc-menu-radio');
    expect(menuMark(false).childElementCount).toBe(0);
    expect(css).toMatch(/\[aria-checked='true'\] > \.pc-menu-radio::before \{[^}]*border: 3px solid;/);
  });
});
