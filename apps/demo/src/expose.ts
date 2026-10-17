/**
 * Puts values on `window` for poking at the demo from devtools, and for the browser tests
 * in `e2e/demo/`, which build the demo in the `e2e` mode. Production builds fold it away.
 */
export function expose(values: Record<string, unknown>): void {
  if (import.meta.env.DEV || import.meta.env.MODE === 'e2e') Object.assign(window, values);
}
