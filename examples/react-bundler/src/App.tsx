import { useMemo, useRef, useState } from 'react';
import { createMockDataSource } from '@charton/core';
import type { ChartShell as Shell } from '@charton/ui';
import { ChartShell } from '@charton/react/shell';

/** The widget with synthetic data, a theme switch and a crosshair readout. */
export function App() {
  // Keep the source stable: a new one would attach again and reload the symbol.
  const dataSource = useMemo(() => createMockDataSource(), []);
  const shell = useRef<Shell>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [price, setPrice] = useState<number | null>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 8, fontFamily: 'system-ui' }}>
        <button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          Theme: {theme}
        </button>
        <button type="button" onClick={() => shell.current?.chart.fitContent()}>
          Fit
        </button>
        <span>Crosshair: {price === null ? '-' : price.toFixed(2)}</span>
      </header>
      <ChartShell
        ref={shell}
        style={{ flex: 1, minHeight: 0 }}
        theme={theme}
        dataSource={dataSource}
        symbol="DEMO"
        interval="1h"
        on={{ 'crosshair:move': (e) => setPrice(e ? e.price : null) }}
      />
    </div>
  );
}
