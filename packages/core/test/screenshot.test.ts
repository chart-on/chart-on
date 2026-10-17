import { afterEach, describe, expect, it, vi } from 'vitest';
import { compositeImage } from '../src/capture';
import { Chart } from '../src/chart';

/**
 * The test environment has no DOM or WebGL, so captureImage runs against a
 * stand-in chart and a stand-in 2D canvas that record what happens to them.
 */
const log: string[] = [];

function fakeCanvas(blob: Blob | null) {
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: (layer: string) => log.push(`draw ${layer}`), setTransform: () => {} }),
    toBlob: vi.fn((done: (b: Blob | null) => void, type?: string, quality?: number) => {
      log.push(`toBlob ${type} ${quality}`);
      queueMicrotask(() => done(blob));
    }),
  };
  vi.stubGlobal('document', { createElement: () => canvas });
  return canvas;
}

function fakeChart(size = { width: 200, height: 100 }) {
  return {
    ...size,
    dpr: 2,
    renderer: { isLost: false },
    options: { legend: { visible: false }, maxGlDpr: 2 },
    theme: { background: '#000000' },
    sceneDirty: false,
    bottom: 'bottom',
    glCanvas: 'gl',
    top: 'top',
    render: () => log.push('render'),
    // What the imageCapture() plugin gives the chart.
    imageCapture: compositeImage,
  };
}

function screenshot(chart: ReturnType<typeof fakeChart>, options?: Parameters<Chart['captureImage']>[0]) {
  // A Chart instance without running the constructor, which needs a DOM and WebGL.
  // It has none of the chart's ES private (`#name`) members, and reading one throws a
  // TypeError ("Receiver must be an instance of class Chart"). So these options are not
  // covered here: a `theme` other than the chart's (#captureTheme, #useTheme, #layout),
  // `caption: true` (#captionText), a `scale` above the device or GPU ratio (#sizeCanvases)
  // and `legend: true` (#legendIndex). The Chart members this path reads must not become ES
  // private (destroyed, paused, renderer, sceneDirty, render, bottom, glCanvas, top,
  // imageCapture, ...).
  const instance: Chart = Object.assign(Object.create(Chart.prototype) as object, chart) as unknown as Chart;
  return instance.captureImage(options);
}

afterEach(() => {
  log.length = 0;
  vi.unstubAllGlobals();
});

describe('captureImage', () => {
  it('redraws and composites synchronously, then resolves to the encoded blob', async () => {
    const blob = new Blob(['png']);
    const canvas = fakeCanvas(blob);
    const pending = screenshot(fakeChart());
    // The GL buffer is only valid in this task, so all drawing happens before the call returns.
    expect(log).toEqual(['render', 'draw bottom', 'draw gl', 'draw top', 'toBlob image/png undefined']);
    expect(pending).toBeInstanceOf(Promise);
    expect(await pending).toBe(blob);
    expect([canvas.width, canvas.height]).toEqual([400, 200]);
  });

  it('passes the image type and quality to the encoder', async () => {
    const canvas = fakeCanvas(new Blob(['jpg']));
    await screenshot(fakeChart(), { type: 'image/jpeg', quality: 0.8 });
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.8);
  });

  it('resolves to null when the chart has no size', async () => {
    const canvas = fakeCanvas(new Blob(['png']));
    expect(await screenshot(fakeChart({ width: 0, height: 100 }))).toBeNull();
    expect(canvas.toBlob).not.toHaveBeenCalled();
    expect(log).toEqual([]);
  });

  it('resolves to null when the GPU context is lost', async () => {
    fakeCanvas(new Blob(['png']));
    const chart = { ...fakeChart(), renderer: { isLost: true } };
    expect(await screenshot(chart)).toBeNull();
  });

  it('resolves to null when the browser cannot encode the image', async () => {
    fakeCanvas(null);
    expect(await screenshot(fakeChart())).toBeNull();
  });
});
