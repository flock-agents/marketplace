// The voice crawl (Task 2.9): read enough of the person's own sent mail, for one mailbox, to learn how they write; then one
// model call (extract.ts) and the rows (store.ts). Ported from Flock's email-desk/voice-crawl.ts.
//
// THE MAILBOX'S TURN, ONE READ AT A TIME. Every Gmail read here runs under `connectors.readTurn(accountId,
// "email-desk:voice")`, the lease every reader of the mailbox takes its turn on, with the exec carrying the turn's id. The
// lease is a try-lock, so the crawl holds it only around its reads and RELEASES IT BEFORE EVERY PAUSE (the 45-90 s gaps, the
// session retries, the busy backoff): between reads the hourly gather and reply_context can take the mailbox. This is the
// source's yielding (yieldToAgentTurn, callWithBusyRetry) on the platform's lease: a turn refused as busy between reads is
// "come back later", retried after a backoff up to MAX_BUSY_RETRIES times, then that read is skipped like any failed read.
// The first turn decides whether the crawl starts at all: refused, no crawl ("better to skip a crawl than to read the
// mailbox out of turn", as the source said), and the next trigger asks again. The model call reads no mail and holds none.
//
// LEARNING, AND ITS CAP (spec §5.2, Review Focus 5). While a crawl or its model call is in flight, the mailbox's voice is
// "learning", and create_draft answers VOICE_LEARNING with a time to try after: the crawl's cap, VOICE_PENDING_CAP_MS from
// its start. Past the cap the mailbox is no longer learning, whatever the crawl is doing, so a wedged or slow crawl never
// blocks a draft for longer than that. A mailbox with no crawl in flight is never learning: "ready" when it has a voice,
// "none" otherwise (a draft is allowed, without voice). That is the source's rule (voicePendingFor: no crawl, not pending).
// The state is this process's: an app restart mid-crawl drops it (the mailbox reads "none") and the next trigger crawls
// again.
//
// WHO STARTS IT. `runVoiceCrawl` / `beginVoiceCrawl` are what lifecycle initialize (Task 2.10) calls per mailbox.
// `ensureVoiceCrawl` is the memory-extraction routine's catch-up for a mailbox that has no voice and no crawl in flight
// (an existing mailbox from before this app, or one whose crawl failed): RECRAWL_AFTER_MS after a clean end, sooner
// (VOICE_RETRY_AFTER_MS) after a failed or capped one.
import type { PlatformContext } from "@flock/app-sdk";
import { getStore } from "../store";
import { NO_READ_TURNS, type ReadTurnResult } from "../platform-ext";
import {
  prefilterSentRows, ownMessageText, isUsableSample, capSample, stripSharedTrailer, isSkippableSentSubject, MAX_SAMPLES, MAX_READS,
} from "./sampling";
import { extractVoice, type VoiceModel } from "./extract";
import { hasVoice, storeLearnedVoice } from "./store";

export const VOICE_CONSUMER = "email-desk:voice";

/**
 * A crawl that has not finished by here stops with what it has. A WEDGE BACKSTOP, not a deadline (source): MAX_READS (20)
 * x (8s read + 67s mean pause) is ~25 minutes, so 40 gives 1.6x. Checked BETWEEN reads, never inside one.
 */
export const CRAWL_WALL_CLOCK_MS = 40 * 60_000;
/** How long a mailbox reads as learning: the crawl's bound plus the model call after it. The VOICE_LEARNING refusal's
 *  "try after" time is the crawl's start plus this, so one retry then always drafts (with the voice, or past the cap). */
export const VOICE_PENDING_CAP_MS = CRAWL_WALL_CLOCK_MS + 5 * 60_000;
/** The catch-up crawl (ensureVoiceCrawl) tries a mailbox whose crawl ended cleanly with nothing learned (`empty`) again after
 *  this long, not every run. */
export const RECRAWL_AFTER_MS = 7 * 24 * 60 * 60_000;
/** A crawl that failed, hit its wall clock (`capped`), or ended with no outcome recorded is tried again after 6 hours: what
 *  stopped it (a sign-in, a busy mailbox, the model) usually passes within the day, and a week without a voice is too long. */
export const VOICE_RETRY_AFTER_MS = 6 * 60 * 60_000;

/** Human-shaped gap between page reads in the background (source READ_PAUSE_*: CPU duty cycle when many mailboxes crawl). */
export const READ_PAUSE_MIN_MS = 45_000;
export const READ_PAUSE_MAX_MS = 90_000;
/** The onboarding pace (a person is waiting; one crawl at a time). */
export const INTERACTIVE_READ_PAUSE_MIN_MS = 2_000;
export const INTERACTIVE_READ_PAUSE_MAX_MS = 6_000;
/** A just-connected session may not be ready: three searches over a minute. */
const SEARCH_ATTEMPTS = 3;
const SESSION_RETRY_MS = 30_000;
/** One page of Gmail reads (gather's THREAD_TIMEOUT_MS order): a browser read, not a write. */
const READ_TIMEOUT_MS = 180_000;
/** A turn lasts one read (released after it, or at the latest by this ttl): the read plus a margin. */
const READ_TURN_TTL_MS = READ_TIMEOUT_MS + 60_000;
/** A mailbox busy between reads: come back after this (source BUSY_BACKOFF_*), at most MAX_BUSY_RETRIES times per read. */
const BUSY_BACKOFF_MIN_MS = 30_000;
const BUSY_BACKOFF_MAX_MS = 60_000;
const MAX_BUSY_RETRIES = 3;

/** Voice's read: ONE newest-first page of sent mail, up to the read budget (source VOICE_THREAD_FILTERS). */
const VOICE_THREAD_FILTERS = { in: "sent" } as const;
const VOICE_PAGE_LIMIT = MAX_READS;
/** Inter-thread pace an interactive crawl asks of the connector: small, not zero (source: a zero gap collided with Gmail's
 *  own navigation). */
const INTERACTIVE_THREAD_PACE_MIN_MS = 800;
const INTERACTIVE_THREAD_PACE_MAX_MS = 1_500;
/** Body chars per message asked of getThreads: keeps every 1200-char sample whole and a page inside the result cap. */
const VOICE_MAX_BODY_CHARS = 4_000;

export interface VoiceCrawlProgress {
  accountId: string;
  address: string;
  startedAt: number;
  finishedAt?: number;
  listed: number;
  read: number;
  sampled: number;
  stored: number;
  done: boolean;
  /** True from just before the model call to just after it settles: still learning. */
  storing?: boolean;
  stopReason?: string;
  error?: string;
}

// ---- seams ---------------------------------------------------------------------------------------------------------------

let sleepImpl: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));
let nowImpl: () => number = () => Date.now();
let log: (line: string) => void = (line) => console.log(line);

/** Tests: replace the sleep, the clock or the log (null restores all three). */
export function _setVoiceCrawlSeamsForTesting(
  seams: { sleep?: (ms: number) => Promise<void>; now?: () => number; log?: (line: string) => void } | null,
): void {
  if (!seams) {
    sleepImpl = (ms) => new Promise((r) => setTimeout(r, ms));
    nowImpl = () => Date.now();
    log = (line) => console.log(line);
    return;
  }
  if (seams.sleep) sleepImpl = seams.sleep;
  if (seams.now) nowImpl = seams.now;
  if (seams.log) log = seams.log;
}

const active = new Map<string, VoiceCrawlProgress>(); // accountId -> progress

const settling = new Map<string, Promise<void>>(); // accountId -> the crawl's end

export function _resetVoiceCrawlsForTesting(): void {
  active.clear();
  settling.clear();
}

export function voiceCrawlProgress(accountId: string): VoiceCrawlProgress | null {
  return active.get(accountId) ?? null;
}

// ---- the state the ops read ----------------------------------------------------------------------------------------------

export type VoiceState = "ready" | "learning" | "none";

/** Until when this mailbox's voice is learning (epoch ms), or null when it is not: no crawl in flight, its model call
 *  settled, or past its cap. */
export function voiceLearningUntil(accountId: string, now: number = nowImpl()): number | null {
  const p = active.get(accountId);
  if (!p) return null;
  if (p.done && !p.storing) return null;
  const until = p.startedAt + VOICE_PENDING_CAP_MS;
  return now < until ? until : null;
}

/** "ready": the mailbox has a voice (a re-learn in flight changes nothing; drafts use the voice it has). "learning": a
 *  crawl is in flight and under its cap. "none": neither, and a draft goes ahead without voice. */
export function voiceStateFor(accountId: string, now: number = nowImpl()): VoiceState {
  try {
    if (hasVoice(accountId)) return "ready";
  } catch { /* no store: no voice */ }
  return voiceLearningUntil(accountId, now) !== null ? "learning" : "none";
}

/** Resolves when this mailbox stops learning: its crawl (and model call) ended, or its cap passed, whichever is first.
 *  Null when it is not learning now. Never rejects. (Ruling R22: memory-extraction holds a learning mailbox's wake to this.) */
export function whenVoiceSettles(accountId: string): Promise<void> | null {
  const until = voiceLearningUntil(accountId);
  if (until === null) return null;
  const ended = settling.get(accountId);
  const cap = sleepImpl(Math.max(0, until - nowImpl()));
  return ended ? Promise.race([ended, cap]) : cap;
}

// ---- the reads -----------------------------------------------------------------------------------------------------------

type Read = (functionName: string, params: Record<string, unknown>) => Promise<unknown | null>;
/** A gap between reads: the mailbox's turn is released first, so others may read meanwhile. */
type Pause = (ms: number) => Promise<void>;

function jitter(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min));
}
const pauseMin = (interactive?: boolean): number => interactive ? INTERACTIVE_READ_PAUSE_MIN_MS : READ_PAUSE_MIN_MS;
const pauseMax = (interactive?: boolean): number => interactive ? INTERACTIVE_READ_PAUSE_MAX_MS : READ_PAUSE_MAX_MS;

type BatchStop = "samples" | "read_cap" | "wall_clock" | "exhausted" | "unavailable";

/**
 * Read the newest sent threads in one held session (getThreads, the source's BATCH FIRST path). Returns the stop reason, or
 * "unavailable" when the first page could not be read at all, so the caller falls back to search + per-thread reads.
 */
async function readSentViaGetThreads(c: {
  read: Read; pause: Pause; address: string; progress: VoiceCrawlProgress; samples: string[]; interactive?: boolean;
}): Promise<BatchStop> {
  const { read, address, progress, samples } = c;
  let offset = 0;
  let pages = 0;
  const seen = new Set<string>(); // a thread is never sampled twice, however the page lists it
  while (samples.length < MAX_SAMPLES && progress.read < MAX_READS) {
    if (nowImpl() - progress.startedAt > CRAWL_WALL_CLOCK_MS) return "wall_clock";
    const limit = Math.min(VOICE_PAGE_LIMIT, MAX_READS - progress.read);
    const out = await read("getThreads", {
      filters: VOICE_THREAD_FILTERS, limit, offset, maxBodyChars: VOICE_MAX_BODY_CHARS,
      ...(c.interactive ? { paceMinMs: INTERACTIVE_THREAD_PACE_MIN_MS, paceMaxMs: INTERACTIVE_THREAD_PACE_MAX_MS } : {}),
    }) as any;
    // A page must be an OBJECT: anything else is a failed page, never an empty one.
    if (!out || typeof out !== "object" || Array.isArray(out)) {
      if (pages === 0) return "unavailable";
      break; // a later page failed: keep what was read
    }
    const listed = Number(out.listed) || 0;
    if (pages === 0 && listed === 0) return "unavailable"; // a hollow first search: let the fallback retry it
    pages++;
    progress.listed = Math.max(progress.listed, listed);

    const threads: any[] = Array.isArray(out.threads) ? out.threads : [];
    for (const t of threads) {
      progress.read++; // every returned thread cost a read, usable or not
      const id = String(t?.threadId ?? "");
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      if (isSkippableSentSubject(t?.subject)) continue;
      const text = ownMessageText(t?.messages ?? [], address);
      if (samples.length < MAX_SAMPLES && isUsableSample(text)) {
        samples.push(capSample(text));
        progress.sampled = samples.length;
      }
    }
    // Exhausted when a page came back short and was not cut off by its own budget; otherwise resume where the connector says.
    if (threads.length < limit && !out.truncated) break;
    const next = out.truncated && Number.isFinite(Number(out.nextOffset)) ? Number(out.nextOffset) : offset + threads.length;
    if (next <= offset) break;
    offset = next;
    await c.pause(jitter(pauseMin(c.interactive), pauseMax(c.interactive)));
  }
  if (samples.length >= MAX_SAMPLES) return "samples";
  if (progress.read >= MAX_READS) return "read_cap";
  return "exhausted";
}

/** The crawl's reads: the batch path, else one search and a read per candidate. Never throws; the samples are cleaned of a
 *  signature every sample shares. */
async function crawlSentMail(read: Read, pause: Pause, progress: VoiceCrawlProgress, interactive?: boolean): Promise<{ stop: string; samples: string[]; error?: string }> {
  const samples: string[] = [];
  const address = progress.address;
  const done = (stop: string, error?: string) => {
    const stripped = stripSharedTrailer(samples).filter(isUsableSample);
    progress.sampled = stripped.length;
    return { stop, samples: stripped, ...(error ? { error } : {}) };
  };
  try {
    const batch = await readSentViaGetThreads({ read, pause, address, progress, samples, interactive });
    if (batch !== "unavailable") return done(batch);

    // A session that is not ready yet looks exactly like a search that failed: three attempts over a minute.
    let rows: unknown = null;
    for (let attempt = 0; attempt < SEARCH_ATTEMPTS; attempt++) {
      rows = await read("searchEmails", { query: "in:sent", maxResults: 50 });
      if (rows !== null) break;
      if (attempt < SEARCH_ATTEMPTS - 1) await pause(SESSION_RETRY_MS);
    }
    if (rows === null) return done("session_not_ready", "search failed");
    const candidates = prefilterSentRows((Array.isArray(rows) ? rows : []) as never, new Date(nowImpl()));
    progress.listed = candidates.length;

    for (const candidate of candidates) {
      if (samples.length >= MAX_SAMPLES) return done("samples");
      if (progress.read >= MAX_READS) return done("read_cap");
      if (nowImpl() - progress.startedAt > CRAWL_WALL_CLOCK_MS) return done("wall_clock");
      const thread: any = await read("getThread", { threadId: candidate.threadId });
      if (thread && typeof thread === "object") {
        progress.read++;
        const text = ownMessageText(thread.messages ?? [], address);
        if (isUsableSample(text)) {
          samples.push(capSample(text));
          progress.sampled = samples.length;
        }
      }
      // Paced the same way, success or failure: a burst of fast failures is least like a person reading mail.
      await pause(jitter(pauseMin(interactive), pauseMax(interactive)));
    }
    return done("exhausted");
  } catch (e: any) {
    return done("error", e?.message ?? String(e));
  }
}

// ---- the lifecycle row (lifecycle_state stage 'voice': reserved for it by the store) ---------------------------------------

function recordStart(accountId: string, at: number): void {
  getStore().query(
    `INSERT INTO lifecycle_state (account_id, stage, started_at, finished_at, outcome, last_progress_at, updated_at)
     VALUES (?, 'voice', ?, NULL, NULL, ?, ?)
     ON CONFLICT(account_id, stage) DO UPDATE SET started_at = excluded.started_at, finished_at = NULL, outcome = NULL,
       last_progress_at = excluded.last_progress_at, updated_at = excluded.updated_at`,
  ).run(accountId, at, at, at);
}

function recordFinish(accountId: string, at: number, outcome: string): void {
  getStore().query(
    "UPDATE lifecycle_state SET finished_at = ?, outcome = ?, last_progress_at = ?, updated_at = ? WHERE account_id = ? AND stage = 'voice'",
  ).run(at, outcome, at, at, accountId);
}

function lastAttempt(accountId: string): { startedAt: number | null; finishedAt: number | null; outcome: string | null } | null {
  const row = getStore().query("SELECT started_at, finished_at, outcome FROM lifecycle_state WHERE account_id = ? AND stage = 'voice'")
    .get(accountId) as { started_at: number | null; finished_at: number | null; outcome: string | null } | null;
  return row ? { startedAt: row.started_at, finishedAt: row.finished_at, outcome: row.outcome } : null;
}

// ---- starting a crawl ----------------------------------------------------------------------------------------------------

export type BeginVoiceCrawl =
  | { started: true; progress: VoiceCrawlProgress; done: Promise<VoiceCrawlProgress> }
  | { started: false; reason: string };

/** The mailbox's address, to tell the person's own messages in a thread (connectors.accounts; an email-shaped id else). */
async function addressOf(platform: PlatformContext, accountId: string): Promise<string> {
  try {
    const r = await platform.connectors.accounts?.("gmail");
    const email = r?.ok ? (r.data?.accounts ?? []).find((a) => a.accountId === accountId)?.email : null;
    if (email) return email.trim().toLowerCase();
  } catch { /* fall through */ }
  return accountId.includes("@") ? accountId.trim().toLowerCase() : "";
}

/**
 * Take the mailbox's turn and start the crawl in the background. Answers once the turn is taken (`started`, with the
 * crawl's `done`) or refused (`started: false` and why: already running, already learned, no model, or the turn's code).
 * `force` re-learns a mailbox that has a voice (the person's own rows are kept). Never throws.
 */
export async function beginVoiceCrawl(
  platform: PlatformContext, accountId: string, opts: { force?: boolean; interactive?: boolean } = {},
): Promise<BeginVoiceCrawl> {
  if (!accountId) return { started: false, reason: "no_account" };
  const running = active.get(accountId);
  if (running && (!running.done || running.storing)) return { started: false, reason: "running" };
  if (!opts.force && hasVoice(accountId)) return { started: false, reason: "learned" };
  const model = platform.model?.json;
  if (!model) return { started: false, reason: "no_model" };

  // Learning from here: the placeholder is what a create_draft racing the turn sees.
  const progress: VoiceCrawlProgress = { accountId, address: "", startedAt: nowImpl(), listed: 0, read: 0, sampled: 0, stored: 0, done: false };
  active.set(accountId, progress);
  let turn: ReadTurnResult;
  try {
    turn = platform.connectors.readTurn
      ? await platform.connectors.readTurn(accountId, VOICE_CONSUMER, { skillId: "gmail", ttlMs: READ_TURN_TTL_MS })
      : { ok: false, reason: "this Flock has no read turns", code: "busy" };
  } catch (e: any) {
    turn = { ok: false, reason: e?.message ?? String(e), code: "busy" };
  }
  if (!turn.ok) {
    if (active.get(accountId) === progress) active.delete(accountId);
    const code = "code" in turn && turn.code ? String(turn.code) : "refused";
    log(`[email-desk] voice crawl account=${accountId} not started: mailbox ${code}${turn.reason ? ` (${turn.reason})` : ""}`);
    return { started: false, reason: code };
  }
  // From here `learn` owns the turn: it releases it in every path, and never throws.
  const done = learn(platform, model as unknown as VoiceModel, progress, turn.data, opts.interactive);
  const ended = done.then(() => undefined);
  settling.set(accountId, ended);
  void ended.then(() => { if (settling.get(accountId) === ended) settling.delete(accountId); });
  return { started: true, progress, done };
}

/** The crawl under the held turn, then the model call and the rows. Never throws; always marks the crawl done. */
type HeldTurn = { turnId: string; release(): Promise<void> };

async function learn(
  platform: PlatformContext, model: VoiceModel, progress: VoiceCrawlProgress, first: HeldTurn, interactive?: boolean,
): Promise<VoiceCrawlProgress> {
  const { accountId } = progress;
  // The turn the crawl holds right now, if any: taken for a read, released before every pause.
  let held: HeldTurn | null = first;
  const releaseHeld = async (): Promise<void> => {
    const t = held;
    held = null;
    if (t) { try { await t.release(); } catch { /* released by its ttl otherwise */ } }
  };
  const pause: Pause = async (ms) => {
    await releaseHeld();
    await sleepImpl(ms);
  };
  /** The mailbox's turn for the next read. Busy is "come back later": a backoff holding nothing, then ask again. Any other
   *  refusal (the account paused or not this person's), or busy past the retries, skips the read. */
  const take = async (): Promise<HeldTurn | null> => {
    for (let attempt = 0; attempt <= MAX_BUSY_RETRIES; attempt++) {
      let r: ReadTurnResult;
      try {
        r = platform.connectors.readTurn
          ? await platform.connectors.readTurn(accountId, VOICE_CONSUMER, { skillId: "gmail", ttlMs: READ_TURN_TTL_MS })
          : NO_READ_TURNS;
      } catch (e: any) {
        r = { ok: false, reason: e?.message ?? String(e), code: "busy" };
      }
      if (r.ok) return r.data;
      const code = "code" in r ? String(r.code ?? "") : "";
      if (code !== "busy" || attempt === MAX_BUSY_RETRIES) return null;
      await sleepImpl(jitter(BUSY_BACKOFF_MIN_MS, BUSY_BACKOFF_MAX_MS));
    }
    return null;
  };
  const read: Read = async (functionName, params) => {
    if (!held) held = await take();
    if (!held) return null;
    try {
      const r = await platform.connectors.exec<unknown>({
        skillId: "gmail", functionName, params, accountHint: accountId, timeoutMs: READ_TIMEOUT_MS, turnId: held.turnId,
      });
      if (!r.ok) return null;
      return typeof r.data === "string" ? safeParse(r.data) : r.data ?? null;
    } catch {
      return null;
    }
  };
  let outcome = "empty";
  try {
    recordStart(accountId, progress.startedAt);
    let crawl: Awaited<ReturnType<typeof crawlSentMail>>;
    try {
      progress.address = await addressOf(platform, accountId);
      crawl = progress.address ? await crawlSentMail(read, pause, progress, interactive) : { stop: "no_address", samples: [] };
    } finally {
      // The reads are over: the mailbox is free for the next reader. The model call below reads no mail.
      await releaseHeld();
    }
    progress.stopReason = crawl.stop;
    if (crawl.error) progress.error = crawl.error;
    if (crawl.stop === "wall_clock") outcome = "capped";
    if (crawl.samples.length > 0) {
      progress.storing = true;
      const learned = await extractVoice(model, crawl.samples);
      if (learned.entries) {
        progress.stored = storeLearnedVoice(accountId, learned.entries, learned.sampleCount);
        if (progress.stored > 0) outcome = "done";
      } else {
        progress.error = learned.reason;
      }
    }
  } catch (e: any) {
    progress.error = e?.message ?? String(e);
    outcome = "failed";
  } finally {
    await releaseHeld(); // a throw before the reads (recordStart) still lets the mailbox go
    progress.storing = false;
    progress.done = true;
    progress.finishedAt = nowImpl();
    try { recordFinish(accountId, progress.finishedAt, outcome); } catch { /* the in-memory state still says done */ }
    log(`[email-desk] voice crawl account=${accountId} finished: ${progress.stopReason ?? outcome} listed=${progress.listed} read=${progress.read} sampled=${progress.sampled} stored=${progress.stored}${progress.error ? ` error=${progress.error}` : ""}`);
  }
  return progress;
}

const safeParse = (s: string): unknown => { try { return JSON.parse(s); } catch { return null; } };

/** Run one mailbox's crawl to the end (lifecycle initialize, Task 2.10): the outcome, or why it did not start. */
export async function runVoiceCrawl(
  platform: PlatformContext, accountId: string, opts: { force?: boolean; interactive?: boolean } = {},
): Promise<{ started: false; reason: string } | { started: true; progress: VoiceCrawlProgress }> {
  const begun = await beginVoiceCrawl(platform, accountId, opts);
  if (!begun.started) return begun;
  return { started: true, progress: await begun.done };
}

/**
 * The catch-up: a mailbox with no voice and no crawl in flight gets one, in the background, unless its last attempt finished
 * recently: within RECRAWL_AFTER_MS when it ended `done` or `empty`, within VOICE_RETRY_AFTER_MS otherwise (failed, capped,
 * no outcome). An attempt that never finished (the app stopped mid-crawl, or the crawl never started) does not count.
 * Never throws.
 */
export async function ensureVoiceCrawl(platform: PlatformContext, accountId: string): Promise<BeginVoiceCrawl> {
  try {
    if (hasVoice(accountId)) return { started: false, reason: "learned" };
    if (voiceLearningUntil(accountId) !== null) return { started: false, reason: "running" };
    const last = lastAttempt(accountId);
    const wait = last?.outcome === "done" || last?.outcome === "empty" ? RECRAWL_AFTER_MS : VOICE_RETRY_AFTER_MS;
    if (last?.finishedAt && nowImpl() - last.finishedAt < wait) return { started: false, reason: "recent" };
    return await beginVoiceCrawl(platform, accountId);
  } catch (e: any) {
    return { started: false, reason: e?.message ?? String(e) };
  }
}

/** The "try after" time in words a person reads and an agent can use: the local clock time, then the instant. */
export function tryAfterText(until: number, timeZone?: string): string {
  let clock: string;
  try {
    clock = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", ...(timeZone ? { timeZone } : {}) }).format(new Date(until));
  } catch {
    clock = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(until));
  }
  return `${clock} (${new Date(until).toISOString()})`;
}
