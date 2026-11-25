// getEmail.ts — one email thread's text, as one joined body.
//
// PRINT VIEW FIRST (2026-11-25). The conversation view loads the whole Gmail app to show one
// thread; on a cloud Flock that traffic goes through the paid proxy. Gmail's print view is one
// static page holding every message (_printView.ts), and it leaves the thread unread. When it
// fails, shows no message, or its newest message has no text, the read falls back to the
// conversation view, as before.
//
// SAME MEANING EITHER WAY. The conversation view opens the thread on its NEWEST message, so body,
// date and snippet are that message's; from and senders keep the conversation view's order
// (first sender first), and messageCount counts the thread's messages.
//
// The pure parts (emailFromPrintView, emailFromThreadView, readEmail) are exported and
// unit-tested with fakes; the browser-driving body only runs as a skill script (SKILL_PARAMS set).

import {
  errorJson,
  requireBrowserSession,
  validateId,
  browserWrite,
  browserInteract,
} from "../../_shared/_google_helpers";
import { printViewUrl, PRINT_BLOCKS_EXPR, rowsFromPrintBlocks } from "./_printView";

export interface EmailRead {
  subject: string;
  from: string;
  date: string;
  body: string;
  snippet: string;
  senders: Array<{ name: string; email: string }>;
  messageCount: number;
}

const SNIPPET_CHARS = 200;
/** A print read that does not show the thread can cost the whole read; keep it short. */
export const PRINT_VIEW_TIMEOUT_MS = 15_000;

function senderLine(sender: EmailRead["senders"][number] | undefined): string {
  if (!sender) return "";
  return sender.name ? `${sender.name} <${sender.email}>` : sender.email;
}

function parseJson(content: unknown): any {
  if (typeof content !== "string") return content ?? null;
  try { return JSON.parse(content); } catch { return null; }
}

/** The print view's reply (PRINT_BLOCKS_EXPR) as an email; null when it holds no message, or
 *  its newest message has no text (not a read to trust). */
export function emailFromPrintView(content: unknown): EmailRead | null {
  const parsed = parseJson(content);
  const blocks = Array.isArray(parsed?.blocks) ? parsed.blocks : [];
  if (blocks.length === 0) return null;
  const rows = rowsFromPrintBlocks(blocks);
  const newest = rows[rows.length - 1];
  const body = (newest.body ?? "").trim();
  if (!body) return null;
  const senders = rows.map((r) => ({ name: r.fromName ?? "", email: r.fromEmail ?? "" }));
  return {
    subject: typeof parsed.subject === "string" ? parsed.subject : "",
    from: senderLine(senders[0]),
    date: newest.date ?? "",
    body,
    snippet: body.substring(0, SNIPPET_CHARS),
    senders,
    messageCount: rows.length,
  };
}

/** The conversation view's reply (THREAD_VIEW_EXPR), read as it always was. */
export function emailFromThreadView(content: unknown): Partial<EmailRead> {
  return parseJson(content) ?? {};
}

export interface EmailReadIo {
  /** The print view's page content, or null when the read failed. */
  printView(url: string): Promise<unknown>;
  /** The conversation view's page content (a failure ends the script, as it always has). */
  threadView(url: string): Promise<unknown>;
}

export function threadViewUrl(messageId: string): string {
  return `https://mail.google.com/mail/u/0/#inbox/${messageId}`;
}

export async function readEmail(io: EmailReadIo, messageId: string): Promise<Partial<EmailRead> & { id: string; readVia: "print" | "thread" }> {
  const printed = emailFromPrintView(await io.printView(printViewUrl(messageId)).catch(() => null));
  if (printed) return { ...printed, id: messageId, readVia: "print" };
  return { ...emailFromThreadView(await io.threadView(threadViewUrl(messageId))), id: messageId, readVia: "thread" };
}

const THREAD_VIEW_EXPR = `(() => {
  const subject = document.querySelector('h2.hP')?.textContent?.trim() || '';
  const senders = Array.from(document.querySelectorAll('.gD')).map(s => ({
    name: s.textContent?.trim() || '',
    email: s.getAttribute('email') || ''
  }));
  const dates = Array.from(document.querySelectorAll('.g3')).map(d => d.textContent?.trim() || '');
  const messages = Array.from(document.querySelectorAll('.a3s.aiL')).map(b => b.textContent?.trim() || '');
  const from = senders.length > 0
    ? (senders[0].name ? senders[0].name + ' <' + senders[0].email + '>' : senders[0].email)
    : '';
  const body = messages.join('\\n---\\n');
  return JSON.stringify({
    subject,
    from,
    date: dates[0] || '',
    body: body || '',
    snippet: (body || '').substring(0, 200),
    senders,
    messageCount: messages.length
  });
})()`;

const browserEmailIo: EmailReadIo = {
  // soft: a failed print read must fall back, never end the script.
  printView: async (url) =>
    (await browserInteract(url, [], "table.message", PRINT_BLOCKS_EXPR, { soft: true, timeout: PRINT_VIEW_TIMEOUT_MS }))?.content ?? null,
  threadView: async (url) => (await browserWrite(url, THREAD_VIEW_EXPR, ".a3s.aiL"))?.content || "{}",
};

// Every module-level const the script reads sits above this guard (gmail-scripts-load.test.ts).
if (process.env.SKILL_PARAMS !== undefined) {
  runScript();
}

function runScript(): void {
  const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
  const messageId: string = params.messageId || "";

  requireBrowserSession();

  if (!messageId) {
    errorJson("MISSING_PARAM", "messageId is required");
  }
  validateId(messageId, "messageId");

  (async () => {
    console.log(JSON.stringify(await readEmail(browserEmailIo, messageId)));
  })();
}
