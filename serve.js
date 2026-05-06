import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";

const PORT = process.env.PORT || 5000;
const DIST = new URL("./dist/server", import.meta.url).pathname;
const CLIENT = new URL("./dist/client", import.meta.url).pathname;

const MIME = {
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

let workerModule;
async function getWorker() {
  if (!workerModule) {
    workerModule = await import(join(DIST, "index.js"));
  }
  return workerModule.default;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  const staticPath = join(CLIENT, url.pathname);
  if (existsSync(staticPath) && !staticPath.endsWith(CLIENT)) {
    try {
      const data = await readFile(staticPath);
      const ext = extname(staticPath);
      res.writeHead(200, {
        "Content-Type": MIME[ext] || "application/octet-stream",
        "Cache-Control": url.pathname.startsWith("/assets/")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      });
      res.end(data);
      return;
    } catch {}
  }

  try {
    const worker = await getWorker();

    const headers = new Headers();
    for (const [key, val] of Object.entries(req.headers)) {
      if (val != null) {
        headers.set(key, Array.isArray(val) ? val.join(", ") : val);
      }
    }

    let body = undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      body = await new Promise((resolve) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => resolve(Buffer.concat(chunks)));
      });
    }

    const request = new Request(`http://localhost${req.url}`, {
      method: req.method,
      headers,
      body: body && body.length > 0 ? body : undefined,
    });

    const env = {};
    const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };
    const response = await worker.fetch(request, env, ctx);

    const resHeaders = {};
    response.headers.forEach((val, key) => {
      resHeaders[key] = val;
    });

    res.writeHead(response.status, resHeaders);
    const buffer = await response.arrayBuffer();
    res.end(Buffer.from(buffer));
  } catch (err) {
    console.error("Server error:", err);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal Server Error");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
