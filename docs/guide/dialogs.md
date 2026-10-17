---
description: "Schema-driven settings forms and searchable pickers from @charton/ui, with custom input kinds, live preview and keyboard control."
---

# Form and picker dialogs

`@charton/ui` ships two dialog primitives that every settings surface can share, in the widget and in your own app:

- **`createFormDialog`** builds a settings form from a schema: sections, groups and inputs, with conditional visibility, validation messages and a live preview that Cancel undoes.
- **`createPickerDialog`** is a searchable list with categories, single or multiple selection, paging, row actions, and loading, error and empty states.

Both open at once in the element you pass (use the shell element, `shell.el`, so they pick up the theme), cover it while open, trap focus, close with Escape and give focus back to where it was. Below a host width of 600 px (`compactWidth`) they switch to a compact layout: tabs become a select, and a sidebar becomes a list of sections that opens one at a time.

<!-- example: form-dialog -->

## Form dialog

```ts
import { createFormDialog, type FormSchema } from '@charton/ui';

const schema: FormSchema = {
  id: 'bands',
  title: 'Bands',
  layout: 'single', // or 'sidebar'
  sections: [
    {
      id: 'inputs',
      title: 'Inputs',
      groups: [
        {
          id: 'calc',
          inputs: [
            { kind: 'number', id: 'length', label: 'Length', default: 20, min: 2, integer: true },
            { kind: 'source', id: 'source', label: 'Source', default: 'close' },
            { kind: 'boolean', id: 'smooth', label: 'Smooth', default: false },
            // Shown only while `smooth` is on.
            { kind: 'number', id: 'factor', label: 'Factor', default: 2, visible: (v) => v.smooth === true },
          ],
        },
      ],
    },
  ],
};

const dialog = createFormDialog(shell.el, schema, {
  values: current,                       // inputs without a value start from `default`
  onChange: (values) => preview(values), // every edit that leaves the form valid
  onAction: (id, values) => {
    if (id === 'ok') save(values);
  },
});
```

| Option | |
| --- | --- |
| `values` | Values to edit, by input id |
| `onChange(values)` | Live preview: after each edit that leaves the form valid, and with the opening values on cancel |
| `onFieldChange(id, value, values)` | After each edit whose own value is valid |
| `onAction(id, values, dialog)` | An action ran. A submit only reaches it when the form is valid; return `false` to keep the dialog open |
| `inputs` | Renderers for this dialog only, by kind |
| `section` | Section to show first |
| `compactWidth` | Host width in px below which the compact layout is used. Default `600` |
| `presentation` | `'modal'` (default) or `'panel'`: a non-modal panel docked to the host's right edge, see [Panel](#panel) |
| `headerControls` | Extra elements in the header, before the close button |
| `closeLabel` | Accessible name of the close button. Default the `dialogClose` [message](./localization) in the `localization`'s language, `'Close'` in English |
| `localization` | Language of the dialog's own text (Ok, Cancel, the close button, validation messages), usually `chart.localization`; read when the dialog opens. Default English. Actions take a `labelKey` (`dialogOk`, say) that applies while their `label` is the key's English text |

The dialog handle has `values`, `errors`, `section`, `showSection(id)`, `setValues(patch)` (no callbacks), `submit()`, `cancel()` and `close()`.

### Inputs

| Kind | Value | Extra fields |
| --- | --- | --- |
| `number` | number | `min`, `max`, `step`, `integer` |
| `text` | string | `placeholder`, `maxLength`, `required` |
| `boolean` | boolean | |
| `select` | string or number | `options`, `searchable` (a search box over the list, for long lists such as timezones; it matches labels and values) |
| `multi-select` | array of option values | `options` |
| `color` | CSS color | `swatches`, `placeholder` (the color shown while the value is empty; with one, an empty value is valid) |
| `slider` | number | `min`, `max`, `step`, `unit` |
| `range` | `[from, to]` | `min`, `max`, `step` |
| `source` | string | `options`, default `defaultSources` (open, high, low, close and the usual averages) |

Every input has `id`, `label`, and optionally `hint`, `default`, `visible`, `disabled` and `validate`. `visible` and `disabled` are a boolean or a function of the current values; groups and sections take `visible` too. Hidden and disabled inputs keep their values and are not validated.

`validate(value, values)` returns a message, or nothing when the value is fine. It runs after the built-in checks (a number in range, a required text, a known option…). Messages show under the input once it has been edited, or for every input after a submit, which then moves to the first one.

Groups can have a `label`, and with `collapsible` (and `collapsed`) the label folds them.

`select` and `source` fields show the chosen option on a closed control (a button with `aria-haspopup="listbox"`, labelled by the field label) that opens a themed list in a popover; it is fixed to the viewport, so a scrolling dialog body does not clip it, and it closes when the field scrolls out of view. Arrow and Page keys move the active option, Enter or a click picks it and closes the list, and Escape or a press outside closes it without a change; typing on the closed control opens it with that text. Without `searchable`, focus moves into the list (the active option is its `aria-activedescendant`), where Home and End go to the ends, typing jumps to the option starting with the typed text and Space picks. With `searchable`, a search box (a combobox over the list) filters the options instead.

### Actions

The footer defaults to Cancel and Ok. Pass `actions` to change it:

```ts
actions: [
  { id: 'defaults', label: 'Defaults', role: 'reset', align: 'start' },
  { id: 'cancel', label: 'Cancel', role: 'cancel' },
  { id: 'ok', label: 'Ok', role: 'submit' },
],
```

`submit` validates and closes, `cancel` (also Escape and the close button) restores the opening values through `onChange` and closes, `reset` puts back the inputs' defaults, and `button` only calls `onAction`. Enter in a one-line input submits. `align: 'header'` puts an action in the header beside the close button instead of the footer. `align: 'nav'` puts one under the section list of a `sidebar` layout, for buttons that lead elsewhere; in the compact layout it joins the section list, and without a sidebar it sits at the footer start.

### Panel

With `presentation: 'panel'` the form slides in from the right edge of the host instead of opening over a backdrop, so whatever it edits stays in view and usable while the preview updates. It has no focus trap and no `aria-modal`: Tab can leave it, and presses outside reach the chart. Escape (with focus inside) and the close button still cancel. Below `compactWidth` it becomes a bottom sheet. It slides out on close, and appears and disappears at once when the user prefers reduced motion. The [indicator settings](./ui-shell#indicator-settings) use it; mount it in the chart's container (the shell's `.pc-stage`) so it covers the chart only.

### Custom input kinds

Register a renderer for a new kind with `registerInput(kind, renderer)`; it returns a function that removes it again. A renderer gets the input and a context, and returns the control:

```ts
import { registerInput, type FormInputBase, type InputRenderer } from '@charton/ui';

interface StepperInputDef extends FormInputBase<number> {
  kind: 'stepper';
  max?: number;
}

// Let schemas use the kind with full typing.
declare module '@charton/ui' {
  interface FormInputKinds {
    stepper: StepperInputDef;
  }
}

const stepper: InputRenderer<StepperInputDef, number> = (input, ctx) => {
  let value = ctx.value;
  const el = document.createElement('button');
  el.id = ctx.controlId; // the field's label points at it
  el.textContent = String(value);
  el.addEventListener('click', () => {
    value = Math.min(input.max ?? 10, value + 1);
    el.textContent = String(value);
    ctx.set(value);
  });
  return {
    el,
    // Reset, cancel and setValues: show the value without reporting it.
    setValue: (next) => (el.textContent = String((value = next))),
    setDisabled: (disabled) => (el.disabled = disabled),
  };
};

const unregister = registerInput('stepper', stepper);
```

`ctx.set(value)` reports what the user entered; the form validates it, updates visibility and calls `onChange`. Put `ctx.controlId` on the focusable element (or return it as `focusTarget`), or label a group of controls with `aria-labelledby` set to `ctx.labelId`. Registering a built-in kind's name replaces it until the returned function runs. For one dialog only, pass `inputs: { stepper }` instead.

`createFormDialog` throws when the schema has mistakes (duplicate ids, unknown kinds, a select without options…); `validateFormSchema(schema)` lists them without opening anything.

## Picker dialog

```ts
import { createPickerDialog } from '@charton/ui';

createPickerDialog(
  shell.el,
  {
    title: 'Add indicator',
    source: { items: definitions.map((d) => ({ id: d.id, label: d.name, category: d.category })) },
    categories: [
      { id: 'trend', label: 'Trend' },
      { id: 'momentum', label: 'Momentum' },
    ],
    rowActions: [{ id: 'star', label: 'Favorite', icon: Star, pressed: (item) => favorites.has(item.id) }],
  },
  {
    onSelect: ([item]) => add(item.id),
    onAction: (action, item, dialog) => {
      toggleFavorite(item.id);
      dialog.refresh();
    },
  },
  { localization: chart.localization }, // optional
);
```

Items need an `id` and a `label`; `description`, `category` (one id or several), `keywords` and `disabled` are optional. With `source: { items }` the picker filters by category and ranks matches itself: exact label, id or keyword first, then label prefix, keyword or id prefix, acronym of the label or a keyword (`rsi` finds "Relative Strength Index"), word prefix, substring of the label or a keyword, all query words, and description. Equal matches keep their order.

`rankItems(items, query, options?)` is the same ranking on its own, and `matchScore(item, query, { typos })` scores one item (lower is better, `null` for no match). Two options change the ranking:

- `typos: true` also matches a query of three or more characters one typo away (a missing, extra, wrong or swapped letter) from a label, a keyword or one of their words, ranked just above description matches: `rsl` finds RSI. The [indicator picker](./indicator-picker#search) ranks this way.
- `favorites: ['id', …]` puts those items first among equally good matches; a better match still comes first.

For server-side search pass `source: { fetch(query, { page, pageSize, category, signal }) }`, returning an array or `{ items, hasMore }`. Typing is debounced (`debounce`, default 200 ms for `fetch`, none for `items`), older requests are aborted through `signal`, and the next page loads as the list scrolls.

| Option | |
| --- | --- |
| `categories`, `allLabel` | Category list beside the results; the first entry, `paletteAll` ("All") by default, lists everything. `allLabel: false` drops it |
| `multiple`, `selected` | Pick several, confirmed with Done; `selected` holds the ids picked on open |
| `closeOnSelect` | Single select: `false` keeps the dialog open to pick several in a row |
| `rowActions` | Buttons at the end of each row, with an optional `pressed` state and `appliesTo(item)` to show one on some rows only |
| `pageSize` | Items per page. Default `50` |
| `placeholder`, `searchLabel`, `emptyText`, `closeLabel` | Texts (`closeLabel` names the close button). Their defaults are the `dialogSearch`, `pickerEmpty` and `dialogClose` messages |

The third argument holds the callbacks. The optional fourth, `{ localization }` (usually `chart.localization`), sets the language of the defaults above and of Done, Cancel, the loading and empty messages and the counts; without it they are in English.

Keyboard: typing searches, the arrow and Page keys move through the rows, Enter picks (or toggles, with `multiple`; Ctrl+Enter confirms), Tab reaches the active row's buttons and the category list, whose arrows, Home and End switch category, and Escape closes. Up and Down on a row button move the active row and go back to the search box, and a row button keeps focus when `dialog.refresh()` redraws the rows. The [indicator picker](./indicator-picker) runs on the same list.

## Styling

Both dialogs use the shell's `--pc-*` tokens, plus `--pc-dialog-bg`, `--pc-dialog-backdrop`, `--pc-dialog-radius`, `--pc-dialog-shadow`, `--pc-dialog-width`, `--pc-dialog-panel-width`, `--pc-dialog-height`, `--pc-dialog-sidebar-width`, `--pc-dialog-padding`, `--pc-dialog-btn-min-width` (the smallest width of a footer text button), `--pc-dialog-field-height` and `--pc-dialog-error`. The panel carries `.pc-dialog` with `.pc-form-dialog` or `.pc-picker`, and `data-compact="true"` in the compact layout. A non-modal panel adds `.pc-dialog--panel` (and `data-closing="true"` while it slides out); its positioning wrapper is `.pc-dialog-backdrop--panel`.

The [symbol search](./symbol-search) and the indicator picker keep their own result lists but share this frame's behaviour (Escape, focus trap, presses outside, compact mode) and tokens. Their panels carry `.pc-symbol-search` or `.pc-indicator-picker` and the same `data-compact` attribute while open; in the compact layout the symbol search puts its exchange select on a row of its own under the search box.
