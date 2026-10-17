---
description: "One to eight linked chart shells in resizable cells, with layout presets, an active chart for the toolbar, and a saved grid layout."
---

# Chart grid

`createChartGrid` from `@charton/ui` puts one to eight [shells](./ui-shell) in a grid of resizable cells. The charts are in a [link group](./link-groups), so the crosshair, pan and zoom follow across them, and one toolbar above the grid acts on the active chart.

<!-- example: chart-grid -->

```ts
import { createChartGrid } from '@charton/ui';
import '@charton/ui/style.css';

const grid = createChartGrid(el, {
  layout: '2x2',                       // preset, see below; default '1x1'
  cell: { rail: false },               // shell options of every cell, or (index) => options
  setup(shell, index) {                // each new cell, also those a later setLayout adds
    shell.chart.setDataSource(source);
    void shell.chart.setSymbol(symbols[index], '1h');
    return () => {};                   // optional: runs when the cell goes
  },
  toolbar: [...],                      // acts on the active chart; omit for none
  link: { symbol: false },             // link group options; false links nothing
  theme: 'dark',                       // grid and cells; 'dark' | 'light' | 'system'
});

grid.cells;      // ChartShell per cell, by row
grid.charts;     // their charts
grid.links;      // the LinkGroup: grid.links.applyOptions({ interval: true })
grid.active;     // the active cell's shell; grid.activeIndex is its index
grid.destroy();
```

## Layouts

Presets are named columns by rows:

| Preset | Cells |
| --- | --- |
| `1x1` | One chart |
| `2x1`, `3x1` | Side by side |
| `1x2`, `1x3` | Stacked |
| `2x2` | Four |
| `3x2` | Six |
| `4x2` | Eight |

`grid.setLayout('3x2')` switches preset. Cells keep their place by index: a smaller preset destroys cells from the end, a larger one creates new cells with the `cell` options and runs `setup` for them. New cells join the link group and take the first chart's linked state. If a new chart cannot be created (no WebGL2, or `setup` throws), `setLayout` destroys the cells it made, keeps the previous layout and rethrows the error. `chartGridLayouts` lists the columns and rows of each preset, for a layout menu.

## Resizing

A bar between each pair of columns and rows resizes them. Drag it, or focus it with Tab and use the arrow keys (Shift for bigger steps, Home and End for the limits). Each bar is a `separator` with its position in `aria-valuenow`, in percent. A column or row never gets smaller than a tenth of the grid. Only the two cells beside the bar change.

`grid.sizes` holds the column widths and row heights as fractions that sum to 1; `grid.setSizes({ columns: [2, 1] })` sets them (scaled to sum to 1). A layout change resets them to equal sizes.

Each shell sizes its narrow layout by its own cell, not by the window: a cell's compact layout (`features.railSheet`) follows the cell's width.

## The active chart

The active cell is the one the grid toolbar acts on: toolbar callbacks get its chart, and `isActive` and `isChecked` are read again when it changes. A click or focus in a cell makes it active; `grid.setActive(index, { focus: true })` does so from code and moves keyboard focus to its chart. Tab moves through the charts and the resize bars. With more than one cell, the active one has an outline (`--pc-grid-active`, the accent colour by default) and `aria-current="true"`.

A segmented or menu item shows a value that may differ per chart. Update it when the active chart changes:

```ts
grid.on('active:change', ({ shell }) => {
  grid.toolbar?.setValue('interval', shell.chart.data?.requested?.interval ?? '1h');
});
```

The `gridLayout()` [preset](./ui-shell#presets) is a layout menu that switches `grid.setLayout` and follows `layout:change` by itself:

```ts
import { createChartGrid, gridLayout } from '@charton/ui';

const grid = createChartGrid(el, { layout: '2x2', toolbar: [gridLayout(['1x1', '2x1', '2x2'])] });
```

Custom toolbar items render once, with the chart active at that moment; read `grid.active` when they act.

## Events

| Event | Payload | When |
| --- | --- | --- |
| `active:change` | `{ index, shell }` | Another cell became active |
| `layout:change` | `{ layout }` | `setLayout` or `loadLayout` changed the preset |
| `sizes:change` | `{ columns, rows }` | A bar moved, or `setSizes` changed the sizes |

`grid.on(event, listener)` returns an unsubscribe function.

## Save and restore

`grid.serializeLayout()` returns the preset, the sizes, the active cell, the link options and each chart's [layout](./layouts). Store it as JSON and pass it back to `grid.loadLayout(saved)`:

```ts
localStorage.setItem('grid', JSON.stringify(grid.serializeLayout({ visibleRange: true })));

const { errors, ready } = grid.loadLayout(JSON.parse(localStorage.getItem('grid')!));
await ready; // each saved symbol loaded
```

Options go to each chart's `serializeLayout` and `loadLayout`. Parts that are not valid are skipped and listed in `errors`, with the chart's index in the part (`charts[1].panes[0]`). A missing `sizes.columns` or `sizes.rows` list means equal sizes. `loadLayout` throws a `ChartError` with code `invalid-layout`, changing nothing, only when the data is not a saved grid at all; when a new chart of the saved preset cannot be created, it rethrows that error, also changing nothing.

## Performance

Cells draw through the [shared WebGL context](./embedding#one-context-for-many-charts) unless their `chart` options set `gl`, so eight charts take one context of the page's budget. Each shell has its own rail, bottom bar and dialogs; leave out the parts a small cell does not need (`cell: { rail: false, bottomBar: false }`).

## Theming

The grid root is also a `.pc-shell`, so it takes the same tokens and `data-theme`. Two more tokens:

| Token | Default | Use |
| --- | --- | --- |
| `--pc-grid-gutter` | `var(--pc-gap)` | Space between cells, where the resize bars sit |
| `--pc-grid-active` | `var(--pc-accent)` | Outline of the active cell |
