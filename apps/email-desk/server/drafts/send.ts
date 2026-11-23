// send_draft: the reply goes out on the person's press, and only then (spec §2.4; Op contract). Ported from Flock's
// email-desk send-email.ts (the send ledger, the sent stamp), approved-draft.ts (Gmail's draft made to hold the approved
// text before it sends) and card-closed.ts (the person's ✕ discards the draft).
//
// The approval is the press token Flock mints for the card's Send (a press on Home, or the person's own "send" reply to
// the draft's line). No token, no send: NO_APPROVAL, always, before anything is read and with Gmail never called. The
// token goes to Gmail's sendDraft as the call's approval; the platform checks it is this app's and spends it once.
//
// Once, whatever happens around it (Review Focus 1): the send ledger, keyed by the draft's own id (`draft:<id>`) in its
// own table, so it outlives the draft row (a new draft on the thread replaces the row). A ledger row `sent` answers
// `{ ok: true, sentAt }` and sends nothing: a retry after a timeout, a second press with a second token. Each send runs in
// the thread's turn (ops.ts withThreadTurn), so two presses at once are one after the other, and the second reads the
// first's `sent`.
//
// What is sent is the record as it stands at the press: the person's edit (`editedBody`, saved first as theirs), else the
// last text written (the agent's latest update, which the card shows). Gmail's draft is made to hold that text before the
// send, whatever Gmail holds (the source's approved-draft rule); short of that, nothing sends.
//
// A crash between the ledger's in_flight and its sent leaves an in_flight row. Within this process a turn never sees
// another's in_flight (the turn serialises sends), so one seen in a turn is a crash's. The source's rule: such a send is
// taken back by the person's next press, which sends again. Kept, with one guard for Review Focus 1: a send that already
// went out leaves Gmail without the draft (sendDraft consumes it), so a retaken send (in_flight or failed before) whose
// Gmail draft is gone is recorded sent, and not sent again.
import type { CardClosedEvent, PlatformContext } from "@flock/app-sdk";
import { getStore } from "../store";
import { changeDraft, gmail, removeDraft, withThreadTurn, type OpCtx } from "../ops";
import { getDraft, type DraftRecord } from "./records";
import { DRAFT_SOURCE_PREFIX } from "./card";

export type SendRefusal =
  | { error: string; code: "NO_APPROVAL"; status: number }
  | { error: string; code: "NOT_FOUND"; status: number }
  | { error: string; code: "SEND_FAILED"; status: number };

export const sendLedgerKey = (id: string): string => `draft:${id}`;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

const noApproval = (): SendRefusal => ({ error: "Only your press of Send can send this reply.", code: "NO_APPROVAL", status: 403 });
const notFound = (): SendRefusal => ({ error: "There is no draft with that id any more.", code: "NOT_FOUND", status: 404 });
/** Gmail (or the press's approval) failed: 502, the card stays open with the reason. */
const sendFailed = (reason: string, status = 502): SendRefusal => ({ error: `Could not send: ${reason}`, code: "SEND_FAILED", status });

interface LedgerRow { state: "in_flight" | "sent" | "failed"; result: string | null; updated_at: number }

function readLedger(key: string): LedgerRow | null {
  return getStore().query("SELECT state, result, updated_at FROM send_ledger WHERE idempotency_key = ?").get(key) as LedgerRow | null;
}

/** When the ledger says it went out: the time it records (result `{ sentAt }`), else the row's own. */
function sentAtOf(row: LedgerRow): string {
  try {
    const at = JSON.parse(row.result ?? "")?.sentAt;
    if (typeof at === "string" && at) return at;
  } catch { /* the row's own time below */ }
  return new Date(row.updated_at).toISOString();
}

/** send_draft `{ id, editedBody? }`: see the file header. */
export async function sendDraft(p: Record<string, unknown>, ctx: OpCtx): Promise<{ ok: true; sentAt: string } | SendRefusal> {
  if (!ctx.pressToken) return noApproval();
  const id = str(p.id);
  const key = sendLedgerKey(id);
  const done = id ? readLedger(key) : null;
  if (done?.state === "sent") return { ok: true, sentAt: sentAtOf(done) };
  const found = getDraft(getStore(), id);
  if (!found) return notFound();
  const editedBody = typeof p.editedBody === "string" ? p.editedBody : undefined;
  return withThreadTurn(found.accountId, found.threadId, () => sendInTurn(id, editedBody, ctx, ctx.pressToken!));
}

async function sendInTurn(id: string, editedBody: string | undefined, ctx: OpCtx, pressToken: string): Promise<{ ok: true; sentAt: string } | SendRefusal> {
  const db = getStore();
  const key = sendLedgerKey(id);
  // Read again in the turn: a press ahead of this one may have sent it, or a discard removed it.
  const before = readLedger(key);
  if (before?.state === "sent") return { ok: true, sentAt: sentAtOf(before) };
  let draft = getDraft(db, id);
  if (!draft) return notFound();
  if (draft.sentAt !== null) return { ok: true, sentAt: new Date(draft.sentAt).toISOString() };
  // A row left in_flight (a crash's) or failed: an earlier attempt may have reached Gmail.
  const retaken = before !== null;

  // The person's edit on the card is saved as theirs first (their press token makes it theirs, ruling R5), then sent.
  if (editedBody !== undefined && editedBody !== draft.bodyWritten) {
    if (retaken && (await goneFromGmail(ctx.platform, draft))) return recordSent(draft, key, "went out before a restart");
    const edited = await changeDraft(id, { body: editedBody, by: "person" }, ctx);
    if ("error" in edited) {
      if (edited.code === "NOT_FOUND") return notFound();
      if (edited.code === "SENT") {
        const now = getDraft(db, id);
        return { ok: true, sentAt: new Date(now?.sentAt ?? Date.now()).toISOString() };
      }
      return sendFailed(edited.error, edited.code === "GMAIL_FAILED" ? 502 : 400);
    }
    draft = getDraft(db, id);
    if (!draft) return notFound();
  }

  // Claim the send: in_flight, before Gmail is asked. A failed or crash-left row is taken back (the source's rule).
  const now = Date.now();
  db.run(
    `INSERT INTO send_ledger (idempotency_key, account_id, thread_id, draft_id, state, result, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'in_flight', NULL, ?, ?)
     ON CONFLICT(idempotency_key) DO UPDATE SET state = 'in_flight', result = NULL, draft_id = excluded.draft_id,
       updated_at = excluded.updated_at WHERE send_ledger.state != 'sent'`,
    [key, draft.accountId, draft.threadId, draft.draftId, now, now],
  );

  // Gmail's draft must hold the text the record (and so the card) holds.
  const synced = await syncDraftText(ctx.platform, draft);
  if (synced === "gone") {
    if (retaken) return recordSent(draft, key, "went out before a restart");
    return fail(key, "the draft is no longer in Gmail");
  }
  if (synced !== "ok") return fail(key, synced.reason);

  const sent = await gmail(ctx.platform, "sendDraft", { draftId: draft.draftId }, draft.accountId, { pressToken });
  if (!sent.ok) return fail(key, sent.reason || "Gmail did not send it");
  return recordSent(draft, key);
}

function fail(key: string, reason: string): SendRefusal {
  getStore().run("UPDATE send_ledger SET state = 'failed', result = ?, updated_at = ? WHERE idempotency_key = ?", [reason, Date.now(), key]);
  return sendFailed(reason);
}

/** The ledger says sent and the row has its sent stamp (the source's "Sent by Flock" record; 2.4 reads the draft as no
 *  longer open). The platform closes the card on the answer. */
function recordSent(draft: DraftRecord, key: string, note?: string): { ok: true; sentAt: string } {
  const db = getStore();
  const at = Date.now();
  const sentAt = new Date(at).toISOString();
  db.run(
    `INSERT INTO send_ledger (idempotency_key, account_id, thread_id, draft_id, state, result, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'sent', ?, ?, ?)
     ON CONFLICT(idempotency_key) DO UPDATE SET state = 'sent', result = excluded.result, updated_at = excluded.updated_at`,
    [key, draft.accountId, draft.threadId, draft.draftId, JSON.stringify({ sentAt, ...(note ? { note } : {}) }), at, at],
  );
  db.run("UPDATE draft_records SET sent_at = ?, sent_by = 'person', updated_at = ? WHERE id = ?", [at, at, draft.id]);
  return { ok: true, sentAt };
}

// ---- The approved text (approved-draft.ts) --------------------------------------------------------------------------

/**
 * Same text as far as a draft goes: line endings, trailing spaces, surrounding blank lines and blank-line runs aside
 * (Gmail reads a typed blank line back as two newlines), plus the reply attribution line ("On …, … wrote:") Gmail can
 * leave after the body.
 */
export function sameDraftText(approved: string, held: string): boolean {
  const a = normalizeDraftText(approved);
  const h = normalizeDraftText(held);
  if (a === h) return true;
  return h.startsWith(`${a}\n`) && ATTRIBUTION_LINE.test(h.slice(a.length + 1));
}

const ATTRIBUTION_LINE = /^On [^\n]*wrote:$/;

function normalizeDraftText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{2,}/g, "\n\n")
    .trim();
}

type DraftRead = { ok: true; body: string | null } | { ok: false; reason: string };

/** Gmail's text for the draft; body null when Gmail no longer holds it. */
async function readGmailDraft(platform: PlatformContext, draft: DraftRecord): Promise<DraftRead> {
  const r = await gmail<{ body?: unknown }>(platform, "getDraft", { draftId: draft.draftId }, draft.accountId);
  if (!r.ok) return r.code === "DRAFT_NOT_FOUND" ? { ok: true, body: null } : { ok: false, reason: r.reason };
  return { ok: true, body: typeof r.data?.body === "string" ? r.data.body : null };
}

async function goneFromGmail(platform: PlatformContext, draft: DraftRecord): Promise<boolean> {
  const r = await readGmailDraft(platform, draft);
  return r.ok && r.body === null;
}

/** Make Gmail's draft hold the record's text: a read, and a write plus a read-back only when it differs. */
async function syncDraftText(platform: PlatformContext, draft: DraftRecord): Promise<"ok" | "gone" | { reason: string }> {
  const before = await readGmailDraft(platform, draft);
  if (before.ok && before.body === null) return "gone";
  if (before.ok && sameDraftText(draft.bodyWritten, before.body!)) return "ok";

  const write = await gmail(platform, "updateDraft", { draftId: draft.draftId, body: draft.bodyWritten }, draft.accountId);
  if (!write.ok) return { reason: `Gmail could not take the draft's text (${write.reason})` };
  const after = await readGmailDraft(platform, draft);
  if (!after.ok) return { reason: `could not check Gmail holds the draft's text (${after.reason})` };
  if (after.body === null) return "gone";
  if (!sameDraftText(draft.bodyWritten, after.body)) return { reason: "Gmail's draft still differs from the card's text" };
  return "ok";
}

// ---- The card closed (card-closed.ts; the Twitter desk's handleCardClosed) ------------------------------------------

/**
 * What became of a draft card. `declined` (the person's ✕, Not important, Not now): the draft is discarded as the person,
 * so their own edit does not stop it (it is their no): Gmail's draft discarded, the row deleted. A Gmail failure other than
 * "already gone" throws and keeps the row, so Flock asks again later (the source's rule). `done` is the Send, which
 * send_draft already recorded; `expired` changes nothing (the source's rule: the draft stays in Gmail and on the thread).
 */
export async function handleCardClosed(event: CardClosedEvent, ctx: { platform: PlatformContext }): Promise<void> {
  if (event.outcome !== "declined" || !event.sourceRef.startsWith(DRAFT_SOURCE_PREFIX)) return;
  const id = event.sourceRef.slice(DRAFT_SOURCE_PREFIX.length);
  if (!id) return;
  await removeDraft(ctx.platform, id, { byPerson: true, onGmailFailure: "throw" });
}
