type Listener<T> = (payload: T) => void;

/**
 * Typed event emitter. A throwing listener never stops the others or the
 * code that emitted (often the frame loop): its error goes to `onError`.
 */
export class Emitter<Events extends object> {
  #listeners = new Map<keyof Events, Set<Listener<never>>>();

  constructor(private readonly onError: (error: unknown, event: keyof Events) => void) {}

  /** Subscribe; returns an unsubscribe function. */
  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.#listeners.get(event);
    if (!set) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    return () => set.delete(listener as Listener<never>);
  }

  /** Whether anyone listens to `event`. */
  has<K extends keyof Events>(event: K): boolean {
    return (this.#listeners.get(event)?.size ?? 0) > 0;
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.#listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      try {
        (listener as Listener<Events[K]>)(payload);
      } catch (error) {
        this.onError(error, event);
      }
    }
  }

  clear(): void {
    this.#listeners.clear();
  }
}
