---
description: "Keyboard map for the chart and the UI shell, screen-reader support and contrast checks."
---

# Keyboard and accessibility

Everything in the chart and the UI shell can be reached and used from the keyboard. This page is the key map; the [chart's screen-reader support](./interaction#screen-readers) is described with the rest of its input.

## Moving around the shell

The shell has up to five areas: the toolbar, the rail, the chart, the navigator and the bottom bar. Each bar is a single <kbd>Tab</kbd> stop, so <kbd>Tab</kbd> goes from area to area rather than through every button, and the arrow keys move inside a bar.

| Key | Where | Action |
| --- | --- | --- |
| <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd> | Anywhere | Next / previous area, field or slider |
| <kbd>F6</kbd> / <kbd>Shift</kbd>+<kbd>F6</kbd> | Anywhere in the shell | Focus the next / previous area, skipping hidden ones (the `focus-next-region` and `focus-previous-region` actions) |
| <kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd> | Toolbar, rail, bottom bar | Previous / next button, wrapping at the ends |
| <kbd>Home</kbd> / <kbd>End</kbd> | Toolbar, rail, bottom bar | First / last button |
| <kbd>Enter</kbd> or <kbd>Space</kbd> | A button | Press it |
| <kbd>Shift</kbd>+<kbd>Enter</kbd> | A drawing tool in the rail | Arm the tool and keep it after each drawing |

The chart shows a focus ring while keyboard navigation has put focus on it: the ring appears once <kbd>Tab</kbd> or <kbd>F6</kbd> is pressed and hides again after a pointer press. Shortcuts and <kbd>Escape</kbd> do not show it, so focus handed back to the chart when a dialog or panel closes shows no ring.

A bar remembers the button you last used, so coming back with <kbd>Tab</kbd> or <kbd>F6</kbd> lands on it. Fields and sliders inside a bar (the go-to-date form, controls an app puts in a toolbar) keep their own <kbd>Tab</kbd> stops and arrow keys.

<kbd>F6</kbd> works while focus is anywhere in the shell, including the chart, and does nothing while a modal dialog is open. Like any action, it can be rebound or turned off:

```ts
shell.chart.actions.setKeys('focus-next-region', ['Alt+F6']);
```

## Menus

| Key | Action |
| --- | --- |
| <kbd>Enter</kbd> or <kbd>Space</kbd> on a menu button | Open the menu and focus its selected entry, or the first one |
| <kbd>↓</kbd> / <kbd>↑</kbd> | Next / previous entry, wrapping at the ends |
| <kbd>Home</kbd> / <kbd>End</kbd> | First / last entry |
| <kbd>Enter</kbd> or <kbd>Space</kbd> | Pick the entry |
| <kbd>Escape</kbd> | Close the menu and focus its button again |

The chart's [context menu](./ui-shell#context-menu) opens from the focused chart with the <kbd>Menu</kbd> key or <kbd>Shift</kbd>+<kbd>F10</kbd>.

## The chart

With the chart focused, the arrow, Page and Home/End keys move the view, <kbd>+</kbd> and <kbd>-</kbd> zoom, and the drawing keys edit the selection: see the full table under [keyboard](./interaction#keyboard). Typing a letter or digit opens the [symbol search](./symbol-search#keyboard).

## Shortcuts

| Key | Action |
| --- | --- |
| <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>K</kbd> | [Command palette](./ui-shell#command-palette) (`command-palette`) |
| <kbd>/</kbd> | Symbol search (`symbol-search`; also <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>K</kbd> in a shell without the command palette) |
| <kbd>/</kbd> | [Indicator picker](./indicator-picker), with the chart focused or hovered, in a shell without a symbol search (`indicator-picker`) |
| <kbd>Shift</kbd>+<kbd>End</kbd> | Reset the view (`reset-view`) |
| <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>Z</kbd>, <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> | Undo, redo a drawing change |

Every shortcut is an [action](./interaction#actions-and-shortcuts) on `chart.actions`, so an app can list the shortcuts in effect for its own help screen, including any the user rebound:

```ts
for (const { label, keys } of shell.chart.actions.list()) if (keys.length > 0) addRow(label, keys.join(', '));
```

## Other controls

- **Navigator:** the window and both edges are sliders; see [navigator](./ui-shell#navigator).
- **Data window:** the arrow keys step through the bars.
- **Object tree, dialogs and pickers:** see [object tree](./ui-shell#object-tree), [form and picker dialogs](./dialogs) and [symbol search](./symbol-search#keyboard).

## Screen readers and contrast

The chart describes what is in view, can read the crosshair values and announce new bars, and can show its data as a table; see [screen readers](./interaction#screen-readers). The shell's bars are toolbars with names, its menus are menus or list boxes, and toggles report whether they are pressed.

Automated tests check WCAG AA contrast for the built-in dark, light and high-contrast themes: 4.5:1 for text in the chart and the shell chrome, and 3:1 for the focus ring. If you change the colours with the `--pc-*` tokens (see [theming](./theming)), check those pairs again.
