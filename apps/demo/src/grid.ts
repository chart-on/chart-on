import { createMockDataSource, type Interval, type LinkGroupOptions } from '@charton/core';
import { commandPalette, createChartGrid, gridLayout, toasts } from '@charton/ui';
import '@charton/ui/style.css';
import { expose } from './expose';

// Up to eight linked charts, each on its own random walk. The toolbar acts on the active chart.
const STORAGE_KEY = 'charton-demo-grid';
const linkLabels: Record<keyof LinkGroupOptions, string> = {
  crosshair: 'Crosshair',
  visibleRange: 'Pan and zoom',
  symbol: 'Symbol',
  interval: 'Interval',
  timezone: 'Timezone',
  drawings: 'Drawings',
};

const grid = createChartGrid(document.getElementById('grid')!, {
  layout: '2x2',
  theme: 'system',
  cell: { commandPalette: commandPalette(), toasts: toasts() },
  setup(shell, index) {
    shell.chart.setDataSource(createMockDataSource({ startPrice: 50 + index * 40, seed: index + 1 }));
    void shell.chart.setSymbol('DEMO', '1h');
  },
  toolbar: [
    // Switches the grid's preset and follows `layout:change`.
    { ...gridLayout(), text: 'Layout' },
    {
      type: 'segmented',
      id: 'interval',
      label: 'Interval',
      value: '1h',
      options: ['5m', '15m', '1h', '1d'].map((value) => ({ value, label: value })),
      onChange: (value, chart) => void chart.setSymbol(chart.data?.requested?.symbol ?? 'DEMO', value as Interval),
    },
    {
      type: 'menu',
      id: 'links',
      label: 'Linked',
      text: 'Linked',
      options: (Object.keys(linkLabels) as (keyof LinkGroupOptions)[]).map((value) => ({ value, label: linkLabels[value] })),
      isChecked: (value) => grid.links.options[value as keyof LinkGroupOptions],
      onSelect: (value) => {
        const key = value as keyof LinkGroupOptions;
        grid.links.applyOptions({ [key]: !grid.links.options[key] });
      },
    },
    { type: 'spacer' },
    {
      type: 'button',
      id: 'save',
      label: 'Save the grid to this browser',
      text: 'Save',
      onClick: () => localStorage.setItem(STORAGE_KEY, JSON.stringify(grid.serializeLayout({ visibleRange: true }))),
    },
    {
      type: 'button',
      id: 'restore',
      label: 'Restore the saved grid',
      text: 'Restore',
      onClick: () => {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (!saved) return;
        const { errors } = grid.loadLayout(JSON.parse(saved));
        if (errors.length) console.warn('Grid restored with errors', errors);
      },
    },
  ],
});

// The toolbar shows the active chart's interval.
grid.on('active:change', ({ shell }) => grid.toolbar?.setValue('interval', shell.chart.data?.requested?.interval ?? '1h'));

expose({ grid });
