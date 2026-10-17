import type { Time } from '../types';

/**
 * Decides when the view sitting near the first bar asks for older history:
 * once per first-bar time. A request that fails or is aborted re-arms it for
 * the next scroll, and `reset` re-arms it when the series is replaced (the
 * new series may start at the same time as the old one).
 */
export class HistoryGate {
  /** First-bar time of the last request; null when none is outstanding. */
  #first: Time | null = null;
  /** View the last request was made from, once that request failed. */
  #failedView: string | null = null;
  /** Bumped per request and on reset, so a stale result cannot re-arm. */
  #attempt = 0;

  /**
   * Run `load` for `first` unless it was already asked for. `view` identifies
   * the visible range: after a failure the same first bar is asked for again
   * only once the view has moved, so an idle chart doesn't hammer the source.
   * `load` resolves to false when no page was loaded but a retry may help.
   */
  request(first: Time, view: string, load: () => Promise<boolean> | undefined): void {
    if (first === this.#first && (this.#failedView === null || this.#failedView === view)) return;
    this.#first = first;
    this.#failedView = null;
    const attempt = ++this.#attempt;
    void load()?.then((loaded) => {
      if (!loaded && attempt === this.#attempt) this.#failedView = view;
    });
  }

  /** Forget the last request, e.g. after the series was replaced. */
  reset(): void {
    this.#first = null;
    this.#failedView = null;
    this.#attempt++;
  }
}
