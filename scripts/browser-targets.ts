/**
 * Turns a package's `browserslist` entries (`"chrome >= 111"`) into Vite build targets (`"chrome111"`),
 * so the manifest stays the one place the supported browsers are written down.
 */
export function buildTargets(browserslist: readonly string[]): string[] {
  return browserslist.map((query) => {
    const match = /^(\w+) >= ([\d.]+)$/.exec(query.trim());
    if (!match) throw new Error(`Unsupported browserslist query "${query}": use "<browser> >= <version>"`);
    const browser = match[1] === 'ios_saf' ? 'ios' : match[1]!;
    return browser + match[2]!;
  });
}
