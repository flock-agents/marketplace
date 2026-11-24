// Pure helpers for reply_context and the follow-up kind, ported from Flock's email-desk/reply-context.ts (topicTerms,
// assembleReplyContext's caps) and follow-up-rules.ts (followUpKindForTo). No store, no Gmail.
import { extractEmailAddress } from "./draft-eligibility";

// Words that say nothing about WHAT a thread is about. Matched lowercased.
const FILLER = new Set([
  "re", "fw", "fwd", "status", "update", "updates", "question", "questions", "quick", "follow", "followup",
  "up", "regarding", "query", "request", "meeting", "call", "hi", "hello", "the", "a", "an", "and", "or",
  "of", "for", "on", "in", "to", "with", "your", "our", "my", "is", "are", "from", "about", "next", "steps",
  "reminder", "urgent", "please", "thanks", "thank", "you",
]);

/** The subject's key terms, in order: no reply prefixes, filler words or bare numbers. */
export function topicTerms(subject: string): string {
  const stripped = (subject || "").replace(/^(\s*(re|fwd?|fw)\s*:\s*)+/i, "");
  const out: string[] = [];
  for (const word of stripped.split(/[^A-Za-z0-9]+/)) {
    if (word.length < 2 || /^\d+$/.test(word) || FILLER.has(word.toLowerCase())) continue;
    if (!out.some((w) => w.toLowerCase() === word.toLowerCase())) out.push(word);
  }
  return out.join(" ");
}

export interface ContextMessage { from: string; to: string; date: string; body: string }
export interface ContextThread { subject: string; messages: ContextMessage[] }

const THREAD_MESSAGES = 6;
const THREAD_BODY_CHARS = 4_000;
export const MEMORY_FACTS = 8;

const cap = (text: unknown, n: number): string => {
  const s = typeof text === "string" ? text : "";
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

/** `to` as one line: a list joins, a string stays. */
const toLine = (v: unknown): string =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").join(", ") : typeof v === "string" ? v : "";

/** Gmail's getThread answer as the context's thread: the newest messages, bodies capped. Null when it holds no message. */
export function threadFromRead(raw: any): ContextThread | null {
  const list = Array.isArray(raw?.messages) ? raw.messages : [];
  if (list.length === 0) return null;
  return {
    subject: typeof raw.subject === "string" ? raw.subject : "",
    messages: list.slice(-THREAD_MESSAGES).map((m: any) => ({
      from: typeof m?.from === "string" ? m.from : "",
      to: toLine(m?.to),
      date: typeof m?.date === "string" ? m.date : "",
      body: cap(m?.body, THREAD_BODY_CHARS),
    })),
  };
}

/** The person being answered: the newest message's sender, unless that is the mailbox's own, then whoever wrote before. */
export function senderOf(messages: readonly { from: string }[], mailbox: string): string {
  const own = (mailbox || "").toLowerCase();
  for (let i = messages.length - 1; i >= 0; i--) {
    const addr = extractEmailAddress(messages[i]!.from);
    if (addr && addr !== own) return addr;
  }
  return "";
}

/** A follow-up's kind: the first ADDRESS on a To line (a header string or a list), bare and lower-cased, so a quoted display
 *  name holding a comma ("Rao, Keshav" <k@x>) is not split. Null when the line names no address (fail open). */
export function followUpKindForTo(to: string | readonly string[] | null | undefined): string | null {
  const line = Array.isArray(to) ? to.join(", ") : ((to as string | null | undefined) ?? "");
  const m = line.match(/<([^<>\s]+@[^<>\s]+)>|([^\s,<>"]+@[^\s,<>"]+)/);
  return m ? extractEmailAddress(m[1] ?? m[2]!) : null;
}
