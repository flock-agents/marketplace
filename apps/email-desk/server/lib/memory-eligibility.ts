// Is this journaled item worth spending an extraction on? A DENYLIST — and the
// deliberate opposite of the drafting gate.
//
// TWO GATES, NEVER ONE. `skills/gmail/scripts/shouldTrigger.ts` decides whether
// mail should WAKE AN AGENT TO DRAFT A REPLY, and it is an allowlist: an engaged
// domain admits, everything else drops. That is correct for a reply — a draft to
// a vendor the owner has never written to is noise.
//
// It is exactly wrong for memory. The mail the drafting gate throws away is the
// mail memory most wants: receipts, renewals, flight confirmations, statements,
// no-reply transactional mail. Every one of those carries a durable fact, and not
// one of them would survive an engagement test.
//
// So this module admits by default and drops only what is CONFIRMED noise:
//
//   an unsubscribe / manage-preferences / opt-out link  → bulk mail
//   an `Accepted:` / `Declined:` / `Invitation:` subject → a calendar auto-response
//
// Nothing else. In particular these are KEPT, on purpose, and each has a test:
//   - no-reply and automated senders — that is where receipts and renewals live;
//   - self-sends — the owner's own writing is both a fact source and a voice source;
//   - senders from domains the owner has never emailed — engagement is a drafting
//     concern, not a memory one.
//
// Do NOT import a rule list from the drafting gate, and do not "unify" the two
// predicates. They answer opposite questions; one shared list would quietly pull
// the allowlist's drops into memory, and the loss would be invisible — mail that
// simply never became a fact. The ONE exception is the calendar auto-response prefix list (owner, 2026-10-10, P21.3): a machine-written calendar reply is noise to both gates, so both read shared/calendar-auto-response.ts.
//
// FAIL OPEN, always. A malformed entry, a missing entry, or any throw returns
// eligible with a logged reason. Over-extracting costs a few tokens; silently
// dropping mail costs a fact the owner will never learn was missing.
//
// PURE: a journal entry plus the link handed in. No DB, no network, no browser
// session — which is what makes it unit-testable, and safe to call from both the
// harvest runner and a test.

import type { StoredJournalEntry } from "./journal-entry"; // type-only: no runtime import, no DB
import { isCalendarAutoResponse } from "./calendar-auto-response";
// A pure predicate over `raw.folder`, exactly like this module's own senderOf/
// subjectOf readers below — no DB, no network. Needed here because a Task 6 sent
// row's `actor` is the RECIPIENT (the adapter has no separate field for who the
// owner wrote to), not the sender, so the two checks below that read `actor` as
// "who sent this" must recognise a sent row first (controller ruling R15).
import { isSentRow } from "./sent-row";
import { isAutomatedSender } from "./automated-sender";

export interface MemoryEligibilityOptions {
  /**
   * How the bulk signal was established. `"url"` is a real opt-out link;
   * `"footer_text"` is only a footer SAYING so, which is weaker evidence and
   * carries a lighter verdict below. Absent means `"url"`, the historical shape.
   */
  bulkSignal?: unknown;

  /**
   * The message text the caller already has. Only read for the bulk test below;
   * absent means "cannot judge", never "impersonal".
   */
  text?: unknown;

  /**
   * Names whose presence makes a message personal — the owner's name, the name
   * they are called, and the local parts of their addresses. A blast names an
   * audience; a receipt or a recap names a person.
   */
  personalNames?: unknown;

  /**
   * The message's unsubscribe / manage-preferences / opt-out link, if the caller
   * found one — the bulk-mail signal.
   *
   * ORDERING, and why this is an INPUT rather than something read in here:
   * today the link comes from the message BODY, because the browser scrape has no
   * `List-Unsubscribe` and no `Precedence` header to read. That forces this filter
   * to run AFTER the fetch — we pay for the body, then decide we did not want it.
   * Under OAuth the link becomes a free header on the list response, and the
   * filter moves AHEAD of the fetch, saving the fetch entirely.
   *
   * Taking the link as an optional parameter is what makes that move a CALL-SITE
   * change instead of a rewrite of this predicate. Do not "simplify" this by
   * having isMemoryEligible fetch or parse the body itself — that would weld the
   * filter to the post-fetch position and cost this module its purity.
   */
  unsubscribeLink?: string | null;
}

export interface MemoryEligibility {
  eligible: boolean;
  /** Why it was dropped, or — on an eligible result — why the filter gave up. */
  reason?: string;
}

// Google Calendar's auto-response and invitation subjects. Anchored at the start
// of the subject and requiring the colon, deliberately: a subject only has to
// LEAD with one of these to be machine-generated. "Re: Invitation: Sprint review"
// is a human writing on an invite thread, "Your offer was Accepted: next steps"
// is a human writing about a deal, and both are kept. A denylist that guesses is
// worse than one that under-matches.

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// The subject, as the ingest manifest leaves it: `raw.subject` from the scraped
// item, with `preview` ("subject — snippet", per the emailPreview transform) as
// the fallback for a source that kept no raw subject.
// TODO(text-as-state): recovers the subject by splitting the "subject — snippet" preview built in
// ingest-manifest-loader.ts. Keep the subject as its own field instead.
function subjectOf(entry: StoredJournalEntry): string {
  const raw = (entry as { raw?: unknown }).raw;
  const fromRaw = raw && typeof raw === "object" ? asString((raw as Record<string, unknown>).subject) : "";
  if (fromRaw.trim()) return fromRaw.trim();
  const preview = asString((entry as { preview?: unknown }).preview);
  const [head] = preview.split(" — ");
  return (head ?? "").trim();
}

/**
 * Decide whether `entry` is worth extracting memory from.
 *
 * Admits by default. Drops only bulk mail (an unsubscribe link was found) and
 * calendar auto-responses (the calendar connector carries those facts better,
 * and with structure this path would have to guess at).
 */
export function isMemoryEligible(
  entry: StoredJournalEntry,
  opts: MemoryEligibilityOptions,
): MemoryEligibility {
  try {
    if (!entry || typeof entry !== "object") {
      return failOpen("no entry to inspect", "fail_open_unparseable");
    }

    // BULK. Presence of the link is the whole signal — the caller decides what
    // counts as one (a body scrape today, a `List-Unsubscribe` header under
    // OAuth). Only a non-empty string is a confirmed finding; anything else
    // (absent, null, blank, the wrong type) means the caller did not establish
    // one, and an unestablished signal must not drop mail.
    const link = opts && typeof opts === "object" ? opts.unsubscribeLink : null;
    if (typeof link === "string" && link.trim()) {
      // ...unless the sender is automated (owner, 2026-09-14). Every example this
      // header lists as WANTED — "receipts, renewals, flight confirmations, statements,
      // no-reply transactional mail" — ships an unsubscribe link, because bulk senders
      // attach one for compliance whether the mail is promotional or transactional. So
      // the link alone was dropping the very class the module exists to keep.
      //
      // The link still damns bulk mail from a HUMAN-looking sender, which is what
      // marketing from a person's address is. The cost is that a newsletter from a
      // `no-reply@` address now reaches extraction; the extractor writes facts, not
      // mail, so the failure mode is a few wasted tokens rather than a wrong memory —
      // and per the header, over-extracting is the side to err on.
      // A FOOTER THAT MERELY SAYS SO IS WEAKER EVIDENCE than a real opt-out URL,
      // and must not damn mail on its own. Dropping on the word alone took "Your
      // NSDL CAS — August 2026", a consolidated account statement from a
      // human-looking address, off the owner's live journal. A weak signal has
      // to be corroborated by the mail naming nobody.
      const weak = opts.bulkSignal === "footer_text";
      // A SENT ROW'S `actor` WAS THE RECIPIENT (R15); since F-SELF B it is the mailbox
      // itself (sent-source.ts). Either way it is not a third-party sender — the owner
      // is the true sender of their own sent mail, always human, and reading the
      // recipient's address as "the sender" for an automation check is simply
      // wrong (a reply into a ticketing system's automated inbox would misread
      // as bulk mail FROM that system). Treat it as unidentified, same as any
      // other row this predicate cannot read a sender off.
      const from = isSentRow(entry as { raw?: Record<string, unknown> | null })
        ? null
        : senderOf({ actor: (entry as { actor?: unknown }).actor });
      if (!weak && (!from || !isAutomatedSender(from.email))) {
        return { eligible: false, reason: "bulk_unsubscribe_link" };
      }

      // ...and among AUTOMATED bulk senders, only the mail that concerns the
      // owner (owner, 2026-09-19).
      //
      // The carve-out above reasoned that a newsletter reaching extraction costs
      // "a few wasted tokens rather than a wrong memory". Measured on the owner's
      // live wiki, it cost a wrong memory: a Digit Insurance announcement and a
      // Microsoft internship blast became durable facts, and minted `IRDAI`,
      // `NCLT` and `Digit Insurance` as organizations the owner has no
      // relationship with — which then supplied descriptors for other entities.
      //
      // The class the carve-out protects — receipts, renewals, and the notetaker
      // recap that an earlier rule was deferring with three of the owner's action
      // items in it — has a property the announcements lack: IT NAMES THE OWNER.
      // A blast names an audience; a receipt, a statement and a recap name a
      // person. That is the whole test, and it needs no model and no keyword list
      // (stych's `hasAttentionSignal` draws the same line: relationship, never
      // content).
      //
      // FAIL OPEN both ways: with no text to read or no names to check, we cannot
      // judge, so the mail is kept.
      const text = typeof opts.text === "string" ? opts.text : "";
      const names = Array.isArray(opts.personalNames)
        ? opts.personalNames.filter((n): n is string => typeof n === "string" && n.trim().length > 1)
        : [];
      if (text && names.length > 0 && !namesSomeone(text, names)) {
        return { eligible: false, reason: "bulk_impersonal" };
      }
    }

    // CALENDAR AUTO-RESPONSE. An "Accepted:"/"Declined:"/"Invitation:" mail says
    // who said yes to what — which the calendar connector already holds as
    // structured attendance, rather than as a subject line to be parsed.
    if (isCalendarAutoResponse(subjectOf(entry))) {
      return { eligible: false, reason: "calendar_autoresponse" };
    }

    return { eligible: true };
  } catch (e) {
    // Never let a bad row lose mail: log loudly, admit, let extraction decide.
    return failOpen(String(e), "fail_open_error");
  }
}


/**
 * Does `text` name one of `names` as a WORD?
 *
 * Word boundaries, not substrings: "Shiva" inside "Shivam Kapoor" or inside a
 * `/Users/shivashankar/...` path is not the owner being addressed, and treating
 * it as such would make every blast containing the letters look personal.
 *
 * Deliberately a local copy rather than an import of wiki-grounding's `mentions`.
 * This module's header promises it is PURE — no DB, no network — and that module
 * reaches the wiki DB through wiki-ops. Five lines of regex is the cheaper price.
 */
function namesSomeone(text: string, names: readonly string[]): boolean {
  const hay = text.toLowerCase();
  for (const raw of names) {
    const needle = raw.trim().toLowerCase();
    if (needle.length < 2) continue;
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    try {
      if (new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, "iu").test(hay)) return true;
    } catch {
      if (hay.includes(needle)) return true;
    }
  }
  return false;
}

function failOpen(detail: string, reason: string): MemoryEligibility {
  console.warn(`[memory-eligibility] failing open (${reason}): ${detail}`);
  return { eligible: true, reason };
}


// ---------------------------------------------------------------------------
// COLD OUTREACH — a BLOCK-level predicate, deliberately separate from
// isMemoryEligible above.
//
// WHY IT IS NOT PART OF isMemoryEligible. That predicate is per-ENTRY and pure,
// and it answers "is this message noise?". This one answers a question about the
// THREAD — "has the owner ever spoken here?" — which no single entry can answer.
// Folding it in would either force isMemoryEligible to take the whole block (and
// stop being per-entry) or make it silently wrong on the second message of a
// thread. So: two predicates, one module, one set of tests.
//
// WHAT IT IS FOR. First-contact mail from a stranger is ~36% of measured inbound
// (docs/research/2026-09-10-stych-calibration-answers.md, Q2). It carries no bulk
// signal and it is addressed directly to the user, so the denylist above cannot
// see it, and it is mostly not worth an extraction. But the moment the OWNER
// replies, the whole thread becomes worth extracting — including the original
// cold email, which is the message carrying the actual ask.
//
// THE VERDICT IS NOT TERMINAL, and the caller must honour that: a cold block's
// rows stay `pending` and are skipped for this run only. Marking them `filtered`
// would make the reply case impossible, which is the entire point of the rule.
// The comprehension horizon is the backstop that retires a thread nobody ever
// answers.
//
// TWO GATES, NEVER ONE — and this does not breach it. The constraint is about
// POLICY: not sharing a rule list, not unifying the predicates. Engagement is
// used here for a DIFFERENT purpose than the drafting gate uses it: there it is
// an ALLOWLIST (engaged → admit, everything else drops), here it is one term in a
// NARROW DROP (engaged → keep, and unengaged only defers when the owner is also
// silent). Nothing is imported from shouldTrigger.ts or draft-eligibility.ts, and
// the engaged-domain LIST arrives as an INPUT — this module reads no database and
// imports engaged-domains not at all, which memory-eligibility.test.ts pins
// structurally. A reviewer who disagrees should say so at the runner's call site,
// where the list is fetched.

/** The only shape this predicate needs off a journal row: who sent it, and — to
 *  recognise a Task 6 sent row, whose `actor` is the RECIPIENT, not a sender —
 *  the raw envelope `isSentRow` reads `raw.folder` off. */
export interface ThreadActorRow {
  actor?: unknown;
  raw?: Record<string, unknown> | null;
}

export interface ColdOutreachOptions {
  /** Domains the owner has demonstrably corresponded with. An INPUT, never read here. */
  engagedDomains?: readonly string[] | null;
  /** Every address that is the owner. Empty or absent means identity is UNRESOLVED. */
  ownerAddresses?: readonly string[] | null;
  /** P21.2 (owner, 2026-10-10): the domains the engagement lookup actually CLASSIFIED (engaged or
   *  confirmed not-engaged). Present -> a sender domain outside it and outside engagedDomains was
   *  never checked, so the thread FAILS OPEN (as shouldTrigger does). Absent -> the old reading. */
  resolvedDomains?: readonly string[] | null;
}

export interface ColdOutreachVerdict {
  /** True only when BOTH signals are absent and the owner is identifiable. */
  cold: boolean;
  /** `cold_outreach` on a drop; on a keep, why the predicate gave up (if it did). */
  reason?: string;
}

function normaliseSet(values: readonly string[] | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const value of Array.isArray(values) ? values : []) {
    const v = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (v) out.add(v);
  }
  return out;
}

// The sender address off a journal row's `actor`. Everything after the LAST `@`
// is the domain — the same reading shouldTrigger.ts does, arrived at
// independently rather than shared.
/** Does the row's raw.participants (array of address strings) include an owner address?
 *  Defensive: a missing raw, a non-array or a non-string entry is simply no signal. */
function ownerParticipates(row: ThreadActorRow, owners: Set<string>): boolean {
  const raw = row && typeof row === "object" ? row.raw : undefined;
  const list = raw && typeof raw === "object" ? (raw as Record<string, unknown>).participants : undefined;
  if (!Array.isArray(list)) return false;
  return list.some((p) => typeof p === "string" && owners.has(p.trim().toLowerCase()));
}

function senderOf(row: ThreadActorRow): { email: string; domain: string } | null {
  const actor = row && typeof row === "object" ? (row.actor as Record<string, unknown> | undefined) : undefined;
  const email = actor && typeof actor.email === "string" ? actor.email.trim().toLowerCase() : "";
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at === -1) return null;
  const domain = email.slice(at + 1);
  return domain ? { email, domain } : null;
}


/**
 * Is this block first-contact mail from a stranger the owner has not answered?
 *
 * Both signals come off journal rows already in hand — NO fetch, NO LLM:
 *   - the owner spoke in this thread (any row's actor is an owner address, or an owner
 *     address is among the row's raw.participants) → KEEP;
 *   - the sender's domain is engaged → KEEP;
 *   - neither → COLD.
 *
 * FAILS OPEN in every direction. No owner address on record, an unreadable row,
 * an empty block, any throw — all return `cold: false`. Dropping mail on a signal
 * we do not actually have is the one outcome this rule must never produce, and
 * the caller's skip is cheap to repeat.
 */
export function isColdOutreachThread(
  rows: readonly ThreadActorRow[],
  opts: ColdOutreachOptions,
): ColdOutreachVerdict {
  try {
    const options = opts && typeof opts === "object" ? opts : {};
    const owners = normaliseSet(options.ownerAddresses);
    if (owners.size === 0) {
      // We cannot tell whether the owner spoke, so we cannot conclude they did
      // not. Keep, and say why.
      return { cold: false, reason: "fail_open_owner_unresolved" };
    }

    const list = Array.isArray(rows) ? rows : [];
    if (list.length === 0) return { cold: false, reason: "fail_open_empty_block" };

    const engaged = normaliseSet(options.engagedDomains);
    const resolved = Array.isArray(options.resolvedDomains) ? normaliseSet(options.resolvedDomains) : null;
    let identified = 0;

    for (const row of list) {
      // A SENT ROW MEANS THE OWNER SPOKE, unconditionally (R15). Its `actor` is
      // the RECIPIENT — the owner can never be their own recipient — so the
      // ordinary `owners.has(sender.email)` test below can never fire for one,
      // and a thread the owner started, before anyone answered, would misread as
      // cold outreach and defer forever. Checked first, ahead of `senderOf`.
      if (isSentRow(row)) return { cold: false };
      // THE OWNER IS A PARTICIPANT. An inbox row's actor is the thread's LATEST writer (F8a),
      // so a reply on a thread the owner started carries the replier as actor; the row's
      // participant list (listInbox's raw.participants) still names the owner.
      if (ownerParticipates(row, owners)) return { cold: false };
      const sender = senderOf(row);
      if (!sender) continue;
      identified++;
      // THE OWNER SPOKE. Keep the whole thread — including the cold email that
      // opened it, which is the message carrying the ask being answered.
      if (owners.has(sender.email)) return { cold: false };
      // AN ENGAGED CORRESPONDENT. A colleague's FYI is not cold outreach, even
      // when the owner never replied to it.
      if (engaged.has(sender.domain)) return { cold: false };
      // AN AUTOMATED SENDER IS NOT OUTREACH AT ALL (owner, 2026-09-14). Engagement is
      // decided by `in:sent to:@domain` — mail the owner has SENT. No owner ever writes
      // to `no-reply@`, so a tool they use every day can never become engaged and every
      // notification it sends defers as cold outreach, forever, re-deferred each run.
      //
      // That is the exact loss this FILE's header warns against: "no-reply and automated
      // senders — that is where receipts and renewals live" are listed as KEPT on
      // purpose, and "engagement is a drafting concern, not a memory one". This rule
      // reintroduced the engagement test the header forbids. Live example: a meeting
      // recap listing five action items, three assigned to the owner by name, deferred
      // because they had never emailed the notetaker's no-reply address.
      if (isAutomatedSender(sender.email)) return { cold: false, reason: "automated_sender" };
      // UNRESOLVED IS NOT NOT-ENGAGED (P21.2): first contact from a new person keeps the coverage
      // the retired drafting routine gave it.
      if (resolved && !resolved.has(sender.domain)) return { cold: false, reason: "fail_open_engagement_unresolved" };
    }

    // Not one row named a sender we could read — no signal either way.
    if (identified === 0) return { cold: false, reason: "fail_open_no_identifiable_sender" };

    return { cold: true, reason: "cold_outreach" };
  } catch (e) {
    console.warn(`[memory-eligibility] cold-outreach check failing open: ${String(e)}`);
    return { cold: false, reason: "fail_open_error" };
  }
}
