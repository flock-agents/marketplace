// Email Desk's lifecycle hooks: the first read of a person's mailbox, its progress rows, and the owed work of a tick.
//
// Ported from Flock's built-in desk (email-desk/lifecycle.ts, initialize.ts, lifecycle-state.ts, first-sweep.ts,
// mailbox-progress.ts). What was the platform's stays Flock's (the wizard hold, the routine registry, the sweeps, post-init
// "Run now" of routines: Flock hands routine runs to the app); what is the app's own is here.
//
// INITIALIZE, per mailbox, one mailbox at a time across calls (the stages are careful to work one mailbox at a time: three
// browser pages on one host is what took a live host down):
//   1. READ: the memory-extraction run for the mailbox (routines/memory-extraction.ts runFirstRead, not a copy of it), over the
//      first read's window, no wake. A mailbox another reader holds is retried a few times; a read that fails stays owed.
//   2. VOICE: learn the person's writing voice from their sent mail (voice/crawl.ts), waiting for it to end.
//   3. DONE: the person's setup row says so. A first read that did not land says "Still finishing your email" and the tick
//      reads again once its backoff has passed.
//
// ALREADY INITIALIZED, exactly what the db says (a moved owner db must not be read from scratch). With a `sequence` row in
// lifecycle_state, the row governs: finished with outcome 'done' is initialized; anything else is not. With no row, the db's
// history decides, and ANY of these makes the mailbox initialized (a row is then written, so the answer is the row's):
//   - app_meta `last_harvest:<account>` (a clean memory run finished: this app's own, or the built-in desk's date copied in);
//   - an ingest_comprehension row in state 'extracted' for the memory consumer on this account (journal rows already read);
//   - an ingest_cursors(gmail, <account>) cursor (the journal has been read for this mailbox before).
// An initialized mailbox is not read again from scratch: the routine continues from the cursor and the ledger.
import type { AppLifecycleHooks, InitializeContext, PlatformContext, ProgressItem, TickContext } from "@flock/app-sdk";
import type { Database } from "bun:sqlite";
import { getStore } from "./store";
import { GMAIL_SOURCE, MEMORY_CONSUMER } from "./journal";
import { lastHarvestKey } from "./platform-ops";
import { runFirstRead } from "./routines/memory-extraction";
import { runVoiceCrawl, whenVoiceSettles } from "./voice/crawl";
import { routineCtxFor } from "./routine-ctx";
import { settleRepliedFollowUps } from "./routines/follow-up";
import { listFollowUps } from "./routines/follow-up-store";
import { describeMailboxProgress, type MailboxInitStatus } from "./lib/mailbox-progress";

export const SETUP_DONE_LABEL = "Setup complete. Your assistant will prepare replies as mail arrives.";
export const READING_LABEL = "Reading your email and learning about you…";
export const VOICE_LABEL = "Learning your email communication style…";
export const STILL_LABEL = "Still finishing your email…";

const GMAIL = "gmail";
/** A sequence with no sign of life for this long died with its process: the gate releases, the tick resumes it. */
export const STALL_MS = 20 * 60_000;
/** A first read that did not land is read again after this long. */
export const RETRY_AFTER_MS = 15 * 60_000;
/** A finished row stays on the setup panel this long. */
export const DONE_VISIBLE_MS = 30_000;
const BUSY_RETRY_MS = 15_000;
const BUSY_ATTEMPTS = 8;
const HEARTBEAT_MS = 60_000;

// ---- the sequence rows (lifecycle_state) ---------------------------------------------------------------------------------

interface StageRow { started_at: number | null; finished_at: number | null; outcome: string | null; last_progress_at: number | null }

function row(db: Database, accountId: string, stage: string): StageRow | null {
  return db.query("SELECT started_at, finished_at, outcome, last_progress_at FROM lifecycle_state WHERE account_id = ? AND stage = ?")
    .get(accountId, stage) as StageRow | null;
}

function writeStage(db: Database, accountId: string, stage: string, patch: Partial<StageRow>, now: number): void {
  const cur = row(db, accountId, stage);
  const next = { started_at: null, finished_at: null, outcome: null, last_progress_at: null, ...cur, ...patch };
  db.run(
    `INSERT INTO lifecycle_state (account_id, stage, started_at, finished_at, outcome, last_progress_at, updated_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(account_id, stage) DO UPDATE SET started_at = excluded.started_at, finished_at = excluded.finished_at,
       outcome = excluded.outcome, last_progress_at = excluded.last_progress_at, updated_at = excluded.updated_at`,
    [accountId, stage, next.started_at, next.finished_at, next.outcome, next.last_progress_at, now],
  );
}

/** What the db's history says about a mailbox with no sequence row (see the header). Returns what it found, or null. */
export function historyOf(db: Database, accountId: string): "last_harvest" | "extracted" | "cursor" | null {
  if (db.query("SELECT 1 FROM app_meta WHERE key = ?").get(lastHarvestKey(accountId))) return "last_harvest";
  if (db.query("SELECT 1 FROM ingest_comprehension WHERE source_id = ? AND account_id = ? AND consumer = ? AND state = 'extracted' LIMIT 1")
    .get(GMAIL_SOURCE, accountId, MEMORY_CONSUMER)) return "extracted";
  const cur = db.query("SELECT cursor FROM ingest_cursors WHERE source_id = ? AND account_id = ?").get(GMAIL_SOURCE, accountId) as { cursor: string | null } | null;
  if (cur && cur.cursor) return "cursor";
  return null;
}

/** Is this mailbox's first read done (or never owed)? A history-only answer writes the sequence row. */
export function isInitialized(db: Database, accountId: string, now: number): boolean {
  const seq = row(db, accountId, "sequence");
  if (seq) return seq.finished_at !== null && seq.outcome === "done";
  if (!historyOf(db, accountId)) return false;
  writeStage(db, accountId, "sequence", { started_at: now, finished_at: now, outcome: "done", last_progress_at: now }, now);
  return true;
}

// ---- the hooks -----------------------------------------------------------------------------------------------------------

export interface LifecycleDeps {
  /** The platform context, for the hooks that are not handed one (progress, status). */
  platform?: () => PlatformContext;
  firstRead?: (platform: PlatformContext, accountId: string, email: string | null) => Promise<"read" | "busy" | "failed">;
  voice?: (platform: PlatformContext, accountId: string) => Promise<{ started: boolean; reason?: string }>;
  settle?: (platform: PlatformContext, accountId: string, owner: string) => Promise<unknown>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  /** Heartbeat interval while a sequence runs (tests: 0 turns it off). */
  heartbeatMs?: number;
}

type Mailbox = { accountId: string; email: string | null };

async function mailboxesOf(platform: PlatformContext): Promise<Mailbox[]> {
  try {
    const r = await platform.connectors.accounts?.(GMAIL);
    if (r?.ok) return (r.data?.accounts ?? []).map((a) => ({ accountId: a.accountId, email: a.email ?? null }));
  } catch { /* none known */ }
  return [];
}

export function createEmailDeskHooks(deps: LifecycleDeps = {}): AppLifecycleHooks {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = deps.log ?? ((l: string) => console.log(l));
  const heartbeatMs = deps.heartbeatMs ?? HEARTBEAT_MS;
  const firstRead = deps.firstRead ?? ((platform, accountId, email) => runFirstRead(routineCtxFor(platform, accountId), accountId, email));
  const voice = deps.voice ?? ((platform, accountId) => runVoiceCrawl(platform, accountId, { interactive: true }));
  const settle = deps.settle ?? ((platform, accountId, owner) => settleRepliedFollowUps(routineCtxFor(platform, accountId), accountId, owner));

  /** Mailboxes this process is working now: a sequence row without one of these died with an earlier process. */
  const running = new Set<string>();
  /** Mailboxes claimed and waiting their turn behind another mailbox's sequence (or running). They are alive: neither the gate
   *  nor the tick may take them for dead, and neither initialize nor the tick may queue them twice. */
  const queued = new Set<string>();
  const busy = (accountId: string) => running.has(accountId) || queued.has(accountId);
  /** One sequence at a time, across calls. */
  let queue: Promise<void> = Promise.resolve();

  const report = (platform: PlatformContext, accountId: string, r: Parameters<PlatformContext["progress"]["report"]>[1]) =>
    Promise.resolve(platform.progress.report(accountId, r)).catch(() => undefined);

  async function withBusyRetries<T extends string>(attempt: () => Promise<T>, busy: (v: T) => boolean): Promise<T> {
    let v = await attempt();
    for (let i = 1; i < BUSY_ATTEMPTS && busy(v); i++) {
      await sleep(BUSY_RETRY_MS);
      v = await attempt();
    }
    return v;
  }

  async function voiceStage(platform: PlatformContext, accountId: string): Promise<void> {
    try {
      let begun = await voice(platform, accountId);
      for (let i = 1; i < BUSY_ATTEMPTS && !begun.started && (begun as { reason?: string }).reason === "busy"; i++) {
        await sleep(BUSY_RETRY_MS);
        begun = await voice(platform, accountId);
      }
      // A crawl already running (the routine started it) is waited for, to its cap.
      if (!begun.started && (begun as { reason?: string }).reason === "running") await whenVoiceSettles(accountId);
    } catch (e: any) {
      log(`[email-desk] initialize: voice for ${accountId.slice(0, 8)} failed (${e?.message ?? e})`);
    }
  }

  /** The sequence for one mailbox: read, voice, done. Writes its rows as it goes; never throws. */
  async function sequence(platform: PlatformContext, mailbox: Mailbox): Promise<void> {
    const db = getStore();
    const { accountId } = mailbox;
    running.add(accountId);
    const t0 = now();
    const prior = row(db, accountId, "sequence");
    writeStage(db, accountId, "sequence", { started_at: prior?.started_at ?? t0, finished_at: null, outcome: null, last_progress_at: t0 }, t0);
    writeStage(db, accountId, "extract", { started_at: t0, finished_at: null, outcome: null, last_progress_at: t0 }, t0);
    writeStage(db, accountId, "voice", { started_at: null, finished_at: null, outcome: null, last_progress_at: null }, t0);
    const beat = heartbeatMs > 0 ? setInterval(() => writeStage(db, accountId, "sequence", { last_progress_at: now() }, now()), heartbeatMs) : null;
    try {
      await report(platform, accountId, { status: "in_progress", phase: "reading", activeLabel: READING_LABEL });
      const read = await withBusyRetries(() => firstRead(platform, accountId, mailbox.email).catch(() => "failed" as const), (v) => v === "busy");
      log(`[email-desk] initialize: first read for ${accountId.slice(0, 8)} = ${read}`);
      writeStage(db, accountId, "extract", { finished_at: now(), outcome: read === "read" ? "done" : "failed", last_progress_at: now() }, now());

      await report(platform, accountId, { status: "in_progress", phase: "voice", activeLabel: VOICE_LABEL });
      writeStage(db, accountId, "voice", { started_at: now(), last_progress_at: now() }, now());
      await voiceStage(platform, accountId);
      writeStage(db, accountId, "voice", { finished_at: now(), outcome: "done", last_progress_at: now() }, now());

      // Persist before reporting: the gate asks `status`, which answers from these rows.
      writeStage(db, accountId, "sequence", { finished_at: now(), outcome: read === "read" ? "done" : "failed", last_progress_at: now() }, now());
      if (read === "read") await report(platform, accountId, { status: "done", phase: "drafting", doneLabel: SETUP_DONE_LABEL });
      else await report(platform, accountId, { status: "owed", phase: "reading", activeLabel: STILL_LABEL });
    } catch (e: any) {
      // Leave it owed: the tick reads again after the backoff.
      log(`[email-desk] initialize: ${accountId.slice(0, 8)} stopped (${e?.message ?? e})`);
      writeStage(db, accountId, "sequence", { finished_at: now(), outcome: "failed", last_progress_at: now() }, now());
      await report(platform, accountId, { status: "owed", phase: "reading", activeLabel: STILL_LABEL });
    } finally {
      if (beat) clearInterval(beat);
      running.delete(accountId);
      queued.delete(accountId);
    }
  }

  /** Queue a mailbox's sequence behind any running; resolves when it has run. */
  function enqueue(platform: PlatformContext, mailbox: Mailbox): Promise<void> {
    queued.add(mailbox.accountId);
    const run = queue.then(() => sequence(platform, mailbox));
    queue = run.catch(() => undefined);
    return run;
  }

  return {
    async initialize(ctx: InitializeContext) {
      const db = getStore();
      const all = await mailboxesOf(ctx.platform);
      const wanted = ctx.accountIds?.length
        ? ctx.accountIds.map((id) => all.find((m) => m.accountId === id) ?? { accountId: id, email: null })
        : all;
      const owed: Mailbox[] = [];
      for (const m of wanted) {
        if (busy(m.accountId)) continue;
        if (isInitialized(db, m.accountId, now())) {
          // Already read (a moved db, or a finished sequence): not read again from scratch. The row says done.
          await report(ctx.platform, m.accountId, { status: "done", phase: "drafting", doneLabel: SETUP_DONE_LABEL });
          continue;
        }
        owed.push(m);
      }
      // Claim every owed mailbox up front, so the gate and the panel see all of them while one is worked.
      for (const m of owed) {
        queued.add(m.accountId);
        const t = now();
        writeStage(db, m.accountId, "sequence", { started_at: t, finished_at: null, outcome: null, last_progress_at: t }, t);
        await report(ctx.platform, m.accountId, { status: "in_progress", phase: "reading", activeLabel: READING_LABEL });
      }
      await Promise.all(owed.map((m) => enqueue(ctx.platform, m)));
    },

    // Initialized when its sequence ended, or when nothing is working it. FAILS OPEN: a mailbox the app has no row for, or
    // whose sequence has shown no sign of life for STALL_MS (its process died), is released.
    status(accountId: string) {
      try {
        const seq = row(getStore(), accountId, "sequence");
        if (!seq || seq.finished_at !== null) return true;
        if (busy(accountId)) return false; // waiting its turn or working: alive, however long the mailbox ahead takes
        const last = seq.last_progress_at ?? seq.started_at;
        if (last === null) return true;
        return now() - last >= STALL_MS;
      } catch {
        return true;
      }
    },

    // The setup row of each mailbox being worked or just finished, in the built-in desk's words (lib/mailbox-progress.ts).
    async progress(): Promise<ProgressItem[]> {
      const db = getStore();
      const rows = db.query("SELECT account_id, stage, started_at, finished_at, outcome, last_progress_at FROM lifecycle_state WHERE stage IN ('sequence','extract','voice')")
        .all() as Array<StageRow & { account_id: string; stage: string }>;
      const emails = new Map<string, string | null>();
      try { for (const m of await mailboxesOf(deps.platform?.() as PlatformContext)) emails.set(m.accountId, m.email); } catch { /* titled by account id */ }
      const items: ProgressItem[] = [];
      for (const seq of rows.filter((r) => r.stage === "sequence")) {
        const stage = (name: string) => rows.find((r) => r.account_id === seq.account_id && r.stage === name);
        const t = now();
        let init: MailboxInitStatus;
        if (seq.finished_at === null) {
          const voiceNow = stage("extract")?.finished_at != null;
          init = { status: "in_progress", phase: voiceNow ? "voice" : "reading", activeLabel: voiceNow ? VOICE_LABEL : READING_LABEL, updatedAt: seq.last_progress_at ?? undefined };
        } else if (seq.outcome === "done") {
          // A finished row lingers briefly, then the panel has nothing to say about it.
          if (t - seq.finished_at >= DONE_VISIBLE_MS) continue;
          init = { status: "done", doneLabel: SETUP_DONE_LABEL, updatedAt: seq.finished_at };
        } else {
          init = { status: "owed", phase: "reading", activeLabel: STILL_LABEL, updatedAt: seq.finished_at };
        }
        // What was read, counted from the journal's ledger (the emails this mailbox's memory run has taken so far).
        const n = (db.query("SELECT COUNT(*) AS n FROM ingest_comprehension WHERE source_id = ? AND account_id = ? AND consumer = ? AND state = 'extracted'")
          .get(GMAIL_SOURCE, seq.account_id, MEMORY_CONSUMER) as { n: number }).n;
        const facts = { running: init.status !== "done", extracted: n, extractedTotal: n, failed: 0, claimed: n, tasks: 0, lastRunAt: seq.last_progress_at };
        const view = describeMailboxProgress(facts, init);
        items.push({ id: seq.account_id, title: emails.get(seq.account_id) || seq.account_id, message: view.detail, state: view.state });
      }
      return items;
    },

    // Owed work, once per platform tick:
    //   - a mailbox with no first read and no history (its initialize call was lost), a sequence its process died in, and a first
    //     read that did not land (after RETRY_AFTER_MS) are run again;
    //   - a follow-up TODO whose thread has a reply since comes down (journal only), so a stale "follow up?" card never outlives
    //     the reply by more than a tick.
    // Not here, because they need Flock's board rows: closing reply cards whose draft was sent or discarded outside Flock
    // (owed-mail-checks), and the daily harvest and follow-up passes, which Flock hands to the routines when due.
    async tick(ctx: TickContext) {
      const db = getStore();
      const platform = ctx.platform;
      const mailboxes = await mailboxesOf(platform);
      for (const m of mailboxes) {
        if (busy(m.accountId)) continue;
        try {
          const seq = row(db, m.accountId, "sequence");
          const t = now();
          const owes = !seq ? !isInitialized(db, m.accountId, t)
            : seq.finished_at === null ? t - (seq.last_progress_at ?? seq.started_at ?? 0) >= STALL_MS
            : seq.outcome === "failed" && t - (seq.finished_at ?? 0) >= RETRY_AFTER_MS;
          if (owes) await enqueue(platform, m);
        } catch (e: any) {
          log(`[email-desk] tick: first read check for ${m.accountId.slice(0, 8)} failed (${e?.message ?? e})`);
        }
      }
      for (const m of mailboxes) {
        if (!m.email || listFollowUps(m.accountId, ["offered"]).length === 0) continue;
        try { await settle(platform, m.accountId, m.email); }
        catch (e: any) { log(`[email-desk] tick: follow-up settle for ${m.accountId.slice(0, 8)} failed (${e?.message ?? e})`); }
      }
    },
  };
}
