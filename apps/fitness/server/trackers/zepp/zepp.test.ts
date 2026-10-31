import { describe, it, expect } from "bun:test";
import { readToolResult, type ToolReply } from "../tool-result";
import { dayReadings, newestWatchData, paiReadings, sleepReadings, watchDataUntil, workoutEvents, weightReadings } from "./mapping";
import { ingest, failureAlert, filed, syncPlan, syncSummary, type FiledReading } from "./ingest";
import { localDate, stampOn } from "../../time/dates";
import { SYNC_AUTHOR } from "./config";
import type { StoredReading, SyncStore } from "../store";

const reply = (data: unknown): ToolReply => ({ ok: true, data: { content: [{ type: "text", text: JSON.stringify(data) }], isError: false } });
const refused = (reason: string): ToolReply => ({ ok: false, reason });
const NOW = new Date("2026-10-21T01:00:00.000Z");   // 6:30 AM in Kolkata, 21 Oct

type Row = FiledReading & StoredReading;
function memoryStore(rows: Row[] = []) {
  const events: { title: string; at: string; kind: string }[] = [];
  const store: SyncStore = {
    findReading: (r) => rows.find((x) => x.label === r.label && x.stamp === r.stamp) ?? null,
    hasEvent: (title, at) => events.some((e) => e.title === title && e.at === at),
    addReading: async (r) => { rows.push({ ...r, id: String(rows.length), updated_by: SYNC_AUTHOR }); },
    updateReading: async (id, r) => { Object.assign(rows.find((x) => x.id === id)!, { value: r.value, created_at: r.created_at }); },
    addEvent: async (e) => { events.push(e); },
  };
  return { store, rows, events };
}

const SUMMARY = { status: "ok", days: [
  { date: "2026-10-19", steps: 0, calories_kcal: 0 },
  { date: "2026-10-20", steps: 8412, calories_kcal: 410, distance_metres: 6123, sleep: { total_asleep_minutes: 400, deep_minutes: 75, sleep_score: 74, resting_heart_rate_bpm: 59 } },
  { date: "2026-10-21", steps: 312, calories_kcal: 20, sleep: { total_asleep_minutes: 412, deep_minutes: 80 } },
] };

describe("dates", () => {
  it("uses Kolkata days", () => {
    expect(localDate(NOW)).toBe("2026-10-21");
    expect(localDate(NOW, 1)).toBe("2026-10-20");
    expect(localDate(new Date("2026-10-20T19:00:00.000Z"))).toBe("2026-10-21");   // 00:30 IST
  });
  it("stamps a local time as UTC", () => expect(stampOn("2026-10-20", "23:59")).toBe("2026-10-20T18:29:00.000Z"));
});

describe("syncPlan", () => {
  it("reads the last week up to today", () => {
    const { calls } = syncPlan(NOW);
    expect(calls.daily).toEqual({ tool: "zepp_daily_summary", args: { from_date: "2026-10-14", to_date: "2026-10-21" } });
    expect(calls.workouts.args).toEqual({ from_date: "2026-10-14", to_date: "2026-10-21" });
    expect(Object.keys(calls)).toEqual(["daily", "workouts", "body", "heart", "pai"]);
    expect(calls.heart).toEqual({ tool: "zepp_heart_rate", args: { date: "2026-10-21" } });
    expect(calls.pai).toEqual({ tool: "zepp_raw_request", args: { path: "/v2/users/me/events", params: { eventType: "PaiHealthInfo", from: String(Date.parse("2026-10-14T00:00:00+05:30")), to: String(NOW.getTime()), limit: 20, reverse: "false" } } });
  });
});

describe("readToolResult", () => {
  it("unwraps the tool's JSON", () => expect(readToolResult(reply({ status: "ok", x: 1 }))).toEqual({ ok: true, data: { status: "ok", x: 1 } }));
  it("treats refused calls, tool errors and junk as failures", () => {
    expect(readToolResult(refused("Unauthorized"))).toEqual({ ok: false, error: "Unauthorized" });
    expect(readToolResult(reply({ status: "error", error: "login failed" }))).toEqual({ ok: false, error: "login failed" });
    expect(readToolResult({ ok: true, data: { content: [{ type: "text", text: "Zepp is down" }], isError: true } })).toEqual({ ok: false, error: "Zepp is down" });
    expect(readToolResult({ ok: true, data: { content: [{ type: "text", text: "not json" }] } }).ok).toBe(false);
    expect(readToolResult(undefined).ok).toBe(false);
  });
});

describe("mapping", () => {
  it("leaves out a zero reading", () => {
    expect(dayReadings({ days: [{ date: "2026-10-18", steps: 743, calories_kcal: 0, distance_metres: 460 }] }, "2026-10-21").map((r) => r.label)).toEqual(["Steps", "Distance"]);
  });
  it("maps days up to today, today's totals so far included, skipping empty ones, distance in km", () => {
    expect(dayReadings(SUMMARY, "2026-10-21").map((r) => [r.label, r.value, r.unit, r.created_at])).toEqual([
      ["Steps", 8412, "steps", "2026-10-20T18:29:00.000Z"], ["Calories burned", 410, "kcal", "2026-10-20T18:29:00.000Z"], ["Distance", 6.12, "km", "2026-10-20T18:29:00.000Z"],
      ["Steps", 312, "steps", "2026-10-21T18:29:00.000Z"], ["Calories burned", 20, "kcal", "2026-10-21T18:29:00.000Z"],
    ]);
    expect(dayReadings(SUMMARY, "2026-10-20").map((r) => r.created_at.slice(0, 10))).not.toContain("2026-10-21");
  });
  it("files each night under the morning it ended, and skips a missed night", () => {
    const rows = sleepReadings({ days: [...SUMMARY.days, { date: "2026-10-18", sleep: { main_sleep_recorded: false } }] });
    expect(rows.map((r) => [r.label, r.value, r.created_at.slice(0, 10)])).toEqual([
      ["Sleep", 6.7, "2026-10-20"], ["Deep sleep", 75, "2026-10-20"], ["Sleep score", 74, "2026-10-20"], ["Resting heart rate", 59, "2026-10-20"],
      ["Sleep", 6.9, "2026-10-21"], ["Deep sleep", 80, "2026-10-21"],
    ]);
  });
  it("maps workouts in the window, in local time, naming only sports Zepp knows", () => {
    const list = { workouts: [
      { sport: "outdoor_running", start_local: "2026-10-21T07:05:00+05:30", elapsed_seconds: 1830, summary: { calorie: 312.4, avg_heart_rate: 151 } },
      { sport: "unknown_sport_12", start_local: "2026-10-20T10:30:00+00:00", elapsed_seconds: 720, summary: { calorie: 0, avg_heart_rate: 149 } },
      { sport: "unknown_sport_149", start_local: "2026-10-19T11:40:37+05:30", elapsed_seconds: 0, summary: { calorie: 0, avg_heart_rate: 0 } },
      { sport: "walking", start_local: "2024-07-10T03:58:15+00:00", elapsed_seconds: 480 },
    ] };
    expect(workoutEvents(list, "2026-10-14")).toEqual([
      { title: "Workout: Outdoor running · 31 min · 312 kcal · avg HR 151", at: "2026-10-21T07:05", kind: "Milestone" },
      { title: "Workout · 12 min · avg HR 149", at: "2026-10-20T16:00", kind: "Milestone" },
    ]);
  });
  it("maps PAI to its rounded rolling total, at the start of its day", () => {
    const reply = { status: "ok", data: { items: [
      { eventType: "PaiHealthInfo", timestamp: 1792434600000, value: { totalPai: "61.4", dailyPai: "3.2" } },
      { eventType: "PaiHealthInfo", timestamp: 1792521000000, value: { totalPai: "57.722183", dailyPai: "0.17" } },
      { eventType: "PaiHealthInfo", timestamp: 1792521000000, value: {} },
    ] } };
    expect(paiReadings(reply)).toEqual([
      { label: "PAI", value: 61, unit: null, created_at: "2026-10-19T18:30:00.000Z" },
      { label: "PAI", value: 58, unit: null, created_at: "2026-10-20T18:30:00.000Z" },
    ]);
    expect(paiReadings({ status: "no_data" })).toEqual([]);
  });
  it("maps scale readings, body fat only when measured", () => {
    const rows = weightReadings({ readings: [{ date: "2026-10-20T02:10:00+00:00", weight_kg: 79.4, body_composition: { body_fat_percent: 24.1 } }, { date: "2026-10-18T02:00:00+00:00", weight_kg: 79.9 }] });
    expect(rows.map((r) => [r.label, r.value])).toEqual([["Weight", 79.4], ["Body fat", 24.1], ["Weight", 79.9]]);
  });
});

describe("ingest", () => {
  const raw = { daily: reply(SUMMARY), workouts: reply({ status: "ok", workouts: [] }), body: reply({ status: "ok", readings: [] }), pai: reply({ status: "ok", data: { items: [{ timestamp: 1792521000000, value: { totalPai: "57.7" } }] } }), heart: reply({ status: "ok", date: "2026-10-21", last_reading_minute: 380 }) };
  it("adds rows once, however often it runs", async () => {
    const { store, rows } = memoryStore();
    expect((await ingest(raw, store, NOW)).added).toBe(12);
    expect(await ingest(raw, store, NOW)).toMatchObject({ added: 0, updated: 0 });
    expect(rows).toHaveLength(12);
  });
  it("corrects a number Zepp revised, but never the owner's own edit", async () => {
    const { store, rows } = memoryStore();
    await ingest(raw, store, NOW);
    rows.find((r) => r.label === "Calories burned")!.updated_by = "user:owner";
    rows.find((r) => r.label === "Calories burned")!.value = 500;
    const later = { ...raw, daily: reply({ days: [{ ...SUMMARY.days[1], steps: 9100, calories_kcal: 450 }] }) };
    expect(await ingest(later, store, NOW)).toMatchObject({ added: 0, updated: 1 });
    expect(rows.find((r) => r.label === "Steps")!.value).toBe(9100);
    expect(rows.find((r) => r.label === "Calories burned")!.value).toBe(500);
  });
  it("files today's running totals at the pass's time, never ahead of it", async () => {
    const { store, rows } = memoryStore();
    await ingest(raw, store, NOW);
    const steps = rows.filter((r) => r.label === "Steps");
    expect(steps.map((r) => r.created_at)).toEqual(["2026-10-20T18:29:00.000Z", NOW.toISOString()]);   // yesterday's finished day, today's so far
    expect(rows.every((r) => r.created_at <= NOW.toISOString())).toBe(true);
  });
  it("moves today's total to a later pass's time only when the number changed", async () => {
    const { store, rows } = memoryStore();
    await ingest(raw, store, NOW);
    const later = new Date("2026-10-21T09:30:00.000Z");   // 3 PM
    await ingest(raw, store, later);
    expect(rows.find((r) => r.label === "Steps" && r.stamp.startsWith("2026-10-21"))!.created_at).toBe(NOW.toISOString());
    const moved = { ...raw, daily: reply({ days: [{ ...SUMMARY.days[2], steps: 4100 }] }) };
    expect(await ingest(moved, store, later)).toMatchObject({ added: 0, updated: 1 });
    expect(rows.find((r) => r.label === "Steps" && r.stamp.startsWith("2026-10-21"))).toMatchObject({ value: 4100, created_at: later.toISOString() });
  });
  it("raises one alert a day when the connection is down", async () => {
    const { store, events } = memoryStore();
    const down = refused("Unauthorized");
    const report = await ingest({ daily: down, workouts: down, body: down, pai: down }, store, NOW);
    await ingest({}, store, NOW);
    expect(report.ok).toBe(false);
    expect(events).toEqual([{ title: failureAlert(), at: "2026-10-21", kind: "Alert" }]);
  });
  it("writes what it could read when only part fails", async () => {
    const { store } = memoryStore();
    expect(await ingest({ ...raw, body: refused("timeout") }, store, NOW)).toMatchObject({ ok: true, added: 12, failed: ["body"] });
  });
});

describe("filed", () => {
  it("keeps a past stamp and pulls a future one back to now", () => {
    const r = { label: "Steps", value: 1, unit: "steps", created_at: "2026-10-21T18:29:00.000Z" };
    expect(filed(r, NOW)).toEqual({ ...r, stamp: r.created_at, created_at: NOW.toISOString() });
    expect(filed(r, new Date("2026-10-22T02:00:00.000Z")).created_at).toBe(r.created_at);
  });
});

describe("syncSummary", () => {
  const now = new Date("2026-10-21T15:00:00.000Z");   // 8:30 PM in Kolkata
  it("says when Zepp's newest watch data is from, and how to get newer numbers, when nothing changed", () => {
    expect(syncSummary(0, 0, "2026-10-21T14:43:42.000Z", now)).toBe(
      "Synced with Zepp: nothing new. Zepp's newest watch data is from 8:13 PM: open the Zepp app on your phone so the watch uploads, then sync again");
  });
  it("names the day only when Zepp's newest data is from an earlier day", () => {
    expect(syncSummary(0, 0, "2026-10-20T19:21:50.000Z", now)).toContain("from 12:51 AM:");
    expect(syncSummary(0, 0, "2026-10-20T10:00:00.000Z", now)).toContain("from 20 Oct, 3:30 PM");
  });
  it("counts what a pass added and updated", () => {
    expect(syncSummary(6, 4, "2026-10-21T14:43:42.000Z", now)).toBe("Synced with Zepp: 6 new, 4 updated. Zepp's newest watch data is from 8:13 PM");
  });
  it("falls back to a plain hint when Zepp gave no upload time", () => {
    expect(syncSummary(0, 0, null, now)).toStartWith("Synced with Zepp: nothing new yet");
  });
});

describe("watchDataUntil", () => {
  it("is today's last heart-rate minute, local", () => {
    expect(watchDataUntil({ status: "ok", date: "2026-10-21", last_reading_minute: 652 }, "2026-10-21")).toBe(stampOn("2026-10-21", "10:52"));
  });
  it("is null with no reading from today, another day's, or an unreadable reply", () => {
    expect(watchDataUntil({ status: "no_data", data: { data: [] } }, "2026-10-21")).toBeNull();
    expect(watchDataUntil({ status: "ok", date: "2026-10-20", last_reading_minute: 1351 }, "2026-10-21")).toBeNull();
    expect(watchDataUntil({ status: "ok", date: "2026-10-21", last_reading_minute: 2000 }, "2026-10-21")).toBeNull();
    expect(watchDataUntil(null, "2026-10-21")).toBeNull();
  });
});

describe("ingest's todayAsOf", () => {
  const heart = reply({ status: "ok", date: "2026-10-21", last_reading_minute: 380 });
  const base = { daily: reply(SUMMARY), workouts: reply({ status: "ok", workouts: [] }), body: reply({ status: "ok", readings: [] }), pai: reply({ status: "ok", data: { items: [] } }) };
  it("says how far today's totals reach when the pass read both them and today's heart rate", async () => {
    expect((await ingest({ ...base, heart }, memoryStore().store, NOW)).todayAsOf).toBe(stampOn("2026-10-21", "06:20"));
  });
  it("is null when today's totals were not read this pass, or the watch sent nothing today", async () => {
    expect((await ingest({ ...base, daily: refused("timeout"), heart }, memoryStore().store, NOW)).todayAsOf).toBeNull();
    expect((await ingest({ ...base, heart: reply({ status: "no_data" }) }, memoryStore().store, NOW)).todayAsOf).toBeNull();
  });
});

describe("newestWatchData", () => {
  it("takes the latest of the PAI uploads and the workout ends", () => {
    const pai = { data: { items: [{ value: { uploadTimestamp: "1792593646966" } }, { value: {} }] } };
    const workouts = { workouts: [{ end_local: "2026-10-21T20:13:42+05:30" }, { end_local: "2026-10-21T20:02:26+05:30" }] };
    expect(newestWatchData(pai, workouts)).toBe("2026-10-21T14:43:42.000Z");
    expect(newestWatchData(pai, null)).toBe("2026-10-21T14:40:46.966Z");
  });
  it("is null when neither reply says", () => {
    expect(newestWatchData(null, { workouts: [] })).toBeNull();
  });
});
