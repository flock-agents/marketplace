// The follow-up routine: sent mail nobody answered raises a TODO for the person's paired agent, and an answer withdraws it.
//
// Ported from Flock's built-in desk: follow-up-runner.ts (the daily pass, its caps and its day stamp), follow-up-rules.ts
// (lib/follow-up-rules.ts), follow-up-store.ts (follow-up-store.ts here) and the sent list of sent-source.ts. Once a day
// per mailbox (the routine runs on each hourly new-mail event and gates itself on the person's follow-up hour, as the source
// did): list the recent sent threads, read the few old enough to matter (print view, which leaves mail unread), keep those
// where the PERSON spoke last N business days ago, and raise ONE TODO per thread: `tasks.publish` with the source ref
// `follow-up:<threadId>`, addressed to the paired agent (never an assumed PA). A reply withdraws it (`tasks.withdraw`).
//
// WHAT CHANGED FROM THE BUILT-IN DESK. It woke the Inbox Assistant in a session of its own with the day's candidates, gave
// that session a grant to draft a follow-up on exactly those threads, judged the session's turn (`considered`, `nudged`,
// `not_needed`) and discarded its untouched draft when a reply landed. None of that is here: the routine writes no draft and
// wakes no agent. The TODO is the offer, and the person (with their agent, when they ask) decides. So the grant window, the
// wake outcome handling, the settle's draft proofs and the kind drop (Flock applies it to the TODO) are gone; the statuses
// are `waiting`, `offered` (the TODO is up) and `replied` (answered, or closed because the person wrote again).
//
// EVERY GMAIL READ runs inside ONE read turn (`connectors.readTurn(account, "email-desk:follow-up")`), released on every path
// out. A held or paused mailbox, or a refusal from the account guard, leaves the day due. A heavy day spans ticks: a pass
// reads at most `maxReads` threads, remembers what it read today, and the next tick carries on; the day is stamped only
// when the sent list was worked through or the daily limit was reached.
//
// THE REPLY CHECK IS CHEAP. Every run (hourly, before the daily gate) looks in the journal, which the gather keeps, for a
// message on a TODO's thread newer than the TODO that is neither sent mail nor the person's own: that is a reply, with no
// Gmail read. The daily pass catches the rest when it reads the thread again.
import type { RoutineContext } from "@flock/app-sdk";
import { NO_READ_TURNS, routineCtx, type ReadTurnResult, type RoutineCtx } from "../platform-ext";
import { getStore } from "../store";
import { SENT_LIST_MAX, sentQuery } from "../journal";
import { extractEmailAddress } from "../lib/draft-eligibility";
import { decideNudgeEligibility, nextFollowUpAction, ownerMsgKey, businessDaysSetting, type NudgeThread, type FollowUpStatus } from "../lib/follow-up-rules";
import { followUpKindForTo } from "../lib/reply-context";
import { isSentRow } from "../lib/sent-row";
import { addBusinessDays } from "../lib/business-days";
import { parseGmailDate, parseGmailDateTime } from "../lib/gmail-date";
import { processTimezone } from "../lib/local-day";
import { stopReason } from "./gather";
import { threadLink } from "./memory-extraction";
import { getFollowUp, listFollowUps, listFollowUpsOfferedSince, lastFollowUpRunAt, putFollowUp, recordFollowUpRun, type FollowUpRow } from "./follow-up-store";

/** The read turn's consumer name: Flock's lease and its logs say who holds the mailbox. */
export const FOLLOW_UP_CONSUMER = "email-desk:follow-up";
/** One pass's worst case: a paced list and up to MAX_READS_PER_PASS thread reads. */
export const FOLLOW_UP_TURN_TTL_MS = 20 * 60_000;
const GMAIL = "gmail";
const LIST_TIMEOUT_MS = 2 * 60_000;
const THREAD_TIMEOUT_MS = 90_000;
/** Thread reads per pass (ruling M6): paced reads must fit the turn; a heavier day continues on the next hourly tick. */
const MAX_READS_PER_PASS = 15;
/** Owner decision 2026-09-24: follow-ups for at most 25 threads a day per mailbox, by default. */
const DEFAULT_DAILY_LIMIT = 25;
/** The pause between thread reads: a background pass reads like a person, not a crawler. */
const READ_PACE_MS = 1500;
const SETTLE_MAX_ROWS = 5000;

export interface FollowUpConfig { hour: number; businessDays: number; lookbackDays: number; dailyLimit: number; maxReads: number }

/** The routine's settings, with defaults. Reads per pass are a fixed cap, not derived from the daily limit. */
export function followUpConfig(filter: Record<string, unknown> = {}): FollowUpConfig {
  const rawHour = filter.followUpHour;
  const hour = rawHour !== undefined && rawHour !== null && rawHour !== "" && Number.isFinite(Number(rawHour)) ? Number(rawHour) : 8;
  const dailyLimit = Number(filter.dailyLimit) >= 1 ? Math.floor(Number(filter.dailyLimit)) : DEFAULT_DAILY_LIMIT;
  return {
    hour,
    // 0 is a real setting ("follow up the same day", for trying the routine out); only an absent, blank, non-numeric or
    // negative value falls back to the default of 3.
    businessDays: businessDaysSetting(filter.businessDays),
    lookbackDays: Number(filter.lookbackDays) > 0 ? Number(filter.lookbackDays) : 14,
    dailyLimit,
    maxReads: MAX_READS_PER_PASS,
  };
}

export interface FollowUpDeps {
  now: () => number;
  tz: () => string;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}
const realDeps = (): FollowUpDeps => ({
  now: () => Date.now(),
  tz: () => processTimezone(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  log: (line) => console.log(line),
});

export interface FollowUpTally {
  /** True when the day's work is done and the caller should stamp it: the sent list was worked through or the daily limit was
   *  reached. False (the day stays due; the next tick continues) when there is no mailbox address, the mailbox was held, the
   *  sent list failed, the account guard stopped the pass, the read cap stopped it with rows left, or a TODO did not publish. */
  completed: boolean;
  listed: number; read: number; offered: number; settled: number;
}

function localDateKey(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}
function localHour(ms: number, tz: string): number {
  return parseInt(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(new Date(ms)), 10) % 24;
}
export function isFollowUpDue(lastRunAt: number | null, now: number, hour: number, tz: string): boolean {
  if (localHour(now, tz) < hour) return false;
  return lastRunAt === null || localDateKey(lastRunAt, tz) !== localDateKey(now, tz);
}

/** A first name for the TODO: the first To's display name, else the first piece of its local part ("priya.shah@x" -> "Priya"). */
function fallbackName(to: string[]): string {
  const first = (to[0] ?? "").trim();
  if (!first) return "";
  const display = first.match(/^\s*"?([^"<]+?)"?\s*</)?.[1]?.trim();
  if (display && !display.includes("@")) return display.split(/\s+/)[0]!;
  const local = extractEmailAddress(first).split("@")[0] ?? "";
  const piece = local.split(/[._+-]/)[0] ?? "";
  return piece ? piece[0]!.toUpperCase() + piece.slice(1) : "";
}

/** What this local day has already done per account, in memory (a restart only costs re-reads): threads read today that need
 *  no second read today, so the next tick of a heavy day continues past them. */
const passMemory = new Map<string, { day: string; read: Set<string> }>();
function dayMemory(accountId: string, day: string): { day: string; read: Set<string> } {
  const m = passMemory.get(accountId);
  if (m && m.day === day) return m;
  const fresh = { day, read: new Set<string>() };
  passMemory.set(accountId, fresh);
  return fresh;
}
export function _resetFollowUpPassMemoryForTesting(): void { passMemory.clear(); }

export const followUpRef = (threadId: string): string => `follow-up:${threadId}`;

/** States that are a final answer for their message until new mail lands on the thread. */
const DECIDED = new Set<FollowUpStatus>(["offered", "replied"]);

const plain = (s: string): string => s.replace(/[–—]/g, "-").replace(/--+/g, "-").replace(/\s+/g, " ").trim();

function parsed(data: unknown): any {
  if (typeof data !== "string") return data;
  try { return JSON.parse(data); } catch { return null; }
}

/** Takes a thread's TODO down. True when it is gone (or never was up); false leaves the row as it was for the next run. */
async function withdrawTodo(ctx: RoutineCtx, row: FollowUpRow, deps: FollowUpDeps): Promise<boolean> {
  if (row.status !== "offered") return true;
  try {
    const r = await ctx.platform.tasks.withdraw(followUpRef(row.threadId), { reason: "replied" });
    if (r.ok || r.skipped) return true;
    deps.log(`[email-desk] follow-up ${row.accountId}/${row.threadId}: withdraw failed (${r.message ?? r.reason}); left for the next run`);
  } catch (e: any) {
    deps.log(`[email-desk] follow-up ${row.accountId}/${row.threadId}: withdraw threw (${e?.message ?? e}); left for the next run`);
  }
  return false;
}

/** They replied: the TODO comes down and the row is closed. Marks the row `replied` only once the TODO is gone. */
async function settleOne(ctx: RoutineCtx, row: FollowUpRow, deps: FollowUpDeps): Promise<boolean> {
  if (!(await withdrawTodo(ctx, row, deps))) return false;
  putFollowUp({ ...row, status: "replied", checkedAt: deps.now() });
  return true;
}

interface Candidate { threadId: string; ownerMsgKey: string; subject: string; recipientName: string; to: string[]; sentAt: number }

export async function runFollowUpForAccount(
  ctx: RoutineCtx, accountId: string, owner: string, cfgIn: Pick<FollowUpConfig, "businessDays" | "lookbackDays" | "dailyLimit" | "maxReads">,
  deps: FollowUpDeps = realDeps(),
): Promise<FollowUpTally> {
  const cfg = cfgIn;
  const tally: FollowUpTally = { completed: false, listed: 0, read: 0, offered: 0, settled: 0 };
  const me = owner.trim().toLowerCase();
  if (!me) { deps.log(`[email-desk] follow-up ${accountId}: no mailbox address, skipped`); return tally; }
  const now = deps.now();
  const tz = deps.tz();

  // Today's room under the daily limit: TODOs already raised today (a second Run now) count.
  const today = localDateKey(now, tz);
  const mem = dayMemory(accountId, today);
  const offeredToday = listFollowUpsOfferedSince(accountId, now - 36 * 3600_000)
    .filter((r) => r.offeredAt !== null && localDateKey(r.offeredAt, tz) === today).length;
  const room = Math.max(0, cfg.dailyLimit - offeredToday);
  if (room === 0) {
    deps.log(`[email-desk] follow-up ${accountId}: the daily limit of ${cfg.dailyLimit} is already raised today, nothing read`);
    tally.completed = true;
    return tally;
  }

  const turn: ReadTurnResult = ctx.platform.connectors.readTurn
    ? await ctx.platform.connectors.readTurn(accountId, FOLLOW_UP_CONSUMER, { skillId: GMAIL, ttlMs: FOLLOW_UP_TURN_TTL_MS })
    : NO_READ_TURNS;
  if (!turn.ok) {
    const code = "code" in turn ? turn.code : undefined;
    deps.log(`[email-desk] follow-up ${accountId}: ${turn.skipped ? "not connected to Flock" : code === "busy" ? "mailbox busy" : `could not take the mailbox (${turn.reason})`}; day left due`);
    return tally;
  }
  const { turnId } = turn.data;
  const gmail = <T = unknown>(fn: string, params: Record<string, unknown>, timeoutMs: number) =>
    ctx.connectors.exec<T>(GMAIL, fn, params, { account: accountId, turnId, timeoutMs });

  const candidates: Candidate[] = [];
  let limitReached = false;
  let cappedWithRowsLeft = false;
  let stopped = false;
  try {
    const listed = await gmail("searchEmails", { query: sentQuery(cfg.lookbackDays), maxResults: SENT_LIST_MAX }, LIST_TIMEOUT_MS);
    if (!listed.ok) {
      const stop = stopReason(listed);
      deps.log(`[email-desk] follow-up ${accountId}: ${stop ? `stopped by the account guard (${stop})` : "sent list failed"}; day left due`);
      return tally;
    }
    const data = parsed(listed.data);
    const rows = (Array.isArray(data) ? data : []) as Array<{ id: string; dateFull?: string; date?: string }>;
    tally.listed = rows.length;

    for (const row of rows) {
      if (candidates.length >= room) { limitReached = true; break; }
      if (!row?.id) continue;
      // Read earlier today with nothing to raise (or already raised today): an earlier tick's work.
      if (mem.read.has(row.id)) continue;
      // Coarse age filter off the row date (day-precise for older mail): never read a thread that cannot possibly be due.
      // A row we cannot date is read (fail toward looking, not skipping).
      const rowAt = parseGmailDateTime(row.dateFull ?? "") ?? parseGmailDate(row.date ?? "", new Date(now));
      const prev = getFollowUp(accountId, row.id);
      // A thread we hold a row for is read whatever its age: the person may have written again, or they may have replied
      // (a newer sent-list date), and the TODO has to come down.
      if (!prev && rowAt !== null && addBusinessDays(rowAt, cfg.businessDays, tz) > now + 24 * 3600_000) continue;
      // Nothing on the thread since we last decided it (the sent list dates a thread by its newest message): skipped BEFORE
      // reading, so it never spends the read cap. An undatable row is read.
      if (prev && DECIDED.has(prev.status) && rowAt !== null && rowAt <= prev.checkedAt) continue;

      // The cap is checked only when another read is actually needed, so a pass whose remaining rows are all skipped
      // without a read still counts as having worked the list.
      if (tally.read >= cfg.maxReads) { cappedWithRowsLeft = true; break; }
      if (tally.read > 0) await deps.sleep(READ_PACE_MS);
      tally.read++;
      // bypassCache: the message key is the raw date string, whose format differs between print and thread view, so a
      // thread-view cache entry served here would change the key.
      const res = await gmail("getThread", { threadId: row.id, view: "print", bypassCache: true }, THREAD_TIMEOUT_MS);
      if (!res.ok) {
        const stop = stopReason(res);
        if (stop) { deps.log(`[email-desk] follow-up ${accountId}: stopped by the account guard (${stop}); day left due`); stopped = true; break; }
        continue; // not remembered: the next tick reads it again
      }
      const thread = parsed(res.data) as NudgeThread | null;
      const last = thread?.messages?.[thread.messages.length - 1];
      const lastIsOwner = !!last && extractEmailAddress(last.from) === me;
      const key = lastIsOwner ? ownerMsgKey(last!) : null;
      const action = nextFollowUpAction(prev, { lastIsOwner, ownerMsgKey: key });
      if (action === "settle_replied") {
        if (await settleOne(ctx, prev!, deps)) { tally.settled++; mem.read.add(row.id); }
        continue;
      }
      if (action !== "judge") { mem.read.add(row.id); continue; }

      const gate = decideNudgeEligibility(me, thread!, now, cfg.businessDays, tz);
      const lastMsg = last!;
      const to = (lastMsg.to ?? []).filter((a) => extractEmailAddress(a) !== me);
      if (!gate.ok) {
        // The person wrote again since their TODO went up: it is out of date, so it comes down.
        if (prev?.status === "offered") {
          if (!(await withdrawTodo(ctx, prev, deps))) continue;
          putFollowUp({ accountId, threadId: row.id, ownerMsgKey: key!, status: !gate.ok && gate.code === "draft_nudge_too_soon" ? "waiting" : "replied", checkedAt: now });
        } else if (!gate.ok && gate.code === "draft_nudge_too_soon") {
          putFollowUp({ accountId, threadId: row.id, ownerMsgKey: key!, status: "waiting", checkedAt: now });
        }
        mem.read.add(row.id);
        continue;
      }
      candidates.push({
        threadId: row.id, ownerMsgKey: key!, subject: typeof thread!.subject === "string" ? thread!.subject : "",
        recipientName: fallbackName(to), to, sentAt: parseGmailDateTime(lastMsg.date) ?? now,
      });
    }
  } finally {
    try { await turn.data.release(); }
    catch (err: any) { deps.log(`[email-desk] follow-up ${accountId}: releasing the read turn failed: ${err?.message}`); }
  }

  // The TODOs, once the mailbox is let go. A TODO that did not publish leaves no row, so the next tick raises it.
  let publishFailed = false;
  for (const c of candidates) {
    const raised = await publishTodo(ctx, accountId, me, c, tz, deps);
    if (!raised) { publishFailed = true; continue; }
    putFollowUp({ accountId, threadId: c.threadId, ownerMsgKey: c.ownerMsgKey, status: "offered", checkedAt: now, offeredAt: now, recipientName: c.recipientName });
    mem.read.add(c.threadId);
    tally.offered++;
  }
  if (tally.offered > 0) deps.log(`[email-desk] follow-up ${accountId}: raised ${tally.offered} follow-up TODO(s)`);

  if (stopped || publishFailed) return tally;
  // Stamp the day only when the list was worked through or the daily limit reached.
  if (cappedWithRowsLeft && !limitReached) {
    deps.log(`[email-desk] follow-up ${accountId}: read cap of ${cfg.maxReads} reached with rows left; day left due, the next tick continues`);
    return tally;
  }
  tally.completed = true;
  return tally;
}

async function publishTodo(ctx: RoutineCtx, accountId: string, ownerEmail: string, c: Candidate, tz: string, deps: FollowUpDeps): Promise<boolean> {
  const name = c.recipientName;
  const subject = plain(c.subject);
  const sent = new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short" }).format(new Date(c.sentAt));
  const about = subject ? `"${subject}"` : "your email";
  const why = `No reply yet to ${about}, which you sent on ${sent}.`;
  const kind = followUpKindForTo(c.to);
  try {
    const r = await ctx.platform.tasks.publish({
      title: name ? `Follow up with ${name}` : "Follow up on an email you sent",
      sourceRef: followUpRef(c.threadId),
      deeplink: threadLink(ownerEmail, c.threadId),
      context: {
        why,
        // The copy's own agent, whoever it is (an Inbox Assistant, the Butler, any agent the person paired): never an assumed PA.
        agentId: ctx.platform.pairedAgent?.id,
        threadId: c.threadId,
        accountId,
        ...(kind ? { kindRef: { who: kind, guess: "follow-up" } } : {}),
      },
    });
    if (r.ok) return true;
    deps.log(`[email-desk] follow-up ${accountId}/${c.threadId}: TODO not raised (${r.skipped ? "not paired" : r.message ?? r.reason})`);
  } catch (e: any) {
    deps.log(`[email-desk] follow-up ${accountId}/${c.threadId}: TODO threw (${e?.message ?? e})`);
  }
  return false;
}

const actorEmail = (actor: unknown): string => {
  const o = typeof actor === "string" ? parsed(actor) : actor;
  return o && typeof o === "object" && typeof (o as any).email === "string" ? extractEmailAddress((o as any).email) : "";
};

/** Hourly, journal only: for every raised TODO, a journal row on its thread newer than the TODO, neither sent mail nor the
 *  person's own, is a reply: the TODO comes down. One walk per account from the oldest open TODO. No Gmail read. */
export async function settleRepliedFollowUps(ctx: RoutineCtx, accountId: string, owner: string, deps: FollowUpDeps = realDeps()): Promise<number> {
  const open = listFollowUps(accountId, ["offered"]);
  if (open.length === 0) return 0;
  const me = owner.trim().toLowerCase();
  if (!me) return 0; // cannot tell the person's rows from a reply: settle nothing
  const byThread = new Map(open.map((f) => [f.threadId, f]));
  const since = Math.min(...open.map((f) => f.checkedAt));
  const rows = getStore().query(
    "SELECT thread_key, ts, actor, raw FROM ingest_events WHERE source_id = 'gmail' AND account_id = ? AND ts > ? AND thread_key IS NOT NULL ORDER BY ts LIMIT ?",
  ).all(accountId, since, SETTLE_MAX_ROWS) as Array<{ thread_key: string; ts: number; actor: string | null; raw: string | null }>;
  const replied = new Set<string>();
  for (const r of rows) {
    const f = byThread.get(r.thread_key);
    if (!f || !(r.ts > f.checkedAt)) continue;
    if (isSentRow({ raw: parsed(r.raw ?? "") ?? null })) continue;
    if (actorEmail(r.actor) === me) continue;
    replied.add(f.threadId);
  }
  let settled = 0;
  for (const threadId of replied) {
    try {
      if (await settleOne(ctx, byThread.get(threadId)!, deps)) settled++;
    } catch (e: any) {
      deps.log(`[email-desk] follow-up ${accountId}/${threadId}: settle failed (${e?.message ?? e}), next thread`);
    }
  }
  return settled;
}

/** The routine's Gmail account (one per account for an event routine), else every Gmail account the agent holds. */
async function routineAccounts(ctx: RoutineCtx): Promise<Array<{ accountId: string; email: string }>> {
  let known: Array<{ accountId: string; email: string }> = [];
  try {
    const r = await ctx.platform.connectors.accounts?.(GMAIL);
    if (r?.ok) known = (r.data?.accounts ?? []).map((a) => ({ accountId: a.accountId, email: a.email ?? "" }));
  } catch { /* with no address the daily pass skips and the settle does nothing */ }
  const own = ctx.routine.accounts?.[GMAIL];
  if (own) return [{ accountId: own, email: known.find((a) => a.accountId === own)?.email ?? "" }];
  return known;
}

/** The routine handler (flock.app.json routines[].handler "follow-up"). */
export async function followUp(ctxIn: RoutineContext | RoutineCtx, deps: FollowUpDeps = realDeps()): Promise<void> {
  const ctx = routineCtx(ctxIn as RoutineContext);
  const trigger = (ctx.routine.trigger ?? {}) as { filter?: Record<string, unknown> };
  const cfg = followUpConfig({ ...(trigger.filter ?? {}), ...(ctx.routine.values ?? {}) });
  const force = ctx.trigger === "manual";
  const failures: string[] = [];
  for (const { accountId, email } of await routineAccounts(ctx)) {
    try {
      await settleRepliedFollowUps(ctx, accountId, email, deps);
      if (!force && !isFollowUpDue(lastFollowUpRunAt(accountId), deps.now(), cfg.hour, deps.tz())) continue;
      const t = await runFollowUpForAccount(ctx, accountId, email, cfg, deps);
      deps.log(`[email-desk] follow-up ${accountId}: completed=${t.completed} listed=${t.listed} read=${t.read} raised=${t.offered} settled=${t.settled}`);
      // Stamp only a pass that finished the day's work; anything else stays due for the next tick.
      if (t.completed) recordFollowUpRun(accountId, deps.now());
    } catch (e: any) {
      failures.push(`${accountId}: ${e?.message ?? String(e)}`);
    }
  }
  if (failures.length) throw new Error(failures.join("; "));
}
