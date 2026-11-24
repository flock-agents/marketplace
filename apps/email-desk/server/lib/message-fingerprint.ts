// A fetched message's identity across reads: how the harvest tells the messages an earlier
// extraction of a thread read from the new ones (renderSegments). Gmail's print view, the
// harvest's default read, carries no message ids, and the thread view that does marks the mail
// read, so the id is our own: a hash of what both views give every message (getThread /
// getThreads, through messagesFromThreadDom) — the sender's address, the minute the date names
// (the date string as read when it does not parse), and the start of the message's own text
// (`bodyMain`, the text without its quoted history, when one was split off).
//
// A message the two views render differently (other text, a date that does not parse) gets
// another fingerprint and so reads as NEW. That is the intended failure direction: at worst a
// fact deduplicated a second time, never a message's facts lost. Keep it that way.
import { createHash } from "node:crypto";
import { extractEmailAddress } from "./draft-eligibility";
import { parseGmailDateTime } from "./gmail-date";

/** How much of the message's own text the fingerprint covers. */
const TEXT_PREFIX_CHARS = 200;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * The message's fingerprint, or undefined when the read gave it no date or no text. Without a
 * date, two short notes from one sender ("Thanks!") would share one, and the second would be
 * taken for read. Pure.
 */
export function messageFingerprint(m: { from?: unknown; date?: unknown; body?: unknown; bodyMain?: unknown }): string | undefined {
  const date = str(m.date).trim();
  const text = (str(m.bodyMain) || str(m.body)).replace(/\s+/g, " ").trim().slice(0, TEXT_PREFIX_CHARS);
  if (!date || !text) return undefined;
  // "Tue, Oct 27, 2026, 2:12 PM" and "27 Oct 2026, 14:12" are one minute, so one message.
  const when = parseGmailDateTime(date) ?? date;
  return createHash("sha256").update([extractEmailAddress(str(m.from)), String(when), text].join("\n")).digest("hex");
}
