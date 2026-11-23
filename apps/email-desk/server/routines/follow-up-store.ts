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
  /** The follow-up draft the agent made for an "always" rule (status `drafted`). */
  draftId: string | null;
}
/** A write. The offer fields are optional; omitted or null, the stored values are kept. */
export type FollowUpInput = Omit<FollowUpRow, "offeredAt" | "recipientName" | "draftId"> & Partial<Pick<FollowUpRow, "offeredAt" | "recipientName">>;

/** A thread's follow-up TODO on Flock's board: one per thread, so a repeat is the same TODO. */
export const followUpRef = (threadId: string): string => `follow-up:${threadId}`;

const toRow = (r: any): FollowUpRow => ({
  accountId: r.account_id, threadId: r.thread_id, ownerMsgKey: r.owner_msg_key, status: r.status, checkedAt: r.checked_at,
  offeredAt: r.offered_at ?? null, recipientName: r.recipient_name ?? null, draftId: r.draft_id ?? null,
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

// ---- an "always follow up" rule's draft (owner decision 2026-11-23) ------------------------------------------------------
// The routine wakes the agent to write the follow-up (status `drafting`, with the TODO it raises if no draft comes); the
// agent's create_draft in that routine's run marks it `drafted` with the draft's id, and the draft's card says it is a
// follow-up, so the person's rule sends it.

/** What the TODO needs if the draft never comes. */
export interface FollowUpFallback { subject: string; to: string[]; sentAt: number }

/** The agent was woken for this thread: no TODO now, the fallback kept. `waitFrom`: when its time to draft starts (now,
 *  or the end of a usage hold). */
export function markFollowUpDrafting(row: Omit<FollowUpInput, "status" | "checkedAt">, waitFrom: number, fallback: FollowUpFallback): void {
  putFollowUp({ ...row, status: "drafting", checkedAt: waitFrom });
  getStore().run("UPDATE follow_up_state SET fallback = ?, draft_id = NULL WHERE account_id = ? AND thread_id = ?",
    [JSON.stringify(fallback), row.accountId, row.threadId]);
}

/** Is the routine waiting on the agent's follow-up draft for this thread? */
export function followUpAwaitingDraft(accountId: string, threadId: string): boolean {
  return getFollowUp(accountId, threadId)?.status === "drafting";
}

/** The agent made the follow-up draft: the row is done waiting. */
export function markFollowUpDrafted(accountId: string, threadId: string, draftId: string): void {
  getStore().run("UPDATE follow_up_state SET status = 'drafted', draft_id = ? WHERE account_id = ? AND thread_id = ? AND status = 'drafting'",
    [draftId, accountId, threadId]);
}

/** Rows still waiting on a draft, with their fallback. */
export function listAwaitingDrafts(accountId: string): Array<FollowUpRow & { fallback: FollowUpFallback | null }> {
  return (getStore().query("SELECT * FROM follow_up_state WHERE account_id = ? AND status = 'drafting'").all(accountId) as any[]).map((r) => {
    let fallback: FollowUpFallback | null = null;
    try { fallback = r.fallback ? JSON.parse(r.fallback) : null; } catch { fallback = null; }
    return { ...toRow(r), fallback };
  });
}
