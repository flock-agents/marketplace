// Who a draft's reply reaches, derived in code (Ruling P3-R5; Flock's R-C16 and R-C18). A person's standing mail rule in
// Flock sends a draft's card only when the card names exactly the people the rule covers; so the card carries who the
// reply reaches (`to`, `cc`) and the set itself (`replyAllRecipients`), never the model's words.
//
// The set comes from Gmail's own read of the thread (reply_context's live getThread, the read the reply is written from):
// the newest message's sender plus everyone on its To and Cc, minus the mailbox. Gmail's Reply all on that message reaches
// exactly them, and only when nothing points the reply elsewhere: a Reply-To naming anyone but the sender, or a read that
// could not tell (no verified header rows, a cached read), gives no set. Nor does a newest message the person wrote
// themselves, a read older than ADDRESSING_FRESH_MS when the draft is written, or a draft Gmail did not open as the reply
// the set needs (more than one person and not Reply all). No set: the card carries none, and no rule sends it (fail
// closed). The set is kept on the draft's row, so every publish of its card carries the same.
import { extractEmailAddress } from "../lib/draft-eligibility";

export interface ReplyAddressing {
  /** The newest message's sender, as Gmail shows it ("Name <addr>"). */
  to: string;
  /** Everyone else the reply reaches, comma-separated addresses; "" when no one. */
  cc: string;
  /** Every address the reply reaches, the sender first, lower-cased, once each. */
  recipients: string[];
}

/** How long a thread read stands for the draft written from it. */
export const ADDRESSING_FRESH_MS = 15 * 60_000;

const address = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const a = extractEmailAddress(raw);
  return a.includes("@") ? a : null;
};

/** Who Gmail's Reply all on the read's newest message reaches, or null when the read cannot say (see the file header). */
export function replyAddressingOf(read: unknown, mailbox: string): ReplyAddressing | null {
  const own = (mailbox || "").trim().toLowerCase();
  if (!own) return null;
  const messages = Array.isArray((read as { messages?: unknown })?.messages) ? (read as { messages: any[] }).messages : [];
  const last = messages[messages.length - 1];
  if (!last || typeof last !== "object") return null;
  const from = address(last.from);
  if (!from || from === own) return null;
  if (last.replyToKnown !== true || !Array.isArray(last.replyTo)) return null;
  if (!last.replyTo.every((r: unknown) => address(r) === from)) return null;
  if (!Array.isArray(last.to) || !Array.isArray(last.cc)) return null;
  const others: string[] = [];
  for (const raw of [...last.to, ...last.cc]) {
    const a = address(raw);
    if (!a || a === own || a === from || others.includes(a)) continue;
    others.push(a);
  }
  return { to: String(last.from).trim(), cc: others.join(", "), recipients: [from, ...others] };
}

/** The last live read of each thread (account + thread): who its reply reaches, and when it was read. */
const reads = new Map<string, { at: number; addressing: ReplyAddressing | null }>();
const keyOf = (accountId: string, threadId: string) => `${accountId}\u0000${threadId}`;
let clock: () => number = () => Date.now();

/** reply_context read the thread live: what that read says the reply reaches (null: it cannot say). */
export function noteThreadRead(accountId: string, threadId: string, addressing: ReplyAddressing | null): void {
  reads.set(keyOf(accountId, threadId), { at: clock(), addressing });
}

/** Who the draft just written on the thread reaches: the thread's last live read, while fresh, when Gmail opened the reply
 *  that reaches them (`replyMode` from createReplyDraft). Null otherwise. */
export function addressingForDraft(accountId: string, threadId: string, replyMode: unknown): ReplyAddressing | null {
  const read = reads.get(keyOf(accountId, threadId));
  if (!read?.addressing || clock() - read.at > ADDRESSING_FRESH_MS) return null;
  const mode = typeof replyMode === "string" ? replyMode : "";
  const fits = read.addressing.recipients.length > 1 ? mode === "reply-all" : mode === "reply" || mode === "reply-all";
  return fits ? read.addressing : null;
}

/** Tests: forget every read, and set the clock (null: the real one). */
export function _resetAddressingForTesting(now: (() => number) | null = null): void {
  reads.clear();
  clock = now ?? (() => Date.now());
}
