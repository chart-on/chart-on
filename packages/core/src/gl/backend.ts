import type { FrameCounters, GpuMemory } from '../render-stats';
import type { HeatmapGrid } from './heatmap-grid';
import type { HeatmapUniforms } from './heatmap-program';
import type { LineBatch } from './line-batch';
import type { RectBatch } from './rect-batch';
import type {
  BoxUniforms,
  DeviceRect,
  FillUniforms,
  GpuOwner,
  LineUniforms,
  PointUniforms,
  RectUniforms,
  SpanUniforms,
} from './renderer';

/**
 * @internal What series and charts draw through: the WebGL2 renderer today,
 * later another GPU backend or a worker proxy. Only a backend touches the
 * GPU context; batches and grids stay backend-neutral CPU buffers.
 */
export interface RenderBackend {
  readonly maxTextureSize: number;
  readonly isLost: boolean;
  /** The context is live, or coming back for the context budget. */
  readonly holdsContext: boolean;
  /** Work counters for the current frame while render statistics are on, else null. */
  counters: FrameCounters | null;
  /**
   * Start a frame drawn for `client`. Clients sharing a backend pass the same
   * `frame` (the animation frame's timestamp) to share its upload budget.
   */
  beginFrame(dpr: number, client?: unknown, frame?: number): void;
  setPane(rect: DeviceRect): void;
  drawRects(batch: RectBatch, first: number, count: number, u: RectUniforms): void;
  drawSpans(batch: RectBatch, first: number, count: number, u: SpanUniforms): void;
  drawPoints(batch: RectBatch, first: number, count: number, u: PointUniforms): void;
  drawBoxes(batch: RectBatch, first: number, count: number, u: BoxUniforms): void;
  drawLine(batch: LineBatch, first: number, end: number, u: LineUniforms): void;
  drawFill(batch: LineBatch, first: number, end: number, u: FillUniforms): void;
  /** Draw a heatmap grid into the current pane; a no-op until the heatmap plugin primed this backend. */
  drawHeatmap(grid: HeatmapGrid, u: HeatmapUniforms): void;
  /**
   * Upload more of the batch data a large load left waiting in the batches
   * the current client drew, nearest the view first; call once per drawn
   * frame, after the draws. True while the client's data still waits, so it
   * asks for another frame.
   */
  flushUploads(): boolean;
  endFrame(): void;
  /** Free what mirrors `owner` on the GPU; drawing it again re-creates it. */
  release(owner: GpuOwner): void;
  /** Give the context up for the context budget. */
  suspend(): void;
  /** Take a context back after `suspend`. */
  resume(): void;
  gpuMemory(): GpuMemory;
  gpuTime(): number | null;
  stopTiming(): void;
  destroy(): void;
  /** Release the context for good. */
  loseContext(): void;
}
