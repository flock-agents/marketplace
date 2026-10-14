import { describe, it, expect } from "bun:test";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Hono } from "hono";
import { mountKit } from "@flock/app-kit";
import * as schema from "./db/schema";
import { seed, sampleEvents } from "./db/seed";
import { fromForm, toForm, whenText, monthDays } from "../src/pages/shared";

const boot = async () => {
  const hono = new Hono();
  await mountKit({ hono, env: { appId: "t", dataDir: mkdtempSync(join(tmpdir(), "calendar-schema-")), apiUrl: null, token: null, agent: null } }, { schema, seed, dbFile: ":memory:", appName: "T" });
  return hono;
};
const post = (hono: Hono, body: object) => hono.request("/api/_data/events", { method: "POST", headers: { "Content-Type": "application/json", "X-Flock-User": "owner" }, body: JSON.stringify(body) });

describe("calendar data", () => {
  it("is one table of events: title, start, end, all_day, notes, and nothing else", async () => {
    const s = await (await (await boot()).request("/api/_data/_schema")).json() as any;
    expect(Object.keys(s.tables)).toEqual(["events"]);
    const cols = (s.tables.events.columns as { name: string }[]).map((c) => c.name).filter((n) => !["id", "created_at", "updated_at", "updated_by"].includes(n));
    expect(cols.sort()).toEqual(["all_day", "end", "notes", "start", "title"]);
  });
  it("seeds sample events, marked as samples, sorted by start through the uniform route", async () => {
    const hono = await boot();
    const { rows } = await (await hono.request("/api/_data/events?sort=start&limit=100")).json() as any;
    expect(rows.length).toBe(sampleEvents().length);
    expect(rows.every((r: any) => r._sample === true)).toBe(true);
    const starts = rows.map((r: any) => r.start);
    expect([...starts].sort()).toEqual(starts);
  });
  it("takes an all-day event and a timed one, and filters on end (a reserved word in SQL)", async () => {
    const hono = await boot();
    expect((await post(hono, { title: "Holiday", start: "2026-12-24", end: "2026-12-26", all_day: true })).status).toBe(201);
    expect((await post(hono, { title: "Call", start: "2026-12-01T09:30" })).status).toBe(201);
    const { rows } = await (await hono.request("/api/_data/events?end=2026-12-26")).json() as any;
    expect(rows.map((r: any) => [r.title, r.all_day])).toEqual([["Holiday", true]]);
    const call = (await (await hono.request("/api/_data/events?title=Call")).json() as any).rows[0];
    expect(call).toMatchObject({ all_day: false, end: null, notes: null });
  });
});

describe("sample events", () => {
  const from = new Date(2026, 9, 15);
  const rows = sampleEvents(from);
  it("sit around today, some all day and some timed, in the stored shapes", () => {
    expect(rows.some((r) => r.all_day) && rows.some((r) => !r.all_day)).toBe(true);
    for (const r of rows) {
      expect(r.start).toMatch(r.all_day ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      if (r.end) expect(r.end >= r.start).toBe(true);
    }
    expect(rows.some((r) => r.start.startsWith("2026-10-15"))).toBe(true);
    expect(rows.some((r) => r.all_day && r.end)).toBe(true);   // one runs over several days
  });
});

describe("the event form", () => {
  it("no start time means all day; a time makes it timed", () => {
    expect(fromForm({ title: " Fair ", start_date: "2026-10-20" })).toEqual({ title: "Fair", all_day: true, start: "2026-10-20", end: null, notes: null });
    expect(fromForm({ title: "Dentist", start_date: "2026-10-20", start_time: "9.30", end_time: "1000" }))
      .toEqual({ title: "Dentist", all_day: false, start: "2026-10-20T09:30", end: "2026-10-20T10:00", notes: null });
    expect(fromForm({ title: "Trip", start_date: "2026-10-20", start_time: "09:00", all_day: true, end_date: "2026-10-22" }))
      .toMatchObject({ all_day: true, start: "2026-10-20", end: "2026-10-22" });
  });
  it("names the field it cannot read, or an end before the start", () => {
    expect(() => fromForm({ title: "x", start_date: "2026-10-20", start_time: "soon" })).toThrow();
    try { fromForm({ title: "x", start_date: "2026-10-20", start_time: "10:00", end_time: "09:00" }); } catch (e) { expect(e).toEqual({ field: "end_time", message: "Ends before it starts" }); }
    try { fromForm({ title: "x", start_date: "2026-10-20", end_date: "2026-10-19" }); } catch (e) { expect((e as any).field).toBe("end_date"); }
  });
  it("round-trips a stored event", () => {
    const e = { title: "Wedding", start: "2026-11-02T18:00", end: "2026-11-03T01:00", all_day: false, notes: "Hall B" };
    expect(fromForm(toForm(e))).toEqual(e);
    const a = { title: "Camp", start: "2026-11-02", end: "2026-11-04", all_day: true, notes: null };
    expect(fromForm(toForm(a))).toEqual(a);
  });
  it("says when in words", () => {
    expect(whenText({ start: "2026-10-20", end: null, all_day: true })).toBe("All day");
    expect(whenText({ start: "2026-10-20", end: "2026-10-22", all_day: true })).toBe("All day, until 22 Oct");
    expect(whenText({ start: "2026-10-20T09:30", end: "2026-10-20T10:00", all_day: false })).toBe("09:30 – 10:00");
    expect(whenText({ start: "2026-10-20T19:00", end: "2026-10-21", all_day: false })).toBe("19:00, until 21 Oct");
  });
  it("knows the month grid's days as the Calendar lays them out (Monday first, six weeks)", () => {
    const g = monthDays("2026-10-15");
    expect(g.length).toBe(6);
    expect(g[0]![0]).toBe("2026-09-28");
    expect(g[0]![3]).toBe("2026-10-01");
    expect(g[5]![6]).toBe("2026-11-08");
  });
});
