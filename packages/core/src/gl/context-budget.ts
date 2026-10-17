import { isDev } from '../util/dev';

// Bundlers replace `process.env.NODE_ENV`; module-local so it never clashes with Node's typings.
declare const process: { env: { NODE_ENV?: string } };
/**
 * Something that holds a WebGL context the budget may take away: a chart's
 * renderer, seen through a small adapter.
 */
export interface ContextHolder {
  /** Whether it holds a live context now (not lost, not given up). */
  readonly holding: boolean;
  /** Give the context up for the budget. */
  evict(): void;
  /** Take a context back after `evict`. */
  reacquire(): void;
  /**
   * Holds a context only to draw (a static chart): it never takes one from a
   * chart in view, but waits for one to be released.
   */
  readonly transient?: boolean;
}

interface Entry {
  visible: boolean;
  /** Tick when it was last in view; Infinity while it is. */
  seen: number;
  /** Tick of its last creation, interaction or re-acquire. */
  used: number;
}

/**
 * Browsers cap live WebGL contexts per page (commonly 16 on desktop, 8 on
 * mobile) and silently lose the oldest past that. Staying a little below the
 * cap leaves room for other contexts on the page and lets the chart choose
 * which one goes.
 */
function defaultLimit(): number {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return coarse ? 6 : 12;
}

/** Charts on the page and the contexts they hold, evicting past the limit. */
export class ContextBudget {
  #limitValue: number | null = null;
  readonly #entries = new Map<ContextHolder, Entry>();
  /** Holders waiting for room to take a context back, in the order they asked. */
  readonly #waiting = new Set<ContextHolder>();
  /** Ordering counter; deterministic, unlike timestamps. */
  #tick = 0;

  get limit(): number {
    return (this.#limitValue ??= defaultLimit());
  }

  setLimit(n: number): void {
    if (!Number.isInteger(n) || n < 1) {
      throw new RangeError(/* @__PURE__ */ isDev() && process.env.NODE_ENV !== 'production' ? `setContextBudget() expects a whole number of at least 1, got ${String(n)}` : '');
    }
    this.#limitValue = n;
    this.fit(0, null, true);
    this.#admit();
  }

  /**
   * Make room for a context about to be created; call before creating it. A
   * static chart (`transient`) holds its first context only to draw, so it
   * takes room from charts out of view and from other static charts, never
   * from a chart in view that keeps its context.
   */
  reserve(transient = false): void {
    this.fit(1, null, true, transient);
  }

  add(holder: ContextHolder): void {
    this.#entries.set(holder, { visible: true, seen: Infinity, used: ++this.#tick });
  }

  remove(holder: ContextHolder): void {
    this.#entries.delete(holder);
    this.#waiting.delete(holder);
    this.#admit();
  }

  /** The holder gives its context up of its own accord (a static chart done drawing, or one whose restore went unanswered): one waiting may take it. */
  release(holder: ContextHolder): void {
    holder.evict();
    this.#admit();
  }

  /**
   * The holder was interacted with or wants to draw: it ranks as recently used,
   * and takes a context back if it gave one up.
   */
  use(holder: ContextHolder): void {
    const entry = this.#entries.get(holder);
    if (!entry) return;
    entry.used = ++this.#tick;
    this.#wake(holder);
  }

  setVisible(holder: ContextHolder, visible: boolean): void {
    const entry = this.#entries.get(holder);
    if (!entry || entry.visible === visible) return;
    entry.visible = visible;
    entry.seen = visible ? Infinity : ++this.#tick;
    if (!visible) return;
    entry.used = ++this.#tick;
    // A static chart shows its last drawing without a context: it only wants one if it was waiting to draw.
    if (!holder.transient || this.#waiting.has(holder)) this.#wake(holder);
  }

  /**
   * A lost context came back. One the browser restored counts again, so others
   * may have to go; one restored for the budget can now be evicted, which may
   * make room for a chart waiting.
   */
  restored(holder: ContextHolder): void {
    if (!this.#entries.has(holder)) return;
    this.fit(0, holder, true);
    this.#admit();
  }

  /** Contexts held by the charts on the page now. */
  get held(): number {
    let n = 0;
    for (const holder of this.#entries.keys()) if (holder.holding) n++;
    return n;
  }

  /**
   * Take a context back for `holder` if one fits after evicting, or else wait
   * for one: a context still being restored cannot be evicted, and the browser
   * would drop one of its own choosing past its cap.
   */
  #wake(holder: ContextHolder): void {
    if (holder.holding) {
      this.#waiting.delete(holder);
      return;
    }
    this.fit(1, holder, !holder.transient);
    if (this.held < this.limit) {
      this.#waiting.delete(holder);
      holder.reacquire();
    } else {
      this.#waiting.add(holder);
    }
  }

  /**
   * Give the holders waiting for a context another try, first come first
   * served. Those out of view draw nothing, so they keep their place until
   * they are back in view.
   */
  #admit(): void {
    for (const holder of [...this.#waiting]) if (this.#entries.get(holder)?.visible) this.#wake(holder);
  }

  /**
   * Evict until `extra` more contexts fit, sparing `keep`, charts in view
   * unless `inView`, and with `spareKept` the charts in view that keep their
   * context. Charts out of view go first, the one out of view longest first;
   * then the least recently used.
   */
  private fit(extra: number, keep: ContextHolder | null, inView: boolean, spareKept = false): void {
    const held = [...this.#entries].filter(
      ([holder, entry]) =>
        holder !== keep && holder.holding && ((inView && !(spareKept && !holder.transient)) || !entry.visible),
    );
    let excess = this.held + extra - this.limit;
    if (excess <= 0) return;
    held.sort(([, a], [, b]) => a.seen - b.seen || a.used - b.used);
    for (const [holder] of held) {
      if (excess <= 0) break;
      holder.evict();
      // A holder that cannot give its context up (no lose-context extension) keeps it.
      if (!holder.holding) excess--;
    }
  }
}

/** The page's budget, shared by every chart from this copy of the library. */
export const contextBudget = new ContextBudget();

/** A renderer with its own context as a budget entry, added to the budget (`reserve` comes before creating it). */
export function budgetEntry(
  renderer: { readonly holdsContext: boolean; suspend(): void; resume(): void },
  transient = false,
): ContextHolder {
  const holder: ContextHolder = {
    transient,
    get holding() {
      return renderer.holdsContext;
    },
    evict: () => renderer.suspend(),
    reacquire: () => renderer.resume(),
  };
  contextBudget.add(holder);
  return holder;
}

/**
 * Set how many WebGL contexts the charts on this page may hold at once
 * (default 12, or 6 with a coarse pointer). Past it, the chart out of view the
 * longest gives its context up, and takes one back when it scrolls into view
 * or is interacted with. Lowering the budget evicts at once.
 */
export function setContextBudget(n: number): void {
  contextBudget.setLimit(n);
}

/** The current context budget (see `setContextBudget`). */
export function getContextBudget(): number {
  return contextBudget.limit;
}
