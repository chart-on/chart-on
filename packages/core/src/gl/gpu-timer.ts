/** The constants of the disjoint timer query extension for WebGL2, which the DOM typings leave out. */
interface TimerQueryExtension {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

/** Queries waiting for their result at most; frames past this go untimed rather than queue more. */
const MAX_PENDING = 4;

/**
 * Times GPU work with timer queries and reads the results back on later
 * frames, so the CPU never waits for the GPU. Queries are reused: once warm,
 * timing a frame creates nothing.
 */
export class GpuTimer {
  /** Ended queries whose result has not been read, oldest first. */
  readonly #pending: WebGLQuery[] = [];
  readonly #spare: WebGLQuery[] = [];
  #active: WebGLQuery | null = null;
  /** Milliseconds of the newest result read back, or null before the first. */
  #latest: number | null = null;

  private constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly ext: TimerQueryExtension,
  ) {}

  /** A timer for `gl`, or null when the browser does not offer the extension. */
  static create(gl: WebGL2RenderingContext): GpuTimer | null {
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQueryExtension | null;
    return ext ? new GpuTimer(gl, ext) : null;
  }

  /** Start timing; does nothing while too many results are still on their way. */
  begin(): void {
    // A frame that threw before `end` left its query running.
    if (this.#active) this.end();
    if (this.#pending.length >= MAX_PENDING) return;
    const query = this.#spare.pop() ?? this.gl.createQuery();
    if (!query) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.#active = query;
  }

  /** Stop timing the work since `begin`. */
  end(): void {
    if (!this.#active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.#pending.push(this.#active);
    this.#active = null;
  }

  /** Read every result that is ready, without waiting; returns the newest in milliseconds. */
  poll(): number | null {
    const gl = this.gl;
    let disjoint: boolean | null = null;
    while (this.#pending.length > 0) {
      const query = this.#pending[0]!;
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
      // A disjoint event (the GPU changed clocks, or was reset) spoils the results since the last check.
      disjoint ??= Boolean(gl.getParameter(this.ext.GPU_DISJOINT_EXT));
      if (!disjoint) this.#latest = (gl.getQueryParameter(query, gl.QUERY_RESULT) as number) / 1e6;
      this.#pending.shift();
      this.#spare.push(query);
    }
    return this.#latest;
  }

  /** Delete every query. With `lost`, the context already dropped them, so only forget them. */
  dispose(lost = false): void {
    if (this.#active && !lost) this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    const all = [...this.#pending, ...this.#spare];
    if (this.#active) all.push(this.#active);
    if (!lost) for (const query of all) this.gl.deleteQuery(query);
    this.#pending.length = 0;
    this.#spare.length = 0;
    this.#active = null;
    this.#latest = null;
  }
}
