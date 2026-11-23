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
// The ledger is claimed (in_flight) just before Gmail's sendDraft runs, with nothing awaited in between: anything that
// fails before it (the edit, the text sync) writes no ledger row, so a ledger row that is not `sent` always means sendDraft
// was asked and may have reached Gmail (ruling R30, as Flock's own send):
//   - `in_flight`: the outcome is unknown (no answer in time, the platform unreachable, a skill_timeout or exec_error,
//     "Send was pressed but Gmail did not confirm", or the app died mid-send). A later press answers from the ledger and
//     NEVER sends, whatever Gmail shows: UNCONFIRMED, telling the person to check Sent.
//   - `failed`: sendDraft failed before Send was pressed, for sure (ruling R31, stoppedBeforePress). The next press reads
//     Gmail first: the draft still there did not go out, so the press sends it; Gmail showing no draft is never read as
//     sent, and never sent again either (Review Focus 1).
import type { CardClosedEvent, PlatformContext } from "@flock/app-sdk";
import { getStore } from "../store";
import { changeDraft, gmail, withThreadTurn, type OpCtx } from "../ops";
import { deleteDraft, getDraft, type DraftRecord } from "./records";
import { DRAFT_SOURCE_PREFIX, withdrawDraftCard } from "./card";

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
/** A send whose outcome is unknown (an in_flight ledger row): Flock's own wording (ruling R30). */
const unconfirmed = (): SendRefusal => ({ error: "Couldn't confirm the send. Check Sent before sending again.", code: "SEND_FAILED", status: 502 });

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

  // sendDraft was asked before. Its outcome unknown (in_flight): never again (R30). Its own definite failure: send again
  // only while Gmail still holds the draft.
  if (before?.state === "in_flight") return unconfirmed();
  if (before) {
    const held = await readGmailDraft(ctx.platform, draft);
    if (!held.ok) return sendFailed(`could not check the draft in Gmail (${held.reason})`);
    if (held.body === null) return sendFailed(MAY_HAVE_GONE_OUT);
  }

  // The person's edit on the card is saved as theirs first (their press token makes it theirs, ruling R5), then sent.
  if (editedBody !== undefined && editedBody !== draft.bodyWritten) {
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

  // Gmail's draft must hold the text the record (and so the card) holds. A failure here sent nothing and leaves no ledger
  // row, so the next press is a plain first send.
  const synced = await syncDraftText(ctx.platform, draft);
  if (synced !== "ok") return sendFailed(synced.reason);

  // Claim the send (in_flight) just before Gmail is asked to send; a failed row is taken back here. Nothing is awaited
  // between this write and sendDraft.
  const now = Date.now();
  db.run(
    `INSERT INTO send_ledger (idempotency_key, account_id, thread_id, draft_id, state, result, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'in_flight', NULL, ?, ?)
     ON CONFLICT(idempotency_key) DO UPDATE SET state = 'in_flight', result = NULL, draft_id = excluded.draft_id,
       updated_at = excluded.updated_at WHERE send_ledger.state != 'sent'`,
    [key, draft.accountId, draft.threadId, draft.draftId, now, now],
  );
  const sent = await gmail(ctx.platform, "sendDraft", { draftId: draft.draftId }, draft.accountId, { pressToken });
  if (sent.ok) return recordSent(draft, key);
  // Only a failure known to come before Send was pressed is definite (R31). Anything else may have gone out: no answer in
  // time, a skill_timeout, "Send was pressed but Gmail did not confirm", a crash. The row stays in_flight (R30).
  if (!stoppedBeforePress(sent)) return unconfirmed();
  return fail(key, sent.reason || "Gmail did not send it");
}

/**
 * Did this sendDraft failure surely stop before Send was pressed (ruling R31)? The platform refused it before the skill
 * ran (ops.ts gmail `notRun`), or the script said so in its own words: "Failed to send draft, nothing was sent" and "The
 * draft did not open; nothing was sent." (skills/gmail/scripts/sendDraft.ts, _openDraft.ts). Its SESSION_ERROR is not:
 * the browser runs the open-and-press steps in the same request that came back without a session.
 */
function stoppedBeforePress(f: { reason: string; unknown?: boolean; notRun?: boolean }): boolean {
  if (f.unknown) return false;
  if (/send was pressed/i.test(f.reason)) return false;
  return f.notRun === true || /nothing was sent/i.test(f.reason);
}

/** A retake after sendDraft was asked, with Gmail showing no draft: it may have been sent, so it is not sent again. */
const MAY_HAVE_GONE_OUT = "it may already have gone out. Check Sent in Gmail.";

/** sendDraft itself failed: the ledger keeps `failed` with the reason (the next press checks Gmail first). */
function fail(key: string, reason: string): SendRefusal {
  getStore().run("UPDATE send_ledger SET state = 'failed', result = ?, updated_at = ? WHERE idempotency_key = ?", [reason, Date.now(), key]);
  return sendFailed(reason);
}

/** The ledger says sent and the row has its sent stamp (the source's "Sent by Flock" record; 2.4 reads the draft as no
 *  longer open). The platform closes the card on the answer. */
function recordSent(draft: DraftRecord, key: string): { ok: true; sentAt: string } {
  const db = getStore();
  const at = Date.now();
  const sentAt = new Date(at).toISOString();
  db.run(
    `INSERT INTO send_ledger (idempotency_key, account_id, thread_id, draft_id, state, result, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'sent', ?, ?, ?)
     ON CONFLICT(idempotency_key) DO UPDATE SET state = 'sent', result = excluded.result, updated_at = excluded.updated_at`,
    [key, draft.accountId, draft.threadId, draft.draftId, JSON.stringify({ sentAt }), at, at],
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

/** Gmail's text for the draft; body null when Gmail showed none (gone, or its compose did not open in time: never proof
 *  of a send). */
async function readGmailDraft(platform: PlatformContext, draft: DraftRecord): Promise<DraftRead> {
  const r = await gmail<{ body?: unknown }>(platform, "getDraft", { draftId: draft.draftId }, draft.accountId);
  if (!r.ok) return r.code === "DRAFT_NOT_FOUND" ? { ok: true, body: null } : { ok: false, reason: r.reason };
  return { ok: true, body: typeof r.data?.body === "string" ? r.data.body : null };
}

const NO_DRAFT_SHOWN = "Gmail did not show the draft. Try again, or dismiss this card if you deleted it in Gmail.";

/** Make Gmail's draft hold the record's text: a read, and a write plus a read-back only when it differs. */
async function syncDraftText(platform: PlatformContext, draft: DraftRecord): Promise<"ok" | { reason: string }> {
  const before = await readGmailDraft(platform, draft);
  if (before.ok && before.body === null) return { reason: NO_DRAFT_SHOWN };
  if (before.ok && sameDraftText(draft.bodyWritten, before.body!)) return "ok";

  const write = await gmail(platform, "updateDraft", { draftId: draft.draftId, body: draft.bodyWritten }, draft.accountId);
  if (!write.ok) return { reason: `Gmail could not take the draft's text (${write.reason})` };
  const after = await readGmailDraft(platform, draft);
  if (!after.ok) return { reason: `could not check Gmail holds the draft's text (${after.reason})` };
  if (after.body === null) return { reason: NO_DRAFT_SHOWN };
  if (!sameDraftText(draft.bodyWritten, after.body)) return { reason: "Gmail's draft still differs from the card's text" };
  return "ok";
}

// ---- The card closed (card-closed.ts; the Twitter desk's handleCardClosed) ------------------------------------------

/**
 * What became of a draft card. No outcome leaves an open row without a card: such a row would mute its thread (the wake
 * and create_draft read an open row as "a draft exists").
 *   - `declined` (the person's ✕, Not important, Not now): the draft is discarded as the person, so their own edit does not
 *     stop it (it is their no). The row is deleted and the card withdrawn on the FIRST attempt. Gmail's discard is tried
 *     then; a failure other than "already gone" is kept as a pending discard (app_meta `gmail-discard:<id>`) and thrown, so
 *     Flock asks again later and only Gmail's discard is retried. It never discards a newer draft on the same thread.
 *   - `expired`: as the source did, the draft stays in Gmail, but the row goes (the card is gone).
 *   - `done` is the Send, which send_draft already recorded.
 */
export async function handleCardClosed(event: CardClosedEvent, ctx: { platform: PlatformContext }): Promise<void> {
  if (!event.sourceRef.startsWith(DRAFT_SOURCE_PREFIX)) return;
  const id = event.sourceRef.slice(DRAFT_SOURCE_PREFIX.length);
  if (!id) return;
  if (event.outcome === "expired") return closeExpired(id);
  if (event.outcome !== "declined") return;
  const found = getDraft(getStore(), id);
  if (found && found.sentAt === null) {
    await withThreadTurn(found.accountId, found.threadId, async () => {
      const db = getStore();
      const draft = getDraft(db, id);
      if (!draft || draft.sentAt !== null) return;
      db.transaction(() => {
        putPendingDiscard(id, { accountId: draft.accountId, threadId: draft.threadId, draftId: draft.draftId });
        deleteDraft(db, id);
      })();
    });
    await withdrawDraftCard(ctx.platform, id);
  }
  await retryPendingDiscard(ctx.platform, id);
}

/** An expired card's draft: left in Gmail (the source's rule), its row deleted so the thread is not muted. */
async function closeExpired(id: string): Promise<void> {
  const found = getDraft(getStore(), id);
  if (!found || found.sentAt !== null) return;
  await withThreadTurn(found.accountId, found.threadId, async () => {
    const draft = getDraft(getStore(), id);
    if (draft && draft.sentAt === null) deleteDraft(getStore(), id);
  });
}

interface PendingDiscard { accountId: string; threadId: string; draftId: string }
const pendingKey = (id: string): string => `gmail-discard:${id}`;

function putPendingDiscard(id: string, p: PendingDiscard): void {
  getStore().run(
    "INSERT INTO app_meta (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    [pendingKey(id), JSON.stringify(p), Date.now()],
  );
}

/** Gmail's discard of a declined draft whose row is already gone. Done, already gone, or replaced by a newer draft of ours
 *  on the thread (Gmail's reply draft id is reused): the pending discard is dropped. Any other failure throws. */
async function retryPendingDiscard(platform: PlatformContext, id: string): Promise<void> {
  const db = getStore();
  const row = db.query("SELECT value FROM app_meta WHERE key = ?").get(pendingKey(id)) as { value: string } | null;
  if (!row) return;
  let p: PendingDiscard | null = null;
  try { p = JSON.parse(row.value) as PendingDiscard; } catch { p = null; }
  const drop = () => db.run("DELETE FROM app_meta WHERE key = ?", [pendingKey(id)]);
  if (!p?.draftId || !p.accountId) { drop(); return; }
  await withThreadTurn(p.accountId, p.threadId, async () => {
    const newer = db.query("SELECT 1 FROM draft_records WHERE account_id = ? AND thread_id = ? AND draft_id = ? AND sent_at IS NULL")
      .get(p!.accountId, p!.threadId, p!.draftId);
    if (newer) { drop(); return; }
    const gone = await gmail(platform, "discardDraft", { draftId: p!.draftId }, p!.accountId);
    if (!gone.ok && gone.code !== "DRAFT_NOT_FOUND") throw new Error(`Gmail could not discard draft ${id}: ${gone.reason}`);
    drop();
  });
}
