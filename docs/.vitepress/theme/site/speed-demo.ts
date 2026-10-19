import { createChart, statsOverlay, type Bar, type Chart } from '@chart-on/core';
import { sampleBars } from '../../../examples/sample-data';
import { errorText, retheme, themeFor, whenVisible, type Section } from './section';
import { slidingIndicator } from './slide';

const BARS = 1_000_000;
/** Bars the view moves per frame at 1×. */
const PAN_STEP = 6;

/**
 * One million candles that pan by themselves, with the frame rate and frame
 * cost the chart measures in the visitor's browser. The auto-pan runs at 1×
 * up to 1000× its normal pace; grabbing the chart pauses it, and so does a
 * request for reduced motion.
 */
export function mountSpeedDemo(root: HTMLElement, dark: boolean): Section {
  const host = root.querySelector<HTMLElement>('[data-speed-chart]')!;
  const note = root.querySelector<HTMLElement>('[data-speed-note]')!;
  const toggle = root.querySelector<HTMLButtonElement>('[data-speed-toggle]')!;
  const latest = root.querySelector<HTMLButtonElement>('[data-speed-latest]')!;
  const speeds = root.querySelector<HTMLElement>('.lp-speeds')!;
  const out = (name: string) => root.querySelector<HTMLElement>(`[data-speed="${name}"]`)!;
  const [fps, cpu, gpu] = [out('fps'), out('cpu'), out('gpu')];

  let chart: Chart | null = null;
  let bars: Bar[] = [];
  let raf = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let at = 0;
  let rate = 1;
  let lastReadout = 0;
  let panning = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  let isDark = dark;

  const setPanning = (value: boolean) => {
    panning = value;
    // The button shows pause while panning and play while paused (site.css).
    const label = value ? 'Pause auto-pan' : 'Resume auto-pan';
    toggle.setAttribute('aria-pressed', String(value));
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
  };
  setPanning(panning);
  toggle.addEventListener('click', () => setPanning(!panning));
  host.addEventListener('pointerdown', () => setPanning(false));
  latest.addEventListener('click', () => {
    setPanning(false);
    chart?.scrollToRealtime();
  });
  // Picking a speed also resumes the pan.
  const removeSlide = slidingIndicator(speeds);
  speeds.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-speed-rate]');
    if (!button) return;
    rate = Number(button.dataset.speedRate);
    for (const b of speeds.querySelectorAll('[data-speed-rate]')) b.setAttribute('aria-checked', String(b === button));
    // Past 1× the view jumps thousands of bars a frame; an eased price scale would trail behind it.
    chart?.applyOptions({ smoothScale: rate === 1 });
    setPanning(true);
  });

  function step(now: number): void {
    raf = requestAnimationFrame(step);
    if (!chart) return;
    if (panning) {
      at = (at + PAN_STEP * rate) % (bars.length - 2_000);
      chart.scrollToTime(bars[1_000 + at]!.time, false);
    }
    if (now - lastReadout < 250) return;
    lastReadout = now;
    const frame = chart.frameTime;
    fps.textContent = frame ? String(Math.min(240, Math.round(1000 / frame))) : '–';
    const stats = chart.frameStats;
    cpu.textContent = stats ? stats.times.total.toFixed(2) : '–';
    gpu.textContent = stats?.gpuTime != null ? stats.gpuTime.toFixed(2) : '–';
  }

  const stopWatching = whenVisible(host, () => {
    // Let "Generating" paint before the million bars hold the thread.
    timer = setTimeout(() => {
      try {
        bars = sampleBars(BARS, { price: 1000 });
        // The panel bar has its own go-to-newest button, so the chart's floating one is off.
        chart = createChart(host, { theme: themeFor(isDark), plugins: [statsOverlay()], renderStats: true, scrollButton: false, smoothScale: rate === 1 });
        chart.addCandles({ title: '1,000,000 bars' }).setData(bars);
        chart.scrollToTime(bars[1_000]!.time, false);
        note.hidden = true;
        raf = requestAnimationFrame(step);
      } catch (error) {
        note.textContent = errorText(error);
      }
    }, 30);
  });

  return {
    setDark(value) {
      isDark = value;
      retheme([chart], value);
    },
    destroy() {
      stopWatching();
      removeSlide();
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      chart?.destroy();
      chart = null;
      bars = [];
    },
  };
}
