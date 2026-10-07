// A first calendar read that did not land is read again, on a backoff, until it does. A busy refusal (another
// read holds the account) is transient: it keeps the account "reading" and comes back within minutes, at no
// cost against the daily scrape cap. Any other failure is retried more slowly and counts against the cap, so a
// broken session costs a few scrapes a day. Imported only by lifecycle, ops and index.
import type { PlatformContext } from "@flock/app-sdk";
import { listInit, markInitStarted, markInitFinished, getCursor, setCursor } from "./store";
import { syncAccount, type SyncResult } from "./sync";
import { runPlanning } from "./planner";
import { readRoutineState } from "./scheduler";

const MIN = 60_000;
const BUSY_BACKOFF = { firstMs: 1 * MIN, capMs: 10 * MIN };
const FAIL_BACKOFF = { firstMs: 5 * MIN, capMs: 60 * MIN };

const retryKey = (a: string) => `init_retry:${a}`;
function readRetry(a: string): { n: number; at: number } | null {
  try { const v = JSON.parse(getCursor(retryKey(a)) || "null"); return v && typeof v.at === "number" ? { n: Number(v.n) || 0, at: v.at } : null; } catch { return null; }
}
function scheduleRetry(a: string, busy: boolean, now: Date): void {
  const n = readRetry(a)?.n ?? 0;
  const b = busy ? BUSY_BACKOFF : FAIL_BACKOFF;
  const wait = Math.min(b.firstMs * 2 ** n, b.capMs);
  setCursor(retryKey(a), JSON.stringify({ n: n + 1, at: now.getTime() + wait }));
}

/** The routines the platform named on the last initialize, kept so a retried first read knows planning is on before any tick. */
export function storeInitRoutines(ids: string[] | undefined): void {
  if (Array.isArray(ids)) setCursor("init_routines", JSON.stringify(ids));
}
function storedInitRoutines(): string[] {
  try { const v = JSON.parse(getCursor("init_routines") || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function planningOn(enabled?: string[]): boolean {
  return enabled ? enabled.includes("event-planning") : readRoutineState().planEnabled || storedInitRoutines().includes("event-planning");
}

/** Plans right after a first read, through runPlanning's guards, with the time planning starts. Never throws. */
export async function planAfterFirstRead(platform: PlatformContext, clock: () => Date, enabled?: string[]): Promise<void> {
  if (!planningOn(enabled)) return;
  try { await runPlanning(platform, clock()); } catch (err: any) { console.warn(`[calendar-desk] planning: ${err?.message ?? err}`); }
}

/** Records how a first read went. `defer` leaves planning to the caller (one plan after a loop over several accounts). */
export async function completeFirstRead(platform: PlatformContext, accountId: string, r: SyncResult, clock: () => Date, enabled?: string[], opts: { defer?: boolean } = {}): Promise<"done" | "waiting" | "failed"> {
  const rec = listInit().find((x) => x.accountId === accountId);
  // Another read of this account is already running (the in-flight guard): that read records the outcome.
  if (r.skipped === "busy") return rec?.finishedAt && rec.outcome === "done" ? "done" : "waiting";
  if (r.ok) {
    markInitFinished(accountId, "done", "Calendar is set up");
    setCursor(retryKey(accountId), "");
    if (!opts.defer) await planAfterFirstRead(platform, clock, enabled);
    return "done";
  }
  if (r.busy) {
    if (!rec || rec.finishedAt) markInitStarted(accountId, "Reading your calendar");
    scheduleRetry(accountId, true, clock());
    return "waiting";
  }
  markInitFinished(accountId, "failed", "Could not read your calendar yet");
  scheduleRetry(accountId, false, clock());
  return "failed";
}

/** Reads again every account whose first read has not landed and whose backoff has passed. Plans at most once. */
export async function retryUnfinishedInits(platform: PlatformContext, now: Date, deps: { sync?: typeof syncAccount; clock?: () => Date } = {}): Promise<number> {
  if (!platform.configured) return 0;
  const started = Date.now();
  // A fresh clock that starts at `now`: planning and the next retry time take the time they happen.
  const clock = deps.clock ?? (() => new Date(now.getTime() + (Date.now() - started)));
  const due = listInit().filter((r) => !(r.finishedAt && r.outcome === "done")).filter((r) => (readRetry(r.accountId)?.at ?? 0) <= now.getTime());
  let anyDone = false;
  for (const rec of due) {
    try {
      const r = await (deps.sync ?? syncAccount)(rec.accountId, { platform, now: () => now }, "init");
      if ((await completeFirstRead(platform, rec.accountId, r, clock, undefined, { defer: true })) === "done") anyDone = true;
    } catch (err: any) { console.warn(`[calendar-desk] first-read retry ${rec.accountId}: ${err?.message ?? err}`); }
  }
  if (anyDone) await planAfterFirstRead(platform, clock);
  return due.length;
}
