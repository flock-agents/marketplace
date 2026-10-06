// plan_events_done: the working agent's report for a plan_events run. Each step is checked (rules ported from core's
// pa-brief event-decisions.ts: eventSchemaErrors + the add_steps checks), published as Calendar Desk's own TODO, and
// answered per item. The plan is answered once every offered event is planned; refused reports count against it.
import type { PlatformContext, OpError, AppTask } from "@flock/app-sdk";
import { getEvent, type EventRow } from "./store";
import { ymd } from "./events";
import { pointer } from "./planner";
import { openPlan, plannedMark, markPlanned, recordStep, stepKeysFor, noteBadReport, answerPlan, abandonPlan, BAD_REPORTS_MAX, type PlanRecord, type PlanEventRef } from "./planning-store";

// `withdrawn`: a dismissed row Calendar Desk itself withdrew (its event was deleted), not one the owner closed.
export type StepState = { sourceRef: string; status: "open" | "done" | "dismissed"; withdrawn?: true; title: string; due: number | null; showFrom: number | null };
const MAX_REASON = 120;
const MAX_STEPS_PER_EVENT = 3, MAX_WHY = 500, MAX_TITLE = 200;
const KEY = /^[a-z0-9-]{1,40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^\d{2}:\d{2}$/;
const err = (code: string, message: string, status = 400): OpError => ({ error: message, code, status });

export interface StepSpec { key: string; title: string; dueDate: string; dueTime?: string; showFrom?: string; why: string }
export type PlanReportResult = { accepted: string[]; refused: { item: string; reason: string }[]; done: boolean };

// The model cites bundle refs ("(e1)", "[[e1]]") for code and evals; they are never shown to the owner. Ported from core's refs.ts.
const REF = String.raw`[a-z]\d+`, REFS = String.raw`${REF}(?:\s*,\s*${REF})*`;
const BRACKETS = new RegExp(String.raw`[ \t]*\[\[\s*(${REFS})\s*\]\]`, "g");
const PARENS = new RegExp(String.raw`[ \t]*\(\s*(${REFS.replaceAll("[a-z]", "[cayteso]")})\s*\)`, "g");
const clean = (text: string) => text.replace(BRACKETS, "").replace(PARENS, "").replace(/\s+([.,;:!?])/g, "$1").trim();

const isRealDate = (s: unknown): s is string => {
  if (typeof s !== "string" || !DATE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  return ymd(new Date(y!, m! - 1, d!)) === s;
};
const isRealTime = (s: unknown): s is string => typeof s === "string" && HM.test(s) && Number(s.slice(0, 2)) < 24 && Number(s.slice(3)) < 60;
const localAt = (date: string, time?: string) => new Date(`${date}T${time ?? "00:00"}:00`).getTime();

/** The latest a step for the event may be due or shown: its start (timed) or the end of its day (all-day), with the reason Flock shows. */
export function maxDueOf(e: EventRow): { maxDue: number; maxDueReason: string } {
  const [y, m, d] = e.localDate.split("-").map(Number);
  const day = new Date(y!, m! - 1, d!);
  const label = day.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(",", "");
  let maxDue: number, tail: string;
  if (!e.allDay && e.startAt != null) {
    const t = new Date(e.startAt); const hm = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
    maxDue = e.startAt; tail = `, ${label} ${hm}`;
  } else { maxDue = new Date(y!, m! - 1, d!, 23, 59, 59, 999).getTime(); tail = `, ${label}`; }
  // Flock refuses a reason over 120 characters: shorten the title, not the date.
  const room = MAX_REASON - tail.length;
  const title = e.title.length > room ? `${e.title.slice(0, Math.max(0, room - 1)).trimEnd()}…` : e.title;
  return { maxDue, maxDueReason: `${title}${tail}` };
}

/** The TODO Calendar Desk publishes for a step. Calendar Desk computes local dates in the process zone (the desktop install's zone = the owner's). */
export function stepTask(e: EventRow, s: StepSpec): AppTask {
  const { maxDue, maxDueReason } = maxDueOf(e);
  return {
    sourceRef: `step:${e.eventKey}:${s.key}`, title: s.title.trim(),
    due: localAt(s.dueDate, s.dueTime), dueTimed: !!s.dueTime,
    showFrom: s.showFrom ?? s.dueDate, status: "backlog", maxDue, maxDueReason,
    context: { eventKey: pointer(e.eventKey), why: s.why },
  };
}

/**
 * A step already published for the event, brought to the event's current limit: the cap and its reason only, its dates
 * left as they are. If the event moved earlier than the step's due, Flock would refuse the cap, so the due comes back
 * to the event's day (date only) and a show-from after it with it: the step stays on the board, on the last day it can
 * still be done, rather than keep a limit that protects nothing.
 */
export function capUpdate(e: EventRow, t: StepState): AppTask {
  const { maxDue, maxDueReason } = maxDueOf(e);
  const out: AppTask = { sourceRef: t.sourceRef, title: t.title, maxDue, maxDueReason };
  if (t.due != null && t.due > maxDue) {
    const day = localAt(e.localDate);
    out.due = day; out.dueTimed = false;
    if (t.showFrom != null && t.showFrom > day) out.showFrom = e.localDate;
  }
  return out;
}

/** Re-publishes the limit of every open step Calendar Desk recorded for the event, except `skip` (just published in full).
 *  Returns the ones Flock did not take. */
export async function refreshStepCaps(platform: PlatformContext, e: EventRow, states: StepState[], skip: Set<string>): Promise<{ key: string; reason: string }[]> {
  const prefix = `step:${e.eventKey}:`;
  const recorded = new Set(stepKeysFor(e.accountId, e.eventKey));
  const failed: { key: string; reason: string }[] = [];
  for (const t of states) {
    if (t.status !== "open" || !t.sourceRef.startsWith(prefix)) continue;
    const key = t.sourceRef.slice(prefix.length);
    if (!recorded.has(key) || skip.has(key)) continue;
    const res = await platform.tasks.publish(capUpdate(e, t));
    if (!res.ok) failed.push({ key, reason: (res as any).reason ?? "unknown" });
  }
  return failed;
}

/** Why a step is unusable, or null. `closed` = keys the owner already closed; `seen` = keys earlier in this entry. */
function stepRefusal(s: any, e: EventRow, now: Date, closed: Set<string>, seen: Set<string>): string | null {
  if (!s || typeof s !== "object") return "must be an object";
  if (typeof s.key !== "string" || !KEY.test(s.key)) return `key must match ${KEY}`;
  if (seen.has(s.key)) return `key ${s.key} is used twice`;
  seen.add(s.key);
  if (closed.has(s.key)) return `step ${s.key} was already done or dismissed by the owner`;
  if (typeof s.title !== "string" || s.title.length < 1) return "title is required";
  if (s.title.length > MAX_TITLE) return `title is longer than ${MAX_TITLE}`;
  if (s.why.length > MAX_WHY) return `why is longer than ${MAX_WHY}`;
  if (!isRealDate(s.dueDate)) return "dueDate must be a real date, YYYY-MM-DD";
  if (s.dueTime !== undefined && !isRealTime(s.dueTime)) return "dueTime must be HH:MM";
  if (s.showFrom !== undefined && !isRealDate(s.showFrom)) return "showFrom must be a real date, YYYY-MM-DD";
  const today = ymd(now);
  if (s.dueDate < today) return "dueDate is before today";
  const show = s.showFrom ?? s.dueDate;
  if (show < today) return "showFrom is before today";
  if (show > s.dueDate) return "showFrom is after its due date";
  if (s.dueTime && localAt(s.dueDate, s.dueTime) <= now.getTime()) return "it is already past";
  if (s.dueTime && !e.allDay && e.startAt != null) { if (localAt(s.dueDate, s.dueTime) > e.startAt) return "it is due after its event"; }
  else if (s.dueDate > e.localDate) return "it is due after its event";
  return null;
}

const planDone = (plan: PlanRecord, ref: PlanEventRef): boolean => {
  const m = plannedMark(ref.accountId, ref.eventKey);
  return !!m && m.date === ref.date && m.startAt === (ref.startAt ?? null) && m.plannedAt >= plan.createdAt;
};

export async function handlePlanReport(p: Record<string, unknown>, platform: PlatformContext, now: Date): Promise<PlanReportResult | OpError> {
  const plan = openPlan();
  if (typeof p.planId !== "string" || !plan || plan.planId !== p.planId) return err("PLAN_UNKNOWN", "plan already answered or given up", 409);
  if (!Array.isArray(p.events)) return err("BAD_REPORT", "events must be a list of {event, steps}");

  const accepted: string[] = [];
  const refused: { item: string; reason: string }[] = [];
  const handled = new Set<string>();
  let bad = 0; // validation refusals only
  for (const entry of p.events as any[]) {
    const ref = typeof entry?.event === "string" ? plan.events.find((x) => x.ref === entry.event) : undefined;
    if (!ref) { refused.push({ item: String(entry?.event ?? "?"), reason: "event is not in this plan" }); bad++; continue; }
    if (handled.has(ref.ref)) { refused.push({ item: ref.ref, reason: "event listed twice" }); bad++; continue; }
    handled.add(ref.ref);
    if (planDone(plan, ref)) { refused.push({ item: ref.ref, reason: "already planned" }); continue; }
    const ev = getEvent(ref.accountId, ref.eventKey);
    if (!ev || ev.missingSince != null) continue; // gone: nothing to plan, settled below
    const steps = entry.steps;
    if (!Array.isArray(steps)) { refused.push({ item: ref.ref, reason: "steps must be a list" }); bad++; continue; }
    if (steps.length > MAX_STEPS_PER_EVENT) { refused.push({ item: ref.ref, reason: `at most ${MAX_STEPS_PER_EVENT} steps per event` }); bad++; continue; }

    const prefix = `step:${ev.eventKey}:`;
    const listed = await (platform as any).tasks.list({ prefix }) as { ok: boolean; data?: { tasks: StepState[] }; reason?: string };
    if (!listed.ok) return err("TASKS_UNAVAILABLE", `could not read existing steps: ${listed.reason ?? "unknown"}`, 503);
    const existing = listed.data!.tasks.filter((t) => t.sourceRef.startsWith(prefix) && !t.sourceRef.slice(prefix.length).includes(":"));
    // A step Calendar Desk withdrew is not the owner's close: an event restored in Google gets it again.
    const closed = new Set(existing.filter((t) => t.status !== "open" && !t.withdrawn).map((t) => t.sourceRef.slice(prefix.length)));
    const openKeys = new Set(existing.filter((t) => t.status === "open").map((t) => t.sourceRef.slice(prefix.length)));

    const seen = new Set<string>();
    let allOk = true, fresh = 0;
    for (const raw of steps) {
      const item = `${ref.ref}/${typeof raw?.key === "string" ? raw.key : "?"}`;
      // Cited refs come out of the title and why; a title that was only refs is empty and refused; an empty why gets a plain one.
      const s = raw && typeof raw === "object" ? { ...raw, title: typeof raw.title === "string" ? clean(raw.title) : raw.title, why: (typeof raw.why === "string" ? clean(raw.why) : "") || `planned for ${ev.title}`.slice(0, MAX_WHY) } : raw;

      let why = stepRefusal(s, ev, now, closed, seen);
      if (!why && !openKeys.has(s.key)) {
        if (openKeys.size + fresh + 1 > MAX_STEPS_PER_EVENT) why = `event already has ${openKeys.size} live steps (max ${MAX_STEPS_PER_EVENT})`;
        else fresh++;
      }
      if (why) { refused.push({ item, reason: why }); bad++; allOk = false; continue; }
      const res = await platform.tasks.publish(stepTask(ev, s as StepSpec));
      if (!res.ok) { refused.push({ item, reason: `could not publish: ${(res as any).reason ?? "unknown"}` }); allOk = false; continue; } // the platform's fault: no bad report, the event stays unplanned for the next run
      recordStep(ev.accountId, ev.eventKey, s.key);
      accepted.push(item);
    }
    if (!allOk) continue;
    // A moved or renamed event: the steps the report left out still carry the old limit. A refused update is the
    // platform's answer, not a bad report: the event stays unplanned and is offered again next run.
    const capFails = await refreshStepCaps(platform, ev, existing, seen);
    for (const f of capFails) refused.push({ item: `${ref.ref}/${f.key}`, reason: `could not update its limit: ${f.reason}` });
    if (capFails.length === 0) markPlanned([{ accountId: ref.accountId, eventKey: ref.eventKey, date: ref.date, startAt: ref.startAt }], now.getTime());
  }

  // Everything planned answers the plan, whatever else was refused; only then do bad reports count toward giving up.
  const allPlanned = plan.events.every((r) => {
    if (planDone(plan, r)) return true;
    const ev = getEvent(r.accountId, r.eventKey);
    return !ev || ev.missingSince != null;
  });
  let done = false;
  if (allPlanned) { answerPlan(plan.planId, now.getTime()); done = true; }
  else if (bad > 0 && noteBadReport(plan.planId) >= BAD_REPORTS_MAX) abandonPlan(plan.planId, now.getTime());
  return { accepted, refused, done };
}
