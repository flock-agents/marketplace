// The dashboard's Sync button: POST /api/trackers/sync-now starts a pass (or joins the one under way); GET it to follow that pass.
import { Hono } from "hono";
import type { SyncNow } from "./sync-now";

export function trackerRoutes(sync: SyncNow) {
  const routes = new Hono();
  routes.get("/sync-now", (c) => c.json(sync.status()));
  routes.post("/sync-now", (c) => c.json(sync.request(), 202));
  return routes;
}
