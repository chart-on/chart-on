/** Items moved per `unshift` call; spreading more arguments than this risks the engine's argument limit. */
const CHUNK = 8192;

/**
 * Replace the first `removed` items of `target` with `items`, in place: the
 * array keeps its identity and nothing of its length is allocated. The rest
 * of the array moves once per chunk of `CHUNK` new items.
 */
export function replaceFront<T>(target: T[], removed: number, items: readonly T[]): void {
  const extra = items.length - removed;
  if (extra < 0) target.splice(0, -extra);
  const kept = Math.min(removed, items.length);
  const start = Math.max(extra, 0);
  for (let j = 0; j < kept; j++) target[j] = items[start + j]!;
  for (let end = start; end > 0; end -= CHUNK) target.unshift(...items.slice(Math.max(0, end - CHUNK), end));
}
