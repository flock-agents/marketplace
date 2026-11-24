// A send whose outcome is unknown blocks any redraft on its thread (ruling R33; Review Focus 1).
//
// send_draft claims the ledger (in_flight) before Gmail's sendDraft and keeps it in_flight whenever the outcome is not
// known (drafts/send.ts, rulings R30-R32). If that send really went out, Gmail no longer holds the draft, and an agent's
// create_draft / update_draft would read the draft as gone, drop the row and the Check Sent card, and write a new draft
// whose press would send a second reply. So while the thread has an in_flight ledger row (whatever draft it was, the row
// gone or not), create_draft and update_draft write nothing and answer SEND_UNCONFIRMED, unless one Gmail re-read settles
// it; an agent's discard_draft is refused the same way (no re-read); the person's own discard releases the hold (R34):
//   - SENT: the thread holds a message from the person's own address, dated at or after the ledger row was claimed, whose
//     text is the one sent (kept in the ledger row at the claim, else the draft row; whitespace and quote styles aside;
//     Gmail's quoted history after it allowed). The ledger says sent, the row (while there) gets its sent stamp, the card
//     is withdrawn, and the caller refuses as already sent.
//   - UNSENT: the read worked, no such message is there, AND Gmail's draft still holds the very text that was being sent
//     (getDraft's body, compared as above; other text may be a new draft the person began after a real send). The
//     in_flight row is cleared, and drafting goes on as for any open draft. A row with no known text is never unsent.
//   - anything else (no read turn, the mailbox busy, a failed read, the person's own address unknown, a matching message
//     whose date does not read, the draft not shown): unknown, SEND_UNCONFIRMED, nothing changed.
// One attempt per call, under the mailbox's read turn ("email-desk:send-check"), as reply_context reads. send_draft itself
// runs the same re-read on the person's press (settleForPress, R34): it sends only when the read shows nothing went out.
import type { PlatformContext } from "@flock/app-sdk";
import { getStore } from "../store";
import { extractEmailAddress } from "../lib/draft-eligibility";
import { parseGmailDateTime } from "../lib/gmail-date";
import type { ReadTurnResult } from "../platform-ext";
import { sendUnconfirmedRefusal, sentRefusal, type DraftRefusal } from "./rules";
import { getDraft } from "./records";
import { DRAFT_SOURCE_PREFIX, withdrawDraftCard } from "./card";
import { recordSent } from "./send";

export const SEND_CHECK_CONSUMER = "email-desk:send-check";
/** One read's timeout (reply-context READ_TIMEOUT_MS). */
const READ_TIMEOUT_MS = 90_000;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** A send of this thread whose outcome is unknown: its ledger row, and the text it sent when known (the claim keeps it in
 *  the row's result; else the draft row, while it is still there). */
interface PendingSend {
  key: string;
  /** The app's draft id (`draft:<id>` keys), "" for an imported key. */
  id: string;
  accountId: string;
  threadId: string;
  gmailDraftId: string;
  body: string | null;
  since: number;
}

function pendingSends(accountId: string, threadId: string): PendingSend[] {
  const db = getStore();
  const rows = db.query(
    "SELECT idempotency_key, draft_id, result, created_at FROM send_ledger WHERE account_id = ? AND thread_id = ? AND state = 'in_flight'",
  ).all(accountId, threadId) as Array<{ idempotency_key: string; draft_id: string | null; result: string | null; created_at: number }>;
  return rows.map((r) => {
    const id = r.idempotency_key.startsWith(DRAFT_SOURCE_PREFIX) ? r.idempotency_key.slice(DRAFT_SOURCE_PREFIX.length) : "";
    let body: string | null = null;
    try { const b = JSON.parse(r.result ?? "")?.body; if (typeof b === "string" && b.trim()) body = b; } catch { /* below */ }
    if (body === null && id) body = getDraft(db, id)?.bodyWritten ?? null;
    return { key: r.idempotency_key, id, accountId, threadId, gmailDraftId: r.draft_id ?? "", body, since: r.created_at };
  });
}

/** Is a send of this thread in doubt (an in_flight ledger row, whatever draft it was)? No Gmail read. */
export function threadSendInDoubt(accountId: string, threadId: string): boolean {
  return !!getStore().query("SELECT 1 FROM send_ledger WHERE account_id = ? AND thread_id = ? AND state = 'in_flight' LIMIT 1")
    .get(accountId, threadId);
}

/**
 * Before create_draft or update_draft writes on a thread (inside the thread's turn): null when no send on the thread is
 * in doubt, or when the re-read proved each did not go out (their in_flight rows are cleared). Otherwise the refusal to
 * answer: SENT when the re-read proved one went (recorded, its card withdrawn), else SEND_UNCONFIRMED. The thread is the
 * key, not the open draft: an in_flight row holds even when its draft row is gone (until the person's own discard releases it, R34).
 */
export async function settleUnconfirmedSend(platform: PlatformContext, accountId: string, threadId: string): Promise<DraftRefusal | null> {
  const r = await settlePending(platform, accountId, threadId);
  if (r.sent) return sentRefusal();
  return r.unknown ? sendUnconfirmedRefusal() : null;
}

/** What one re-read of the thread's in_flight sends found: any proven sent (and when the pressed draft's own was), any
 *  unknown. Proven-unsent rows are cleared, proven-sent ones recorded and their cards withdrawn. */
async function settlePending(
  platform: PlatformContext, accountId: string, threadId: string, ownKey = "", ownGmailDraftId = "",
): Promise<{ sent: boolean; ownSentAt: number | null; unknown: boolean }> {
  const out = { sent: false, ownSentAt: null as number | null, unknown: false };
  for (const p of pendingSends(accountId, threadId)) {
    const seen = await reread(platform, p);
    if (seen.kind === "sent") {
      markSent(p, seen.at);
      if (p.id) await withdrawDraftCard(platform, p.id);
      out.sent = true;
      if (p.key === ownKey || (!!ownGmailDraftId && p.gmailDraftId === ownGmailDraftId)) out.ownSentAt = seen.at;
    } else if (seen.kind === "unsent") {
      getStore().run("DELETE FROM send_ledger WHERE idempotency_key = ? AND state = 'in_flight'", [p.key]);
    } else {
      out.unknown = true;
    }
  }
  return out;
}

/**
 * The person's press of Send on a thread with a send in doubt (ruling R34, R35): one re-read of the thread first, whatever
 * row holds it (the draft's own key or an imported one). `own`: this draft's own send is proven sent (recorded, card
 * withdrawn). `other`: another send of the thread is. `clear`: the read worked and no send went out (the holds are
 * cleared), so the press may send. `unknown`: anything else, the press sends nothing.
 */
export async function settleForPress(
  platform: PlatformContext, accountId: string, threadId: string, ownKey: string, ownGmailDraftId = "",
): Promise<{ kind: "own"; at: number } | { kind: "other" } | { kind: "clear" } | { kind: "unknown" }> {
  const r = await settlePending(platform, accountId, threadId, ownKey, ownGmailDraftId);
  if (r.ownSentAt !== null) return { kind: "own", at: r.ownSentAt };
  if (r.sent) return { kind: "other" };
  return r.unknown ? { kind: "unknown" } : { kind: "clear" };
}

/** The person's own discard of the draft releases the thread's hold (ruling R34): its in_flight rows are deleted, so a
 *  later create_draft is allowed. The agent's discard never reaches this. */
export function releaseThreadHold(accountId: string, threadId: string): void {
  getStore().run("DELETE FROM send_ledger WHERE account_id = ? AND thread_id = ? AND state = 'in_flight'", [accountId, threadId]);
}

/** The ledger says sent (when Gmail shows it went), and the draft row, while it is still there, has its sent stamp. */
function markSent(p: PendingSend, at: number): void {
  const db = getStore();
  const draft = p.id ? getDraft(db, p.id) : null;
  if (draft) { recordSent(draft, p.key, at); return; }
  db.run("UPDATE send_ledger SET state = 'sent', result = ?, updated_at = ? WHERE idempotency_key = ?",
    [JSON.stringify({ sentAt: new Date(at).toISOString() }), Date.now(), p.key]);
}

type Seen = { kind: "sent"; at: number } | { kind: "unsent" } | { kind: "unknown" };
const UNKNOWN: Seen = { kind: "unknown" };

async function reread(platform: PlatformContext, draft: PendingSend): Promise<Seen> {
  // Without the text that was sent, no message can be told to be it, nor shown not to be there.
  if (draft.body === null || !draft.gmailDraftId) return UNKNOWN;
  const sentText = draft.body;
  const since = draft.since;
  if (!platform.connectors.readTurn) return UNKNOWN;
  const own = await ownAddress(platform, draft.accountId);
  if (!own) return UNKNOWN;
  let turn: ReadTurnResult;
  try {
    turn = await platform.connectors.readTurn(draft.accountId, SEND_CHECK_CONSUMER, { skillId: "gmail" });
  } catch { return UNKNOWN; }
  if (!turn.ok) return UNKNOWN;
  try {
    const read = async (functionName: string, params: Record<string, unknown>): Promise<any> => {
      const r = await platform.connectors.exec<unknown>({
        skillId: "gmail", functionName, params, accountHint: draft.accountId, timeoutMs: READ_TIMEOUT_MS, turnId: turn.data.turnId,
      });
      if (!r.ok) return null;
      return typeof r.data === "string" ? safeParse(r.data) : r.data;
    };
    // bypassCache: a cached read from before the send would hide the reply it sent (routines/follow-up.ts reads the same way).
    const thread = await read("getThread", { threadId: draft.threadId, bypassCache: true });
    if (!thread || !Array.isArray(thread.messages)) return UNKNOWN;
    // Gmail's dates name the minute, in the mailbox's local time: a reply sent in the minute the send was claimed counts.
    const from = Math.floor(since / 60_000) * 60_000;
    let undated = false;
    for (const m of thread.messages) {
      if (extractEmailAddress(str(m?.from)) !== own) continue;
      if (!sameSentText(sentText, str(m?.bodyMain) || str(m?.body))) continue;
      const at = parseGmailDateTime(str(m?.date));
      if (at === null) { undated = true; continue; }
      if (at >= from) return { kind: "sent", at };
    }
    if (undated) return UNKNOWN;
    // getDraft shows whatever compose is open on the thread, so a new draft the person began after a real send would read
    // as "still there". Unsent only when Gmail still holds the very text that was being sent.
    const held = await read("getDraft", { draftId: draft.gmailDraftId });
    return held && typeof held.body === "string" && sameSentText(sentText, held.body) ? { kind: "unsent" } : UNKNOWN;
  } catch {
    return UNKNOWN;
  } finally {
    try { await turn.data.release(); } catch { /* released by its ttl otherwise */ }
  }
}

/** The person's own address for the mailbox (lower-cased), "" when it cannot be known. */
async function ownAddress(platform: PlatformContext, accountId: string): Promise<string> {
  try {
    const r = await platform.connectors.accounts?.("gmail");
    if (r?.ok) return extractEmailAddress(str((r.data?.accounts ?? []).find((a) => a.accountId === accountId)?.email)) || "";
  } catch { /* unknown below */ }
  return "";
}

const safeParse = (s: string): unknown => { try { return JSON.parse(s); } catch { return null; } };

/** The text as compared: line endings, curly quotes and runs of whitespace (non-breaking spaces too) made one. */
function normalizeSentText(text: string): string {
  return text
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

/** A message is the draft sent when its text is the draft's, alone or followed by what Gmail adds after it (the quoted
 *  history, a signature). */
export function sameSentText(draftBody: string, messageText: string): boolean {
  const d = normalizeSentText(draftBody);
  const m = normalizeSentText(messageText);
  if (!d || !m) return false;
  return m === d || m.startsWith(`${d} `);
}
