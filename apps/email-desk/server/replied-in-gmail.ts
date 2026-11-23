// The person replied in Gmail itself (owner-approved 2026-11-23): open items about that thread close.
//
// Whenever the app reads a thread (the gather of memory-extraction, the follow-up pass, the desk-thread fetch and
// reply_context), the read is shown here. When its newest message is the person's own (from one of the copy's own account
// addresses) and newer than an open item of the thread, that item is done:
//   - the copy's own open draft: its card comes down as replied (no send, no chat line), its record is closed as replied in
//     Gmail (sent_at = the reply's time, sent_by "replied-in-gmail"), and a send hold on the thread (an in_flight ledger row,
//     SEND_UNCONFIRMED) resolves as sent;
//   - the copy's own open follow-up TODO: withdrawn and its row marked `replied`, as the follow-up runner does for others'
//     replies;
//   - Flock is told (`POST /api/apps/:appId/tasks/thread-replied`, the app's own token), so the person's TODOs about the
//     thread close there too. At most once per thread per newest message (app_meta `thread-replied:<account>:<thread>`);
//     a refusal or failure is logged, never fatal.
//
// "Newer than the item": the reply's time (Gmail's minute-precise local time) at or after the item's minute. A message that
// cannot be dated closes no item of the app's own. Never throws: a read that looked is never failed by the look.
import { createTransport, readAppEnv, type PlatformContext, type Result } from "@flock/app-sdk";
import { getStore } from "./store";
import { extractEmailAddress } from "./lib/draft-eligibility";
import { parseGmailDateTime } from "./lib/gmail-date";
import { markDraftRepliedInGmail, openDraftForThread } from "./drafts/records";
import { withdrawDraftCard } from "./drafts/card";
import { followUpRef, getFollowUp, putFollowUp } from "./routines/follow-up-store";

/** What the look needs of the platform: the copy's own accounts, and its board. */
export type RepliedPlatform = { connectors: Pick<PlatformContext["connectors"], "accounts">; tasks?: Pick<PlatformContext["tasks"], "withdraw"> };

export interface RepliedOutcome {
  /** The thread's newest message is the person's own. */
  replied: boolean;
  draftClosed: boolean;
  followUpClosed: boolean;
  holdsResolved: number;
  /** Flock's thread-replied route was called by this look. */
  flockCalled: boolean;
}
const NOTHING: RepliedOutcome = { replied: false, draftClosed: false, followUpClosed: false, holdsResolved: 0, flockCalled: false };

export const REPLIED_IN_GMAIL = "replied-in-gmail";
export const threadRepliedKey = (accountId: string, threadId: string): string => `thread-replied:${accountId}:${threadId}`;

let log: (line: string) => void = (line) => console.warn(line);
/** Tests: capture the look's lines; null restores console.warn. */
export function _setRepliedLogForTesting(fn: ((line: string) => void) | null): void {
  log = fn ?? ((line) => console.warn(line));
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const minuteOf = (ms: number): number => Math.floor(ms / 60_000) * 60_000;

/** Flock's route: the person's TODOs about this thread close (200 `{ closed }`; 400 a missing field, 403 not an Email Desk
 *  copy or not its person's mailbox, 409 the person left). The SDK's transport, with the app's own token; skipped unpaired. */
export async function postThreadReplied(accountId: string, threadId: string): Promise<Result<{ closed: number }>> {
  const env = readAppEnv();
  return createTransport(env).request<{ closed: number }>(
    "POST", `/api/apps/${encodeURIComponent(env.appId)}/tasks/thread-replied`, { accountId, threadId });
}

/** The copy's own addresses (every Gmail account it holds), lower-cased. None when Flock cannot say. */
async function ownAddresses(platform: RepliedPlatform): Promise<Set<string>> {
  try {
    const r = await platform.connectors.accounts?.("gmail");
    if (r?.ok) return new Set((r.data?.accounts ?? []).map((a) => extractEmailAddress(str(a.email))).filter(Boolean));
  } catch { /* none known: nothing is the person's */ }
  return new Set();
}

/**
 * Looks at one read of a thread: when its newest message is the person's own, the thread's open items close (above). `read`
 * is Gmail's answer as it came (`{ messages: [{ from, date, ... }] }`, oldest first). Never throws.
 */
export async function closeIfRepliedInGmail(
  platform: RepliedPlatform, accountId: string, threadId: string, read: unknown, opts: { own?: Iterable<string> } = {},
): Promise<RepliedOutcome> {
  try {
    const messages = Array.isArray((read as { messages?: unknown })?.messages) ? (read as { messages: any[] }).messages : [];
    const newest = messages[messages.length - 1];
    if (!accountId || !threadId || !newest || typeof newest !== "object") return NOTHING;
    const from = extractEmailAddress(str(newest.from));
    if (!from) return NOTHING;
    const own = opts.own ? new Set([...opts.own].map((a) => extractEmailAddress(a)).filter(Boolean)) : await ownAddresses(platform);
    if (!own.has(from)) return NOTHING;

    const out: RepliedOutcome = { ...NOTHING, replied: true };
    const at = parseGmailDateTime(str(newest.date));
    if (at !== null) {
      out.holdsResolved = resolveHolds(accountId, threadId, at);
      out.draftClosed = await closeDraft(platform, accountId, threadId, at);
      out.followUpClosed = await closeFollowUp(platform, accountId, threadId, at);
    }
    out.flockCalled = await tellFlock(accountId, threadId, `${from}|${at ?? str(newest.date)}`);
    return out;
  } catch (e: any) {
    log(`[email-desk] replied-in-Gmail look at ${accountId}/${threadId} threw (${e?.message ?? e}); nothing more closed`);
    return NOTHING;
  }
}

/** A send of this thread in doubt, claimed at or before the reply's minute: the person's message is what went out. */
function resolveHolds(accountId: string, threadId: string, at: number): number {
  const r = getStore().run(
    "UPDATE send_ledger SET state = 'sent', result = ?, updated_at = ? WHERE account_id = ? AND thread_id = ? AND state = 'in_flight' AND created_at < ?",
    [JSON.stringify({ sentAt: new Date(at).toISOString(), by: REPLIED_IN_GMAIL }), Date.now(), accountId, threadId, at + 60_000],
  );
  return r.changes;
}

async function closeDraft(platform: RepliedPlatform, accountId: string, threadId: string, at: number): Promise<boolean> {
  const db = getStore();
  const draft = openDraftForThread(db, accountId, threadId);
  if (!draft || at < minuteOf(draft.updatedAt)) return false;
  markDraftRepliedInGmail(db, draft.id, at);
  if (platform.tasks) await withdrawDraftCard({ tasks: platform.tasks as PlatformContext["tasks"] }, draft.id, "replied");
  log(`[email-desk] ${accountId}/${threadId}: the person replied in Gmail; draft ${draft.id} closed`);
  return true;
}

async function closeFollowUp(platform: RepliedPlatform, accountId: string, threadId: string, at: number): Promise<boolean> {
  const row = getFollowUp(accountId, threadId);
  if (!row || row.status !== "offered" || row.offeredAt === null || at < minuteOf(row.offeredAt)) return false;
  if (platform.tasks) {
    try {
      const r = await platform.tasks.withdraw(followUpRef(threadId), { reason: "replied" });
      if (!r.ok && !r.skipped) {
        log(`[email-desk] follow-up ${accountId}/${threadId}: withdraw failed (${r.message ?? r.reason}); left for the next run`);
        return false;
      }
    } catch (e: any) {
      log(`[email-desk] follow-up ${accountId}/${threadId}: withdraw threw (${e?.message ?? e}); left for the next run`);
      return false;
    }
  }
  putFollowUp({ ...row, status: "replied", checkedAt: Date.now() });
  return true;
}

/** Flock's route, once per thread per newest message (remembered whatever Flock answered). An unpaired copy calls nothing
 *  and remembers nothing, so pairing later still tells Flock. */
async function tellFlock(accountId: string, threadId: string, messageKey: string): Promise<boolean> {
  const db = getStore();
  const key = threadRepliedKey(accountId, threadId);
  const seen = db.query("SELECT value FROM app_meta WHERE key = ?").get(key) as { value: string } | null;
  if (seen?.value === messageKey) return false;
  if (!readAppEnv().configured) return false;
  db.run(
    "INSERT INTO app_meta (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    [key, messageKey, Date.now()],
  );
  try {
    const r = await postThreadReplied(accountId, threadId);
    if (!r.ok && !r.skipped) log(`[email-desk] thread-replied ${accountId}/${threadId}: Flock answered ${r.status ?? ""} (${r.message ?? r.reason})`);
  } catch (e: any) {
    log(`[email-desk] thread-replied ${accountId}/${threadId}: the call threw (${e?.message ?? e})`);
  }
  return true;
}
