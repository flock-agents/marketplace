// The memory-extraction routine: the person's new mail into their memory, their TODOs and their family's calendar, then
// the routine's agent woken for the mail that may want a reply.
//
// Ported from Flock's built-in desk: memory-relay.ts (blockToItem, the relay's POST to /api/memory/extract) and the extract
// half of harvest-runner.ts (one call per block, a failed or deferred block left for the next run, the rows marked only
// once their facts were committed, the family run's one push). The read half is gather.ts (Task 2.3).
//
// One run, per account of the routine:
//   1. gather (gather.ts): read new mail under the mailbox lease and keep what the rules keep. A held mailbox ends the run
//      ok with the note; the next run reads it.
//   2. extract: `platform.memory.extract` in chunks of EXTRACT_SERVABLE_ITEMS (what one call can serve before Flock's socket
//      limit). Facts go to the paired agent's memory (the person's) and TODOs to their Home, as today: Flock writes both. A
//      chunk that fails (refused, timed out, or answered with a failed item) does not stop the next; its mail stays pending
//      and is offered again next run. A deferred chunk (Flock's hourly write limit) is left pending without a failure.
//   3. family: a personal mailbox asks for its family items back (`source.familyCandidates`). They are planned into Family
//      Calendar items and sent in ONE import per run through Flock's gate (family/push.ts). With nowhere to send them, or a
//      failed send, the to-dos Flock held go on Home.
//   4. wake: the draft-eligible mail that went into memory and has no open draft is offered to the routine's agent, whoever
//      it is: one line of counts, the mail itself only in `data`.
//   5. hand over (seen.ts markHandedOver) what went into memory, so it is never offered twice. Mail whose wake failed is
//      not handed over, so it is offered (and woken for) again next run.
// A run with a failure throws once everything else is done, so the owner's routine history shows it.
//
// CLOSURE (ruling R12). The extraction closes a TODO once the thread shows it done, but only a TODO the item carries
// (`context.openTasks`). The person's own reply, which usually finishes it, now reaches this routine as kept sent mail
// (gather, ruling R11), so the built-in desk's daily closure RE-READS are not needed for it. What is still missing is the
// list of the thread's open TODOs: they are Flock's board rows (source "gmail"), which `tasks.list` cannot see. The seam's
// optional `board.openTasks` is the proposed read; until Flock serves it, items carry none and nothing is closed here.
import type { RoutineContext } from "@flock/app-sdk";
import { routineCtx, type ExtractAnswer, type ImportPayload, type OpenTaskWire, type RoutineCtx } from "../platform-ext";
import { getStore } from "../store";
import { THREAD_BODY_SEPARATOR } from "../lib/thread-format";
import { localDayStart, processTimezone, todayIn } from "../lib/local-day";
import { gatherNewMail, EARLIER_MESSAGE_MARK, type GatherResult, type KeptMail } from "./gather";
import { markHandedOver } from "./seen";
import { FamilyPushBatch, NAMING_SCHEMA, emailLabel, slugOf, type HeldTask, type ImportCallResult } from "../family/push";
import { householdNames, personFirstName } from "../family/context";

/**
 * How many items one memory.extract call can serve. NOT EXPORTED BY THE SDK, so mirrored here from its formula
 * (@flock/app-sdk context.ts EXTRACT_SERVABLE_ITEMS): the platform spends about EXTRACT_PER_ITEM_TIMEOUT_MS (120 s) per item
 * and the SDK waits at most EXTRACT_MAX_TIMEOUT_MS (240 s), under the platform's 255 s socket limit. Change it with them.
 */
const EXTRACT_PER_ITEM_TIMEOUT_MS = 120_000;
const EXTRACT_MAX_TIMEOUT_MS = 240_000;
export const EXTRACT_SERVABLE_ITEMS = Math.max(1, Math.floor(EXTRACT_MAX_TIMEOUT_MS / EXTRACT_PER_ITEM_TIMEOUT_MS));

/** memory-relay MAX_RELAY_MESSAGES: how many messages of one thread ride the wire. */
const MAX_ITEM_MESSAGES = 200;
/** harvest-runner MAX_OPEN_TASKS_PER_BLOCK. */
const MAX_OPEN_TASKS_PER_ITEM = 20;
const SNIPPET_CHARS = 200;
const GMAIL = "gmail";

/** The wake's one line: counts only. */
export function wakeLine(n: number): string {
  return `${n} new mails may want a reply.`;
}

let log: (line: string) => void = (line) => console.log(line);
/** Tests: capture or silence the run's log lines (null restores the console). */
export function _setLogForTesting(fn: ((line: string) => void) | null): void {
  log = fn ?? ((line) => console.log(line));
}
const say = (accountId: string, what: string) => log(`[email-desk] memory-extraction account=${accountId} ${what}`);

// ---- the wire item -------------------------------------------------------------------------------------------------------

/** One message of a kept thread, as the extract item carries it (memory-relay messagesForWire). */
export interface ItemMessage { index: number; from: string; text: string }

/** The thread kept apart, message by message, oldest first: KeptMail.body split back on its separator. */
export function messagesOf(body: string): ItemMessage[] {
  return body.split(THREAD_BODY_SEPARATOR).slice(0, MAX_ITEM_MESSAGES).map((raw, index) => {
    let text = raw.trim();
    if (text.startsWith(EARLIER_MESSAGE_MARK)) text = text.slice(EARLIER_MESSAGE_MARK.length).trim();
    const head = /^From:[ \t]*(.*)\n?/i.exec(text);
    const from = head ? head[1]!.trim() : "";
    if (head) text = text.slice(head[0].length).trim();
    return { index, from, text };
  });
}

/** A link the person can click, on the right account (Flock's mailbox.ts gmailThreadLink); the journal's own otherwise. */
export function threadLink(email: string | null | undefined, threadId: string): string {
  return email
    ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#all/${encodeURIComponent(threadId)}`
    : `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(threadId)}`;
}

/** The thread's open TODOs as the item carries them (harvest buildOpenTaskRefs): T1..Tn in the order they were made. The
 *  anchor is what Flock stored; Flock re-resolves it against its own row before closing anything. */
export function openTaskRefs(tasks: readonly OpenTaskWire[]): Array<Record<string, unknown>> {
  return [...tasks]
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, MAX_OPEN_TASKS_PER_ITEM)
    .map((t, i) => ({
      ref: `T${i + 1}`,
      id: t.id,
      title: t.title,
      ...(typeof t.why === "string" && t.why.trim() ? { why: t.why } : {}),
      anchor: typeof t.anchor === "number" ? t.anchor : null,
      createdAt: t.createdAt,
    }));
}

/** A kept mail as a /api/memory/extract item (memory-relay blockToItem). Enumerated, never spread; optional fields omitted. */
export function keptToItem(k: KeptMail, owner: { email: string | null }, openTasks: readonly OpenTaskWire[] = []): Record<string, unknown> {
  const messages = messagesOf(k.body);
  const participants = [...new Set(messages.map((m) => m.from).filter(Boolean))];
  const context: Record<string, unknown> = {};
  if (owner.email) context.ownerAddresses = [owner.email];
  if (k.mailboxKind === "personal") context.mailboxKind = "personal";
  const refs = openTaskRefs(openTasks);
  if (refs.length > 0) context.openTasks = refs;
  const ts = Date.parse(k.date);
  const item: Record<string, unknown> = {
    id: k.threadId,
    text: k.body,
    timestamp: Number.isFinite(ts) ? new Date(ts).toISOString() : new Date().toISOString(),
    reference: threadLink(owner.email, k.threadId),
    context,
  };
  if (participants.length > 0) item.participants = participants;
  if (messages.length > 0) item.messages = messages;
  return item;
}

/** The newest message's words, short: what the wake's data shows of a mail. */
function snippetOf(body: string): string {
  const last = messagesOf(body).at(-1)?.text ?? "";
  const flat = last.replace(/\s+/g, " ").trim();
  return flat.length <= SNIPPET_CHARS ? flat : `${flat.slice(0, SNIPPET_CHARS - 1).trimEnd()}…`;
}

// ---- the run -------------------------------------------------------------------------------------------------------------

export interface MemoryExtractionDeps {
  gather?: (ctx: RoutineCtx, accountId: string) => Promise<GatherResult>;
  handOver?: (ids: readonly string[]) => void;
}

/** The routine handler (flock.app.json routines[].handler "memory-extraction"). */
export async function memoryExtraction(ctx: RoutineContext): Promise<void> {
  await runMemoryExtraction(routineCtx(ctx));
}

export async function runMemoryExtraction(ctx: RoutineCtx, deps: MemoryExtractionDeps = {}): Promise<void> {
  const gather = deps.gather ?? ((c, a) => gatherNewMail(c, a));
  const handOver = deps.handOver ?? markHandedOver;
  const accounts = await routineAccounts(ctx);
  const failures: string[] = [];
  for (const { accountId, email } of accounts) {
    try {
      await runAccount(ctx, accountId, email, gather, handOver, failures);
    } catch (e: any) {
      failures.push(`${accountId}: ${e?.message ?? String(e)}`);
    }
  }
  if (failures.length) throw new Error(failures.join("; "));
}

/** The routine's Gmail account (one per account for an event routine), else every Gmail account the agent holds. */
async function routineAccounts(ctx: RoutineCtx): Promise<Array<{ accountId: string; email: string | null }>> {
  let known: Array<{ accountId: string; email: string | null }> = [];
  try {
    const r = await ctx.platform.connectors.accounts(GMAIL);
    if (r.ok) known = (r.data?.accounts ?? []).map((a) => ({ accountId: a.accountId, email: a.email ?? null }));
  } catch { /* the address is a nice-to-have: the routine's own account still runs */ }
  const own = ctx.routine.accounts?.[GMAIL];
  if (own) return [{ accountId: own, email: known.find((a) => a.accountId === own)?.email ?? null }];
  return known;
}

async function runAccount(
  ctx: RoutineCtx,
  accountId: string,
  email: string | null,
  gather: NonNullable<MemoryExtractionDeps["gather"]>,
  handOver: NonNullable<MemoryExtractionDeps["handOver"]>,
  failures: string[],
): Promise<void> {
  const g = await gather(ctx, accountId);
  if (g.busy) {
    say(accountId, `ended: ${g.note ?? "mailbox busy"}`);
    return;
  }
  if (g.note) say(accountId, g.note);
  if (g.kept.length === 0) return;

  const personal = g.kept.some((k) => k.mailboxKind === "personal");
  const openTasks = await openTasksFor(ctx, g.kept);

  // 2. EXTRACT, chunk by chunk.
  const extracted: KeptMail[] = [];
  const family = personal ? await openFamilyBatch(ctx) : null;
  let failed = 0;
  const reasons = new Set<string>();
  for (let i = 0; i < g.kept.length; i += EXTRACT_SERVABLE_ITEMS) {
    const chunk = g.kept.slice(i, i + EXTRACT_SERVABLE_ITEMS);
    const items = chunk.map((k) => keptToItem(k, { email }, openTasks.get(k.threadId)));
    const source: Record<string, unknown> = { type: "email", connectorSkill: GMAIL, account: accountId };
    if (personal) source.familyCandidates = true;
    let r: Awaited<ReturnType<RoutineCtx["platform"]["memory"]["extract"]>>;
    try {
      r = await ctx.platform.memory.extract<ExtractAnswer>(items, source);
    } catch (e: any) {
      r = { ok: false, reason: e?.message ?? String(e) };
    }
    if (!r.ok) {
      failed += chunk.length;
      reasons.add(r.skipped ? "not paired" : r.reason);
      continue;
    }
    const answer = (r.data ?? {}) as ExtractAnswer;
    // The family items Flock wrote and held come back whatever else happened: they are placed either way.
    if (family && Array.isArray(answer.family?.blocks)) family.batch.addBlocks(answer.family!.blocks);
    // One call answers for the whole chunk, so a failed item fails the chunk: it is offered again, never marked done.
    if ((answer.failedItems ?? 0) > 0) {
      failed += chunk.length;
      reasons.add("an item failed");
      continue;
    }
    if ((answer.deferredItems ?? 0) > 0) {
      say(accountId, `deferred ${chunk.length} mail(s): Flock's write limit; left for the next run`);
      continue;
    }
    extracted.push(...chunk);
  }
  if (failed > 0) {
    const why = [...reasons].join(", ");
    say(accountId, `extract failed for ${failed} mail(s): ${why}`);
    failures.push(`${failed} of ${g.kept.length} mails could not be read into memory (${why})`);
  }

  // 3. FAMILY: the run's one import.
  if (family && !family.batch.isEmpty) await flushFamily(ctx, accountId, email, family);

  // 4. WAKE for what may want a reply.
  const toWake = draftCandidates(extracted);
  const notWoken = new Set<string>();
  if (toWake.length > 0) {
    const mails = toWake.map((k) => ({ threadId: k.threadId, accountId: k.accountId, from: k.from, subject: k.subject, snippet: snippetOf(k.body) }));
    let woke: Awaited<ReturnType<RoutineCtx["wakeAgent"]>>;
    try {
      woke = await ctx.wakeAgent(wakeLine(toWake.length), { mails });
    } catch (e: any) {
      woke = { ok: false, reason: e?.message ?? String(e) };
    }
    if (!woke.ok) {
      for (const k of toWake) notWoken.add(k.messageId);
      const why = woke.skipped ? "not paired" : woke.reason;
      say(accountId, `could not wake the agent: ${why}`);
      failures.push(`could not wake the agent (${why})`);
    }
  }

  // 5. HAND OVER what went into memory (and, for mail that wanted a reply, reached the agent).
  const ids = extracted.map((k) => k.messageId).filter((id) => !notWoken.has(id));
  if (ids.length > 0) handOver(ids);
  say(accountId, `kept=${g.kept.length} extracted=${extracted.length} failed=${failed} woke=${notWoken.size ? 0 : toWake.length}`);
}

/** Draft-eligible mail with no open draft on its thread, one per thread. */
function draftCandidates(mail: readonly KeptMail[]): KeptMail[] {
  const db = getStore();
  const open = db.query("SELECT 1 FROM draft_records WHERE account_id = ? AND thread_id = ? AND sent_at IS NULL LIMIT 1");
  const seen = new Set<string>();
  const out: KeptMail[] = [];
  for (const k of mail) {
    const key = `${k.accountId}\u0000${k.threadId}`;
    if (!k.draftEligible || seen.has(key)) continue;
    seen.add(key);
    if (open.get(k.accountId, k.threadId)) continue;
    out.push(k);
  }
  return out;
}

/** The kept threads' open TODOs, when Flock serves them (seam `board.openTasks`); none otherwise. Never throws. */
async function openTasksFor(ctx: RoutineCtx, mail: readonly KeptMail[]): Promise<Map<string, OpenTaskWire[]>> {
  const byThread = new Map<string, OpenTaskWire[]>();
  const read = ctx.platform.board?.openTasks;
  if (!read) return byThread;
  try {
    const r = await read({ connectorSkill: GMAIL, threadKeys: [...new Set(mail.map((k) => k.threadId))] });
    if (!r.ok) return byThread;
    for (const t of r.data?.tasks ?? []) {
      if (!t || typeof t.id !== "string" || typeof t.threadKey !== "string" || typeof t.title !== "string" || typeof t.createdAt !== "number") continue;
      byThread.set(t.threadKey, [...(byThread.get(t.threadKey) ?? []), t]);
    }
  } catch { /* no closure this run; the next run asks again */ }
  return byThread;
}

// ---- the family push -----------------------------------------------------------------------------------------------------

interface FamilyRun { batch: FamilyPushBatch; tz: string }

async function openFamilyBatch(ctx: RoutineCtx): Promise<FamilyRun> {
  const tz = processTimezone();
  const [names, first] = await Promise.all([householdNames(ctx), personFirstName(ctx)]);
  return { tz, batch: new FamilyPushBatch({ sourceId: ctx.platform.appId, label: emailLabel(first), today: todayIn(tz), tz, familyNames: names }) };
}

async function flushFamily(ctx: RoutineCtx, accountId: string, email: string | null, run: FamilyRun): Promise<void> {
  const fam = ctx.platform.family;
  let target: string | null = null;
  try {
    const t = fam?.targets && fam.importEvents ? await fam.targets() : null;
    const ids = t && t.ok ? t.data?.appIds ?? [] : [];
    target = ids[0] ?? null;
    if (ids.length > 1) say(accountId, `family_push_target ${ids[0]} (the oldest group's); not used: ${ids.slice(1).join(", ")}`);
  } catch { target = null; }

  const send = async (payload: ImportPayload): Promise<ImportCallResult> => {
    if (!target || !fam?.importEvents) return { ok: false, error: "no Family Calendar to import into" };
    const r = await fam.importEvents(payload);
    return r.ok ? { ok: true, answer: r.data?.answer } : { ok: false, error: r.skipped ? "not paired" : (r.message ?? r.reason) };
  };
  const out = await run.batch.flush({
    send,
    // Named only when there is somewhere to send it: the call costs a model call.
    name: target && ctx.platform.model?.json
      ? async (prompt) => {
        const r = await ctx.platform.model!.json({ ...prompt, schema: NAMING_SCHEMA, tier: "fast", maxTokens: 2000, purpose: "family-calendar-names" });
        if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
        return r.json !== undefined ? JSON.stringify(r.json) : r.text ?? "";
      }
      : undefined,
    publishTasks: (held) => publishHome(ctx, email, held, run.tz),
    log: (outcome, detail) => say(accountId, `${outcome} ${detail}`),
  });
  if (out.ok !== null || out.tasksPublished > 0) {
    say(accountId, `family push ok=${out.ok} sent=${out.sent} fellBack=${out.fellBack} home=${out.tasksPublished}`);
  }
}

/** Home, for the family to-dos the push could not take: one of this app's TODOs each, keyed on its thread and title. */
async function publishHome(ctx: RoutineCtx, email: string | null, held: HeldTask[], tz: string): Promise<number> {
  let n = 0;
  for (const h of held) {
    const t = h.task;
    const due = dueOf(t.due ?? null, tz);
    const r = await ctx.platform.tasks.publish({
      title: t.title,
      sourceRef: `todo:${h.threadKey}#${slugOf(t.title)}`,
      deeplink: threadLink(email, h.threadKey),
      ...(t.detail ? { body: t.detail } : {}),
      ...(due ? { due: due.at, dueTimed: due.timed } : {}),
      context: { threadId: h.threadKey, audience: t.audience ?? "family" },
    });
    if (r.ok) n++;
  }
  return n;
}

function dueOf(due: string | null, tz: string): { at: number; timed: boolean } | null {
  if (!due) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) {
    const at = localDayStart(due, tz);
    return at === null ? null : { at, timed: false };
  }
  const at = Date.parse(due);
  return Number.isFinite(at) ? { at, timed: true } : null;
}
