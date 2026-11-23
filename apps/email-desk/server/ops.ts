// The app's ops (Op contract). Registered in index.ts; the SDK's ops router hands each `(payload, { platform, agentId,
// pressToken })`. Who may call the declared ones is Flock's rule (routes/app-ops.ts), not this file's.
//
// Drafts (Task 2.5): create_draft, update_draft, discard_draft. The rules are drafts/rules.ts; the record drafts/records.ts;
// the card drafts/card.ts. Gmail is reached only through connectors.exec as the copy's paired agent; a draft write needs no
// press token (only a send does), so none is ever passed here.
//
// Who wrote a body (ruling R5): `by: "person"` counts only when the call carries a press token, which Flock mints for the
// person's own save on the card (draftSaveOp). An agent saying `by: "person"` without one is the agent: the lock applies
// to it, and it cannot set the lock.
import type { OpHandler, PlatformContext } from "@flock/app-sdk";
import { getStore } from "./store";
import {
  bodyRefusal, draftExistsRefusal, gmailRefusal, notDeskThreadRefusal, notFoundRefusal, personEditedRefusal, updateRefusal,
  type DraftAuthor, type DraftRefusal,
} from "./drafts/rules";
import { deleteDraft, draftStatus, getDraft, lockDraft, openDraftForThread, recordDraft, setDraftBody } from "./drafts/records";
import { answeredMessage, publishDraftCard, withdrawDraftCard } from "./drafts/card";

export interface OpCtx {
  platform: PlatformContext;
  agentId: string | null;
  pressToken: string | null;
}

/** A Gmail draft write drives a browser (manifest timeout 90 s, plus queueing for the mailbox). */
const GMAIL_WRITE_TIMEOUT_MS = 150_000;

let log: (line: string) => void = (line) => console.warn(line);
/** Tests: silence (or capture) the ops' warnings; null restores console.warn. */
export function _setOpsLogForTesting(fn: ((line: string) => void) | null): void {
  log = fn ?? ((line) => console.warn(line));
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

type Gmail<T> = { ok: true; data: T } | { ok: false; reason: string; code?: string };

async function gmail<T>(platform: PlatformContext, functionName: string, params: Record<string, unknown>, accountId: string): Promise<Gmail<T>> {
  try {
    const r = await platform.connectors.exec<T>({ skillId: "gmail", functionName, params, accountHint: accountId, timeoutMs: GMAIL_WRITE_TIMEOUT_MS });
    if (r.ok) return { ok: true, data: r.data };
    if (r.skipped) return { ok: false, reason: "Email Desk is not set up with an agent" };
    return { ok: false, reason: r.message ?? r.reason, ...(r.code ? { code: r.code } : {}) };
  } catch (e: any) {
    return { ok: false, reason: String(e?.message ?? e) };
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

/** The account this copy read the thread in: the journal holds a row of it (in `accountId`'s mailbox, when named). */
function deskThreadAccount(threadId: string, accountId: string): string | null {
  if (!threadId) return null;
  const db = getStore();
  const row = (accountId
    ? db.query("SELECT account_id FROM ingest_events WHERE thread_key = ? AND account_id = ? LIMIT 1").get(threadId, accountId)
    : db.query("SELECT account_id FROM ingest_events WHERE thread_key = ? ORDER BY ts DESC LIMIT 1").get(threadId)) as { account_id: string } | null;
  return row?.account_id ?? null;
}

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
  const accountId = deskThreadAccount(threadId, str(p.accountId));
  if (!accountId) return notDeskThreadRefusal();
  const body = typeof p.body === "string" ? p.body : "";
  const bad = bodyRefusal(body, "agent");
  if (bad) return bad;
  return withThreadTurn(accountId, threadId, () => writeNewDraft(accountId, threadId, body, str(p.why) || null, ctx));
}

async function writeNewDraft(accountId: string, threadId: string, body: string, why: string | null, ctx: OpCtx): Promise<{ id: string } | DraftRefusal> {
  const db = getStore();
  const open = openDraftForThread(db, accountId, threadId);
  if (open) return draftExistsRefusal(open.id);

  const answered = answeredMessage(db, accountId, threadId);
  // Gmail's own Reply all sets who the reply reaches; the skill still asks for a `to` and a subject.
  const params: Record<string, unknown> = { threadId, to: answered?.address || answered?.from || "", body };
  if (answered?.subject) params.subject = answered.subject;
  const written = await gmail<{ draftId?: unknown; draftMessageId?: unknown; bodyAsSaved?: unknown; reason?: unknown }>(
    ctx.platform, "createReplyDraft", params, accountId);
  let ids: { draftId: string; draftMessageId: string } | null = null;
  if (written.ok && str(written.data?.draftId)) ids = { draftId: str(written.data.draftId), draftMessageId: str(written.data.draftMessageId) };
  // A write that timed out, or saved without showing its id, may still have landed: ask Gmail before a retry writes a second.
  if (!ids) ids = await recoverDraftId(ctx.platform, accountId, threadId);
  if (!ids) return gmailRefusal("save the draft", written.ok ? str(written.data?.reason) || "the draft did not show up in Gmail" : written.reason);

  const saved = written.ok ? str(written.data?.bodyAsSaved) : "";
  const draft = recordDraft(db, {
    accountId, threadId, draftId: ids.draftId, draftMessageId: ids.draftMessageId,
    bodyWritten: saved || body, answeredMessageRef: answered?.eventId ?? "", why,
  });
  await publishDraftCard(ctx.platform, draft);
  return { id: draft.id };
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
  const locked = updateRefusal(draft, by);
  if (locked) return locked;
  const body = typeof p.body === "string" ? p.body : "";
  const bad = bodyRefusal(body, by);
  if (bad) return bad;

  if (by === "agent") {
    // The person may have changed the draft in Gmail itself: the three-way compare (source owner-edit guard). Fails closed.
    const now = await gmail<{ body?: unknown }>(ctx.platform, "getDraft", { draftId: draft.draftId }, draft.accountId);
    if (!now.ok) return gmailRefusal("read the draft to check it", now.reason);
    const status = draftStatus(draft, typeof now.data?.body === "string" ? now.data.body : null);
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
 *  fails (ruling R15: logged; the thread has no draft). The one refusal (ruling R18): the agent (no press token) may not
 *  discard a draft the person edited, which would let it draft over their edit; nothing changes then. */
export async function discardDraft(p: Record<string, unknown>, ctx: OpCtx): Promise<{ ok: true } | DraftRefusal> {
  const id = str(p.id);
  const found = getDraft(getStore(), id);
  if (found) {
    const refused = await withThreadTurn(found.accountId, found.threadId, async (): Promise<DraftRefusal | null> => {
      const db = getStore();
      const draft = getDraft(db, id);
      if (!draft || draft.sentAt !== null) return null;
      if (draft.personEdited && !ctx.pressToken) return personEditedRefusal();
      const gone = await gmail(ctx.platform, "discardDraft", { draftId: draft.draftId }, draft.accountId);
      // Already gone from Gmail is the end we want; any other failure leaves a stray Gmail draft, logged.
      if (!gone.ok && gone.code !== "DRAFT_NOT_FOUND") {
        log(`[email-desk] Gmail could not discard draft ${draft.id} (${gone.reason}); its record and card are gone anyway`);
      }
      deleteDraft(db, draft.id);
      return null;
    });
    if (refused) return refused;
  }
  if (id) await withdrawDraftCard(ctx.platform, id);
  return { ok: true };
}

export const ops: Record<string, OpHandler> = {
  create_draft: (p, ctx) => createDraft(p, ctx),
  update_draft: (p, ctx) => updateDraft(p, ctx),
  discard_draft: (p, ctx) => discardDraft(p, ctx),
};
