import type { RenderBackend } from '../src/gl/backend';

/** One call a series or chart made on the backend, with its arguments as passed. */
export interface BackendCall {
  op: string;
  args: unknown[];
}

export interface RecordingBackend extends RenderBackend {
  calls: BackendCall[];
  /** The recorded operation names, in order. */
  ops(): string[];
}

const RECORDED = [
  'beginFrame',
  'setPane',
  'drawRects',
  'drawSpans',
  'drawPoints',
  'drawBoxes',
  'drawLine',
  'drawFill',
  'drawHeatmap',
  'endFrame',
  'release',
  'suspend',
  'resume',
  'stopTiming',
  'destroy',
  'loseContext',
] as const;

/**
 * A `RenderBackend` that records commands instead of drawing, so series and
 * chart tests can assert what was drawn without reading GL calls. Swap it in
 * for a chart's renderer: `(chart as any).renderer = recordingBackend()`.
 */
export function recordingBackend(): RecordingBackend {
  const calls: BackendCall[] = [];
  const backend: Record<string, unknown> = {
    maxTextureSize: 16384,
    isLost: false,
    holdsContext: true,
    counters: null,
    calls,
    ops: () => calls.map((c) => c.op),
    gpuMemory: () => ({ buffers: 0, textures: 0, total: 0 }),
    gpuTime: () => null,
    flushUploads: () => false,
  };
  for (const op of RECORDED) backend[op] = (...args: unknown[]) => void calls.push({ op, args });
  return backend as unknown as RecordingBackend;
}
