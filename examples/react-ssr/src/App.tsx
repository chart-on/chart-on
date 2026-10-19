import { useMemo, useState } from 'react';
import { createMockDataSource } from '@chart-on/core';
import { Chart } from '@chart-on/react';

const intervals = ['1m', '1h', '1d'] as const;

/**
 * Renders the same markup on the server and in the browser. On the server the
 * chart is only its container `div`; the chart itself is created after
 * hydration, when the component mounts.
 */
export function App() {
  // Creating the source does not touch the network or the DOM, so it is safe on the server too.
  const dataSource = useMemo(() => createMockDataSource(), []);
  const [interval, pickInterval] = useState<(typeof intervals)[number]>('1h');

  return (
    <main style={{ fontFamily: 'system-ui', padding: 16 }}>
      <h1 style={{ fontSize: 20 }}>Server-rendered chart</h1>
      <div role="group" aria-label="Interval" style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {intervals.map((value) => (
          <button key={value} type="button" aria-pressed={value === interval} onClick={() => pickInterval(value)}>
            {value}
          </button>
        ))}
      </div>
      <Chart id="chart" style={{ height: 420 }} dataSource={dataSource} symbol="DEMO" interval={interval} />
    </main>
  );
}
