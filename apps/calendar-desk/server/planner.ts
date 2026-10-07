// The Plan upcoming events routine: picks the events that are new or moved, bundles them (facts from memory, the steps
// Calendar Desk already made, read back from Flock) and wakes the paired agent with plan_events. Its report arrives
// through the plan_events_done operation (plan-report.ts).
import type { PlatformContext } from "@flock/app-sdk";
import { eventsToPlan, openPlan, createPlan, setPlanSession, abandonPlan, PLAN_GIVE_UP_MS, type PlanEventRef } from "./planning-store";
import { ymd } from "./events";

const APP = "calendar-desk";
const EVENT_FACTS_MAX = 3;
/** The pointer that ties a TODO to an event: `calendar-desk:<event key>`. */
export const pointer = (eventKey: string) => `${APP}:${eventKey}`;
const hhmm = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

// The SDK methods this routine uses; typed here so the app does not depend on an SDK build that has them yet.
// `withdrawn`: a dismissed row Calendar Desk itself withdrew (its event was deleted), not one the owner closed.
interface AppTaskState { sourceRef: string; status: "open" | "done" | "dismissed"; withdrawn?: true; title: string; due: number | null; dueTimed: boolean; showFrom: number | null; updatedAt: number }
type Res<T> = { ok: true; data: T } | { ok: false; reason: string };
interface PlanningPlatform {
  tasks: { list(opts?: { prefix?: string }): Promise<Res<{ tasks: AppTaskState[] }>> };
  memory: { search(query: string, opts?: { person?: boolean; limit?: number }): Promise<Res<{ facts: string[] }>> };
  agent: { intent<T>(name: string, payload: Record<string, unknown>): Promise<Res<T>> };
}

export interface BundleStep { key: string; title: string; due: string | null; dueTime?: string; showFrom: string | null; closed?: true }
export interface BundleEvent {
  ref: string; event: string; title: string; date: string; time?: string; allDay: boolean;
  location?: string; guests?: string[]; change: "new" | "changed";
  /** A changed event's date (and time) when it was last planned: its steps were dated against this. */
  was?: { date: string; time?: string };
  facts: string[]; steps: BundleStep[];
}
export type PlanningResult = { woke: boolean; planId?: string; skipped?: "in-flight" | "nothing" | "usage" | "failed" };

// Single flight: the open-plan check below is followed by awaits (steps, memory) before the plan is stored, so two
// callers (the minute-loop retry, the tick, refresh_calendar's per-account plan) could both pass it and both wake the agent.
let running: Promise<PlanningResult> | null = null;

export function runPlanning(platform: PlatformContext, now: Date): Promise<PlanningResult> {
  if (running) return Promise.resolve({ woke: false, skipped: "in-flight" });
  const mine = planOnce(platform, now).finally(() => { if (running === mine) running = null; });
  running = mine;
  return mine;
}

async function planOnce(platform: PlatformContext, now: Date): Promise<PlanningResult> {
  const p = platform as unknown as PlanningPlatform;
  const open = openPlan();
  if (open && now.getTime() - open.createdAt < PLAN_GIVE_UP_MS) return { woke: false, skipped: "in-flight" };
  if (open) abandonPlan(open.planId, now.getTime());
  const picks = eventsToPlan(now);
  if (picks.length === 0) return { woke: false, skipped: "nothing" };

  const listed = await p.tasks.list({ prefix: "step:" });
  const states = listed.ok ? listed.data.tasks : [];
  if (!listed.ok) console.warn(`[calendar-desk] planning: could not read steps: ${listed.reason}`);
  const events: BundleEvent[] = [];
  for (const [i, e] of picks.entries()) {
    const prefix = `step:${e.eventKey}:`;
    // A withdrawn step belonged to the event before it was deleted; a restored event is planned afresh, so it is left out.
    const steps = states.filter((s) => s.sourceRef.startsWith(prefix) && !s.sourceRef.slice(prefix.length).includes(":") && !s.withdrawn).map((s): BundleStep => ({
      key: s.sourceRef.slice(prefix.length), title: s.title,
      due: s.due != null ? ymd(new Date(s.due)) : null, ...(s.dueTimed && s.due != null ? { dueTime: hhmm(s.due) } : {}), showFrom: s.showFrom != null ? ymd(new Date(s.showFrom)) : null,
      ...(s.status !== "open" ? { closed: true as const } : {}),
    }));
    events.push({
      ref: `e${i + 1}`, event: pointer(e.eventKey), title: e.title, date: e.localDate,
      ...(e.startAt != null && !e.allDay ? { time: hhmm(e.startAt) } : {}), allDay: e.allDay,
      ...(e.location ? { location: e.location } : {}),
      ...(e.guests?.length ? { guests: e.guests.map((g) => (g.name ? `${g.name} <${g.email}>` : g.email)) } : {}),
      change: e.change,
      ...(e.was ? { was: { date: e.was.date, ...(e.was.startAt != null && !e.allDay ? { time: hhmm(e.was.startAt) } : {}) } } : {}),
      facts: await factsFor(p, e.title), steps,
    });
  }

  const refs: PlanEventRef[] = picks.map((e, i) => ({ ref: `e${i + 1}`, accountId: e.accountId, eventKey: e.eventKey, date: e.localDate, startAt: e.allDay ? null : e.startAt }));
  const plan = createPlan(refs, now.getTime());
  const res = await p.agent.intent<{ sessionId: string }>("plan_events", {
    planId: plan.planId, today: ymd(now), nowLocal: hhmm(now.getTime()), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, events,
  });
  if (!res.ok) {
    // A refused wake costs the events no try: they are offered again next run.
    abandonPlan(plan.planId, now.getTime(), { countTry: false });
    const usage = /USAGE_PAUSED/.test(res.reason);
    if (!usage) console.warn(`[calendar-desk] plan_events wake failed: ${res.reason}`);
    return { woke: false, skipped: usage ? "usage" : "failed" };
  }
  setPlanSession(plan.planId, res.data.sessionId);
  return { woke: true, planId: plan.planId };
}

/** Up to 3 memory facts for an event, as core's bundle found them: each of the title's first two capitalised runs searched as a
 *  person (a trailing possessive dropped: "Asha's birthday" asks about Asha), else the whole title; a fact that only repeats
 *  the title is dropped. */
async function factsFor(p: PlanningPlatform, title: string): Promise<string[]> {
  const runs = capitalisedRuns(title).slice(0, 2).map((r) => r.replace(/['’]s$/u, "")).filter(Boolean);
  const out: string[] = [];
  for (const q of runs.length ? runs : [title]) {
    const r = await p.memory.search(q, { person: runs.length > 0, limit: EVENT_FACTS_MAX });
    if (r.ok) for (const f of r.data.facts) if (f !== title && !out.includes(f)) out.push(f);
  }
  return out.slice(0, EVENT_FACTS_MAX);
}

/** Runs of capitalised words in a title ("Asha birthday" -> ["Asha"]; "Design Review with Asha Rao" -> ["Design Review", "Asha Rao"]); a run is up to 3 tokens. */
export function capitalisedRuns(title: string): string[] {
  const runs: string[] = [];
  let cur: string[] = [];
  const flush = () => { if (cur.length) runs.push(cur.join(" ")); cur = []; };
  for (const tok of title.split(/\s+/).filter(Boolean)) {
    if (/^\p{Lu}/u.test(tok)) { cur.push(tok); if (cur.length === 3) flush(); } else flush();
  }
  flush();
  return runs;
}
