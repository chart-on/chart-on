import type { Chart, ScreenshotOptions } from '@charton/core';

/** Screenshot options for an image on the clipboard: always PNG, the one image type browsers accept there. */
export type ClipboardImageOptions = Omit<ScreenshotOptions, 'type' | 'quality'>;

/** Internal: the browser's async clipboard; undefined without one (insecure context, old browser). */
export const clipboardApi = () => (typeof navigator === 'undefined' ? undefined : navigator.clipboard);

/**
 * Internal: a PNG of the chart; rejects when the chart cannot be captured (`captureImage` resolved
 * to null), or with the `not-registered` error of a chart without the `imageCapture()` plugin.
 */
export function chartPng(chart: Chart, options: ScreenshotOptions): Promise<Blob> {
  let shot: Promise<Blob | null>;
  try {
    shot = chart.captureImage({ ...options, type: 'image/png' });
  } catch (error) {
    // Rejected, not thrown, so callers' `.catch` sees it.
    return Promise.reject(error);
  }
  return shot.then((blob) => {
    if (!blob) throw new Error('The chart could not be captured');
    return blob;
  });
}

/** Internal: whether `error` says the chart has no `imageCapture()` plugin. */
export const captureMissing = (error: unknown) => (error as { code?: unknown } | null)?.code === 'not-registered';

/** True when the browser can put an image on the clipboard (a secure context with the async Clipboard API). */
export function canCopyImage(): boolean {
  return typeof clipboardApi()?.write === 'function' && typeof ClipboardItem !== 'undefined';
}

/**
 * Copy a PNG of the chart to the clipboard. Call it from a user action, such as
 * a click: browsers only allow clipboard writes started by one. Rejects when the
 * browser cannot copy images (see `canCopyImage`), the user denies it, or the
 * chart cannot be captured (`captureImage` resolved to null). Needs the
 * `imageCapture()` plugin, which the UI shell adds: without it this rejects
 * with the `not-registered` `ChartError` of `captureImage`.
 */
export function copyChartImage(chart: Chart, options: ClipboardImageOptions = {}): Promise<void> {
  if (!canCopyImage()) return Promise.reject(new Error('Copying images is not available'));
  // The write starts now, inside the user action, and waits for the image; some browsers
  // refuse a write that only starts after the image has been encoded.
  return navigator.clipboard.write([new ClipboardItem({ 'image/png': chartPng(chart, options) })]);
}
