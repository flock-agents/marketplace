import { Hono } from "hono";
import drafts from "./routes/drafts";
import requests from "./routes/requests";
import version from "./routes/version";
import widgets from "./routes/widgets";
import { mountStaticSite } from "./staticSite";

// Entry point: health + route mounting only. No business logic here.
const app = new Hono();

// The UI polls read endpoints (drafts list/detail/count, request status) and must always see
// the latest DB state — a cached GET can serve a just-saved edit's old value and clobber the UI.
// So mark every GET response non-cacheable; mutations are unaffected.
app.use("/api/*", async (c, next) => {
  await next();
  if (c.req.method === "GET") c.header("Cache-Control", "no-store");
});

app.get("/api/health", (c) => c.json({ ok: true, service: "draft-desk" }));

app.route("/api/version", version);
app.route("/api/drafts", drafts);
app.route("/api/requests", requests);
// Declarative dashboard widget data (§7.4) — fetched server-side by the platform's widget proxy.
app.route("/api/widgets", widgets);

// Static build (shell + hashed assets). Registered LAST so the SPA catch-all never shadows /api.
mountStaticSite(app);

const port = Number(process.env.PORT);
if (!port) throw new Error("PORT env var is required");

// Serve explicitly (not `export default {port, fetch}`) so we can emit a stable startup line the
// platform's app-process watches for. `readyPattern:"listening"` in flock.app.json matches this
// exact log — without it the process never signals ready, times out after 30s, and churns
// restarts (which races credential injection). Mirrors the meal-planner/family-calendar convention.
Bun.serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
console.log(`draft-desk listening on port ${port}`);
