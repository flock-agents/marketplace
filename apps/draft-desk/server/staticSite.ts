import { resolve } from "path";
import { existsSync } from "fs";
import type { Hono } from "hono";
import { SERVED_DIST } from "./services/servedDist";

// The Hono process serves the SAME build the platform serves to end users (SERVED_DIST — see
// servedDist.ts), so a direct hit on the process and a hit through the platform proxy return an
// identical shell/asset set and an /api/version that matches the loaded bundle. This is what lets
// the process own the shell's cache policy without drifting from what users actually loaded.
const DIST = SERVED_DIST;
const INDEX = resolve(DIST, "index.html");
const VERSION_JSON = resolve(DIST, "version.json");

const IMMUTABLE = "public, max-age=31536000, immutable";

function fileResponse(path: string, cacheControl: string, contentType?: string): Response {
  const file = Bun.file(path);
  const headers: Record<string, string> = { "Cache-Control": cacheControl };
  const type = contentType ?? file.type;
  if (type) headers["Content-Type"] = type;
  return new Response(file, { headers });
}

// Mount static serving. MUST be called AFTER all /api routes so the SPA catch-all never shadows
// an API path. Serving policy:
//   - /assets/*    → content-hashed bundle → cache immutable for a year.
//   - /version.json→ build marker → never cache.
//   - everything else (the shell) → index.html with `no-store`, so a client always boots the
//     CURRENT build's HTML, which references the current hashed bundle. This is what lets mobile
//     users pick up a new deploy without a manual hard-refresh.
export function mountStaticSite(app: Hono): void {
  app.get("/assets/*", (c) => {
    const rel = decodeURIComponent(c.req.path).replace(/^\/+/, "");
    const path = resolve(DIST, rel);
    if (!path.startsWith(DIST + "/") || !existsSync(path)) return c.notFound();
    return fileResponse(path, IMMUTABLE);
  });

  app.get("/version.json", (c) => {
    if (!existsSync(VERSION_JSON)) return c.notFound();
    return fileResponse(VERSION_JSON, "no-store", "application/json");
  });

  app.get("*", (c) => {
    // An unmatched /api path is a real 404 — never fall through to the HTML shell.
    if (c.req.path.startsWith("/api/")) return c.json({ error: "not found" }, 404);
    if (!existsSync(INDEX)) return c.notFound();
    return fileResponse(INDEX, "no-store", "text/html; charset=utf-8");
  });
}
