import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeContainer } from '../../core/test/fake-dom';
import { createChartShell } from '../src/shell';

afterEach(() => vi.unstubAllGlobals());

describe('createChartShell without WebGL2', () => {
  it('rethrows the chart error and leaves the container empty', () => {
    const container = fakeContainer({ webgl: null });
    // The shell reads its theme from CSS custom properties; none are set here.
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));
    expect(() => createChartShell(container)).toThrow(expect.objectContaining({ code: 'webgl2-unavailable' }));
    expect((container as unknown as { children: unknown[] }).children).toEqual([]);
  });
});
