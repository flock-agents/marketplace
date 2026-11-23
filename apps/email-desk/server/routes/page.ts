// The app's own page (src/App.tsx, built by `bun run app:build` into dist/): its settings, the person's mailboxes, voice and
// "Delete my mail data". `GET /` is the page and `GET /assets/*` its built files, read from dist/. The page holds no data:
// what it shows comes from /api/voice, which only the person reaches (routes/voice.ts person()). Flock's install asks the
// root for a 200 HTML page before it opens the app (app-install.ts requirePage), so `/` answers without a person too.
import { Hono, type Context } from "hono";
import { existsSync, readFileSync, statSync } from "fs";
import { extname, join, resolve, sep } from "path";

export const DIST_DIR = resolve(import.meta.dir, "../../dist");

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".json": "application/json", ".map": "application/json",
};

export function pageRoutes(dist: string = DIST_DIR): Hono {
  const app = new Hono();

  const index = (c: Context) => {
    const file = join(dist, "index.html");
    if (!existsSync(file)) return c.text("Email Desk's page is not built yet.", 503);
    return c.html(readFileSync(file, "utf-8"));
  };
  app.get("/", index);
  app.get("/index.html", index);

  app.get("/assets/*", (c) => {
    const root = resolve(dist, "assets");
    const file = resolve(dist, c.req.path.replace(/^\/+/, ""));
    // Only a file inside dist/assets: never a path that climbs out of it.
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) return c.notFound();
    const body = readFileSync(file);
    return new Response(body, {
      headers: {
        "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
        // Vite names each built file by its content, so a file at one name never changes.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  });

  return app;
}
