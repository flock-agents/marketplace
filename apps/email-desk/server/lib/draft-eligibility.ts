// Is this thread eligible for an auto-drafted reply? Deterministic, pure, and
// the SINGLE definition of that question (owner decision, 2026-09-09: "the
// decision to draft or not should be deterministic without any LLM call").
//
// Two callers ask it, and they must never disagree:
//
//   1. event-llm-dispatcher, at GATE time — so a thread that can never produce a
//      draft does not wake the agent at all. That is the point of moving these
//      checks earlier: the model should not spend a turn, or a gather budget, on
//      something the platform is going to refuse.
//   2. skill-executor, at DRAFT time — the backstop, immediately before the
//      browser write.
//
// The rules live here, in one pure function, rather than being written twice.
// Two implementations of one rule drift, and drift here is invisible until it
// produces a wrong draft. (This branch has already been bitten by exactly that:
// a recipient-field probe and the click that used it described "the same"
// element with two different selector lists, and the mismatch only surfaced
// against live Gmail.)
//
// KNOWN AND ACCEPTED GAP (owner, 2026-09-09): between the gate deciding and the
// draft landing, the owner — or anyone else — could reply or draft on the thread.
// The executor's re-check closes most of it; what remains is a seconds-wide
// window, and the owner has accepted that.

/** Mirror of skills/gmail/scripts/_printView PRINT_VIEW_SHOWS_DRAFTS (owner ruling 2026-09-24:
 *  print reads never answer "is a draft open"). server/ cannot import skills/ (skills ship as
 *  installed packages on real instances, not code server/src can reach); a test in
 *  draft-eligibility.test.ts pins the two equal so this mirror can never silently drift. */
export const PRINT_VIEW_SHOWS_DRAFTS = false;

/** Which getThread view the draft gates read. Print view leaves mail unread, but the gate's
 *  `draft_exists` rule needs to SEE an open draft; if print view cannot (it cannot, per
 *  PRINT_VIEW_SHOWS_DRAFTS above), the gate reads the thread view, which restores the unread
 *  state itself (Task 4). */
export function gateReadView(): "print" | "thread" {
  return PRINT_VIEW_SHOWS_DRAFTS ? "print" : "thread";
}

export interface EligibilityMessage {
  from?: unknown;
  to?: unknown;
  /**
   * Whether getThread could actually tell To from Cc for this message (it reads
   * Gmail's labelled header rows). Absent or false means it could not, and the
   * To-only rule below refuses rather than assume.
   */
  recipientsVerified?: unknown;
  /**
   * getThread's bulk-mail signal: the body carries an unsubscribe / opt-out /
   * manage-preferences link. Only a literal `true` counts.
   */
  unsubscribeLink?: unknown;
}

export interface EligibilityThread {
  messages?: unknown;
  incomplete?: unknown;
  /** getThread: an unsent draft is open on this thread (whoever wrote it). Only a literal `true` counts. */
  hasDraft?: unknown;
}

export interface EligibilityContext {
  /**
   * The platform holds a draft record of its own for this thread. Then a draft
   * on the thread is presumed ours, and the caller's replace path (discard the
   * old draft, write for the newer message) is allowed to proceed.
   */
  ownDraftOnThread?: boolean;
  /**
   * R73 (Task 34): the owner asked for this draft, in a card's chat, during their own turn
   * (gmail-middleware's ownerAskedInCardChat). Then a thread whose newest message is the owner's
   * own is an owed update, not "already answered": that one rule is lifted, and the recipient
   * rules below (bulk, To-only) read the newest message from someone else — none → refused
   * draft_no_correspondent. The recipientsVerified requirement is waived (the owner reviews the
   * recipients on the card before Approve). Every other rule stands.
   */
  ownerAskedInCardChat?: boolean;
}

export type Eligibility =
  | { ok: true }
  | { ok: false; reason: string; code: string };

// "Display Name <a@b.com>" -> "a@b.com"; a bare address passes through.
// Lowercased for comparison. getThread composes `from` with composeFrom(), so the
// angle-bracket form is the norm and a bare value is the fallback.
export function extractEmailAddress(raw: string): string {
  const value = (raw || "").trim();
  const m = value.match(/<([^>]+)>\s*$/);
  return (m ? m[1] : value).trim().toLowerCase();
}

/**
 * Decide whether `thread` warrants an auto-drafted reply for `ownerEmail`.
 *
 * Fails CLOSED on anything it cannot establish: no owner address, an unreadable
 * thread, a scrape that came back `incomplete` (its to/cc may already be missing
 * people, so "the owner is absent" would be unsound). Refusing costs a missed
 * draft the owner can still write by hand; guessing costs a reply sent on their
 * behalf to a conversation that was never theirs.
 */
export function decideDraftEligibility(
  ownerEmail: string,
  thread: EligibilityThread | null | undefined,
  context: EligibilityContext = {},
): Eligibility {
  const refuse = (reason: string, code: string): Eligibility => ({ ok: false, reason, code });

  const owner = (ownerEmail || "").trim().toLowerCase();
  if (!owner) {
    return refuse(
      "Cannot tell whether you are a direct recipient: the resolved mailbox has no address on record. Not drafting.",
      "draft_recipient_unverifiable",
    );
  }

  if (thread?.incomplete === true) {
    return refuse(
      "The thread did not scrape completely, so its recipient list cannot be trusted. Not drafting.",
      "draft_recipient_unverifiable",
    );
  }

  const messages = Array.isArray(thread?.messages)
    ? (thread!.messages as EligibilityMessage[])
    : [];
  if (messages.length === 0) {
    return refuse(
      "The thread returned no messages to check recipients against. Not drafting.",
      "draft_recipient_unverifiable",
    );
  }

  // The LAST message is the triggering one — the same convention the drafting
  // prompt uses to pick the sender and the reply-all lists.
  let triggering = messages[messages.length - 1];

  // ALREADY ANSWERED. If the newest message is the owner's own, they spoke last
  // and nothing is outstanding.
  //
  // This is the judgement a model got wrong on a live thread: every message came
  // from a different address under a display name identical to the owner's, and
  // it concluded the owner had "already replied" when the newest message was an
  // unanswered question TO them. Matching on the ADDRESS cannot make that
  // mistake, and unlike a prompt rule an agent's retry cannot talk its way past
  // it.
  const fromOf = (m: EligibilityMessage | undefined) => extractEmailAddress(typeof m?.from === "string" ? m.from : "");
  const fromAddr = fromOf(triggering);
  if (fromAddr && fromAddr === owner) {
    if (!context.ownerAskedInCardChat) {
      return refuse(
        "The newest message on this thread is your own. Nothing is waiting on a reply.",
        "draft_already_answered",
      );
    }
    // R73: the owner's own ask for an update. The recipient rules read the newest message from
    // someone else; a thread only the owner has written to has no correspondent to answer.
    const other = [...messages].reverse().find((m) => fromOf(m) !== owner);
    if (!other) {
      return refuse(
        "Only you have written on this thread. There is no one else's message to reply to.",
        "draft_no_correspondent",
      );
    }
    triggering = other;
  }

  // A DRAFT ALREADY ON THE THREAD (owner decision, 2026-09-10). Someone is
  // already replying, whoever wrote it: the owner by hand, or an earlier install
  // whose records are gone. Live: after a reset the first sweep wrote on a
  // thread that already carried the previous run's draft, because only our own
  // records were consulted. The thread read now reports the open draft editor
  // directly. Skipped when the caller vouches the draft is a recorded one of
  // ours -- that is the replace path, and it handles foreign drafts itself.
  if (thread?.hasDraft === true && context.ownDraftOnThread !== true) {
    return refuse(
      "A draft is already open on this thread. Someone is already replying, not drafting another.",
      "draft_exists",
    );
  }

  // BULK MAIL (owner decision, 2026-09-10). A message whose body carries an
  // unsubscribe / opt-out / manage-preferences link is bulk mail, whoever sent
  // it. This is the rule engagement cannot supply: a live wake on 2026-09-10
  // listed six items and five were newsletters from domains the owner HAD
  // written to, addressed To them -- nothing above this line tells them from a
  // person. The browser scrape has no List-Unsubscribe / Precedence headers
  // (IMAP was rejected), so the footer link IS the header. And a human sender
  // with that link (a founder mailing from their own address through a
  // campaign tool) is impersonating bulk mail: the owner ruled it draws no
  // draft either. Decided before the recipient rules so the refusal on the
  // log names the real reason.
  if (triggering?.unsubscribeLink === true) {
    return refuse(
      "The newest message carries an unsubscribe / opt-out link. Bulk mail draws no reply.",
      "draft_bulk_mail",
    );
  }

  // TO-ONLY. Being cc'd or bcc'd is not a reason to reply on someone's behalf.
  //
  // This rule is only as good as the recipient scrape behind it, so it refuses
  // unless that scrape could actually tell To from Cc. It could not, for a
  // while: Gmail's COLLAPSED message header renders To and Cc as one merged
  // summary with no marker, and getThread classified the lot as "to" -- so a
  // message the owner was merely cc'd on read as addressed to them and this
  // rule passed it. getThread now expands Gmail's labelled header rows and says
  // whether it managed to; when it did not, an unverified list cannot answer
  // this question and the honest answer is no draft.
  // R73 (fix round 1): waived for a draft the owner asked for in a card chat; the owner reviews the
  // recipients on the card before Approve & Send. Live, an older message's header is collapsed in
  // the thread view, so its To/Cc split is unverified.
  if (triggering?.recipientsVerified !== true && !context.ownerAskedInCardChat) {
    return refuse(
      "Could not tell whether you were a direct (To) recipient or only cc'd. Not drafting.",
      "draft_recipient_unverifiable",
    );
  }

  const to = Array.isArray(triggering?.to) ? (triggering.to as unknown[]) : [];
  const inTo = to.some((addr) => typeof addr === "string" && addr.trim().toLowerCase() === owner);
  if (!inTo) {
    return refuse(
      "You are not a direct (To) recipient of this message. Cc/bcc does not draw a reply.",
      "draft_not_direct_recipient",
    );
  }

  return { ok: true };
}

/**
 * R-F2 (P23): the gate for an awaiting follow-up — someone promised the owner a dated delivery on
 * this thread, the date came and they have not written since. The owner speaking last ("Great,
 * thanks") is the normal shape here, so draft_already_answered and the To-only rule (checked when
 * the row was minted, on the promise message) do not apply. Kept: owner address known, a complete
 * read, a draft already open, bulk mail (on the promiser's own last message). Added: the promiser
 * must have written on the thread — an absent or unnamed promiser refuses draft_promiser_absent.
 * Returns the promiser's last message so the caller's sender checks read it, not the owner's.
 */
export function decideAwaitingFollowUpEligibility(
  ownerEmail: string,
  thread: EligibilityThread | null | undefined,
  promiser: string,
  context: Pick<EligibilityContext, "ownDraftOnThread"> = {},
): { ok: true; promiserMessage: EligibilityMessage } | { ok: false; reason: string; code: string } {
  const refuse = (reason: string, code: string) => ({ ok: false as const, reason, code });
  const owner = (ownerEmail || "").trim().toLowerCase();
  if (!owner) return refuse("The mailbox has no address on record. Not drafting a follow-up.", "draft_recipient_unverifiable");
  if (!thread || thread.incomplete === true) return refuse("The thread did not read completely. Not drafting a follow-up.", "draft_recipient_unverifiable");
  const messages = Array.isArray(thread.messages) ? (thread.messages as EligibilityMessage[]) : [];
  if (messages.length === 0) return refuse("The thread returned no messages. Not drafting a follow-up.", "draft_recipient_unverifiable");
  const who = extractEmailAddress(promiser || "");
  const fromOf = (m: EligibilityMessage) => extractEmailAddress(typeof m?.from === "string" ? m.from : "");
  const theirs = who && who !== owner ? [...messages].reverse().find((m) => fromOf(m) === who) : undefined;
  if (!theirs) return refuse("The person who promised this has not written on this thread. Not drafting a follow-up.", "draft_promiser_absent");
  if (thread.hasDraft === true && context.ownDraftOnThread !== true) {
    return refuse("A draft is already open on this thread. Someone is already replying, not drafting another.", "draft_exists");
  }
  if (theirs.unsubscribeLink === true) return refuse("Their message carries an unsubscribe / opt-out link. Bulk mail draws no follow-up.", "draft_bulk_mail");
  return { ok: true, promiserMessage: theirs };
}

/**
 * Who a reply to the thread's newest message must reach (owner, 2026-09-23):
 * its sender plus everyone on its To and Cc, minus the owner, lowercased and
 * once each. Live, a reply on a thread with two people in Cc was drafted to the
 * sender alone; more than one entry here means the reply must be Reply all.
 */
/**
 * Whether the reply-all set above is who Gmail's reply really reaches (Task 22, R-C18). Gmail's
 * Reply / Reply all answer the newest message's Reply-To, not its From; replyAllRecipients reads
 * From. "same": the read showed that message's labelled header rows (`replyToKnown`) and its
 * Reply-To is absent or the From itself. "differs": a Reply-To naming anyone else. "unknown": the
 * read could not tell (no labelled rows, an older gmail skill, a cached read) — fails closed.
 */
export function replyToVerdict(thread: EligibilityThread | null | undefined): "same" | "differs" | "unknown" {
  const messages = Array.isArray(thread?.messages) ? (thread!.messages as Array<Record<string, unknown>>) : [];
  const last = messages[messages.length - 1];
  if (!last || last.replyToKnown !== true || !Array.isArray(last.replyTo)) return "unknown";
  const from = typeof last.from === "string" ? extractEmailAddress(last.from) : null;
  const replyTo = (last.replyTo as unknown[]).filter((x): x is string => typeof x === "string")
    .map((x) => extractEmailAddress(x)).filter((x): x is string => !!x);
  if (replyTo.length === 0) return "same";
  if (!from) return "unknown";
  return replyTo.every((a) => a === from) ? "same" : "differs";
}

export function replyAllRecipients(ownerEmail: string, thread: EligibilityThread | null | undefined): string[] {
  const owner = (ownerEmail || "").trim().toLowerCase();
  const messages = Array.isArray(thread?.messages) ? (thread!.messages as Array<Record<string, unknown>>) : [];
  const last = messages[messages.length - 1];
  if (!last) return [];
  const list = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [])
    .filter((x): x is string => typeof x === "string");
  const out: string[] = [];
  for (const raw of [...list(last.from), ...list(last.to), ...list(last.cc)]) {
    const addr = extractEmailAddress(raw);
    if (addr && addr !== owner && !out.includes(addr)) out.push(addr);
  }
  return out;
}
