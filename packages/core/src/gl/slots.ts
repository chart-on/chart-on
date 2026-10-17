/**
 * CPU-side storage of fixed-size items for a GPU buffer, `stride` bytes each.
 * Item `i` lives in storage slot `head + i`. The storage keeps headroom at
 * both ends, so items added at either end are written (and uploaded) on their
 * own while the rest stay in place.
 */
export class Slots {
  count = 0;
  /** Changed items since the last GPU sync: [dirtyFrom, dirtyTo). Clean when dirtyFrom is Infinity. */
  dirtyFrom = Infinity;
  dirtyTo = 0;
  /** Driver-side handle; owned by GLRenderer. */
  gpu: unknown = null;

  protected f32 = new Float32Array(0);
  protected u8 = new Uint8Array(0);
  #first = 0;

  constructor(readonly stride: number) {}

  /** The `count` items. */
  get bytes(): Uint8Array {
    return this.u8.subarray(this.#first * this.stride, (this.#first + this.count) * this.stride);
  }

  /** The whole storage, headroom included; item `i` starts at byte `(head + i) * stride`. */
  get storage(): Uint8Array {
    return this.u8;
  }

  /** Storage slot of item 0. */
  get head(): number {
    return this.#first;
  }

  /** Storage size in items, headroom included. */
  get capacity(): number {
    return this.u8.byteLength / this.stride;
  }

  /** Set the item count, growing storage geometrically; keeps existing data and the front headroom. */
  resize(count: number): void {
    if (this.#first + count > this.capacity) this.#realloc(this.#first, Math.max(this.#first + count, Math.ceil(this.capacity * 1.5), 256));
    this.count = count;
  }

  /**
   * Add `n` items in front of item 0 (negative `n` drops that many from the
   * front). Existing items keep their storage slot and bytes; their numbers
   * grow by `n`. The new ones are written by the caller.
   */
  growFront(n: number): void {
    if (n === 0) return;
    if (n < 0) {
      const drop = Math.min(-n, this.count);
      this.#first += drop;
      this.count -= drop;
      this.dirtyFrom = Math.max(0, this.dirtyFrom - drop);
      this.dirtyTo = Math.max(0, this.dirtyTo - drop);
      return;
    }
    if (n > this.#first) {
      // Room for this page and half as much again, so a run of prepends reallocates geometrically.
      const room = n + Math.max(Math.ceil(this.count * 0.5), 256);
      this.#realloc(room, Math.max(this.capacity - this.#first - this.count, 0) + room + this.count);
    }
    this.#first -= n;
    this.count += n;
    this.dirtyFrom += n;
    this.dirtyTo += n;
  }

  /** Move items to a new storage of `slots` items, item 0 at slot `first`. */
  #realloc(first: number, slots: number): void {
    const u8 = new Uint8Array(slots * this.stride);
    u8.set(this.bytes, first * this.stride);
    this.f32 = new Float32Array(u8.buffer);
    this.u8 = u8;
    this.#first = first;
    this.markAllDirty();
  }

  markAllDirty(): void {
    this.dirtyFrom = 0;
    this.dirtyTo = Infinity;
  }

  /** The GPU copy is up to date. */
  markClean(): void {
    this.dirtyFrom = Infinity;
    this.dirtyTo = 0;
  }
}
