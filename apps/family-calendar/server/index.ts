import { Hono } from "hono";
import { resolve, join } from "path";
import { existsSync, statSync } from "fs";
import "./db";
import events from "./routes/events";
import members from "./routes/members";
import reminders from "./routes/reminders";

const app = new Hono();

app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/api/events", events);
app.route("/api/members", members);
app.route("/api/reminders", reminders);

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
