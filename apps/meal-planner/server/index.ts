import { Hono } from "hono";
import { resolve, join } from "path";
import { existsSync, statSync, readFileSync } from "fs";
import "./db";
import meals from "./routes/meals";
import shopping from "./routes/shopping";

const app = new Hono();

app.route("/api/meals", meals);
app.route("/api/shopping", shopping);

const distDir = resolve(import.meta.dir, "../frontend/dist");

app.get("/*", (c) => {
  let filePath = c.req.path === "/" ? "/index.html" : c.req.path;
  const resolved = join(distDir, filePath);
  if (!resolved.startsWith(distDir)) return c.text("Forbidden", 403);
  if (existsSync(resolved) && statSync(resolved).isFile()) {
    return new Response(Bun.file(resolved));
  }
  const fallback = join(distDir, "index.html");
  if (existsSync(fallback)) return new Response(Bun.file(fallback));
  return c.text("Not found", 404);
});

const port = Number(process.env.PORT);
if (!port) {
  console.error("PORT environment variable is required");
  process.exit(1);
}

Bun.serve({ fetch: app.fetch, port });
console.log(`listening on port ${port}`);
