// The sampling half of the voice crawl: which sent rows are worth a 10-second thread read, and how to get the person's
// OWN prose out of a thread once it is read. Ported unchanged from Flock's email-desk/voice-sampling.ts (Task 2.9); only
// the date parser's import moved (lib/gmail-date.ts, the same code).
//
// Everything here is pure so the expensive decisions (a read costs ~10s on the browser path) can be tested without a
// browser. The read loop lives in crawl.ts and calls into this.

import { parseGmailDate } from "../lib/gmail-date";

export interface SentRow { from?: string; subject?: string; snippet?: string; date?: string; link?: string; id?: string }
export interface ThreadMessageLike { from?: string; to?: string[]; cc?: string[]; date?: string; body?: string }
export interface Candidate { threadId: string; date: string }

/** A sample must carry this much of the user's own prose to teach anything. */
export const MIN_SAMPLE_CHARS = 300;
/** Voice lives in the opening and the sign-off, not paragraph twelve (Stych measured
 *  a 24,937-char median sent body). */
export const SAMPLE_CHAR_CAP = 1200;
/**
 * How many usable samples the profile is built from, and the read budget to find them.
 *
 * 25/40 -> 10/20 (owner, 2026-09-16), because the crawl is now PACED like the harvest
 * (voice-crawl.ts READ_PAUSE_MIN/MAX_MS) and a read costs 45-90s instead of 2-6s. At the
 * old counts that is 40 x 75s = fifty minutes of browser time for a profile nothing
 * user-facing waits on.
 *
 * Ten is defensible because the filters here already guarantee what a sample IS: 300+
 * chars of the user's own prose (MIN_SAMPLE_CHARS), one sample per thread (prefilterSentRows
 * dedupes by thread id), no forwards, no auto-replies, inside 180 days. Ten distinct real
 * conversations, not ten lines.
 *
 * THE RATIO IS THE PART THAT MUST NOT SHRINK. MAX_READS is the budget for FINDING
 * MAX_SAMPLES: a read whose body fails isUsableSample still spends a read. 20/10 is 2.0
 * reads per sample against the old 40/25's 1.6 -- more headroom for rejections, not less.
 *
 * NOT YET MEASURED: whether a profile from 10 samples reads as well as one from 25. That
 * is the one thing arithmetic cannot settle; build both on the same mailbox and compare.
 */
export const MAX_SAMPLES = 10;
export const MAX_READS = 20;
export const WINDOW_DAYS = 180;
/** Gmail truncates a row snippet near 100 chars, so a SHORT snippet is evidence of a
 *  short body. This is the one-liner filter that costs no read. */
export const MIN_SNIPPET_CHARS = 90;

const FORWARD_RE = /^\s*(fwd?|fw):/i;
const AUTO_REPLY_RE = /^\s*(automatic reply|auto[- ]?reply|out of office|ooo\b)/i;

/** A subject never worth a read: a forward carries someone else's prose, an auto-reply a
 *  template. Shared by the row prefilter and the batch (getThreads) path, which only learns
 *  the subject once the thread is already read. */
export function isSkippableSentSubject(subject: unknown): boolean {
  const s = typeof subject === "string" ? subject : "";
  return FORWARD_RE.test(s) || AUTO_REPLY_RE.test(s);
}

export function threadIdFromPermalink(link: string): string {
  if (typeof link !== "string" || !link.includes("#")) return "";
  const frag = link.slice(link.indexOf("#") + 1);
  const id = frag.split("/").pop() ?? "";
  return id.trim();
}

/**
 * Rows worth spending a read on, newest first, one per thread.
 * Never throws: a row we cannot read is a row we skip.
 */
export function prefilterSentRows(rows: SentRow[], now: Date): Candidate[] {
  const cutoff = now.getTime() - WINDOW_DAYS * 86_400_000;
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const row of rows ?? []) {
    if (isSkippableSentSubject(row?.subject)) continue;
    const snippet = typeof row?.snippet === "string" ? row.snippet : "";
    if (snippet.trim().length < MIN_SNIPPET_CHARS) continue;
    const date = typeof row?.date === "string" ? row.date : "";
    const ts = date ? parseGmailDate(date, now) : null;
    if (ts !== null && ts < cutoff) continue;
    // searchEmails returns `id` (already a thread id, not a permalink); a
    // `link` is only ever present from a getThread-style caller, so it takes
    // priority when both are there. threadIdFromPermalink("") yields "" and
    // falls through to `id`, which is the live shape (id set, no link).
    const fromLink = threadIdFromPermalink(typeof row?.link === "string" ? row.link : "");
    const threadId = fromLink || (typeof row?.id === "string" ? row.id.trim() : "");
    if (!threadId || seen.has(threadId)) continue;
    seen.add(threadId);
    out.push({ threadId, date });
  }
  return out;
}

const QUOTE_MARKERS: RegExp[] = [
  /^\s*On .+ wrote:\s*$/im,
  /^\s*-{2,}\s*Original Message\s*-{2,}/im,
  /^\s*-{5,}\s*Forwarded message\s*-{5,}/im,
  /^\s*_{10,}\s*$/m,
];

/** Everything from the first quote marker (or the first run of `>` lines) onward. */
export function stripQuotedReply(body: string): string {
  let text = typeof body === "string" ? body : "";
  let cut = text.length;
  for (const re of QUOTE_MARKERS) {
    const m = re.exec(text);
    if (m && m.index < cut) cut = m.index;
  }
  const quoted = /^\s*>.*$/m.exec(text);
  if (quoted && quoted.index < cut) cut = quoted.index;
  return text.slice(0, cut).trim();
}

/** A `-- ` line and everything after it. */
export function stripSignature(body: string): string {
  const text = typeof body === "string" ? body : "";
  const m = /^--\s*$/m.exec(text);
  return (m ? text.slice(0, m.index) : text).trim();
}

/**
 * Most real signatures carry no `-- ` marker; they are simply the same three lines
 * at the bottom of every message. Anything of four lines or fewer that ends three or
 * more samples is one, so remove it from each.
 */
export function stripSharedTrailer(samples: string[]): string[] {
  const counts = new Map<string, number>();
  for (const s of samples) {
    const lines = s.split("\n");
    for (let n = 1; n <= 4 && n <= lines.length - 1; n++) {
      const tail = lines.slice(-n).join("\n").trim();
      if (tail.length < 3) continue;
      counts.set(tail, (counts.get(tail) ?? 0) + 1);
    }
  }
  const trailers = [...counts.entries()]
    .filter(([, n]) => n >= 3)
    .map(([tail]) => tail)
    .sort((a, b) => b.length - a.length);
  if (trailers.length === 0) return samples;
  return samples.map((s) => {
    for (const tail of trailers) {
      if (s.trimEnd().endsWith(tail)) return s.trimEnd().slice(0, -tail.length).trim();
    }
    return s;
  });
}

function addressOf(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return (m ? m[1] : from).trim().toLowerCase();
}

/** The last message the owner wrote in this thread, quoted history and signature gone. */
export function ownMessageText(messages: ThreadMessageLike[], ownerAddress: string): string {
  const owner = (ownerAddress || "").trim().toLowerCase();
  if (!owner) return "";
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const from = typeof list[i]?.from === "string" ? list[i].from! : "";
    if (addressOf(from) !== owner) continue;
    const body = typeof list[i]?.body === "string" ? list[i].body! : "";
    const text = stripSignature(stripQuotedReply(body));
    if (text) return text;
  }
  return "";
}

export function isUsableSample(text: string): boolean {
  return (text ?? "").trim().length >= MIN_SAMPLE_CHARS;
}

export function capSample(text: string): string {
  return (text ?? "").slice(0, SAMPLE_CHAR_CAP);
}
