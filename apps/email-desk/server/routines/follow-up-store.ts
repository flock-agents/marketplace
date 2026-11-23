// The follow-up routine's rows in the app's own store (follow_up_state, follow_up_runs): ported from Flock's built-in
// desk's follow-up-store.ts, reading `getStore()` where it read the platform's db.
import { getStore } from "../store";
import type { FollowUpStatus } from "../lib/follow-up-rules";

export interface FollowUpRow {
  accountId: string; threadId: string; ownerMsgKey: string; status: FollowUpStatus; checkedAt: number;
  /** When the TODO was raised: the daily limit reads it. */
  offeredAt: number | null;
  /** First name for the TODO's title, from the runner's own read of the thread. */
  recipientName: string | null;
}
/** A write. The offer fields are optional; omitted or null, the stored values are kept. */
export type FollowUpInput = Omit<FollowUpRow, "offeredAt" | "recipientName"> & Partial<Pick<FollowUpRow, "offeredAt" | "recipientName">>;

/** A thread's follow-up TODO on Flock's board: one per thread, so a repeat is the same TODO. */
export const followUpRef = (threadId: string): string => `follow-up:${threadId}`;

const toRow = (r: any): FollowUpRow => ({
  accountId: r.account_id, threadId: r.thread_id, ownerMsgKey: r.owner_msg_key, status: r.status, checkedAt: r.checked_at,
  offeredAt: r.offered_at ?? null, recipientName: r.recipient_name ?? null,
});

export function getFollowUp(accountId: string, threadId: string): FollowUpRow | null {
  const r = getStore().query("SELECT * FROM follow_up_state WHERE account_id = ? AND thread_id = ?").get(accountId, threadId);
  return r ? toRow(r) : null;
}
export function putFollowUp(row: FollowUpInput): void {
  getStore().run(
    `INSERT INTO follow_up_state (account_id, thread_id, owner_msg_key, status, checked_at, draft_id, session_id, offered_at, recipient_name)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)
     ON CONFLICT(account_id, thread_id) DO UPDATE SET owner_msg_key = excluded.owner_msg_key, status = excluded.status,
       checked_at = excluded.checked_at,
       offered_at = COALESCE(excluded.offered_at, follow_up_state.offered_at),
       recipient_name = COALESCE(excluded.recipient_name, follow_up_state.recipient_name)`,
    [row.accountId, row.threadId, row.ownerMsgKey, row.status, row.checkedAt, row.offeredAt ?? null, row.recipientName ?? null],
  );
}
export function listFollowUps(accountId: string, statuses: FollowUpStatus[]): FollowUpRow[] {
  if (statuses.length === 0) return [];
  const qs = statuses.map(() => "?").join(",");
  return getStore().query(`SELECT * FROM follow_up_state WHERE account_id = ? AND status IN (${qs})`).all(accountId, ...statuses).map(toRow);
}
/** Rows whose TODO was raised at or after `sinceMs` (any status now): the daily limit counts them. */
export function listFollowUpsOfferedSince(accountId: string, sinceMs: number): FollowUpRow[] {
  return getStore().query("SELECT * FROM follow_up_state WHERE account_id = ? AND offered_at IS NOT NULL AND offered_at >= ?").all(accountId, sinceMs).map(toRow);
}
export function lastFollowUpRunAt(accountId: string): number | null {
  const r = getStore().query("SELECT last_run_at FROM follow_up_runs WHERE account_id = ?").get(accountId) as { last_run_at: number } | null;
  return r ? r.last_run_at : null;
}
export function recordFollowUpRun(accountId: string, at: number): void {
  getStore().run("INSERT INTO follow_up_runs (account_id, last_run_at) VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET last_run_at = excluded.last_run_at", [accountId, at]);
}
