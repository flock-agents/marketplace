// One sync pass: the Zepp replies the app fetched in, the dashboard rows out.
// Idempotent: every row has a deterministic stamp, so a re-run adds nothing again. A number Zepp has since revised
// (a day synced late, today's running total) is corrected in place and moved to the pass's time, unless the owner edited
// that row themselves. No row is ever dated after the pass that wrote it, so a later reading posted that day still wins.
import { LOOKBACK_DAYS, SYNC_AUTHOR } from "./config";
import { localDate, spokenTime, stampOn } from "../../time/dates";
import { dayReadings, newestWatchData, paiReadings, sleepReadings, watchDataUntil, workoutEvents, weightReadings, type Reading } from "./mapping";
import { readToolResult, type ToolReply } from "../tool-result";
import type { FiledReading, SyncStore } from "../store";
import type { SyncReport } from "../types";

export type { FiledReading, SyncReport };

export interface RawReplies { daily?: ToolReply; workouts?: ToolReply; body?: ToolReply; pai?: ToolReply; heart?: ToolReply }

export const failureAlert = () => "Zepp sync failed — sign in to Zepp again, or log today's numbers by hand";

/** What a pass fetches: the last LOOKBACK_DAYS days (each day's totals and the night that ended that morning),
 *  workouts in the same window, recent scale readings, PAI (only Zepp's events data has it, through the raw lookup) and today's heart rate. A pass calls each `tool` with its `args`
 *  and hands the replies to `ingest` under the same keys. */
export function syncPlan(now: Date, days = LOOKBACK_DAYS) {
  const today = localDate(now), from = localDate(now, days);
  return {
    today, from,
    calls: {
      daily: { tool: "zepp_daily_summary", args: { from_date: from, to_date: today } },
      workouts: { tool: "zepp_list_workouts", args: { from_date: from, to_date: today } },
      body: { tool: "zepp_body_composition", args: { limit: 10 } },
      heart: { tool: "zepp_heart_rate", args: { date: today } },   // only to learn how far today's watch data reaches
      pai: {
        tool: "zepp_raw_request",
        args: { path: "/v2/users/me/events", params: { eventType: "PaiHealthInfo", from: String(Date.parse(stampOn(from, "00:00"))), to: String(now.getTime()), limit: 20, reverse: "false" } },
      },
    },
  };
}

export function filed(r: Reading, now: Date): FiledReading {
  const at = now.toISOString();
  return { ...r, stamp: r.created_at, created_at: r.created_at < at ? r.created_at : at };
}

type Outcome = "added" | "updated" | "kept";

async function upsert(r: FiledReading, store: SyncStore): Promise<Outcome> {
  const stored = store.findReading(r);
  if (!stored) { await store.addReading(r); return "added"; }
  // Unchanged keeps its time, so a newer reading posted since still wins; the owner's own edit is never overwritten.
  if (stored.value === r.value || stored.updated_by !== SYNC_AUTHOR) return "kept";
  await store.updateReading(stored.id, r);
  return "updated";
}

export async function ingest(raw: RawReplies, store: SyncStore, now = new Date(), days = LOOKBACK_DAYS): Promise<SyncReport> {
  const { today, from } = syncPlan(now, days);
  const replies = { daily: readToolResult(raw.daily), workouts: readToolResult(raw.workouts), body: readToolResult(raw.body), pai: readToolResult(raw.pai), heart: readToolResult(raw.heart) };
  const failed = Object.entries(replies).filter(([, r]) => !r.ok).map(([name]) => name);
  const data = (name: keyof typeof replies) => { const r = replies[name]; return r.ok ? r.data : null; };

  const readings = [...dayReadings(data("daily"), today), ...sleepReadings(data("daily")), ...weightReadings(data("body")), ...paiReadings(data("pai"))]
    .map((r) => filed(r, now));
  let added = 0, updated = 0;
  for (const r of readings) {
    const outcome = await upsert(r, store);
    if (outcome === "added") added++;
    if (outcome === "updated") updated++;
  }
  for (const w of workoutEvents(data("workouts"), from)) if (!store.hasEvent(w.title, w.at)) { await store.addEvent(w); added++; }

  // Every reply failing means the connection itself is down (signed out, Zepp changed): one alert a day.
  const allFailed = failed.length === Object.keys(replies).length;
  if (allFailed && !store.hasEvent(failureAlert(), today)) await store.addEvent({ title: failureAlert(), at: today, kind: "Alert" });

  const newest = newestWatchData(data("pai"), data("workouts"));
  const message = allFailed
    ? `Zepp sync failed: ${(replies.daily as { error: string }).error}`
    : `${syncSummary(added, updated, newest, now)}${failed.length ? `; could not read ${failed.join(", ")}` : ""}`;
  const todayAsOf = replies.daily.ok ? watchDataUntil(data("heart"), today) : null;
  return { ok: !allFailed, added, updated, failed, message, newest, todayAsOf };
}

/** What a pass changed, in the viewer's words, and how current Zepp itself is: it only has what the phone last uploaded. */
export function syncSummary(added: number, updated: number, newest: string | null, now: Date): string {
  const asOf = newest ? `Zepp's newest watch data is from ${spokenTime(newest, now)}` : null;
  if (added + updated > 0) return `Synced with Zepp: ${added} new, ${updated} updated${asOf ? `. ${asOf}` : ""}`;
  const upload = "open the Zepp app on your phone so the watch uploads, then sync again";
  return asOf ? `Synced with Zepp: nothing new. ${asOf}: ${upload}` : `Synced with Zepp: nothing new yet. If your watch shows newer numbers, ${upload}`;
}
