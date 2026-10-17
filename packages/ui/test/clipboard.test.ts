import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Chart, ScreenshotOptions } from '@charton/core';
import { canCopyImage, copyChartImage } from '../src/clipboard';

/** A clipboard item that keeps what it was given. */
class FakeClipboardItem {
  constructor(readonly items: Record<string, Promise<Blob>>) {}
}

function stubClipboard() {
  const write = vi.fn((_items: FakeClipboardItem[]) => Promise.resolve());
  vi.stubGlobal('navigator', { clipboard: { write, writeText: vi.fn() } });
  vi.stubGlobal('ClipboardItem', FakeClipboardItem);
  return write;
}

function chart(blob: Blob | null) {
  const captureImage = vi.fn((_options?: ScreenshotOptions) => Promise.resolve(blob));
  return { chart: { captureImage } as unknown as Chart, captureImage };
}

afterEach(() => vi.unstubAllGlobals());

describe('copyChartImage', () => {
  it('writes a PNG of the chart, starting the write before the image is encoded', async () => {
    const write = stubClipboard();
    const png = new Blob(['png'], { type: 'image/png' });
    const { chart: c, captureImage } = chart(png);
    const done = copyChartImage(c, { scale: 2, background: 'transparent', type: 'image/jpeg' } as never);
    // The write is already under way in the same task as the call.
    expect(write).toHaveBeenCalledTimes(1);
    expect(captureImage).toHaveBeenCalledWith({ scale: 2, background: 'transparent', type: 'image/png' });
    await done;
    const [item] = write.mock.calls[0]![0];
    expect(Object.keys(item!.items)).toEqual(['image/png']);
    await expect(item!.items['image/png']).resolves.toBe(png);
  });

  it('fails the write when the chart cannot be captured', async () => {
    const write = stubClipboard();
    write.mockImplementation(async (items) => {
      await items[0]!.items['image/png'];
    });
    await expect(copyChartImage(chart(null).chart)).rejects.toThrow('could not be captured');
  });

  it('rejects without capturing when the browser cannot copy images', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn() } });
    const { chart: c, captureImage } = chart(new Blob(['png']));
    expect(canCopyImage()).toBe(false);
    await expect(copyChartImage(c)).rejects.toThrow('not available');
    expect(captureImage).not.toHaveBeenCalled();
    stubClipboard();
    expect(canCopyImage()).toBe(true);
  });
});
