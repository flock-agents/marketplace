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
//
// Gmail's Reply all answers whatever message is newest when the draft is composed, which may be newer than the read the
// set came from. So the set is bound to the read's newest message (newestMessageKey), and create_draft reads the thread
// again once the draft is written (confirmedAddressing): only when that read's newest message is the same one, reaching
// the same people, does the draft keep the set. A message that came in between, or a read that fails, gives none.
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

/** Which message is the read's newest: its sender, date and the start of its text. Null when the read holds none. */
export function newestMessageKey(read: unknown): string | null {
  const messages = Array.isArray((read as { messages?: unknown })?.messages) ? (read as { messages: any[] }).messages : [];
  const last = messages[messages.length - 1];
  if (!last || typeof last !== "object") return null;
  const from = address(last.from);
  if (!from) return null;
  const date = typeof last.date === "string" ? last.date.trim() : "";
  const body = typeof last.body === "string" ? last.body.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  return `${from}|${date}|${body}`;
}

/** What a draft written from a read reaches, bound to the read's newest message. */
export interface DraftAddressing { addressing: ReplyAddressing; newestKey: string }

/** The last live read of each thread (account + thread): who its reply reaches, which message was newest, and when it was
 *  read. */
const reads = new Map<string, { at: number; addressing: ReplyAddressing | null; newestKey: string | null }>();
const keyOf = (accountId: string, threadId: string) => `${accountId}\u0000${threadId}`;
let clock: () => number = () => Date.now();

/** reply_context read the thread live: what that read says the reply reaches (null: it cannot say). */
export function noteThreadRead(accountId: string, threadId: string, addressing: ReplyAddressing | null, newestKey: string | null = null): void {
  reads.set(keyOf(accountId, threadId), { at: clock(), addressing: addressing && newestKey ? addressing : null, newestKey });
}

/** Who the draft just written on the thread may reach: the thread's last live read, while fresh, when Gmail opened the reply
 *  that reaches them (`replyMode` from createReplyDraft). Null otherwise. Still to be confirmed (confirmedAddressing). */
export function addressingForDraft(accountId: string, threadId: string, replyMode: unknown): DraftAddressing | null {
  const read = reads.get(keyOf(accountId, threadId));
  if (!read?.addressing || !read.newestKey || clock() - read.at > ADDRESSING_FRESH_MS) return null;
  const mode = typeof replyMode === "string" ? replyMode : "";
  const fits = read.addressing.recipients.length > 1 ? mode === "reply-all" : mode === "reply" || mode === "reply-all";
  return fits ? { addressing: read.addressing, newestKey: read.newestKey } : null;
}

/** The set, when Gmail's read of the thread taken after the draft was written (`reread`, null when it failed) shows the
 *  same newest message reaching the same people; else null. */
export function confirmedAddressing(candidate: DraftAddressing, reread: unknown, mailbox: string): ReplyAddressing | null {
  if (!reread || newestMessageKey(reread) !== candidate.newestKey) return null;
  const now = replyAddressingOf(reread, mailbox);
  if (!now || now.to !== candidate.addressing.to || now.cc !== candidate.addressing.cc
    || now.recipients.join(",") !== candidate.addressing.recipients.join(",")) return null;
  return candidate.addressing;
}

/** Tests: forget every read, and set the clock (null: the real one). */
export function _resetAddressingForTesting(now: (() => number) | null = null): void {
  reads.clear();
  clock = now ?? (() => Date.now());
}
