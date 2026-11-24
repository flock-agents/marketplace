// The follow-up gate: the MIRROR of decideDraftEligibility. A follow-up is raised only when the PERSON spoke last, at least N
// business days ago, to someone other than themselves. Pure and deterministic; fails closed.
//
// Ported from Flock's built-in desk (email-desk/follow-up-rules.ts). Two things changed with the move:
//   - the draft rule (`draft_exists`) is gone: the desk no longer writes a follow-up draft, it raises a TODO, so an open
//     draft on the thread is no reason to stay quiet;
//   - the statuses are three: `waiting` (the person spoke last but not long enough ago), `offered` (the TODO is raised) and
//     `replied` (they answered, the TODO is withdrawn). The built-in desk's `considered`, `nudged` and `not_needed` belonged
//     to waking the Inbox Assistant and judging its turn; the person is the judge now, on the TODO.
import { extractEmailAddress, type Eligibility } from "./draft-eligibility";
import { isBusinessDaysElapsed } from "./business-days";
import { parseGmailDateTime } from "./gmail-date";

export interface NudgeThreadMessage { from: string; to: string[]; cc: string[]; date: string; body: string; unsubscribeLink?: boolean }
export interface NudgeThread { messages: NudgeThreadMessage[]; incomplete?: boolean; subject?: string }

/** `drafting`: an "always follow up" rule covers it and the agent was woken to write it (no TODO); `drafted`: it did, and
 *  the rule sends that draft. */
export type FollowUpStatus = "waiting" | "offered" | "drafting" | "drafted" | "replied";
export type FollowUpAction = "skip" | "judge" | "settle_replied";

/** The key of the person's message a follow-up answers: one message is never raised twice. */
export function ownerMsgKey(m: { date: string }): string {
  return `owner:${(m.date || "").trim()}`;
}

export function decideNudgeEligibility(
  ownerEmail: string, thread: NudgeThread | null | undefined, nowMs: number, businessDays: number, timeZone: string,
): Eligibility {
  const refuse = (reason: string, code: string): Eligibility => ({ ok: false, reason, code });
  const owner = (ownerEmail || "").trim().toLowerCase();
  if (!owner) return refuse("No mailbox address on record. Not following up.", "draft_recipient_unverifiable");
  if (!thread || thread.incomplete === true) return refuse("The thread did not read completely. Not following up.", "draft_recipient_unverifiable");
  const messages = Array.isArray(thread.messages) ? thread.messages : [];
  const last = messages[messages.length - 1];
  if (!last) return refuse("The thread returned no messages. Not following up.", "draft_recipient_unverifiable");
  if (extractEmailAddress(last.from) !== owner) return refuse("Someone else spoke last. Nothing to follow up.", "draft_not_owner_last");
  const others = [...(last.to || []), ...(last.cc || [])].map((a) => extractEmailAddress(a)).filter((a) => a && a !== owner);
  if (others.length === 0) return refuse("Your last message went only to yourself. No follow-up.", "draft_nudge_self");
  const sentAt = parseGmailDateTime(last.date);
  if (sentAt === null) return refuse("Could not read when your last message was sent. Not following up.", "draft_nudge_undated");
  if (!isBusinessDaysElapsed(sentAt, nowMs, businessDays, timeZone)) return refuse(`Less than ${businessDays} business days since your last message.`, "draft_nudge_too_soon");
  if (last.unsubscribeLink === true) return refuse("Your last message carries an unsubscribe link. Bulk mail draws no follow-up.", "draft_bulk_mail");
  return { ok: true };
}

const OPEN = new Set<FollowUpStatus>(["waiting", "offered", "drafting"]);

/** What to do with a sent thread once read. `judge` = run the gate and, if it passes, raise the TODO. */
export function nextFollowUpAction(
  prev: { ownerMsgKey: string; status: FollowUpStatus } | null,
  current: { lastIsOwner: boolean; ownerMsgKey: string | null },
): FollowUpAction {
  if (!current.lastIsOwner) return prev && OPEN.has(prev.status) ? "settle_replied" : "skip";
  if (!prev || prev.ownerMsgKey !== current.ownerMsgKey) return "judge";
  if (prev.status === "waiting") return "judge";
  // offered: the TODO is already up (idempotent across runs); drafting/drafted: the rule's draft is awaited or made;
  // replied: answered, and nothing new from the person.
  return "skip";
}

/** The routine's "business days" setting as saved: 0 is a real value ("follow up the same day", for trying the routine out);
 *  absent, blank, non-numeric or negative means the default of 3. */
export function businessDaysSetting(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") return 3;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 3;
}
