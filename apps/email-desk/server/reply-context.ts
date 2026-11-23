// reply_context (Op contract): everything a reply is written from, gathered here rather than left to the model. The thread
// (Gmail's own read as the copy's paired agent; the journal's stored text when Gmail cannot be read), what memory holds on
// its topic or sender, the person's voice, and the thread's open draft.
//
// Ported from Flock's email-desk/reply-context.ts gatherReplyContext. Not carried over: the related-mail searches (browser
// sessions of 10-25 s each; the contract has no field for them). The voice (Task 2.9) comes from the copy's own store
// through the injected `voiceBlockFor` (registry.ts passes voice/block.ts) and its state from the crawl (voice/crawl.ts):
// "ready" with a block, else "learning" while a crawl is in flight, else "none".
import type { PlatformContext } from "@flock/app-sdk";
import { getStore } from "./store";
import { THREAD_BODY_SEPARATOR } from "./lib/thread-format";
import { MEMORY_FACTS, senderOf, threadFromRead, topicTerms, type ContextThread } from "./lib/reply-context";
import { notDeskThreadRefusal, type DraftRefusal } from "./drafts/rules";
import { getDraftForThread } from "./drafts/records";
import { deskThreadAccount, type OpCtx } from "./ops";
import type { ReadTurnResult } from "./platform-ext";
import { voiceStateFor as crawlVoiceState, type VoiceState } from "./voice/crawl";

export type { VoiceState };

export interface ReplyContextAnswer {
  thread: ContextThread;
  sender: { facts: string[] };
  voice: string | null;
  voiceState: VoiceState;
  existingDraft: { id: string; body: string } | null;
}

/** The person's voice for one mailbox, as the block a draft is written from; null while there is none. */
export type VoiceBlockFor = (accountId: string) => string | null;
export const noVoiceYet: VoiceBlockFor = () => null;
/** Whether a mailbox without a block is learning its voice or has none. */
export type VoiceStateFor = (accountId: string) => VoiceState;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** The thread as the journal stored it (the message texts the harvest parked, oldest first), when Gmail cannot be read. */
function storedThread(accountId: string, threadId: string): ContextThread | null {
  const row = getStore().query(
    `SELECT COALESCE(c.body, e.body) AS body, COALESCE(c.raw, e.raw) AS raw, COALESCE(c.actor, e.actor) AS actor, e.ts AS ts
       FROM ingest_events e
       LEFT JOIN ingest_content c ON c.source_id = e.source_id AND c.account_id = e.account_id AND c.event_id = e.event_id
      WHERE e.account_id = ? AND e.thread_key = ? AND COALESCE(c.body, e.body) IS NOT NULL AND TRIM(COALESCE(c.body, e.body)) != ''
      ORDER BY e.ts DESC, e.created_at DESC LIMIT 1`,
  ).get(accountId, threadId) as { body: string; raw: string | null; actor: string | null; ts: number } | null;
  if (!row) return null;
  const json = (s: string | null): Record<string, unknown> => { try { const o = s ? JSON.parse(s) : {}; return o && typeof o === "object" ? o : {}; } catch { return {}; } };
  const raw = json(row.raw);
  const actor = json(row.actor);
  const fallbackFrom = str(actor.email) ? (str(actor.name) ? `${str(actor.name)} <${str(actor.email)}>` : str(actor.email)) : str(actor.name);
  const parts = row.body.split(THREAD_BODY_SEPARATOR).map((p) => p.trim()).filter(Boolean);
  const messages = parts.map((part, i) => {
    const named = part.match(/^From: ([^\n]*)\n([\s\S]*)$/);
    const newest = i === parts.length - 1;
    // Only the newest message's time is known to the journal.
    return { from: named ? named[1]!.trim() : fallbackFrom, to: [] as string[], date: newest ? str(raw.dateFull) || str(raw.date) : "", body: (named ? named[2]! : part).trim() };
  });
  return threadFromRead({ subject: str(raw.subject), messages });
}

/** One thread read's timeout (gather's THREAD_TIMEOUT_MS): a read, not the write budget of a draft. */
const READ_TIMEOUT_MS = 90_000;
export const REPLY_CONTEXT_CONSUMER = "email-desk:reply-context";

/** Gmail's read of the thread, under the mailbox's read turn. A turn that is refused (busy, paused, not this person's) or a
 *  failed read answers null, and the caller uses the stored text: the agent's call never waits behind the mailbox. */
async function liveThread(platform: PlatformContext, accountId: string, threadId: string): Promise<ContextThread | null> {
  if (!platform.connectors.readTurn) return null;
  let turn: ReadTurnResult;
  try {
    turn = await platform.connectors.readTurn(accountId, REPLY_CONTEXT_CONSUMER, { skillId: "gmail" });
  } catch { return null; }
  if (!turn.ok) return null;
  try {
    const r = await platform.connectors.exec<unknown>({
      skillId: "gmail", functionName: "getThread", params: { threadId }, accountHint: accountId,
      timeoutMs: READ_TIMEOUT_MS, turnId: turn.data.turnId,
    });
    if (!r.ok) return null;
    const data: any = typeof r.data === "string" ? safeParse(r.data) : r.data;
    return threadFromRead(data);
  } catch { return null; } finally {
    try { await turn.data.release(); } catch { /* released by its ttl otherwise */ }
  }
}

async function readThread(ctx: OpCtx, accountId: string, threadId: string): Promise<ContextThread | null> {
  return (await liveThread(ctx.platform, accountId, threadId)) ?? storedThread(accountId, threadId);
}

const safeParse = (s: string): unknown => { try { return JSON.parse(s); } catch { return null; } };

/** The copy's own address for a mailbox, to tell the person's messages from the sender's. */
async function mailboxAddress(platform: PlatformContext, accountId: string): Promise<string> {
  try {
    const r = await platform.connectors.accounts?.("gmail");
    if (r?.ok) return (r.data?.accounts ?? []).find((a) => a.accountId === accountId)?.email ?? "";
  } catch { /* the sender then falls back to the newest message's */ }
  return "";
}

/** What memory holds on the thread's topic, else on its sender (keyword search needs every term to match, so the topic
 *  alone; the sender only as a fallback). Best effort: a draft from the thread alone is better than none. */
async function senderFacts(platform: PlatformContext, subject: string, sender: string): Promise<string[]> {
  const query = topicTerms(subject) || sender;
  if (!query) return [];
  try {
    const r = await platform.memory.search(query, { limit: MEMORY_FACTS });
    return r.ok ? (r.data?.facts ?? []).filter((f) => typeof f === "string" && f.trim()).slice(0, MEMORY_FACTS) : [];
  } catch { return []; }
}

export async function replyContext(
  p: Record<string, unknown>, ctx: OpCtx, voiceBlockFor: VoiceBlockFor = noVoiceYet,
  voiceStateFor: VoiceStateFor = crawlVoiceState,
): Promise<ReplyContextAnswer | DraftRefusal> {
  const threadId = str(p.threadId);
  // A thread of any of this person's mailboxes works: with no accountId, the mailbox the journal holds it in.
  const accountId = deskThreadAccount(threadId, str(p.accountId));
  if (!accountId) return notDeskThreadRefusal();

  const thread = (await readThread(ctx, accountId, threadId)) ?? { subject: "", messages: [] };
  const sender = senderOf(thread.messages, await mailboxAddress(ctx.platform, accountId));
  const facts = await senderFacts(ctx.platform, thread.subject, sender);

  const voice = voiceBlockFor(accountId);
  const draft = getDraftForThread(getStore(), accountId, threadId);
  return {
    thread,
    sender: { facts },
    voice,
    // A block is a voice to write with; without one, "learning" only while a crawl is in flight (never "ready").
    voiceState: voice ? "ready" : voiceStateFor(accountId) === "learning" ? "learning" : "none",
    existingDraft: draft && draft.sentAt === null ? { id: draft.id, body: draft.bodyWritten } : null,
  };
}

