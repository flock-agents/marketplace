import type { PlatformContext } from "@flock/app-sdk";
import { listActiveReminders, getFire, recordFire, listEvents, getEventNote, getPrep, recordPrep, getCursor, setCursor, type ReminderRow } from "./store";
import { rowOccurrencesDue, timedFireDue, titleForLead, readRemindersConfig, type RemindersConfig } from "./rules";
import { syncAccount, shouldScrape } from "./sync";
import { ymd } from "./events";

export interface PrepConfig { windowMinutes: number; skipAllDay: boolean; skipNoAttendees: boolean }
export function readPrepConfig(filter: Record<string, unknown> | undefined): PrepConfig {
  const raw = filter ?? {};
  return { windowMinutes: typeof raw.windowMinutes === "number" && raw.windowMinutes > 0 ? raw.windowMinutes : 30, skipAllDay: raw.skipAllDay !== false, skipNoAttendees: raw.skipNoAttendees !== false };
}
export interface RoutineState { remindersEnabled: boolean; remindersCfg: RemindersConfig; prepEnabled: boolean; prepCfg: PrepConfig }
/** The tick hands us our routines (enabled ones only — the platform ticks only due, enabled routines);
 *  the minute loop reads this snapshot. A routine the tick stops naming is treated as off after 2h. */
export function storeRoutineState(readRoutines: ReadonlyArray<{ id: string; trigger: unknown }>): void {
  const prev = JSON.parse(getCursor("routines") ?? "{}");
  const now = Date.now();
  for (const r of readRoutines) prev[r.id] = { seenAt: now, filter: (r.trigger as any)?.filter ?? {} };
  setCursor("routines", JSON.stringify(prev));
}
export function readRoutineState(): RoutineState {
  const s = JSON.parse(getCursor("routines") ?? "{}");
  const live = (id: string) => s[id] && Date.now() - s[id].seenAt < 2 * 3600_000;
  return { remindersEnabled: live("reminders"), remindersCfg: readRemindersConfig(s.reminders?.filter), prepEnabled: live("meeting-prep"), prepCfg: readPrepConfig(s["meeting-prep"]?.filter) };
}

export const rowSourceRef = (id: string, occ: string) => `rem|${id}|${occ}`;
const localNine = (ymdStr: string) => { const [y, m, d] = ymdStr.split("-").map(Number); return new Date(y!, m! - 1, d!, 9, 0).getTime(); };
const niceDate = (ymdStr: string) => { const [y, m, d] = ymdStr.split("-").map(Number); return new Date(y!, m! - 1, d!).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }); };

function cardFor(r: ReminderRow, occ: string, missed: boolean) {
  const fields = [{ label: "When", value: `${niceDate(occ)}${r.dueTime ? ` ${r.dueTime}` : ""}` }, { label: "From", value: r.sourceKind === "user" ? "You asked" : r.sourceKind === "migrated" ? "Your earlier reminders" : "Found in your email or Slack" }];
  const blocks: any[] = [{ kind: "fields", items: fields }];
  if (r.body && r.body !== r.title) blocks.push({ kind: "message", text: r.body.slice(0, 1200) });
  if (r.sourceLink) blocks.push({ kind: "link", label: "Open the source", href: r.sourceLink });
  return { why: missed ? "This was due at a time your laptop was off." : r.sourceKind === "fact" ? "A date your agents found; the morning sort decides what to do with it." : "You asked to be reminded.", source: r.sourceLink ? { label: "Source", href: r.sourceLink } : undefined, blocks };
}

export async function publishDueRows(platform: PlatformContext, cfg: RemindersConfig, now: Date) {
  const out = { published: 0, failed: 0 };
  if (!platform.configured || now.getHours() < cfg.publishHour) return out;
  const today = ymd(now);
  for (const r of listActiveReminders()) {
    const occurrences: Array<{ occ: string; missed: boolean }> = rowOccurrencesDue(r, today).map((occ) => ({ occ, missed: false }));
    // A TIMED reminder whose minute passed on an earlier day with no chat sent becomes a row (Review Focus 2).
    if (r.dueTime && r.dueDate < today && !getFire(r.id, r.dueDate, "chat") && !getFire(r.id, r.dueDate, "row")) occurrences.push({ occ: r.dueDate, missed: true });
    for (const { occ, missed } of occurrences) {
      if (getFire(r.id, occ, "row")) continue;
      const sourceRef = rowSourceRef(r.id, occ);
      const title = missed ? `Missed: ${r.title}` : titleForLead(r, occ, today);
      const res = await platform.tasks.publish({ title, sourceRef, type: "reminder", priority: "normal", due: localNine(occ), body: r.body ?? undefined, context: { why: cardFor(r, occ, missed).why, card: cardFor(r, occ, missed) } });
      if (res.ok) { recordFire({ reminderId: r.id, occurrence: occ, kind: "row", taskSourceRef: sourceRef, sessionId: null, status: "ok" }); out.published++; }
      else { out.failed++; console.warn(`[calendar-desk] publish ${sourceRef} failed: ${res.reason}`); }
    }
  }
  return out;
}

const QUIET_START = 23, QUIET_END = 8;
export function quietHoursDefer(now: Date): Date | null {
  const h = now.getHours();
  if (h >= QUIET_END && h < QUIET_START) return null;
  const d = new Date(now); if (h >= QUIET_START) d.setDate(d.getDate() + 1);
  d.setHours(QUIET_END, 0, 0, 0); return d;
}

export async function fireTimedReminders(platform: PlatformContext, now: Date) {
  const out = { fired: 0, deferred: 0, failed: 0 };
  if (!platform.configured) return out;
  const today = ymd(now);
  for (const r of listActiveReminders()) {
    const due = timedFireDue(r, now);
    if (!due) continue;
    const prior = getFire(r.id, due.occurrence, "chat");
    if (prior && (prior.status === "ok" || prior.attempts >= 3)) continue;
    if (quietHoursDefer(now)) { out.deferred++; continue; }        // delivered from 08:00 by the same check
    const reuse = getCursor(`reminder_session:${today}`);
    const payload: Record<string, unknown> = { reminderId: r.id, title: r.title, body: r.body ?? "", dueAt: new Date(due.dueAt).toISOString(), sourceLink: r.sourceLink ?? "", ...(reuse ? { reuseSessionId: reuse } : {}), ...(now.getTime() - due.dueAt > 20 * 60_000 ? { late: true } : {}) };
    const res = await platform.agent.intent<{ sessionId: string }>("reminder_due", payload);
    if (res.ok) { recordFire({ reminderId: r.id, occurrence: due.occurrence, kind: "chat", taskSourceRef: null, sessionId: res.data.sessionId, status: "ok" }); setCursor(`reminder_session:${today}`, res.data.sessionId); out.fired++; }
    else { recordFire({ reminderId: r.id, occurrence: due.occurrence, kind: "chat", taskSourceRef: null, sessionId: null, status: "failed", attempts: (prior?.attempts ?? 0) + 1 }); out.failed++; console.warn(`[calendar-desk] reminder_due ${r.id} failed: ${res.reason}`); }
  }
  return out;
}

export async function runPrepWindow(platform: PlatformContext, cfg: PrepConfig, now: Date, deps: { sync?: typeof syncAccount; facts?: (around: string) => Promise<unknown[]> } = {}) {
  const out = { prepped: 0 };
  if (!platform.configured) return out;
  const today = ymd(now);
  const windowEnd = now.getTime() + cfg.windowMinutes * 60_000;
  const candidates = listEvents({ fromDate: today, toDate: today }).filter((e) =>
    !e.allDay && e.startAt != null && e.startAt > now.getTime() && e.startAt <= windowEnd && !getPrep(e.accountId, e.eventKey)
    && (!cfg.skipNoAttendees || !!e.attendeesText));
  const allDay = cfg.skipAllDay ? [] : listEvents({ fromDate: today, toDate: today }).filter((e) => e.allDay && !getPrep(e.accountId, e.eventKey) && now.getHours() >= 8);
  const pick = [...candidates, ...allDay];
  if (pick.length === 0) return out;
  // One refresh so a cancelled meeting is not prepped (lease permitting); stale data otherwise.
  for (const acct of new Set(pick.map((e) => e.accountId))) if (shouldScrape(acct, now, "pre-prep")) await (deps.sync ?? syncAccount)(acct, { platform, now: () => now }, "pre-prep");
  for (const e0 of pick) {
    const e = listEvents({ fromDate: today, toDate: today, accountId: e0.accountId }).find((x) => x.eventKey === e0.eventKey);
    if (!e) continue;                                             // vanished in the refresh
    const note = getEventNote(e.accountId, e.eventKey)?.note ?? "";
    const factsAround = deps.facts ? (await deps.facts(e.localDate)).slice(0, 10) : [];
    const res = await platform.agent.intent<{ sessionId: string }>("meeting_prep", {
      eventKey: e.eventKey, title: e.title, startAt: new Date(e.startAt ?? now).toISOString(), endAt: e.endAt ? new Date(e.endAt).toISOString() : "",
      attendees: e.attendeesText ?? "", location: e.location ?? "", note, factsAround, budget: { toolCalls: 3, words: 300 },
    });
    if (res.ok) { recordPrep(e.accountId, e.eventKey, res.data.sessionId); out.prepped++; }
    else console.warn(`[calendar-desk] meeting_prep ${e.eventKey} failed: ${res.reason}`);
  }
  return out;
}

/** The app's own clock: cheap, local-store work every minute. The platform tick does the rest. */
export function startMinuteLoop(platform: PlatformContext): () => void {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return; busy = true;
    try {
      const st = readRoutineState(); const now = new Date();
      if (st.remindersEnabled) await fireTimedReminders(platform, now);
      if (st.prepEnabled) await runPrepWindow(platform, st.prepCfg, now, { facts: factsAroundDate(platform) });
    } catch (e: any) { console.error(`[calendar-desk] minute loop: ${e?.message ?? e}`); }
    finally { busy = false; }
  }, 60_000);
  return () => clearInterval(timer);
}

/** Facts whose `when.date` is within ±1 day of the meeting — read through the same reader, window-filtered here. */
export function factsAroundDate(platform: PlatformContext) {
  return async (localDate: string): Promise<unknown[]> => {
    const res = await platform.memory.factsSince<{ facts: Array<{ content: string; when: { date: string } | null; dateRole: string | null }> }>({ sinceIso: new Date(Date.now() - 60 * 86_400_000).toISOString(), limit: 500, datedOnly: true });
    if (!res.ok) return [];
    const d = new Date(localDate).getTime();
    return res.data.facts.filter((f) => f.when && Math.abs(new Date(f.when.date).getTime() - d) <= 86_400_000).map((f) => ({ content: f.content, role: f.dateRole }));
  };
}
