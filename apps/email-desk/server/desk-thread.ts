// Which of this person's mailboxes a thread is in, for the drafting ops (reply_context, create_draft).
//
// The journal answers first: a thread the routines gathered is known with no Gmail call. A thread it does not hold (older
// than the first read's window, or mail the routine skipped) is still the person's own when they ask about it: the op
// reads it from Gmail on demand, under the mailbox's read turn and as one of THIS copy's own accounts, keeps it in the
// journal like a gathered thread, and goes on with the usual draft rules. Only a thread Gmail does not have, or one named
// under an account this copy does not hold, is refused. No other account is ever asked.
import type { PlatformContext } from "@flock/app-sdk";
import { getStore } from "./store";
import { appendEvents, GMAIL_SOURCE, normalizeInboxRow, setEventBody } from "./journal";
import { extractEmailAddress } from "./lib/draft-eligibility";
import { threadText } from "./routines/gather";
import { gmailRefusal, notInMailboxRefusal, type DraftRefusal } from "./drafts/rules";
import type { ReadTurnResult } from "./platform-ext";

/** One thread read's timeout (gather's THREAD_TIMEOUT_MS): a read, not the write budget of a draft. */
const READ_TIMEOUT_MS = 90_000;
export const REPLY_CONTEXT_CONSUMER = "email-desk:reply-context";

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const safeParse = (s: string): unknown => { try { return JSON.parse(s); } catch { return null; } };

/** The account this copy read the thread in: the journal holds a row of it (in `accountId`'s mailbox, when named). */
export function deskThreadAccount(threadId: string, accountId: string): string | null {
  if (!threadId) return null;
  const db = getStore();
  const row = (accountId
    ? db.query("SELECT account_id FROM ingest_events WHERE thread_key = ? AND account_id = ? LIMIT 1").get(threadId, accountId)
    : db.query("SELECT account_id FROM ingest_events WHERE thread_key = ? ORDER BY ts DESC LIMIT 1").get(threadId)) as { account_id: string } | null;
  return row?.account_id ?? null;
}

export type ThreadRead =
  | { status: "found"; read: any }
  | { status: "missing" }
  | { status: "failed"; reason: string };

const hasMessages = (read: any): boolean =>
  !!read && typeof read === "object" && Array.isArray(read.messages) && read.messages.length > 0;

/** Gmail's getThread under the mailbox's read turn, released on every path. "missing": Gmail answered and has no such
 *  thread (no messages, or its own not-found code). "failed": the turn was refused or the read failed. */
export async function readThreadInTurn(platform: PlatformContext, accountId: string, threadId: string): Promise<ThreadRead> {
  if (!platform.connectors.readTurn) return { status: "failed", reason: "this Flock has no read turns" };
  let turn: ReadTurnResult;
  try {
    turn = await platform.connectors.readTurn(accountId, REPLY_CONTEXT_CONSUMER, { skillId: "gmail" });
  } catch (e: any) { return { status: "failed", reason: String(e?.message ?? e) }; }
  if (!turn.ok) return { status: "failed", reason: turn.reason || "the mailbox is busy" };
  try {
    const r = await platform.connectors.exec<unknown>({
      skillId: "gmail", functionName: "getThread", params: { threadId }, accountHint: accountId,
      timeoutMs: READ_TIMEOUT_MS, turnId: turn.data.turnId,
    });
    if (!r.ok) {
      if (/NOT_FOUND/i.test(String((r as { code?: unknown }).code ?? ""))) return { status: "missing" };
      return { status: "failed", reason: (r as { message?: string }).message ?? r.reason };
    }
    const read: any = typeof r.data === "string" ? safeParse(r.data) : r.data;
    return hasMessages(read) ? { status: "found", read } : { status: "missing" };
  } catch (e: any) {
    return { status: "failed", reason: String(e?.message ?? e) };
  } finally {
    try { await turn.data.release(); } catch { /* released by its ttl otherwise */ }
  }
}

/** This copy's own Gmail accounts (the person's), with their addresses. None when Flock cannot say: fails closed. */
async function copyAccounts(platform: PlatformContext): Promise<Array<{ accountId: string; email: string }>> {
  try {
    const r = await platform.connectors.accounts?.("gmail");
    if (r?.ok) return (r.data?.accounts ?? []).map((a) => ({ accountId: a.accountId, email: a.email ?? "" }));
  } catch { /* none known */ }
  return [];
}

/** Keeps an on-demand read in the journal like a gathered thread: one row for its newest message from someone other than
 *  the mailbox (else its newest), with the thread's text parked on it. */
function keepThread(accountId: string, threadId: string, read: any, mailbox: string): void {
  const messages: any[] = read.messages;
  const own = extractEmailAddress(mailbox);
  const theirs = [...messages].reverse().find((m) => own && extractEmailAddress(str(m?.from)) !== own) ?? messages[messages.length - 1];
  const body = str(theirs?.body);
  const row = normalizeInboxRow({
    id: threadId, from: str(theirs?.from), subject: str(read.subject), snippet: body.slice(0, 200), dateFull: str(theirs?.date),
  }, accountId);
  const db = getStore();
  appendEvents(db, accountId, [row]);
  const text = threadText(read);
  if (text) setEventBody(db, { sourceId: GMAIL_SOURCE, accountId, eventId: row.eventId }, text);
}

/**
 * The mailbox a drafting op works the thread in, or its refusal. `read`: Gmail's read when this call had to fetch the
 * thread (so the caller need not read it again).
 */
export async function resolveDeskThread(
  platform: PlatformContext, threadId: string, accountId: string,
): Promise<{ accountId: string; read?: unknown } | DraftRefusal> {
  if (!threadId) return notInMailboxRefusal();
  const known = deskThreadAccount(threadId, accountId);
  if (known) return { accountId: known };

  const accounts = await copyAccounts(platform);
  const candidates = accountId ? accounts.filter((a) => a.accountId === accountId) : accounts;
  let failed: string | null = null;
  for (const a of candidates) {
    const got = await readThreadInTurn(platform, a.accountId, threadId);
    if (got.status === "found") {
      keepThread(a.accountId, threadId, got.read, a.email);
      return { accountId: a.accountId, read: got.read };
    }
    if (got.status === "failed") failed ??= got.reason;
  }
  return failed ? gmailRefusal("read this email thread", failed) : notInMailboxRefusal();
}
