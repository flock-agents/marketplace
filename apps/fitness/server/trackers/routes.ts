// The dashboard's Sync button: POST /api/trackers/sync-now starts a pass (or joins the one under way); GET it to follow that pass.
// Both also say which trackers are connected, so the page offers Connect instead of a Sync that has nothing to read.
// POST /api/trackers/connect {id} asks the coach to get that tracker connected to it.
import { Hono } from "hono";
import type { SyncNow, SyncStatus } from "./sync-now";
import type { TrackerState } from "./run";
import type { ConnectResult } from "./connect";

export type SyncView = SyncStatus & { trackers: TrackerState[] };

export function trackerRoutes(sync: SyncNow, states: () => Promise<TrackerState[]>, connect: (id: unknown) => Promise<ConnectResult>) {
  const routes = new Hono();
  const view = async (status: SyncStatus): Promise<SyncView> => ({ ...status, trackers: await states() });
  routes.get("/sync-now", async (c) => c.json(await view(sync.status())));
  routes.post("/sync-now", async (c) => c.json(await view(sync.request()), 202));
  routes.post("/connect", async (c) => {
    const body = await c.req.json().catch(() => null) as { id?: unknown } | null;
    const result = await connect(body?.id);
    return "error" in result ? c.json({ error: result.error }, result.status) : c.json(result, 202);
  });
  return routes;
}
