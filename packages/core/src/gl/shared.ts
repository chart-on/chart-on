import { contextBudget, type ContextHolder } from './context-budget';
import { GLRenderer, type RendererEvents } from './renderer';

/** A chart drawing through the shared context; it hears about losses and restores. */
export type SharedClient = RendererEvents;

/** One chart's place in the shared context (`SharedContext.join`). */
export interface SharedSession {
  readonly renderer: GLRenderer;
  /** The context as one budget entry: shared charts' use and visibility keep it. */
  readonly holder: ContextHolder;
  setVisible(visible: boolean): void;
  /** Before drawing: grow the hidden canvas to the chart's own canvas. */
  fit(): void;
  /** After drawing: copy the chart's region of the hidden canvas into its own canvas. */
  copy(): void;
  /** The chart goes; the last one out lets the context go. */
  leave(): void;
}

/**
 * One WebGL2 context shared by every chart created with `gl: 'shared'`. Each
 * chart draws into the top-left region of its hidden canvas and copies that
 * region into its own visible 2D canvas in the same task, so the page holds
 * one context however many charts it has. Made by the first shared chart and
 * released with the last.
 */
export class SharedContext {
  private renderer: GLRenderer | null = null;
  #canvasEl: HTMLCanvasElement | null = null;
  readonly #clients = new Set<SharedClient>();
  /** Shared charts in view; the context counts as visible while any is. */
  private visible = new Set<SharedClient>();

  /** The context as one budget entry: shared charts' use and visibility keep it. */
  readonly holder: ContextHolder;

  constructor() {
    const holding = () => this.renderer?.holdsContext ?? false;
    this.holder = {
      get holding() {
        return holding();
      },
      evict: () => this.renderer?.suspend(),
      reacquire: () => this.renderer?.resume(),
    };
  }

  /** The hidden canvas charts draw into. */
  get canvas(): HTMLCanvasElement | null {
    return this.#canvasEl;
  }

  /** Charts drawing through the shared context now. */
  get size(): number {
    return this.#clients.size;
  }

  /**
   * Join `client`, which shows its drawing in the 2D canvas `target`, making
   * the context if it is the first; throws like a chart's own context would.
   */
  join(target: HTMLCanvasElement, client: SharedClient): SharedSession {
    if (!this.renderer) {
      const canvas = document.createElement('canvas');
      contextBudget.reserve();
      this.renderer = new GLRenderer(canvas, {
        lost: (reason) => this.#each((c) => c.lost(reason)),
        restored: (reason) => {
          contextBudget.restored(this.holder);
          this.#each((c) => c.restored(reason));
        },
        restoreFailed: (error) => this.#each((c) => c.restoreFailed(error)),
        gaveUp: () => contextBudget.release(this.holder),
      });
      this.#canvasEl = canvas;
      contextBudget.add(this.holder);
    }
    this.#clients.add(client);
    this.visible.add(client);
    const renderer = this.renderer;
    return {
      renderer,
      holder: this.holder,
      setVisible: (visible) => this.setVisible(client, visible),
      fit: () => this.fit(target.width, target.height),
      copy: () => {
        const source = this.#canvasEl;
        const ctx = target.getContext('2d');
        if (!source || !ctx || renderer.isLost) return;
        ctx.clearRect(0, 0, target.width, target.height);
        // Same task as the GL draw, so the drawing buffer still holds this chart's frame.
        ctx.drawImage(source, 0, 0, target.width, target.height, 0, 0, target.width, target.height);
      },
      leave: () => this.leave(client),
    };
  }

  /** `client` leaves; the last one out lets the context go. */
  leave(client: SharedClient): void {
    if (!this.#clients.delete(client)) return;
    this.visible.delete(client);
    if (this.#clients.size > 0 || !this.renderer) return;
    contextBudget.remove(this.holder);
    this.renderer.destroy();
    this.renderer.loseContext();
    this.renderer = null;
    this.#canvasEl = null;
  }

  setVisible(client: SharedClient, visible: boolean): void {
    if (visible) this.visible.add(client);
    else this.visible.delete(client);
    contextBudget.setVisible(this.holder, this.visible.size > 0);
  }

  /**
   * Make the hidden canvas at least `width` × `height` device px. It only
   * grows: shrinking would reallocate it every time charts of different
   * sizes take turns.
   */
  fit(width: number, height: number): void {
    const canvas = this.#canvasEl;
    if (!canvas) return;
    if (canvas.width < width) canvas.width = width;
    if (canvas.height < height) canvas.height = height;
  }

  #each(fn: (client: SharedClient) => void): void {
    for (const client of [...this.#clients]) fn(client);
  }
}

/** The page's shared context, used by every chart from this copy of the library. */
export const shared = /* @__PURE__ */ new SharedContext();
