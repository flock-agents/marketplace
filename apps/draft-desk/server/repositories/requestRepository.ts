import { db } from "../db";
import type { DraftRequest } from "../../shared/types";
import { id } from "./ids";

// All SQL for "fetch-more" draft requests lives here. Routes never touch the db directly.

export function createRequest(): DraftRequest {
  const now = Date.now();
  const reqId = id("req");
  db.query(
    `INSERT INTO draft_requests (id, status, requested_at, fulfilled_at)
     VALUES (?, 'pending', ?, NULL)`,
  ).run(reqId, now);
  return getRequest(reqId)!;
}

export function getRequest(reqId: string): DraftRequest | null {
  return (
    (db.query(`SELECT * FROM draft_requests WHERE id = ?`).get(reqId) as DraftRequest) ?? null
  );
}

export function listPendingRequests(): DraftRequest[] {
  return db
    .query(`SELECT * FROM draft_requests WHERE status = 'pending' ORDER BY requested_at ASC`)
    .all() as DraftRequest[];
}

// Auto-fulfill any pending request older than `cutoff` (a ms timestamp) so a hung or
// dead agent run that never called /fulfilled can't leave a request pending forever.
// Returns how many were expired. Fulfilled is used (not a new status) so these rows
// simply drop out of listPendingRequests without needing a schema/type change.
export function expireStalePending(cutoff: number): number {
  const now = Date.now();
  const res = db
    .query(
      `UPDATE draft_requests SET status = 'fulfilled', fulfilled_at = ?
       WHERE status = 'pending' AND requested_at <= ?`,
    )
    .run(now, cutoff);
  return res.changes;
}

export function markFulfilled(reqId: string): DraftRequest | null {
  const existing = getRequest(reqId);
  if (!existing) return null;
  const now = Date.now();
  db.query(
    `UPDATE draft_requests SET status = 'fulfilled', fulfilled_at = ? WHERE id = ?`,
  ).run(now, reqId);
  return getRequest(reqId);
}
