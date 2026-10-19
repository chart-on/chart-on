import type { MessageParams } from '@chart-on/core';
import { Check, ChevronDown } from 'lucide';
import { h, markActive, icon, inlineKey, nameButton, placePopover, popoverToggle, prefersReducedMotion, type IconSource } from './dom';
import { stepTab } from './indicator-picker-model';
import type { ShellMessageKey } from './messages';
import { bindTip } from './tooltip';

/** Props of `iconButton`: the icon, its accessible name and tooltip, size, style variant, tooltip side and click handler. */
export interface IconButtonProps {
  icon: IconSource;
  /** Accessible name and tooltip. */
  label: string;
  size?: 'sm' | 'md' | 'lg';
  /** `surface`: tactile bevel; `ghost`: borderless until hover; `flat`: rail/sidebar. */
  variant?: 'surface' | 'ghost' | 'flat';
  tip?: 'bottom' | 'right';
  onClick?: (e: MouseEvent) => void;
}

/** A square button showing only an icon, with `label` as its accessible name and tooltip. */
export function iconButton(p: IconButtonProps): HTMLButtonElement {
  const size = p.size ?? 'sm';
  const el = h('button', {
    class: `pc-icon-btn pc-icon-btn--${size} pc-icon-btn--${p.variant ?? 'surface'}`,
    'aria-label': p.label,
    'data-tip': p.label,
    'data-tip-side': p.tip ?? 'bottom',
  });
  el.append(icon(p.icon, size === 'lg' ? 20 : size === 'md' ? 18 : 16));
  bindTip(el);
  if (p.onClick) el.addEventListener('click', p.onClick);
  return el;
}

/** Props of `button`: the text, an optional leading icon, style variant, tooltip and click handler. */
export interface ButtonProps {
  label: string;
  icon?: IconSource;
  variant?: 'neutral' | 'surface' | 'ghost';
  title?: string;
  onClick?: (e: MouseEvent) => void;
}

/** A text button with an optional leading icon; `title`, when given, becomes its tooltip and accessible name. */
export function button(p: ButtonProps): HTMLButtonElement {
  const el = h('button', { class: `pc-btn pc-btn--${p.variant ?? 'surface'}` });
  if (p.title) {
    el.setAttribute('data-tip', p.title);
    el.setAttribute('aria-label', p.title);
    bindTip(el);
  }
  if (p.icon) el.append(icon(p.icon, 15));
  el.append(h('span', {}, p.label));
  if (p.onClick) el.addEventListener('click', p.onClick);
  return el;
}

/** One choice of a `segmentedTabs` control: the value it selects and its label. */
export interface SegmentOption {
  value: string;
  label: string;
  /** Message key for `label` in a toolbar item, which shows the key's text in the chart's language (see `ToolbarItem.labelKey`). */
  labelKey?: ShellMessageKey | (string & {});
  /** Values for the `{name}` placeholders of `labelKey`'s text, e.g. `{ count: '100' }`. */
  labelParams?: MessageParams;
  /** Accessible name and tooltip when the label is short, e.g. "Log scale" for `log`. */
  title?: string;
  /** Message key for `title`, as `labelKey` is for `label`. */
  titleKey?: ShellMessageKey | (string & {});
}

/** A segmented control made by `segmentedTabs`: its element, `set` to select a value without calling `onChange`, and `destroy`. */
export interface SegmentedTabs {
  el: HTMLDivElement;
  set(value: string): void;
  /** Rename the control and its options, e.g. in a new language; `options` match the original ones by index. */
  relabel(label: string, options: readonly SegmentOption[]): void;
  /** Stop measuring; call when removing the control. */
  destroy(): void;
}

/** Segmented control with a sliding active pill. */
export function segmentedTabs(
  options: SegmentOption[],
  value: string,
  onChange: (value: string) => void,
  label = 'Options',
): SegmentedTabs {
  const indicator = h('div', { class: 'pc-seg-indicator', 'aria-hidden': 'true' });
  const el = h('div', { class: 'pc-seg', role: 'radiogroup', 'aria-label': label }, indicator);
  const pick = (next: string) => {
    set(next);
    onChange(next);
  };
  // One tab stop: the checked radio. Left, Right, Home and End check another one and move focus to it.
  // Inside a roving group (a toolbar) the group owns Tab and the arrows instead.
  const own = () => !el.closest?.('[data-roving]');
  const buttons = options.map((o) => {
    const b = h('button', { class: 'pc-seg-btn', role: 'radio', 'data-value': o.value }, o.label);
    if (o.title) nameButton(b, o.title);
    b.addEventListener('click', () => pick(o.value));
    b.addEventListener('keydown', (e) => {
      // Buttons a toolbar hid (`isOptionHidden`) are skipped.
      const shown = buttons.filter((x) => !x.hidden);
      const next = own() && shown[stepTab(shown.indexOf(b), shown.length, inlineKey(e), false) ?? -1];
      if (!next) return;
      e.preventDefault();
      pick(next.dataset.value!);
      next.focus();
    });
    el.append(b);
    return b;
  });
  let current = value;
  let placed = false;

  const place = () => {
    const active = buttons.find((b) => b.dataset.value === current);
    if (!active || active.offsetWidth === 0) return;
    indicator.style.transition = !placed || prefersReducedMotion() ? 'none' : '';
    indicator.style.transform = `translateX(${active.offsetLeft}px)`;
    indicator.style.width = `${active.offsetWidth}px`;
    indicator.style.opacity = '1';
    placed = true;
  };

  function set(next: string): void {
    current = next;
    for (const b of buttons) {
      const on = b.dataset.value === next;
      markActive(b, on, true);
      if (own()) b.tabIndex = on ? 0 : -1;
    }
    place();
  }

  // Measure once mounted and whenever fonts/layout change the button widths.
  const observer = new ResizeObserver(place);
  observer.observe(el);
  set(value);
  const relabel = (next: string, renamed: readonly SegmentOption[]) => {
    el.setAttribute('aria-label', next);
    buttons.forEach((b, i) => {
      const text = renamed[i]?.label;
      if (text !== undefined && b.textContent !== text) b.textContent = text;
      const title = renamed[i]?.title;
      if (title) nameButton(b, title);
    });
    place();
  };
  return { el, set, relabel, destroy: () => observer.disconnect() };
}

/** One option of a `menuButton` list: its value, label, optional icon and section heading. */
export interface MenuOption {
  value: string;
  label: string;
  /** Message key for `label` in a toolbar item, which shows the key's text in the chart's language (see `ToolbarItem.labelKey`). */
  labelKey?: ShellMessageKey | (string & {});
  /** Values for the `{name}` placeholders of `labelKey`'s text, e.g. `{ count: '100' }`. */
  labelParams?: MessageParams;
  icon?: IconSource;
  /** Heading shown above this option when it differs from the previous option's. */
  section?: string;
  /** Message key for `section` in a toolbar item, as `labelKey` is for `label`. */
  sectionKey?: ShellMessageKey | (string & {});
}

/** A dropdown made by `menuButton`: its element, `set` to change the selected value, and `open` to show the list. */
export interface MenuButton {
  el: HTMLDivElement;
  set(value: string | undefined): void;
  /** Open the list, as a click on the trigger does; nothing when it is open. */
  open(): void;
  /** Change the accessible name, the visible text or the options, e.g. in a new language. An open list closes. */
  update(patch: { label?: string; text?: string; options?: MenuOption[] }): void;
  /** Close the list and stop listening for clicks outside it; call when removing the control. */
  destroy(): void;
}

/**
 * The leading slot of a checkable menu entry: a check mark (or a dot for a radio entry) when on,
 * empty when off so labels stay aligned. The state shows without relying on colour.
 */
export function menuMark(on: boolean, radio = false): HTMLSpanElement {
  const slot = h('span', { class: radio ? 'pc-menu-icon pc-menu-radio' : 'pc-menu-icon' });
  if (on && !radio) slot.append(icon(Check, 16));
  return slot;
}

/**
 * The children of a menu row: one 16px lead slot, then the label, then a check
 * or radio mark at the row end when a checked row has an icon. Rule: one lead
 * slot per row, the icon when the entry has one and otherwise the mark, so
 * labels align whatever mix of icons and marks a menu has. `checked` is null
 * for a plain entry; `padLead` gives an iconless plain entry an empty slot in
 * a list where other entries have icons.
 */
function menuRow(el: HTMLElement, label: string, source: IconSource | undefined, checked: boolean | null, radio: boolean, padLead: boolean): void {
  if (source) el.append(icon(source, 16));
  else if (checked !== null) el.append(menuMark(checked, radio));
  else if (padLead) el.append(h('span', { class: 'pc-menu-icon' }));
  el.append(h('span', {}, label));
  if (source && checked) {
    const end = menuMark(true, radio);
    end.classList.add('pc-menu-end');
    el.append(end);
  }
}

/** A popup menu entry: `label` with an optional icon, and a check or radio mark unless it is a plain `menuitem`. */
export function popoverItem(
  label: string,
  source: IconSource | undefined,
  active: boolean,
  role: 'menuitem' | 'menuitemradio' | 'menuitemcheckbox',
): HTMLButtonElement {
  const el = h('button', { class: `pc-popover-item${active ? ' is-active' : ''}`, role });
  if (role !== 'menuitem') el.setAttribute('aria-checked', String(active));
  menuRow(el, label, source, role === 'menuitem' ? null : active, role === 'menuitemradio', false);
  return el;
}

/**
 * Trigger button with a dropdown list. With `isChecked` the options are
 * independent toggles, each showing its own state, and the trigger keeps its
 * own icon and text instead of showing the selected option.
 */
export function menuButton(p: {
  label: string;
  icon?: IconSource;
  text?: string;
  options: MenuOption[];
  value?: string;
  onSelect: (value: string) => void;
  isChecked?: (value: string) => boolean;
  /** Leave an option out of the list; read each time the list opens. */
  isHidden?: (value: string) => boolean;
  /** Open above the trigger. Default: above in a bar at the bottom edge (`data-pc-edge="bottom"`), else below. */
  up?: boolean;
  /** Anchor the list to the trigger's right edge. Default: whichever side keeps it on screen. */
  alignEnd?: boolean;
}): MenuButton {
  const wrap = h('div', { class: 'pc-menu' });
  const trigger = h('button', {
    class: 'pc-btn pc-btn--ghost pc-menu-trigger',
    'aria-haspopup': p.isChecked ? 'menu' : 'listbox',
    'aria-label': p.label,
    'data-tip': p.label,
  });
  const face = h('span', { class: 'pc-menu-face' });
  trigger.append(face, icon(ChevronDown, 13));
  bindTip(trigger);
  wrap.append(trigger);
  let current = p.value;
  let options = p.options;
  let faceText = p.text;

  const render = () => {
    const selected = p.isChecked ? undefined : options.find((o) => o.value === current);
    const ic = selected?.icon ?? p.icon;
    const text = faceText ?? (ic ? undefined : selected?.label);
    face.replaceChildren();
    if (ic) face.append(icon(ic, 16));
    // Text beside an icon can be dropped to save space; see `.pc-toolbar--icons`.
    if (text) face.append(ic ? h('span', { class: 'pc-menu-text' }, text) : h('span', {}, text));
  };

  const { open, close } = popoverToggle(wrap, trigger, () => {
    const list = h('div', {
      class: 'pc-popover',
      role: p.isChecked ? 'menu' : 'listbox',
      'aria-label': trigger.getAttribute('aria-label') ?? p.label,
    });
    let section: string | undefined;
    const withIcons = options.some((o) => o.icon);
    for (const o of options) {
      if (p.isHidden?.(o.value)) continue;
      if (o.section !== undefined && o.section !== section) list.append(h('div', { class: 'pc-popover-label' }, o.section));
      section = o.section;
      const on = p.isChecked ? p.isChecked(o.value) : o.value === current;
      const item = h('button', {
        class: `pc-popover-item${on ? ' is-active' : ''}`,
        role: p.isChecked ? 'menuitemcheckbox' : 'option',
        [p.isChecked ? 'aria-checked' : 'aria-selected']: String(on),
      });
      menuRow(item, o.label, o.icon, p.isChecked ? on : null, false, withIcons);
      item.addEventListener('click', () => {
        current = o.value;
        render();
        close();
        p.onSelect(o.value);
      });
      list.append(item);
    }
    wrap.append(list);
    placePopover(list, trigger, { up: p.up, alignEnd: p.alignEnd });
    return list;
  }, undefined, true);

  render();
  return {
    el: wrap,
    open,
    set(value) {
      current = value;
      render();
    },
    update(patch) {
      close();
      if (patch.label !== undefined) {
        trigger.setAttribute('aria-label', patch.label);
        trigger.setAttribute('data-tip', patch.label);
      }
      if (patch.text !== undefined) faceText = patch.text;
      if (patch.options) options = patch.options;
      render();
    },
    destroy: close,
  };
}

/** Returned by `overflowMore`: the button's wrapper and popover, and `fit`, `sync`, `close` and `stop`. */
export interface OverflowMore {
  wrap: HTMLElement;
  panel: HTMLElement;
  /** Move the trailing children that do not fit into the popover, and back once they fit. */
  fit(): void;
  /** Mark the button active while a moved element is. */
  sync(): void;
  close(): void;
  /** Close the popover and stop refitting on resize. */
  stop(): void;
}

/**
 * Internal: a "more" `button` at the end of `bar` for children that do not
 * fit, instead of clipping them. `fit` moves the trailing children that
 * overflow the bar (its height when `vertical`) into the button's popover,
 * which keeps their listeners and state, and moves them back once they fit.
 * It runs again whenever the bar resizes. A hidden bar measures zero and is
 * left alone.
 */
export function overflowMore(bar: HTMLElement, button: HTMLButtonElement, wrapClass: string, popover: string, vertical?: boolean): OverflowMore {
  const wrap = h('div', { class: wrapClass }, button);
  // A disclosure, not a menu: the popover holds the bar's own buttons, named after the button.
  // Opened from the keyboard, it still takes focus like the shell's menus.
  const panel = h('div', { class: `pc-popover ${popover}`, role: 'group' });
  const { close } = popoverToggle(wrap, button, () => {
    panel.setAttribute('aria-label', button.getAttribute('aria-label') ?? '');
    wrap.append(panel);
    return panel;
  });
  const over = () => (vertical ? bar.scrollHeight > bar.clientHeight : bar.scrollWidth > bar.clientWidth);
  const sync = () => button.classList.toggle('is-active', !!panel.querySelector('.is-active'));
  const fit = () => {
    close();
    wrap.remove();
    bar.append(...panel.children);
    if (over()) {
      bar.append(wrap);
      // The last child before the button moves to the front of the popover, so order is kept.
      for (let last; over() && (last = bar.children[bar.children.length - 2]); ) panel.insertBefore(last, panel.firstElementChild);
    }
    sync();
  };
  const observer = new ResizeObserver(() => fit());
  observer.observe(bar);
  return {
    wrap,
    panel,
    fit,
    sync,
    close,
    stop() {
      close();
      observer.disconnect();
    },
  };
}
