/**
 * Playground code in the URL fragment: raw deflate, then base64url, so a
 * link reproduces the code with no server. The fragment never reaches a
 * server. Uses the browser's own compression streams (Node has them too).
 */

/** The fragment key: `#code=<encoded>`. */
const KEY = 'code=';

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  // In slices: spreading a long array into one call overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** `code` compressed and encoded for a URL fragment. */
export async function encodeCode(code: string): Promise<string> {
  return toBase64Url(await pipe(new TextEncoder().encode(code), new CompressionStream('deflate-raw')));
}

/** The code `encodeCode` gave `encoded`. Throws when it is not such a string. */
export async function decodeCode(encoded: string): Promise<string> {
  return new TextDecoder('utf-8', { fatal: true }).decode(await pipe(fromBase64Url(encoded), new DecompressionStream('deflate-raw')));
}

/** The fragment, with its `#`, for encoded code. */
export function codeHash(encoded: string): string {
  return `#${KEY}${encoded}`;
}

/** The encoded code in a fragment (`location.hash`), or null when it holds none. */
export function encodedFromHash(hash: string): string | null {
  const body = hash.replace(/^#/, '');
  return body.startsWith(KEY) && body.length > KEY.length ? body.slice(KEY.length) : null;
}
