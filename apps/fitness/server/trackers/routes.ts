// The dashboard's Sync button: POST /api/trackers/sync-now starts a pass (or joins the one under way); GET it to follow that pass.
// Both also say which trackers are connected, so the page offers Connect instead of a Sync that has nothing to read.
import { Hono } from "hono";
import type { SyncNow, SyncStatus } from "./sync-now";
import type { TrackerState } from "./run";

export type SyncView = SyncStatus & { trackers: TrackerState[] };

export function trackerRoutes(sync: SyncNow, states: () => Promise<TrackerState[]>) {
  const routes = new Hono();
  const view = async (status: SyncStatus): Promise<SyncView> => ({ ...status, trackers: await states() });
  routes.get("/sync-now", async (c) => c.json(await view(sync.status())));
  routes.post("/sync-now", async (c) => c.json(await view(sync.request()), 202));
  return routes;
}
