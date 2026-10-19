import type { Chart, ScreenshotOptions } from '@chart-on/core';
import { chartPng } from './clipboard';

/**
 * Screenshot options for printing; the image is always a PNG. Defaults differ
 * from `captureImage`: `theme: 'light'`, `caption: true` and `scale: 2`,
 * for a sharp image on white paper that says what it shows.
 */
export type PrintOptions = Omit<ScreenshotOptions, 'type' | 'quality'>;

/** Class of the print-only view; `style.css` hides it on screen. */
export const PRINT_VIEW_CLASS = 'pc-print-view';
/** Class on the root element while a print view is up, so print CSS hides the rest of the page. */
export const PRINTING_CLASS = 'pc-printing';

/** Removes the print view of the last `printChart` call that has not finished yet. */
let active: (() => void) | null = null;

/**
 * Print the chart: an image of it (see `PrintOptions`) in a print-only view
 * sized to the page, then the browser's print dialog. The page itself stays
 * as it is on screen; while printing, only the image prints. The view is
 * removed when the dialog closes (`afterprint`), or by the next call.
 * Resolves then; rejects when the chart cannot be captured, or with the
 * `not-registered` `ChartError` of a chart without the `imageCapture()`
 * plugin (the UI shell adds it). Call it from a
 * user action, as some browsers block print dialogs opened without one.
 */
export async function printChart(chart: Chart, options: PrintOptions = {}): Promise<void> {
  const blob = await chartPng(chart, { theme: 'light', caption: true, scale: 2, ...options });
  active?.();
  const doc = chart.root.ownerDocument;
  const win = doc.defaultView ?? window;
  const url = URL.createObjectURL(blob);
  const view = doc.createElement('div');
  view.className = PRINT_VIEW_CLASS;
  const image = doc.createElement('img');
  image.alt = '';
  image.src = url;
  view.append(image);
  doc.body.append(view);
  doc.documentElement.classList.add(PRINTING_CLASS);

  return new Promise<void>((resolve, reject) => {
    let done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      if (active === cleanup) active = null;
      win.removeEventListener('afterprint', cleanup);
      view.remove();
      doc.documentElement.classList.remove(PRINTING_CLASS);
      URL.revokeObjectURL(url);
      if (error) reject(error);
      else resolve();
    };
    const cleanup = () => finish();
    active = cleanup;
    // Wait for the image, or the dialog may show an empty page.
    const ready = typeof image.decode === 'function' ? image.decode().catch(() => undefined) : Promise.resolve();
    void ready.then(() => {
      if (done) return;
      win.addEventListener('afterprint', cleanup);
      try {
        win.print();
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}
