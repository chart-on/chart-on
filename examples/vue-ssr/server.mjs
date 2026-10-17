// Serves the built example: the page with the server-rendered app, and the client files.
// Build first (`pnpm build`), then run `pnpm start` and open http://localhost:4173.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const client = fileURLToPath(new URL('./dist/client/', import.meta.url));
const types = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.map': 'application/json' };

/** The full page: the built `index.html` with the server-rendered app in it. */
export async function renderPage() {
  const { render } = await import(pathToFileURL(fileURLToPath(new URL('./dist/server/entry-server.js', import.meta.url))).href);
  const template = await readFile(join(client, 'index.html'), 'utf8');
  return template.replace('<!--app-->', await render());
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 4173);
  createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    try {
      // Read before writing the head, so a missing file can still answer 404.
      if (path === '/' || path === '\\') {
        const page = await renderPage();
        res.writeHead(200, { 'content-type': 'text/html' }).end(page);
      } else {
        const file = join(client, path);
        if (!file.startsWith(client)) throw new Error('outside the client folder');
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(body);
      }
    } catch {
      res.writeHead(404).end('Not found');
    }
  }).listen(port, () => console.log(`http://localhost:${port}`));
}
