// The Plan upcoming events routine: picks the events that are new or moved, bundles them (facts from memory, the steps
// Calendar Desk already made, read back from Flock) and wakes the paired agent with plan_events. Its report arrives
// through the plan_events_done operation (plan-report.ts).
import type { PlatformContext } from "@flock/app-sdk";
import { eventsToPlan, openPlan, createPlan, setPlanSession, abandonPlan, plannedMark, allStepKinds, allCoveredStepRefs, unkindedCabSteps, backfillKind, heldEvents, dropHeld, PLAN_GIVE_UP_MS, PLAN_EVENTS_MAX, type PlanEventRef, type PlanPick } from "./planning-store";
import { ymd } from "./events";
import { getEvent } from "./store";
import { KINDS, KIND_FACTS_LIMIT, KIND_SEARCH_LIMIT, type EventType, type Tier } from "./kinds";
import { tally, withAnswers, type KindState } from "./tally";
import { askStates, settleAsks, preference, answeredInChat, statedAnswers, type AskRow, type AskState } from "./asks";

const APP = "calendar-desk";
const EVENT_FACTS_MAX = 3;
/** The pointer that ties a TODO to an event: `calendar-desk:<event key>`. */
export const pointer = (eventKey: string) => `${APP}:${eventKey}`;
const hhmm = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

// The SDK methods this routine uses; typed here so the app does not depend on an SDK build that has them yet.
// `withdrawn`: a dismissed row Calendar Desk itself withdrew (its event was deleted), not one the owner closed.
// `skipped`, `closedAt` and `actionId` come from newer Flock; an older one leaves them out.
interface AppTaskState { sourceRef: string; status: "open" | "done" | "dismissed"; withdrawn?: true; skipped?: true; closedAt?: number; actionId?: string; title: string; due: number | null; dueTimed: boolean; showFrom: number | null; updatedAt: number }
type Res<T> = { ok: true; data: T } | { ok: false; reason: string };
interface PlanningPlatform {
  tasks: { list(opts?: { prefix?: string }): Promise<Res<{ tasks: AppTaskState[] }>> };
  memory: { search(query: string, opts?: { person?: boolean; limit?: number; any?: boolean }): Promise<Res<{ facts: string[] }>> };
  agent: { intent<T>(name: string, payload: Record<string, unknown>): Promise<Res<T>> };
}

export interface BundleStep { key: string; /** absent for a step recorded before kinds existed */ kind?: string; title: string; due: string | null; dueTime?: string; showFrom: string | null; closed?: true }
export interface BundleEvent {
  ref: string; event: string; title: string; date: string; time?: string; allDay: boolean;
  location?: string; guests?: string[];
  /** "answered": planned before, held for a card the owner has now answered yes, offered once more. */
  change: "new" | "changed" | "answered";
  /** The type stored when the event was last planned. */
  type?: EventType;
  /** A changed event's date (and time) when it was last planned: its steps were dated against this. */
  was?: { date: string; time?: string };
  facts: string[]; steps: BundleStep[];
}
/** What the owner did with past steps of a kind: the tally, the kind's memory facts, and (personal kinds) whether the card asked. */
export interface Habit { tier: Tier; tally: KindState; facts: string[]; asked?: false | "waiting" | true }
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
  const t = now.getTime();
  type Pick = Omit<PlanPick, "change"> & { change: BundleEvent["change"] };
  const picks: Pick[] = eventsToPlan(now);

  // The cards: settled every run (expiry, an answer in chat, an answer by button written to memory), whatever there is to plan.
  const askListed = await p.tasks.list({ prefix: "ask:" });
  if (!askListed.ok) console.warn(`[calendar-desk] planning: could not read cards: ${askListed.reason}`);
  const asks = askListed.ok ? askStates(askListed.data.tasks as AskRow[]) : new Map<string, AskState>();
  // Any of the query's words (an older Flock ignores `any` and needs all of them). null: memory could not be read.
  const factsByKind = new Map<string, string[] | null>();
  for (const k of KINDS) {
    if (!k.query) continue;
    const r = await p.memory.search(k.query, { limit: KIND_SEARCH_LIMIT, any: true });
    factsByKind.set(k.kind, r.ok ? r.data.facts : null);
  }
  if (askListed.ok) await settleAsks(platform, asks, factsByKind, t);

  // Held events come back once, while still ahead, when their card was answered: yes by button, or in chat (a fact the card
  // did not see withdrew it; the agent reads the fact). No, Mark done or expiry drop the hold.
  const offeredHolds: { accountId: string; eventKey: string; kind: string }[] = [];
  if (askListed.ok) {
    for (const h of heldEvents()) {
      // A past or gone event's hold ends whatever its card says (also when the card never got published).
      const e = getEvent(h.accountId, h.eventKey);
      const ahead = !!e && e.missingSince == null && e.localDate >= ymd(now) && (e.allDay || e.startAt == null || e.startAt > t);
      if (!ahead) { dropHeld(h.accountId, h.eventKey, h.kind); continue; }
      const status = asks.get(h.kind)?.status;
      if (status === "none" || status === "waiting") continue;
      const answered = status === "yes" || answeredInChat(asks.get(h.kind), factsByKind.get(h.kind) ?? []);
      if (!answered) { dropHeld(h.accountId, h.eventKey, h.kind); continue; }
      const already = picks.some((x) => x.accountId === h.accountId && x.eventKey === h.eventKey);
      if (!already) {
        if (picks.length >= PLAN_EVENTS_MAX) continue; // offered on a later run
        picks.push({ ...e!, change: "answered" });
      }
      offeredHolds.push(h);
    }
  }
  if (picks.length === 0) return { woke: false, skipped: "nothing" };

  const listed = await p.tasks.list({ prefix: "step:" });
  const states = listed.ok ? listed.data.tasks : [];
  if (!listed.ok) console.warn(`[calendar-desk] planning: could not read steps: ${listed.reason}`);

  // The owner's habits, pooled across accounts (the same tally the report's guard uses). A cab or travel step recorded before
  // kinds existed gets its kind from its listed title first.
  for (const u of unkindedCabSteps()) {
    const row = states.find((s) => s.sourceRef === `step:${u.eventKey}:${u.stepKey}`);
    if (row) backfillKind(u.accountId, u.eventKey, u.stepKey, row.title);
  }
  const kinds = allStepKinds();
  // The effective state, the same one the report's validator enforces: a card's answer beats the tally.
  const effective = withAnswers(tally(states, kinds, t, allCoveredStepRefs()), statedAnswers(asks));
  const habits: Record<string, Habit> = {};
  for (const k of [...KINDS].sort((a, b) => (a.kind < b.kind ? -1 : 1))) {
    if (k.tier === "judgement") continue;
    const facts = (factsByKind.get(k.kind) ?? []).slice(0, KIND_FACTS_LIMIT);
    const st = asks.get(k.kind);
    // A card answered by button is the owner's stated preference while it binds: it reads as a fact, the same words written to memory.
    if (k.ask && (st?.status === "yes" || st?.status === "no") && st.binds !== false) {
      const said = preference(k.ask.title, st.status === "yes");
      if (!facts.includes(said)) facts.push(said);
    }
    const asked = k.tier === 2 ? (st?.status === "waiting" ? "waiting" as const : st && st.status !== "none" ? true as const : false as const) : undefined;
    const state = effective.get(k.kind) ?? "none";
    if (state === "none" && facts.length === 0 && !asked) continue;
    habits[k.kind] = { tier: k.tier, tally: state, facts, ...(asked !== undefined ? { asked } : {}) };
  }

  const events: BundleEvent[] = [];
  for (const [i, e] of picks.entries()) {
    const prefix = `step:${e.eventKey}:`;
    // A withdrawn step belonged to the event before it was deleted; a restored event is planned afresh, so it is left out.
    const steps = states.filter((s) => s.sourceRef.startsWith(prefix) && !s.sourceRef.slice(prefix.length).includes(":") && !s.withdrawn).map((s): BundleStep => ({
      key: s.sourceRef.slice(prefix.length), ...(kinds.has(s.sourceRef) ? { kind: kinds.get(s.sourceRef)! } : {}), title: s.title,
      due: s.due != null ? ymd(new Date(s.due)) : null, ...(s.dueTimed && s.due != null ? { dueTime: hhmm(s.due) } : {}), showFrom: s.showFrom != null ? ymd(new Date(s.showFrom)) : null,
      ...(s.status !== "open" ? { closed: true as const } : {}),
    }));
    const type = plannedMark(e.accountId, e.eventKey)?.type ?? null;
    events.push({
      ref: `e${i + 1}`, event: pointer(e.eventKey), title: e.title, date: e.localDate,
      ...(e.startAt != null && !e.allDay ? { time: hhmm(e.startAt) } : {}), allDay: e.allDay,
      ...(e.location ? { location: e.location } : {}),
      ...(e.guests?.length ? { guests: e.guests.map((g) => (g.name ? `${g.name} <${g.email}>` : g.email)) } : {}),
      change: e.change,
      ...(type ? { type } : {}),
      ...("was" in e && e.was ? { was: { date: e.was.date, ...(e.was.startAt != null && !e.allDay ? { time: hhmm(e.was.startAt) } : {}) } } : {}),
      facts: await factsFor(p, e.title), steps,
    });
  }

  const refs: PlanEventRef[] = picks.map((e, i) => ({ ref: `e${i + 1}`, accountId: e.accountId, eventKey: e.eventKey, date: e.localDate, startAt: e.allDay ? null : e.startAt }));
  const plan = createPlan(refs, now.getTime());
  const res = await p.agent.intent<{ sessionId: string }>("plan_events", {
    planId: plan.planId, today: ymd(now), nowLocal: hhmm(now.getTime()), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, events, habits,
  });
  if (!res.ok) {
    // A refused wake costs the events no try: they are offered again next run.
    abandonPlan(plan.planId, now.getTime(), { countTry: false });
    const usage = /USAGE_PAUSED/.test(res.reason);
    if (!usage) console.warn(`[calendar-desk] plan_events wake failed: ${res.reason}`);
    return { woke: false, skipped: usage ? "usage" : "failed" };
  }
  setPlanSession(plan.planId, res.data.sessionId);
  // Offered once: the hold ends with the wake that offered it.
  for (const h of offeredHolds) dropHeld(h.accountId, h.eventKey, h.kind);
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
