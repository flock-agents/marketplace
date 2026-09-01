import { Hono } from "hono";
import * as requests from "../repositories/requestRepository";

// "Fetch-more" request surface. The owner raises a request via POST /api/drafts/request-more;
// the agent reads pending requests here and marks them fulfilled after creating new drafts.
const router = new Hono();

// GET /api/requests?status=pending — the agent reads outstanding fetch-more requests.
router.get("/", (c) => {
  const status = c.req.query("status");
  if (status && status !== "pending") {
    return c.json({ error: "only status=pending is supported" }, 400);
  }
  return c.json(requests.listPendingRequests());
});

// GET /api/requests/:id — poll a single request's status (the UI watches for `fulfilled`).
router.get("/:id", (c) => {
  const found = requests.getRequest(c.req.param("id"));
  if (!found) return c.json({ error: "request not found" }, 404);
  return c.json(found);
});

// POST /api/requests/:id/fulfilled — the agent marks a request done after creating drafts.
router.post("/:id/fulfilled", (c) => {
  const updated = requests.markFulfilled(c.req.param("id"));
  if (!updated) return c.json({ error: "request not found" }, 404);
  return c.json(updated);
});

export default router;
