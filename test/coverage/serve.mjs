// Tiny static file server for the browser-coverage harness. Serves the
// project root (same thing `python3 -m http.server` / `npx serve` would do
// for a normal user per CLAUDE.md hard rule #5) on an ephemeral port so
// Playwright can navigate to the real, unmodified index.html.
//
// Dependency-free (Node's http + fs only) — mirrors the "no build step"
// spirit CLAUDE.md applies to the app itself: this dev-only test tool
// shouldn't need its own bundler or web-server package either.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/**
 * Starts a static server rooted at PROJECT_ROOT on an ephemeral port.
 * Returns { url, close } — `url` is the http://127.0.0.1:<port>/ base,
 * `close()` shuts the server down (call in a finally block).
 */
export function startServer() {
  const server = http.createServer((req, res) => {
    try {
      const requestUrl = new URL(req.url, "http://localhost");
      let pathname = decodeURIComponent(requestUrl.pathname);
      if (pathname === "/") pathname = "/index.html";

      // Guard against path traversal escaping PROJECT_ROOT — this server
      // only ever needs to be reachable from the local Playwright browser,
      // but there's no reason to trust the request path regardless.
      const filePath = path.normalize(path.join(PROJECT_ROOT, pathname));
      if (!filePath.startsWith(PROJECT_ROOT)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not found: " + pathname);
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, {
          "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
        });
        res.end(data);
      });
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Server error: " + err.message);
    }
  });

  return new Promise((resolve) => {
    // Port 0 = let the OS assign an ephemeral free port, so this harness
    // never collides with a real `start.command` dev server on 8000-8010.
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise((res) => server.close(res)),
      });
    });
  });
}
