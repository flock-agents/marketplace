// The app's ops (Op contract). Registered in index.ts; the SDK's ops router hands each `(payload, { platform, agentId,
// pressToken })`. Who may call the declared ones is Flock's rule (routes/app-ops.ts), not this file's.
//
// A create_draft while the mailbox's voice is being learned answers VOICE_LEARNING with the time to try after (Task 2.9,
// voice/crawl.ts).
//
// Drafts (Task 2.5): create_draft, update_draft, discard_draft; send_draft (Task 2.6, drafts/send.ts) on the person's press. The rules are drafts/rules.ts; the record drafts/records.ts;
// the card drafts/card.ts. Gmail is reached only through connectors.exec as the copy's paired agent; a draft write needs no
// press token (only a send does), so only send_draft ever passes one.
//
// Who wrote a body (ruling R5): `by: "person"` counts only when the call carries a press token, which Flock mints for the
// person's own save on the card (draftSaveOp). An agent saying `by: "person"` without one is the agent: the lock applies
// to it, and it cannot set the lock.
import type { OpHandler, PlatformContext } from "@flock/app-sdk";
import { getStore } from "./store";
import {
  bodyRefusal, draftExistsRefusal, gmailRefusal, notFoundRefusal, personEditedRefusal, updateRefusal,
  sendUnconfirmedRefusal, voiceLearningRefusal, type DraftAuthor, type DraftRefusal,
} from "./drafts/rules";
import { deleteDraft, draftStatus, getDraft, lockDraft, openDraftForThread, recordDraft, setDraftBody, type DraftRecord } from "./drafts/records";
import { answeredMessage, publishDraftCard, withdrawDraftCard } from "./drafts/card";
import { sendDraft } from "./drafts/send";
import { addressingForDraft, confirmedAddressing, confirmedByWrite, type DraftAddressing, type ReplyAddressing } from "./drafts/addressing";
import { releaseThreadHold, settleUnconfirmedSend, threadSendInDoubt } from "./drafts/send-check";
import { tryAfterText, voiceStateFor, voiceLearningUntil } from "./voice/crawl";
import { processTimezone } from "./lib/local-day";
import { resolveDeskThread } from "./desk-thread";
import { followUpAwaitingDraft, markFollowUpDrafted } from "./routines/follow-up-store";

export interface OpCtx {
  platform: PlatformContext;
  agentId: string | null;
  pressToken: string | null;
  /** Set only when Flock proved the calling agent runs in the run session of one of this app's own routines (Ruling
   *  P3-R15, header x-flock-routine-id); absent for a chat or an older Flock. */
  routineId?: string | null;
}

/** A Gmail draft write drives a browser (manifest timeout 90 s, plus queueing for the mailbox). */
const GMAIL_WRITE_TIMEOUT_MS = 150_000;

let log: (line: string) => void = (line) => console.warn(line);
/** Tests: silence (or capture) the ops' warnings; null restores console.warn. */
export function _setOpsLogForTesting(fn: ((line: string) => void) | null): void {
  log = fn ?? ((line) => console.warn(line));
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** A failure: `status` is the platform's HTTP status when it gave one; `unknown` says the call's outcome is not known (no
 *  answer in time, the platform unreachable, or the call threw): it may have run. `notRun` says the call surely stopped
 *  before the skill acted: the platform refused it before running it, or the script refused its params. */
export type Gmail<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string; code?: string; status?: number; unknown?: boolean; notRun?: boolean };

/** The platform's own refusals before a skill runs (app-skill-access.ts, skill-executor.ts: the account guard, account
 *  resolution, the grant and approval gates, params it would not take). */
const NOT_RUN_CODE = /^(forbidden|sideeffect_not_authorized|send_not_authorized|not_connected|guard_.+|resolution_.+|invalid_.+)$/;

/** Did this failure surely stop before the skill acted? A skill's own failure reaches the app in-band as HTTP 400 with an
 *  executor code (exec_error, skill_timeout, ...) and the script's code and message in its text (app-agent.ts); the
 *  platform's refusals before the run come with a code above, or as a status other than 400 with none. */
function failedBeforeRun(r: { reason: string; code?: string; status?: number }): boolean {
  if (r.code) return NOT_RUN_CODE.test(r.code) || /\bMISSING_PARAM:/.test(r.reason);
  return r.status !== undefined && r.status > 400 && r.status < 500;
}

/** One Gmail skill call as the copy's paired agent, on `accountId`. Only a send passes `approval` (the person's press
 *  token, sideEffect): no draft write ever does. Never throws. */
export async function gmail<T>(
  platform: PlatformContext, functionName: string, params: Record<string, unknown>, accountId: string,
  approval?: { pressToken: string },
): Promise<Gmail<T>> {
  try {
    const r = await platform.connectors.exec<T>({
      skillId: "gmail", functionName, params, accountHint: accountId, timeoutMs: GMAIL_WRITE_TIMEOUT_MS,
      ...(approval ? { pressToken: approval.pressToken, sideEffect: true } : {}),
    });
    if (r.ok) return { ok: true, data: r.data };
    if (r.skipped) return { ok: false, reason: "Email Desk is not set up with an agent", notRun: true };
    const status = typeof r.status === "number" ? r.status : undefined;
    const reason = r.message ?? r.reason;
    const unknown = r.reason === "timeout" || r.reason === "unreachable" || (status !== undefined && status >= 500);
    const notRun = !unknown && failedBeforeRun({ reason, ...(r.code ? { code: r.code } : {}), ...(status !== undefined ? { status } : {}) });
    return {
      ok: false, reason, ...(r.code ? { code: r.code } : {}),
      ...(status !== undefined ? { status } : {}), ...(unknown ? { unknown: true } : {}), ...(notRun ? { notRun: true } : {}),
    };
  } catch (e: any) {
    return { ok: false, reason: String(e?.message ?? e), unknown: true };
  }
}

// One change at a time per thread: two create_draft calls racing past the open-draft check would write two Gmail drafts,
// and an update racing a discard could write into a draft being thrown away. The second waits, then sees the first's
// result (DRAFT_EXISTS naming it, or NOT_FOUND). Not re-entrant: inside a turn, call the lock-free `changeDraft`, never
// `updateDraft` (send_draft runs its edit and its send in one turn that way).
const threadTurns = new Map<string, Promise<unknown>>();
export async function withThreadTurn<T>(accountId: string, threadId: string, fn: () => Promise<T>): Promise<T> {
  const key = `${accountId}|${threadId}`;
  const run = (threadTurns.get(key) ?? Promise.resolve()).then(fn, fn);
  const tail = run.catch(() => undefined);
  threadTurns.set(key, tail);
  try {
    return await run;
  } finally {
    if (threadTurns.get(key) === tail) threadTurns.delete(key);
  }
}

export { deskThreadAccount } from "./desk-thread";

/** The id Gmail holds for a thread's draft after a write that returned none (source recoverDraftIdForThread). Null when
 *  Gmail holds none, or could not be asked. */
async function recoverDraftId(platform: PlatformContext, accountId: string, threadId: string): Promise<{ draftId: string; draftMessageId: string } | null> {
  const found = await gmail<{ draftId?: unknown; draftMessageId?: unknown }>(platform, "findDraftForThread", { threadId }, accountId);
  if (!found.ok) return null;
  const draftId = str(found.data?.draftId);
  return draftId ? { draftId, draftMessageId: str(found.data?.draftMessageId) } : null;
}

/** create_draft: the rules, then Gmail's reply draft, then the record, then the card. */
export async function createDraft(p: Record<string, unknown>, ctx: OpCtx): Promise<{ id: string } | DraftRefusal> {
  const threadId = str(p.threadId);
  const body = typeof p.body === "string" ? p.body : "";
  const bad = bodyRefusal(body, "agent");
  if (bad) return bad;
  // Any thread of the person's own mailboxes: one the journal does not hold is read from Gmail now and kept (desk-thread.ts).
  const where = await resolveDeskThread(ctx.platform, threadId, str(p.accountId));
  if ("code" in where) return where;
  const accountId = where.accountId;
  // The mailbox's voice is being learned right now (Task 2.9): a draft written now would miss it. Past the crawl's cap the
  // mailbox is no longer learning, so this never holds a draft for longer than that (Review Focus 5).
  if (voiceStateFor(accountId) === "learning") {
    const until = voiceLearningUntil(accountId);
    if (until !== null) return voiceLearningRefusal(until, tryAfterText(until, processTimezone()));
  }
  return withThreadTurn(accountId, threadId, () => writeNewDraft(accountId, threadId, body, str(p.why) || null, ctx));
}

type DraftRead = { ok: true; body: string | null; gone: boolean } | { ok: false; reason: string };

/** One getDraft. `gone` only on Gmail's explicit DRAFT_NOT_FOUND; a body of null without it is a blank read. */
async function readDraftOnce(platform: PlatformContext, draft: DraftRecord): Promise<DraftRead> {
  const now = await gmail<{ body?: unknown }>(platform, "getDraft", { draftId: draft.draftId }, draft.accountId);
  if (!now.ok) return now.code === "DRAFT_NOT_FOUND" ? { ok: true, body: null, gone: true } : { ok: false, reason: now.reason };
  return { ok: true, body: typeof now.data?.body === "string" ? now.data.body : null, gone: false };
}

/**
 * Gmail's text for a draft the person never edited (ruling R31): the body; null only when Gmail no longer holds it; or the
 * failure when Gmail could not be asked (a timeout, a read error), which is never "gone". getDraft.ts answers a body of
 * null both for a draft that no longer exists and for a compose that did not open in time, so one blank read is not
 * enough: the draft is gone on Gmail's explicit DRAFT_NOT_FOUND, or on two blank reads in a row. Callers never ask this
 * of a person-edited draft: such a draft is never replaced or dropped on a read.
 */
async function gmailDraftBody(platform: PlatformContext, draft: DraftRecord): Promise<{ ok: true; body: string | null } | { ok: false; reason: string }> {
  let read = await readDraftOnce(platform, draft);
  if (read.ok && read.body === null && !read.gone) read = await readDraftOnce(platform, draft);
  if (!read.ok) return read;
  return { ok: true, body: read.body };
}

async function writeNewDraft(accountId: string, threadId: string, body: string, why: string | null, ctx: OpCtx): Promise<{ id: string } | DraftRefusal> {
  const db = getStore();
  // A send on this thread whose outcome is unknown holds it (ruling R33), before anything reads a draft as gone and with
  // or without its draft row: one Gmail re-read may prove it went (SENT) or did not (drafting goes on); short of that
  // SEND_UNCONFIRMED, nothing written.
  const inDoubt = await settleUnconfirmedSend(ctx.platform, accountId, threadId);
  if (inDoubt) return inDoubt;
  const open = openDraftForThread(db, accountId, threadId);
  if (open) {
    // The person's edit is never replaced, whatever Gmail shows (ruling R31): nothing is read or changed.
    if (open.personEdited) return draftExistsRefusal(open.id);
    // The open row may be stale: the person sent or deleted the draft in Gmail itself. Gmail is asked; a draft it surely
    // no longer holds is cleared (row and card) and the new one is written. Gmail not answering is GMAIL_FAILED and
    // changes nothing.
    const held = await gmailDraftBody(ctx.platform, open);
    if (!held.ok) return gmailRefusal("check the draft already on this thread", held.reason);
    if (held.body !== null) return draftExistsRefusal(open.id);
    deleteDraft(db, open.id);
    await withdrawDraftCard(ctx.platform, open.id);
  }

  const answered = answeredMessage(db, accountId, threadId);
  // Gmail's own Reply all sets who the reply reaches; the skill still asks for a `to` and a subject.
  const params: Record<string, unknown> = { threadId, to: answered?.address || answered?.from || "", body };
  if (answered?.subject) params.subject = answered.subject;
  const written = await gmail<{ draftId?: unknown; draftMessageId?: unknown; bodyAsSaved?: unknown; reason?: unknown; replyMode?: unknown; reply?: unknown; newestMessage?: unknown }>(
    ctx.platform, "createReplyDraft", params, accountId);
  let ids: { draftId: string; draftMessageId: string } | null = null;
  if (written.ok && str(written.data?.draftId)) ids = { draftId: str(written.data.draftId), draftMessageId: str(written.data.draftMessageId) };
  // A write that timed out, or saved without showing its id, may still have landed: ask Gmail before a retry writes a second.
  if (!ids) ids = await recoverDraftId(ctx.platform, accountId, threadId);
  if (!ids) return gmailRefusal("save the draft", written.ok ? str(written.data?.reason) || "the draft did not show up in Gmail" : written.reason);

  const saved = written.ok ? str(written.data?.bodyAsSaved) : "";
  // Who the reply reaches: the thread's fresh live read, when Gmail opened the reply that reaches them, and only when Gmail's
  // read taken now, after the draft was written, shows the same newest message: a message that came in since the read
  // would have been the one Reply all answered (Ruling P3-R5, drafts/addressing.ts).
  // An "always follow up" rule's draft (owner decision 2026-11-23): made in a routine run on a thread the follow-up routine
  // woke the agent for. It answers the person's own message, so it reaches that message's To and Cc.
  const automated = typeof ctx.routineId === "string" && ctx.routineId.length > 0;
  const followUp = automated && followUpAwaitingDraft(accountId, threadId);
  const candidate = written.ok ? addressingForDraft(accountId, threadId, written.data?.replyMode, followUp) : null;
  // The write's own read of the reply it composed (gmail 1.6.8+) proves the set without reading the thread again; when it
  // cannot (an older skill, a half it could not read, anything that differs), the thread is read after the write as before.
  const replyAll = candidate
    ? confirmedByWrite(candidate, written.ok ? written.data : null) ?? await confirmAfterWrite(ctx.platform, accountId, threadId, candidate, followUp)
    : null;
  const draft = recordDraft(db, {
    accountId, threadId, draftId: ids.draftId, draftMessageId: ids.draftMessageId,
    bodyWritten: saved || body, answeredMessageRef: answered?.eventId ?? "", why, replyAll,
    // R-F5 (Ruling P3-R14): a draft made in one of this copy's routine runs, on Flock's proof only (P3-R15). A standing
    // mail rule sends only such a draft; one the person asked for in chat is theirs to send.
    automated,
  });
  if (followUp) markFollowUpDrafted(accountId, threadId, draft.id);
  await publishDraftCard(ctx.platform, draft);
  return { id: draft.id };
}

/** The draft's set, confirmed by a read of the thread after the draft was written; null on any doubt (never fails the draft). */
async function confirmAfterWrite(
  platform: PlatformContext, accountId: string, threadId: string, candidate: DraftAddressing, followUp = false,
): Promise<ReplyAddressing | null> {
  try {
    const { liveThreadRead, mailboxAddress } = await import("./reply-context");
    const reread = await liveThreadRead(platform, accountId, threadId);
    return confirmedAddressing(candidate, reread, await mailboxAddress(platform, accountId), followUp);
  } catch { return null; }
}

/** update_draft: the person's edit (with a press token) or the agent's change (never over the person's). */
export async function updateDraft(p: Record<string, unknown>, ctx: OpCtx): Promise<{ ok: true } | DraftRefusal> {
  const found = getDraft(getStore(), str(p.id));
  if (!found) return notFoundRefusal();
  return withThreadTurn(found.accountId, found.threadId, () => changeDraft(found.id, p, ctx));
}

/** update_draft's work, for a caller already inside the thread's turn (withThreadTurn): send_draft's edit-then-send. */
export async function changeDraft(id: string, p: Record<string, unknown>, ctx: OpCtx): Promise<{ ok: true } | DraftRefusal> {
  const by: DraftAuthor = p.by === "person" && !!ctx.pressToken ? "person" : "agent";
  const db = getStore();
  // Read again inside the thread's turn: a discard or a person's edit may have landed while this waited.
  const draft = getDraft(db, id);
  if (!draft) return notFoundRefusal();
  // A send on this thread whose outcome is unknown: nothing is written, whoever asks, until a re-read settles it (R33).
  const inDoubt = await settleUnconfirmedSend(ctx.platform, draft.accountId, draft.threadId);
  if (inDoubt) return inDoubt;
  const locked = updateRefusal(draft, by);
  if (locked) return locked;
  const body = typeof p.body === "string" ? p.body : "";
  const bad = bodyRefusal(body, by);
  if (bad) return bad;

  if (by === "agent") {
    // The person may have changed the draft in Gmail itself: the three-way compare (source owner-edit guard). Fails closed.
    const now = await gmailDraftBody(ctx.platform, draft);
    if (!now.ok) return gmailRefusal("read the draft to check it", now.reason);
    const status = draftStatus(draft, now.body);
    if (status === "missing") {
      deleteDraft(db, draft.id);
      await withdrawDraftCard(ctx.platform, draft.id);
      return notFoundRefusal();
    }
    if (status === "person-edited") {
      lockDraft(db, draft.id);
      return personEditedRefusal();
    }
  }

  const written = await gmail<{ bodyAsSaved?: unknown }>(ctx.platform, "updateDraft", { draftId: draft.draftId, body }, draft.accountId);
  if (!written.ok) return gmailRefusal("save the draft", written.reason);
  setDraftBody(db, draft.id, str(written.data?.bodyAsSaved) ? String(written.data.bodyAsSaved) : body, { personEdited: by === "person" });
  // The change goes back on the card (same sourceRef, why kept): the agent's so Flock re-posts its line, the person's so
  // the card shows what they saved (ruling R16).
  await publishDraftCard(ctx.platform, getDraft(db, draft.id)!);
  return { ok: true };
}

/** discard_draft: Gmail discards it, the row goes, the card is withdrawn. Idempotent, and `{ ok: true }` even when Gmail
 *  fails (ruling R15: logged; the thread has no draft). The refusals, for the agent (no press token) only: a draft the
 *  person edited (ruling R18), which would let it draft over their edit; and a draft whose thread has a send in doubt
 *  (SEND_UNCONFIRMED, ruling R33). Nothing changes then. */
export async function discardDraft(p: Record<string, unknown>, ctx: OpCtx): Promise<{ ok: true } | DraftRefusal> {
  const id = str(p.id);
  const refused = await removeDraft(ctx.platform, id, { byPerson: !!ctx.pressToken });
  if (refused) return refused;
  if (id) await withdrawDraftCard(ctx.platform, id);
  return { ok: true };
}

/**
 * The discard itself, in the thread's turn: Gmail discardDraft, then the row deleted (ruling R19). A sent draft, or no
 * row, is left alone (null). The agent may not discard the person's edit (R18); the person may (`byPerson`: their press,
 * or their own ✕ on the card). A Gmail failure other than "already gone" is logged and the row deleted anyway (R15). The
 * card's own close is drafts/send.ts handleCardClosed.
 */
export async function removeDraft(
  platform: PlatformContext, id: string, opts: { byPerson: boolean },
): Promise<DraftRefusal | null> {
  const found = getDraft(getStore(), id);
  if (!found) return null;
  return withThreadTurn(found.accountId, found.threadId, async (): Promise<DraftRefusal | null> => {
    const db = getStore();
    const draft = getDraft(db, id);
    if (!draft || draft.sentAt !== null) return null;
    if (draft.personEdited && !opts.byPerson) return personEditedRefusal();
    // The agent may not discard a draft while a send on its thread is in doubt (R33): nothing changes. The person's own
    // discard goes through and releases the hold (R34), below.
    if (!opts.byPerson && threadSendInDoubt(draft.accountId, draft.threadId)) return sendUnconfirmedRefusal();
    const gone = await gmail(platform, "discardDraft", { draftId: draft.draftId }, draft.accountId);
    // Already gone from Gmail is the end we want; any other failure leaves a stray Gmail draft.
    if (!gone.ok && gone.code !== "DRAFT_NOT_FOUND") {
      log(`[email-desk] Gmail could not discard draft ${draft.id} (${gone.reason}); its record and card are gone anyway`);
    }
    deleteDraft(db, draft.id);
    // The person's own discard says it did not go: the thread's hold is released (R34).
    if (opts.byPerson) releaseThreadHold(draft.accountId, draft.threadId);
    return null;
  });
}

export const ops: Record<string, OpHandler> = {
  create_draft: (p, ctx) => createDraft(p, ctx),
  update_draft: (p, ctx) => updateDraft(p, ctx),
  discard_draft: (p, ctx) => discardDraft(p, ctx),
  // Served, never declared (manifest.test.ts): only the card's Send reaches it, with the person's press token.
  send_draft: (p, ctx) => sendDraft(p, ctx),
};
