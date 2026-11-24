// The draft rules (spec §2.4): one draft per thread, placeholder and quality checks, and the person's own edits never
// overwritten. Pure: the ops (ops.ts) read the store and Gmail, then ask these. Ported from Flock's gmail-middleware.ts
// gates (draft_placeholder, draft_dash, draft_exists_use_update, draft_owner_edited) and save-draft.ts checkDraftBody, with
// the refusals in the Op contract's codes. Every refusal says what to do next, in plain words.
import { findDash, findPlaceholder } from "../lib/draft-body-check";

export type DraftRefusalCode =
  | "DRAFT_EXISTS" | "PLACEHOLDER" | "QUALITY" | "VOICE_LEARNING" | "NOT_DESK_THREAD"
  | "PERSON_EDITED" | "SENT" | "NOT_FOUND" | "GMAIL_FAILED" | "SEND_UNCONFIRMED";

export interface DraftRefusal {
  error: string;
  code: DraftRefusalCode;
  /** VOICE_LEARNING only: when to try again (ISO), the same time the error names. */
  tryAfter?: string;
}

/** Who wrote the text: the person's own (a press of their card) is theirs, the agent's is held to the writing rules. */
export type DraftAuthor = "agent" | "person";

/** The longest body the card shows whole (source CARD_BODY_MAX / SAVE_DRAFT_MAX). */
export const DRAFT_BODY_MAX = 8000;

/** The no-dash rule in words that hold no dash themselves (the lib's NO_DASHES_RULE quotes them). */
const NO_DASHES = "No long dashes or double hyphens anywhere in a draft: use a comma, a period, or parentheses instead. A hyphen inside a word (follow-up) is fine.";

const refuse = (code: DraftRefusalCode, error: string): DraftRefusal => ({ error, code });

/** Why this body may not be a draft, or null. The person's own text skips the agent's placeholder and dash rules (source
 *  ownerAuthored, ruling R29), never the empty and length checks. */
export function bodyRefusal(body: unknown, by: DraftAuthor): DraftRefusal | null {
  if (typeof body !== "string" || !body.trim()) return refuse("QUALITY", "The draft is empty. Write the reply and try again.");
  if (body.length > DRAFT_BODY_MAX) {
    return refuse("QUALITY", `The draft is too long (at most ${DRAFT_BODY_MAX} characters). Shorten it and try again.`);
  }
  if (by === "person") return null;
  const placeholder = findPlaceholder(body);
  if (placeholder) {
    return refuse("PLACEHOLDER",
      `The draft has a placeholder (${placeholder}). A draft must be sendable as written: say what you know in plain words, or leave that point out. Nothing was written.`);
  }
  const dash = findDash(body);
  if (dash) {
    return refuse("QUALITY", `The draft has a dash ("${dash}"). ${NO_DASHES} Rewrite it and try again. Nothing was written.`);
  }
  return null;
}

/** One draft per thread: the thread already has an open draft. */
export function draftExistsRefusal(existingId: string): DraftRefusal {
  return refuse("DRAFT_EXISTS",
    `A draft for this thread exists: ${existingId}. Nothing new was written. To change it, call update_draft with that id.`);
}

/** The mailbox's voice is still being learned (spec §5.2): nothing was written; try again at `until` (the crawl's cap, so
 *  that retry always drafts, with the voice or past the cap without it). `when` is the time in words (crawl.ts
 *  tryAfterText). */
export function voiceLearningRefusal(until: number, when: string): DraftRefusal {
  return { error: `Voice still learning, try after ${when}. Nothing was written.`, code: "VOICE_LEARNING", tryAfter: new Date(until).toISOString() };
}

/** The thread is in none of this person's mailboxes: Gmail has no such thread, or it was named under an account this copy
 *  does not hold. */
export function notInMailboxRefusal(): DraftRefusal {
  return refuse("NOT_DESK_THREAD", "There is no such email thread in this person's Gmail, so nothing was written.");
}

export function notFoundRefusal(): DraftRefusal {
  return refuse("NOT_FOUND", "There is no draft with that id any more.");
}

export function gmailRefusal(what: string, reason: string): DraftRefusal {
  return refuse("GMAIL_FAILED", `Gmail could not ${what}: ${reason}. Nothing was changed. Try again.`);
}

/** Whether this change may touch the draft at all: never once sent, and never by the agent once the person edited it. */
export function updateRefusal(draft: { sentAt: number | null; personEdited: boolean }, by: DraftAuthor): DraftRefusal | null {
  if (draft.sentAt !== null) return refuse("SENT", "This draft was already sent, so it can't be changed.");
  if (by === "agent" && draft.personEdited) return personEditedRefusal();
  return null;
}

/** The thread's reply was already sent (a send Gmail's re-read proved went out, ruling R33): nothing new is written. */
export function sentRefusal(): DraftRefusal {
  return refuse("SENT", "The reply on this thread was already sent, so nothing was written.");
}

/** A send on this thread may have gone out and could not be confirmed (an in_flight send ledger row, ruling R33): no draft
 *  is written or changed until the person has checked Sent. */
export function sendUnconfirmedRefusal(): DraftRefusal {
  return refuse("SEND_UNCONFIRMED", "A reply to this may have gone already. Check Sent first.");
}

export function personEditedRefusal(): DraftRefusal {
  return refuse("PERSON_EDITED", "The person edited this draft, so it was left as they wrote it. Ask them before changing it.");
}
