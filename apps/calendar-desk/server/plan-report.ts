// plan_events_done: the working agent's report for a plan_events run. Each step is checked (rules ported from core's
// pa-brief event-decisions.ts: eventSchemaErrors + the add_steps checks), published as Calendar Desk's own TODO, and
// answered per item. The plan is answered once every offered event is planned; refused reports count against it.
import type { PlatformContext, OpError, AppTask } from "@flock/app-sdk";
import { getEvent, type EventRow } from "./store";
import { ymd } from "./events";
import { pointer } from "./planner";
import { openPlan, plannedMark, markPlanned, recordStep, noteBadReport, answerPlan, abandonPlan, BAD_REPORTS_MAX, type PlanRecord, type PlanEventRef } from "./planning-store";

type AppTaskState = { sourceRef: string; status: "open" | "done" | "dismissed" };
const MAX_STEPS_PER_EVENT = 3, MAX_WHY = 500, MAX_TITLE = 200;
const KEY = /^[a-z0-9-]{1,40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^\d{2}:\d{2}$/;
const err = (code: string, message: string, status = 400): OpError => ({ error: message, code, status });

export interface StepSpec { key: string; title: string; dueDate: string; dueTime?: string; showFrom?: string; why: string }
export type PlanReportResult = { accepted: string[]; refused: { item: string; reason: string }[]; done: boolean };

const isRealDate = (s: unknown): s is string => {
  if (typeof s !== "string" || !DATE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  return ymd(new Date(y!, m! - 1, d!)) === s;
};
const isRealTime = (s: unknown): s is string => typeof s === "string" && HM.test(s) && Number(s.slice(0, 2)) < 24 && Number(s.slice(3)) < 60;
const localAt = (date: string, time?: string) => new Date(`${date}T${time ?? "00:00"}:00`).getTime();

/** The latest a step for the event may be due or shown: its start (timed) or the end of its day (all-day), with the reason Flock shows. */
export function maxDueOf(e: EventRow): { maxDue: number; maxDueReason: string } {
  const day = new Date(`${e.localDate}T00:00:00`);
  const label = day.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(",", "");
  if (!e.allDay && e.startAt != null) {
    const t = new Date(e.startAt); const hm = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
    return { maxDue: e.startAt, maxDueReason: `${e.title}, ${label} ${hm}` };
  }
  return { maxDue: day.getTime() + 86_399_999, maxDueReason: `${e.title}, ${label}` };
}

/** The TODO Calendar Desk publishes for a step. Dates are the owner's local day (the process runs in the owner's zone). */
export function stepTask(e: EventRow, s: StepSpec, _tz: string): AppTask {
  const { maxDue, maxDueReason } = maxDueOf(e);
  return {
    sourceRef: `step:${e.eventKey}:${s.key}`, title: s.title.trim(),
    due: localAt(s.dueDate, s.dueTime), dueTimed: !!s.dueTime,
    showFrom: s.showFrom ?? s.dueDate, status: "backlog", maxDue, maxDueReason,
    context: { eventKey: pointer(e.eventKey), why: s.why },
  };
}

/** Why a step is unusable, or null. `closed` = keys the owner already closed; `seen` = keys earlier in this entry. */
function stepRefusal(s: any, e: EventRow, now: Date, closed: Set<string>, seen: Set<string>): string | null {
  if (!s || typeof s !== "object") return "must be an object";
  if (typeof s.key !== "string" || !KEY.test(s.key)) return `key must match ${KEY}`;
  if (seen.has(s.key)) return `key ${s.key} is used twice`;
  seen.add(s.key);
  if (closed.has(s.key)) return `step ${s.key} was already done or dismissed by the owner`;
  if (typeof s.title !== "string" || s.title.trim().length < 1) return "title is required";
  if (s.title.trim().length > MAX_TITLE) return `title is longer than ${MAX_TITLE}`;
  if (typeof s.why !== "string" || !s.why.trim()) return "why is required";
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
  for (const entry of p.events as any[]) {
    const ref = typeof entry?.event === "string" ? plan.events.find((x) => x.ref === entry.event) : undefined;
    if (!ref) { refused.push({ item: String(entry?.event ?? "?"), reason: "event is not in this plan" }); continue; }
    if (handled.has(ref.ref)) { refused.push({ item: ref.ref, reason: "event listed twice" }); continue; }
    handled.add(ref.ref);
    if (planDone(plan, ref)) continue; // answered by an earlier report
    const ev = getEvent(ref.accountId, ref.eventKey);
    if (!ev || ev.missingSince != null) continue; // gone: nothing to plan, settled below
    const steps = entry.steps;
    if (!Array.isArray(steps)) { refused.push({ item: ref.ref, reason: "steps must be a list" }); continue; }
    if (steps.length > MAX_STEPS_PER_EVENT) { refused.push({ item: ref.ref, reason: `at most ${MAX_STEPS_PER_EVENT} steps per event` }); continue; }

    const prefix = `step:${ev.eventKey}:`;
    const listed = await (platform as any).tasks.list({ prefix }) as { ok: boolean; data?: { tasks: AppTaskState[] }; reason?: string };
    if (!listed.ok) return err("TASKS_UNAVAILABLE", `could not read existing steps: ${listed.reason ?? "unknown"}`, 503);
    const existing = listed.data!.tasks.filter((t) => t.sourceRef.startsWith(prefix) && !t.sourceRef.slice(prefix.length).includes(":"));
    const closed = new Set(existing.filter((t) => t.status !== "open").map((t) => t.sourceRef.slice(prefix.length)));
    const openKeys = new Set(existing.filter((t) => t.status === "open").map((t) => t.sourceRef.slice(prefix.length)));

    const seen = new Set<string>();
    let allOk = true, fresh = 0;
    for (const s of steps) {
      const item = `${ref.ref}/${typeof s?.key === "string" ? s.key : "?"}`;
      let why = stepRefusal(s, ev, now, closed, seen);
      if (!why && !openKeys.has(s.key)) {
        if (openKeys.size + fresh + 1 > MAX_STEPS_PER_EVENT) why = `event already has ${openKeys.size} live steps (max ${MAX_STEPS_PER_EVENT})`;
        else fresh++;
      }
      if (why) { refused.push({ item, reason: why }); allOk = false; continue; }
      const res = await platform.tasks.publish(stepTask(ev, s as StepSpec, Intl.DateTimeFormat().resolvedOptions().timeZone));
      if (!res.ok) { refused.push({ item, reason: `could not publish: ${(res as any).reason ?? "unknown"}` }); allOk = false; continue; }
      recordStep(ev.accountId, ev.eventKey, s.key);
      accepted.push(item);
    }
    if (allOk) markPlanned([{ accountId: ref.accountId, eventKey: ref.eventKey, date: ref.date, startAt: ref.startAt }], now.getTime());
  }

  let done = false;
  if (refused.length > 0 && noteBadReport(plan.planId) >= BAD_REPORTS_MAX) abandonPlan(plan.planId, now.getTime());
  else if (plan.events.every((r) => {
    if (planDone(plan, r)) return true;
    const ev = getEvent(r.accountId, r.eventKey);
    return !ev || ev.missingSince != null;
  })) { answerPlan(plan.planId, now.getTime()); done = true; }
  return { accepted, refused, done };
}
