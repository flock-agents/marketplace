// The draft's approval card on Home (Op contract "Draft card shape"; Twitter desk routes/drafts.ts publishDraftCard, the
// built-in desk's approval-card.ts buildDraftCardBody). One card per draft, `draft:<id>`; publishing again upserts it, so
// an agent's update shows the new body on the same card and Flock re-posts its line.
//
// The card names the record, never the text: Send runs this app's `send_draft` with `{ id }`, which re-reads the draft as
// it stands at the press (passesEdit hands it the person's edit; byReply lets their "send" reply be the press). What the
// card shows: the message being answered (the built-in card's message block) and the draft.
import type { Database } from "bun:sqlite";
import type { PlatformContext } from "@flock/app-sdk";
import { rfc5322Actor } from "../journal";
import { isSentRow } from "../lib/sent-row";
import { THREAD_BODY_SEPARATOR } from "../lib/thread-format";
import { getStore } from "../store";
import type { DraftRecord } from "./records";

export const DRAFT_SOURCE_PREFIX = "draft:";
export const draftSourceRef = (id: string): string => `${DRAFT_SOURCE_PREFIX}${id}`;

/** What a card shows of one text at most (the built-in card's CARD_BODY_MAX). */
const CARD_TEXT_MAX = 8000;
const DEFAULT_WHY = "A reply is drafted for you. Nothing sends until you press Send.";

let log: (line: string) => void = (line) => console.warn(line);
/** Tests: silence (or capture) the card's warnings; null restores console.warn. */
export function _setLogForTesting(fn: ((line: string) => void) | null): void {
  log = fn ?? ((line) => console.warn(line));
}

/** The message a reply answers: who wrote it and what it said. */
export interface AnsweredMessage {
  /** The journal event id of the message, when it came from the journal. */
  eventId: string | null;
  /** As shown: "Name <addr>", or the address alone. */
  from: string;
  address: string;
  /** The sender's name for the card's title; the address when no name is known. */
  name: string;
  to?: string;
  date?: string;
  subject?: string;
  body: string;
  quoted?: string;
}

const clip = (s: string): string => (s.length > CARD_TEXT_MAX ? `${s.slice(0, CARD_TEXT_MAX - 1)}…` : s);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function shown(name: string, address: string): string {
  if (name && address && name !== address) return `${name} <${address}>`;
  return address || name;
}

/** The text of the newest message of a stored thread written by `address` (the separator format each message opens with
 *  `From: <who>`), without its From line. Falls back to the newest message of all. */
function messageText(threadBody: string, address: string): string {
  const parts = threadBody.split(THREAD_BODY_SEPARATOR).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return "";
  const lower = address.toLowerCase();
  const pick = [...parts].reverse().find((p) => !!lower && /^From:/i.test(p) && p.split("\n", 1)[0]!.toLowerCase().includes(lower))
    ?? parts[parts.length - 1]!;
  return pick.replace(/^From:[^\n]*\n?/i, "").trim();
}

/**
 * The message the draft answers. The reply_messages row reply_context keeps (the built-in card's source) when there is
 * one, else the journal: the thread's newest message not sent by the person, else its newest at all. Null when this copy
 * holds nothing of the thread.
 */
export function answeredMessage(db: Database, accountId: string, threadId: string): AnsweredMessage | null {
  const kept = db.query("SELECT * FROM reply_messages WHERE account_id = ? AND thread_id = ?").get(accountId, threadId) as any;
  const rows = db.query(
    `SELECT e.event_id, e.actor, e.ts, e.raw, e.preview, COALESCE(c.body, e.body) AS body
       FROM ingest_events e
       LEFT JOIN ingest_content c ON c.source_id = e.source_id AND c.account_id = e.account_id AND c.event_id = e.event_id
      WHERE e.account_id = ? AND e.thread_key = ?
      ORDER BY e.ts DESC, e.created_at DESC`,
  ).all(accountId, threadId) as any[];
  const parse = (s: unknown): Record<string, unknown> => { try { return typeof s === "string" && s ? JSON.parse(s) : {}; } catch { return {}; } };
  const journal = rows.map((r) => ({ ...r, raw: parse(r.raw), actor: parse(r.actor) }));
  const newest = journal.find((r) => !isSentRow(r)) ?? journal[0];

  if (kept && str(kept.from_addr) && str(kept.body)) {
    const who = rfc5322Actor(kept.from_addr);
    const address = who.email || str(kept.from_addr);
    return {
      eventId: newest?.event_id ?? null,
      from: str(kept.from_addr), address, name: who.email ? str(who.name) || address : address,
      ...(str(kept.to_addrs) ? { to: str(kept.to_addrs) } : {}),
      ...(str(kept.date_text) ? { date: str(kept.date_text) } : {}),
      ...(str(kept.subject) ? { subject: str(kept.subject) } : {}),
      body: str(kept.body),
      ...(str(kept.quoted) ? { quoted: str(kept.quoted) } : {}),
    };
  }
  if (!newest) return null;
  const address = str(newest.actor.email);
  const rawName = str(newest.actor.name);
  const name = rawName && !rawName.includes("@") ? rawName : address || rawName;
  const subject = str(newest.raw.subject) || str(newest.preview).split(" — ")[0]!.trim();
  const body = (typeof newest.body === "string" && newest.body.trim() ? messageText(newest.body, address) : "")
    || str(newest.raw.snippet) || str(newest.preview);
  return {
    eventId: newest.event_id,
    from: shown(name, address),
    address,
    name,
    ...(Number.isFinite(newest.ts) ? { date: new Date(newest.ts).toISOString() } : {}),
    ...(subject ? { subject } : {}),
    body,
  };
}

/** Publishes (or re-publishes) the draft's card as it stands now. Never throws: the draft is already in Gmail, and a card
 *  that failed is logged, not a failed draft. */
export async function publishDraftCard(platform: PlatformContext, draft: DraftRecord): Promise<boolean> {
  try {
    const m = answeredMessage(getStore(), draft.accountId, draft.threadId);
    const blocks: Record<string, unknown>[] = [];
    if (m) {
      blocks.push({
        type: "message", from: m.from,
        ...(m.to ? { to: m.to } : {}), ...(m.date ? { date: m.date } : {}), ...(m.subject ? { subject: m.subject } : {}),
        body: clip(m.body),
        ...(m.quoted ? { quoted: clip(m.quoted) } : {}),
      });
    }
    blocks.push({ type: "draft", from: "You", to: m?.from ?? "", body: clip(draft.bodyWritten) });

    const published = await platform.tasks.publish({
      title: `Reply to ${m?.name || "this email"}`,
      sourceRef: draftSourceRef(draft.id),
      context: {
        why: draft.why || DEFAULT_WHY,
        // The copy's own agent, whoever it is (an Inbox Assistant, the Butler, any agent the person paired): never the
        // caller's, never an assumed PA.
        agentId: platform.pairedAgent?.id,
        // The draft's Gmail thread and mailbox (F-R16): Flock's thread-keyed checks (dedup, Sent view, Discuss seed) read them.
        threadId: draft.threadId,
        accountId: draft.accountId,
        // Who the reply reaches, derived in code (drafts/addressing.ts): a standing mail rule in Flock sends the card only
        // when these name exactly its people. Left out when unknown, so no rule sends it.
        ...(draft.replyAll ? { to: draft.replyAll.to, cc: draft.replyAll.cc, replyAllRecipients: draft.replyAll.recipients } : {}),
        // Made in one of this copy's routine runs (Ruling P3-R14/R15): only then may a standing rule send it. Never set
        // for a draft the person asked for in chat.
        ...(draft.automated ? { automated: true } : {}),
        card: { blocks, draftSaveOp: "update_draft" },
      },
      actions: [{
        id: "send", label: "Send", kind: "primary", sideEffect: true,
        executor: { mode: "app", op: "send_draft", opArgs: { id: draft.id }, passesEdit: true, byReply: true },
      }],
    });
    if (!published.ok) {
      log(`[email-desk] card publish refused for draft ${draft.id}: ${published.skipped ? published.reason : (published.message ?? published.reason)}`);
      return false;
    }
    return true;
  } catch (e: any) {
    log(`[email-desk] card publish threw for draft ${draft.id}: ${e?.message ?? e}`);
    return false;
  }
}

/** Takes the draft's card off Home. Idempotent; never throws. */
export async function withdrawDraftCard(platform: PlatformContext, id: string): Promise<void> {
  try {
    const r = await platform.tasks.withdraw(draftSourceRef(id));
    if (!r.ok && !r.skipped) log(`[email-desk] card withdraw failed for draft ${id}: ${r.message ?? r.reason}`);
  } catch (e: any) {
    log(`[email-desk] card withdraw threw for draft ${id}: ${e?.message ?? e}`);
  }
}
