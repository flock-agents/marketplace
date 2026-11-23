// A send whose outcome is unknown blocks any redraft on its thread (ruling R33; Review Focus 1).
//
// send_draft claims the ledger (in_flight) before Gmail's sendDraft and keeps it in_flight whenever the outcome is not
// known (drafts/send.ts, rulings R30-R32). If that send really went out, Gmail no longer holds the draft, and an agent's
// create_draft / update_draft would read the draft as gone, drop the row and the Check Sent card, and write a new draft
// whose press would send a second reply. So while the thread's open draft has an in_flight ledger row, create_draft and
// update_draft write nothing and answer SEND_UNCONFIRMED, unless one Gmail re-read settles it:
//   - SENT: the thread holds a message from the person's own address, dated at or after the ledger row was claimed, whose
//     text is the draft's (whitespace and quote styles aside; Gmail's quoted history after it allowed). The ledger says
//     sent, the row gets its sent stamp, the card is withdrawn, and the caller refuses as already sent.
//   - UNSENT: the read worked, no such message is there, AND Gmail still holds the draft (getDraft gives its body). The
//     in_flight row is cleared, and drafting goes on as for any open draft.
//   - anything else (no read turn, the mailbox busy, a failed read, the person's own address unknown, a matching message
//     whose date does not read, the draft not shown): unknown, SEND_UNCONFIRMED, nothing changed.
// One attempt per call, under the mailbox's read turn ("email-desk:send-check"), as reply_context reads. send_draft itself
// keeps R31: a press on an in_flight row never sends, and never runs this re-read.
import type { PlatformContext } from "@flock/app-sdk";
import { getStore } from "../store";
import { extractEmailAddress } from "../lib/draft-eligibility";
import { parseGmailDateTime } from "../lib/gmail-date";
import type { ReadTurnResult } from "../platform-ext";
import { sendUnconfirmedRefusal, sentRefusal, type DraftRefusal } from "./rules";
import type { DraftRecord } from "./records";
import { withdrawDraftCard } from "./card";
import { recordSent, sendLedgerKey } from "./send";

export const SEND_CHECK_CONSUMER = "email-desk:send-check";
/** One read's timeout (reply-context READ_TIMEOUT_MS). */
const READ_TIMEOUT_MS = 90_000;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** When the draft's send was claimed, while its outcome is unknown; null when there is no in_flight row. */
function inFlightSince(draft: DraftRecord): number | null {
  const row = getStore().query("SELECT created_at FROM send_ledger WHERE idempotency_key = ? AND state = 'in_flight'")
    .get(sendLedgerKey(draft.id)) as { created_at: number } | null;
  return row ? row.created_at : null;
}

/**
 * Before create_draft or update_draft touches a thread's open draft (inside the thread's turn): null when no send of it is
 * in doubt, or when the re-read proved it did not go out (the in_flight row is cleared). Otherwise the refusal to answer:
 * SENT when the re-read proved it went (recorded and the card withdrawn first), else SEND_UNCONFIRMED.
 */
export async function settleUnconfirmedSend(platform: PlatformContext, draft: DraftRecord): Promise<DraftRefusal | null> {
  const since = inFlightSince(draft);
  if (since === null) return null;
  const seen = await reread(platform, draft, since);
  if (seen.kind === "sent") {
    recordSent(draft, sendLedgerKey(draft.id), seen.at);
    await withdrawDraftCard(platform, draft.id);
    return sentRefusal();
  }
  if (seen.kind === "unsent") {
    getStore().run("DELETE FROM send_ledger WHERE idempotency_key = ? AND state = 'in_flight'", [sendLedgerKey(draft.id)]);
    return null;
  }
  return sendUnconfirmedRefusal();
}

type Seen = { kind: "sent"; at: number } | { kind: "unsent" } | { kind: "unknown" };
const UNKNOWN: Seen = { kind: "unknown" };

async function reread(platform: PlatformContext, draft: DraftRecord, since: number): Promise<Seen> {
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
    const thread = await read("getThread", { threadId: draft.threadId });
    if (!thread || !Array.isArray(thread.messages)) return UNKNOWN;
    // Gmail's dates name the minute, in the mailbox's local time: a reply sent in the minute the send was claimed counts.
    const from = Math.floor(since / 60_000) * 60_000;
    let undated = false;
    for (const m of thread.messages) {
      if (extractEmailAddress(str(m?.from)) !== own) continue;
      if (!sameSentText(draft.bodyWritten, str(m?.bodyMain) || str(m?.body))) continue;
      const at = parseGmailDateTime(str(m?.date));
      if (at === null) { undated = true; continue; }
      if (at >= from) return { kind: "sent", at };
    }
    if (undated) return UNKNOWN;
    const held = await read("getDraft", { draftId: draft.draftId });
    return held && typeof held.body === "string" && held.body.trim() ? { kind: "unsent" } : UNKNOWN;
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
