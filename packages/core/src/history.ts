/** One undoable change: what undo and redo run, and who made it (see `History.drop`). */
export interface HistoryStep {
  undo(): void;
  redo(): void;
  owner?: object;
  /** The steps a `begin`/`commit` joined whose owners differ, so `drop` finds each owner's. */
  parts?: readonly HistoryStep[];
}

/** Steps kept; the oldest are dropped first. */
const MAX_STEPS = 100;

/**
 * The chart's undo history (`chart.history`), shared by drawings and
 * indicators: one list of steps in the order they were made. Only the
 * drawings and indicators plugins make steps, so on a chart without them
 * there is never anything to undo.
 */
export interface History {
  /** Whether there is a step to undo. */
  readonly canUndo: boolean;
  /** Whether there is an undone step to redo. */
  readonly canRedo: boolean;
  /** Take back the last step; during a drawing gesture, only cancel it. Returns false when there was nothing to undo. */
  undo(): boolean;
  /** Make the last undone step again; during a drawing gesture, only cancel it. Returns false when there was nothing to redo. */
  redo(): boolean;
  /** Forget every step. */
  clear(): void;
}

/**
 * @internal The steps behind `chart.history`. The drawings and indicators
 * plugins make it (see `Chart.undoSteps`), so a chart without them leaves
 * this class out.
 */
export class UndoSteps implements History {
  #done: HistoryStep[] = [];
  #undone: HistoryStep[] = [];
  /** Steps recorded since the outermost `begin`, and where each open `begin` started. */
  #open: HistoryStep[] = [];
  #starts: number[] = [];
  #muted = 0;
  readonly #changed: () => void;
  /** @internal Cancels a change under way (a drawing gesture); true when there was one, which undo and redo then only cancel. */
  interrupt: (() => boolean) | null = null;

  /** @internal `changed` runs whenever `canUndo` or `canRedo` may have changed. */
  constructor(changed: () => void) {
    this.#changed = changed;
  }

  /** Whether there is a step to undo. */
  get canUndo(): boolean {
    return this.#done.length > 0;
  }

  /** Whether there is an undone step to redo. */
  get canRedo(): boolean {
    return this.#undone.length > 0;
  }

  /** Take back the last step; during a drawing gesture, only cancel it. Returns false when there was nothing to undo. */
  undo(): boolean {
    return this.#travel(this.#done, this.#undone, 'undo');
  }

  /** Make the last undone step again; during a drawing gesture, only cancel it. Returns false when there was nothing to redo. */
  redo(): boolean {
    return this.#travel(this.#undone, this.#done, 'redo');
  }

  /** Forget every step. */
  clear(): void {
    if (!this.canUndo && !this.canRedo) return;
    this.#done = [];
    this.#undone = [];
    this.#changed();
  }

  /**
   * @internal Add `step` after the last one and forget the undone steps.
   * Inside `begin`/`commit` it joins the open step; while undoing or
   * redoing (see `mute`) it is ignored. Returns false when ignored.
   */
  record(step: HistoryStep): boolean {
    if (this.#muted > 0) return false;
    if (this.#starts.length > 0) {
      this.#open.push(step);
      return true;
    }
    this.#done.push(step);
    if (this.#done.length > MAX_STEPS) this.#done.shift();
    this.#undone = [];
    this.#changed();
    return true;
  }

  /** @internal Run `fn` without recording the steps it makes. */
  mute<T>(fn: () => T): T {
    this.#muted++;
    try {
      return fn();
    } finally {
      this.#muted--;
    }
  }

  /** @internal Open a step: what is recorded until the matching `commit` becomes one step. Calls nest. */
  begin(): void {
    this.#starts.push(this.#open.length);
  }

  /** @internal Close the step `begin` opened. */
  commit(): void {
    this.#starts.pop();
    this.#flush();
  }

  /** @internal Close the step `begin` opened and take back what was recorded in it, leaving no step. */
  cancel(): void {
    const steps = this.#open.splice(this.#starts.pop() ?? 0);
    this.mute(() => {
      for (let i = steps.length; i-- > 0; ) steps[i]!.undo();
    });
    this.#flush();
  }

  /** @internal The step `undo` would take back next. */
  get last(): HistoryStep | undefined {
    return this.#done[this.#done.length - 1];
  }

  /**
   * @internal Forget `target` and the steps it owns, e.g. when what they
   * change was replaced. Returns whether any went (and reported it).
   */
  drop(target: object): boolean {
    const keep = (s: HistoryStep): boolean => s !== target && s.owner !== target && (s.parts?.every(keep) ?? true);
    const count = this.#done.length + this.#undone.length;
    this.#done = this.#done.filter(keep);
    this.#undone = this.#undone.filter(keep);
    if (this.#done.length + this.#undone.length === count) return false;
    this.#changed();
    return true;
  }

  #travel(from: HistoryStep[], to: HistoryStep[], run: 'undo' | 'redo'): boolean {
    if (this.interrupt?.()) return true;
    const step = from.pop();
    if (!step) return false;
    to.push(step);
    this.mute(() => step[run]());
    this.#changed();
    return true;
  }

  /** Record the steps of the outermost `begin` as one, once it is closed. */
  #flush(): void {
    if (this.#starts.length > 0 || this.#open.length === 0) return;
    const steps = this.#open;
    this.#open = [];
    const owner = steps[0]!.owner;
    const shared = steps.every((s) => s.owner === owner);
    this.record(
      steps.length === 1
        ? steps[0]!
        : {
            ...(shared ? { owner } : { parts: steps }),
            undo: () => {
              for (let i = steps.length; i-- > 0; ) steps[i]!.undo();
            },
            redo: () => {
              for (const s of steps) s.redo();
            },
          },
    );
  }
}
