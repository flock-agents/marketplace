import type { PlatformContext } from "@flock/app-sdk";
import { listEvents, getEventNote, getPrep, recordPrep, getCursor, setCursor } from "./store";
import { syncAccount, shouldScrape } from "./sync";
import { ymd } from "./events";

export interface PrepConfig { windowMinutes: number; skipAllDay: boolean; skipNoAttendees: boolean }
export function readPrepConfig(filter: Record<string, unknown> | undefined): PrepConfig {
  const raw = filter ?? {};
  return { windowMinutes: typeof raw.windowMinutes === "number" && raw.windowMinutes > 0 ? raw.windowMinutes : 30, skipAllDay: raw.skipAllDay !== false, skipNoAttendees: raw.skipNoAttendees !== false };
}
export interface RoutineState { prepEnabled: boolean; prepCfg: PrepConfig }
/** The routine's manifest id ("meeting-prep"). On the wire `id` is the instance UUID
 *  and `appRoutineId` the manifest id; `id` is only a fallback for a platform that predates it. */
export const routineKey = (r: { id: string; appRoutineId?: string | null }) => r.appRoutineId ?? r.id;
/** The tick hands us our routines (enabled ones only — the platform ticks only due, enabled routines);
 *  the minute loop reads this snapshot. A routine the tick stops naming is treated as off after 2h. */
export function storeRoutineState(readRoutines: ReadonlyArray<{ id: string; appRoutineId?: string | null; trigger: unknown }>): void {
  const prev = JSON.parse(getCursor("routines") ?? "{}");
  const now = Date.now();
  for (const r of readRoutines) prev[routineKey(r)] = { seenAt: now, filter: (r.trigger as any)?.filter ?? {} };
  setCursor("routines", JSON.stringify(prev));
}
export function readRoutineState(): RoutineState {
  const s = JSON.parse(getCursor("routines") ?? "{}");
  const live = (id: string) => s[id] && Date.now() - s[id].seenAt < 2 * 3600_000;
  return { prepEnabled: live("meeting-prep"), prepCfg: readPrepConfig(s["meeting-prep"]?.filter) };
}

export async function runPrepWindow(platform: PlatformContext, cfg: PrepConfig, now: Date, deps: { sync?: typeof syncAccount; facts?: (around: string) => Promise<unknown[]> } = {}) {
  const out = { prepped: 0 };
  if (!platform.configured) return out;
  const today = ymd(now);
  const windowEnd = now.getTime() + cfg.windowMinutes * 60_000;
  // Fact events are planned by the morning sort, not meeting-prepped (Part B call 6).
  const candidates = listEvents({ fromDate: today, toDate: today, source: "google" }).filter((e) =>
    !e.allDay && e.startAt != null && e.startAt > now.getTime() && e.startAt <= windowEnd && !getPrep(e.accountId, e.eventKey)
    // Ruling 5 (2026-10-06): once details are read, no guest but the owner = a time block, no prep.
    // R22: details never read = unknown, still prepped (the agenda's organiser-only text says nothing).
    && (!cfg.skipNoAttendees || (e.guests == null ? (e.attendeesText == null || e.attendeesText.trim() !== "") : e.guests.length > 0)));
  const allDay = cfg.skipAllDay ? [] : listEvents({ fromDate: today, toDate: today, source: "google" }).filter((e) => e.allDay && !getPrep(e.accountId, e.eventKey) && now.getHours() >= 8);
  const pick = [...candidates, ...allDay];
  if (pick.length === 0) return out;
  // One refresh so a cancelled meeting is not prepped (lease permitting); stale data otherwise.
  for (const acct of new Set(pick.map((e) => e.accountId))) if (shouldScrape(acct, now, "pre-prep")) await (deps.sync ?? syncAccount)(acct, { platform, now: () => now }, "pre-prep");
  for (const e0 of pick) {
    const e = listEvents({ fromDate: today, toDate: today, accountId: e0.accountId, source: "google" }).find((x) => x.eventKey === e0.eventKey);
    if (!e) continue;                                             // vanished in the refresh
    const note = getEventNote(e.accountId, e.eventKey)?.note ?? "";
    const factsAround = deps.facts ? (await deps.facts(e.localDate)).slice(0, 10) : [];
    const guestLines = (e.guests ?? []).map((g) => `${g.name ? `${g.name} <${g.email}>` : g.email}${g.rsvp ? ` (${g.rsvp})` : ""}`).join("\n");
    const res = await platform.agent.intent<{ sessionId: string }>("meeting_prep", {
      eventKey: e.eventKey, title: e.title, startAt: new Date(e.startAt ?? now).toISOString(), endAt: e.endAt ? new Date(e.endAt).toISOString() : "",
      attendees: guestLines || (e.attendeesText ?? ""), guests: guestLines, guestSummary: e.guestSummary ?? "",
      description: e.description ?? "", meetLink: e.meetLink ?? "", location: e.location ?? "", note, factsAround, budget: { toolCalls: 3, words: 300 },
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
      if (st.prepEnabled) await runPrepWindow(platform, st.prepCfg, now, { facts: factsAroundDate(platform) });
    } catch (e: any) { console.error(`[calendar-desk] minute loop: ${e?.message ?? e}`); }
    finally { busy = false; }
  }, 60_000);
  return () => clearInterval(timer);
}

/** Facts whose `when.date` is within ±1 day of the meeting — read through the same reader, window-filtered here.
 *  The reader pages OLDEST first, so one 500-row page would drop the recent facts: page through the
 *  window (inclusive cursor — dedupe by id), then order newest first for the caller's top-N. */
export function factsAroundDate(platform: PlatformContext) {
  type Fact = { id: number; content: string; when: { date: string } | null; dateRole: string | null; recordedAt: string };
  return async (localDate: string): Promise<unknown[]> => {
    const byId = new Map<number, Fact>();
    let since = new Date(Date.now() - 60 * 86_400_000).toISOString();
    for (let page = 0; page < 20; page++) {
      const res = await platform.memory.factsSince<{ facts: Fact[]; nextSince: string }>({ sinceIso: since, limit: 500, datedOnly: true });
      if (!res.ok) break;
      for (const f of res.data.facts) byId.set(f.id, f);
      if (res.data.facts.length < 500 || res.data.nextSince === since) break;
      since = res.data.nextSince;
    }
    const d = new Date(localDate).getTime();
    return [...byId.values()].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
      .filter((f) => f.when && Math.abs(new Date(f.when.date).getTime() - d) <= 86_400_000).map((f) => ({ content: f.content, role: f.dateRole }));
  };
}
