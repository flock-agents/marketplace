// Planning bookkeeping, ported from core's pa-brief planned-events.ts and the selection in pipeline.ts startPlanningRun:
// which events were planned (and at which date/start), the plans handed to the working agent, the step keys already made.
import { _db as db, listEvents, getCursor, setCursor, type EventRow } from "./store";
import type { EventType } from "./kinds";

export const PLAN_EVENTS_MAX = 20;
export const SILENT_END_MAX = 2;
export const DETAILS_PENDING_WAIT_MS = 2 * 3600_000;
export const PLAN_GIVE_UP_MS = 2 * 3600_000;
export const BAD_REPORTS_MAX = 3;
const HORIZON_DAYS = 90;

export interface PlanEventRef { ref: string; accountId: string; eventKey: string; date: string; startAt: number | null }
export interface PlanRecord { planId: string; createdAt: number; sessionId: string | null; events: PlanEventRef[]; answeredAt: number | null; abandonedAt: number | null; badReports: number }
type EventId = { accountId: string; eventKey: string; date: string; startAt: number | null; type?: EventType | null };

// ── planned marks ─────────────────────────────────────────────────────────────────────────

export function plannedMark(accountId: string, eventKey: string): { date: string; startAt: number | null; plannedAt: number; type: EventType | null } | null {
  const r = db.query("SELECT date, start_at, planned_at, type FROM planned WHERE account_id = ? AND event_key = ? AND planned_at IS NOT NULL").get(accountId, eventKey) as any;
  return r ? { date: r.date, startAt: r.start_at ?? null, plannedAt: r.planned_at, type: r.type ?? null } : null;
}

export function markPlanned(events: EventId[], at: number): void {
  const up = db.query(`INSERT INTO planned (account_id, event_key, date, start_at, planned_at, failed_tries, try_date, try_start_at, type) VALUES (?, ?, ?, ?, ?, 0, NULL, NULL, ?)
    ON CONFLICT(account_id, event_key) DO UPDATE SET date = excluded.date, start_at = excluded.start_at, planned_at = excluded.planned_at, failed_tries = 0, try_date = NULL, try_start_at = NULL,
      type = COALESCE(excluded.type, planned.type)`);
  db.transaction(() => { for (const e of events) up.run(e.accountId, e.eventKey, e.date, e.startAt ?? null, at, e.type ?? null); })();
}

/** Drops marks (and counted tries) whose date is before `todayDate`. */
export function prunePlanned(todayDate: string): void {
  db.query("DELETE FROM planned WHERE date < ?").run(todayDate);
  db.query(`DELETE FROM cursors WHERE key LIKE 'details_wait:%' AND EXISTS (SELECT 1 FROM events e
    WHERE e.local_date < ? AND cursors.key = 'details_wait:' || e.account_id || ':' || e.event_key)`).run(todayDate);
}

// ── selection ─────────────────────────────────────────────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const waitCursor = (accountId: string, eventKey: string) => `details_wait:${accountId}:${eventKey}`;

/**
 * Events today..+90d (not missing) that are new or whose date/start moved since they were planned, nearest first, at most
 * PLAN_EVENTS_MAX; a changed one carries `was`, its planned date and start. A Google event whose details were never read waits for them, unless it is due by tomorrow or has waited 2h
 * (the wait starts when first considered, kept in a cursor so a restart does not reset it).
 */
export type PlanPick = EventRow & { change: "new" | "changed"; /** a changed event's date and start when it was planned */ was?: { date: string; startAt: number | null } };
export function eventsToPlan(now: Date): PlanPick[] {
  const today = ymd(now), tomorrow = ymd(addDays(now, 1));
  const t = now.getTime();
  const out: PlanPick[] = [];
  for (const e of listEvents({ fromDate: today, toDate: ymd(addDays(now, HORIZON_DAYS)) })) {
    const pending = e.source === "google" && e.detailsAt == null;
    const cur = waitCursor(e.accountId, e.eventKey);
    if (pending && e.localDate > tomorrow) {
      let since = Number(getCursor(cur));
      if (!since) { since = t; setCursor(cur, String(t)); }
      if (t - since <= DETAILS_PENDING_WAIT_MS) continue;
    } else if (!pending && getCursor(cur) !== null) {
      db.query("DELETE FROM cursors WHERE key = ?").run(cur);
    }
    const mark = plannedMark(e.accountId, e.eventKey);
    if (!mark) out.push({ ...e, change: "new" });
    else if (mark.date !== e.localDate || mark.startAt !== (e.startAt ?? null)) out.push({ ...e, change: "changed", was: { date: mark.date, startAt: mark.startAt } });
  }
  out.sort((a, b) => a.localDate.localeCompare(b.localDate) || (a.startAt ?? 0) - (b.startAt ?? 0));
  return out.slice(0, PLAN_EVENTS_MAX);
}

// ── plans ─────────────────────────────────────────────────────────────────────────────────

function rowToPlan(r: any): PlanRecord {
  return { planId: r.plan_id, createdAt: r.created_at, sessionId: r.session_id ?? null, events: JSON.parse(r.events_json), answeredAt: r.answered_at ?? null, abandonedAt: r.abandoned_at ?? null, badReports: r.bad_reports };
}

export function getPlan(planId: string): PlanRecord | null {
  const r = db.query("SELECT * FROM plans WHERE plan_id = ?").get(planId);
  return r ? rowToPlan(r) : null;
}

/** The plan still waiting for its report: not answered, not abandoned. */
export function openPlan(): PlanRecord | null {
  const r = db.query("SELECT * FROM plans WHERE answered_at IS NULL AND abandoned_at IS NULL ORDER BY created_at DESC LIMIT 1").get();
  return r ? rowToPlan(r) : null;
}

export function createPlan(events: PlanEventRef[], at: number): PlanRecord {
  const planId = crypto.randomUUID();
  db.query("INSERT INTO plans (plan_id, created_at, events_json) VALUES (?, ?, ?)").run(planId, at, JSON.stringify(events));
  return getPlan(planId)!;
}

export function setPlanSession(planId: string, sessionId: string): void {
  db.query("UPDATE plans SET session_id = ? WHERE plan_id = ?").run(sessionId, planId);
}

export function answerPlan(planId: string, at: number): void {
  db.query("UPDATE plans SET answered_at = ? WHERE plan_id = ?").run(at, planId);
}

export function noteBadReport(planId: string): number {
  db.query("UPDATE plans SET bad_reports = bad_reports + 1 WHERE plan_id = ?").run(planId);
  return (db.query("SELECT bad_reports FROM plans WHERE plan_id = ?").get(planId) as { bad_reports: number } | null)?.bad_reports ?? 0;
}

/**
 * The plan ended without a report. countTry (default true) counts one failed try per event at its offered date/start (a moved
 * event starts again at 1); at SILENT_END_MAX the event is marked planned with no steps, so one event the model never answers
 * cannot hold the planner. A refused wake passes countTry: false.
 */
export function abandonPlan(planId: string, at: number, opts: { countTry?: boolean } = {}): void {
  const plan = getPlan(planId);
  if (!plan) return;
  db.transaction(() => {
    db.query("UPDATE plans SET abandoned_at = ? WHERE plan_id = ? AND abandoned_at IS NULL").run(at, planId);
    if (opts.countTry === false) return;
    for (const e of plan.events) {
      const startAt = e.startAt ?? null;
      const cur = db.query("SELECT failed_tries, try_date, try_start_at FROM planned WHERE account_id = ? AND event_key = ?").get(e.accountId, e.eventKey) as any;
      const same = cur && cur.try_date === e.date && (cur.try_start_at ?? null) === startAt;
      const count = same ? cur.failed_tries + 1 : 1;
      if (count >= SILENT_END_MAX) markPlanned([e], at);
      // Tries live apart from the mark: an existing mark (date/start/planned_at) survives; with none, the row is tries-only (planned_at NULL).
      else db.query(`INSERT INTO planned (account_id, event_key, date, start_at, planned_at, failed_tries, try_date, try_start_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
        ON CONFLICT(account_id, event_key) DO UPDATE SET failed_tries = excluded.failed_tries, try_date = excluded.try_date, try_start_at = excluded.try_start_at`)
        .run(e.accountId, e.eventKey, e.date, startAt, count, e.date, startAt);
    }
  })();
}

// ── step keys ─────────────────────────────────────────────────────────────────────────────

/** A step already recorded keeps its kind and place (the first one wins); backfillKind fills a null kind. */
export function recordStep(accountId: string, eventKey: string, stepKey: string, kind?: string | null, place?: string | null): void {
  db.query("INSERT OR IGNORE INTO plan_steps (account_id, event_key, step_key, kind, place) VALUES (?, ?, ?, ?, ?)").run(accountId, eventKey, stepKey, kind ?? null, place ?? null);
}

/** Each step's kind by its TODO source ref (`step:<eventKey>:<stepKey>`). Steps with no kind yet are left out. */
export function stepKindsFor(accountId: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of db.query("SELECT event_key, step_key, kind FROM plan_steps WHERE account_id = ? AND kind IS NOT NULL ORDER BY rowid").all(accountId) as { event_key: string; step_key: string; kind: string }[]) {
    out.set(`step:${r.event_key}:${r.step_key}`, r.kind);
  }
  return out;
}

/** Marks a step as covered by an existing TODO (so it was not published). */
export function setStepCovered(accountId: string, eventKey: string, stepKey: string): void {
  db.query("UPDATE plan_steps SET covered = 1 WHERE account_id = ? AND event_key = ? AND step_key = ?").run(accountId, eventKey, stepKey);
}

/** The source refs (`step:<eventKey>:<stepKey>`) of steps recorded as covered by an existing TODO. */
export function coveredStepRefs(accountId: string): Set<string> {
  const rows = db.query("SELECT event_key, step_key FROM plan_steps WHERE account_id = ? AND covered = 1").all(accountId) as { event_key: string; step_key: string }[];
  return new Set(rows.map((r) => `step:${r.event_key}:${r.step_key}`));
}

/** Every account's step kinds by source ref: habits are the person's, not an account's. */
export function allStepKinds(): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of db.query("SELECT event_key, step_key, kind FROM plan_steps WHERE kind IS NOT NULL ORDER BY rowid").all() as { event_key: string; step_key: string; kind: string }[]) {
    out.set(`step:${r.event_key}:${r.step_key}`, r.kind);
  }
  return out;
}

/** Every account's covered step refs. */
export function allCoveredStepRefs(): Set<string> {
  const rows = db.query("SELECT event_key, step_key FROM plan_steps WHERE covered = 1").all() as { event_key: string; step_key: string }[];
  return new Set(rows.map((r) => `step:${r.event_key}:${r.step_key}`));
}

/** Every account's steps that recorded a place, by source ref (`step:<eventKey>:<stepKey>`): the person's habits, not an account's. */
export function allStepPlaces(): Map<string, { kind: string; place: string }> {
  const out = new Map<string, { kind: string; place: string }>();
  for (const r of db.query("SELECT event_key, step_key, kind, place FROM plan_steps WHERE kind IS NOT NULL AND place IS NOT NULL ORDER BY rowid").all() as { event_key: string; step_key: string; kind: string; place: string }[]) {
    out.set(`step:${r.event_key}:${r.step_key}`, { kind: r.kind, place: r.place });
  }
  return out;
}

/** Steps keyed cab or travel still without a kind: the only ones backfillKind may fill. */
export function unkindedCabSteps(): { accountId: string; eventKey: string; stepKey: string }[] {
  return (db.query("SELECT account_id, event_key, step_key FROM plan_steps WHERE kind IS NULL AND step_key IN ('cab', 'travel') ORDER BY rowid").all() as { account_id: string; event_key: string; step_key: string }[])
    .map((r) => ({ accountId: r.account_id, eventKey: r.event_key, stepKey: r.step_key }));
}

/**
 * Fills the kind of a step recorded before kinds existed (cab, travel) from its published title: airport, station, else local.
 * Only a null kind is filled, never overwritten. Returns the kind written, or null when the step has one already or is unknown.
 */
export function backfillKind(accountId: string, eventKey: string, stepKey: string, title: string): string | null {
  const kind = /airport/i.test(title) ? "cab-airport" : /station/i.test(title) ? "cab-station" : "cab-local";
  const r = db.query("UPDATE plan_steps SET kind = ? WHERE account_id = ? AND event_key = ? AND step_key = ? AND kind IS NULL").run(kind, accountId, eventKey, stepKey);
  return r.changes > 0 ? kind : null;
}

export function stepKeysFor(accountId: string, eventKey: string): string[] {
  return (db.query("SELECT step_key FROM plan_steps WHERE account_id = ? AND event_key = ? ORDER BY rowid").all(accountId, eventKey) as { step_key: string }[]).map((r) => r.step_key);
}

/** Forgets one recorded step key; the event's planned mark goes only when no keys remain. */
export function forgetStep(accountId: string, eventKey: string, stepKey: string): void {
  db.transaction(() => {
    db.query("DELETE FROM plan_steps WHERE account_id = ? AND event_key = ? AND step_key = ?").run(accountId, eventKey, stepKey);
    if (stepKeysFor(accountId, eventKey).length === 0) forgetEvent(accountId, eventKey);
  })();
}

/** Recorded step keys of events Google confirmed deleted (missing_confirmed = 1), for a withdrawal that failed earlier. */
export function pendingWithdrawals(accountId: string): { eventKey: string; stepKey: string }[] {
  return (db.query(`SELECT s.event_key, s.step_key FROM plan_steps s JOIN events e ON e.account_id = s.account_id AND e.event_key = s.event_key
    WHERE s.account_id = ? AND e.missing_confirmed = 1 ORDER BY s.rowid`).all(accountId) as { event_key: string; step_key: string }[])
    .map((r) => ({ eventKey: r.event_key, stepKey: r.step_key }));
}

/** Forgets the event's mark, tries and step keys: one that comes back is planned afresh. */
export function forgetEvent(accountId: string, eventKey: string): void {
  db.transaction(() => {
    db.query("DELETE FROM planned WHERE account_id = ? AND event_key = ?").run(accountId, eventKey);
    db.query("DELETE FROM plan_steps WHERE account_id = ? AND event_key = ?").run(accountId, eventKey);
    db.query("DELETE FROM cursors WHERE key = ?").run(waitCursor(accountId, eventKey));
  })();
}
