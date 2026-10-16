import { describe, it, expect } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Hono } from "hono";
import { mountKit } from "@flock/app-kit";
import * as schema from "./db/schema";
import { seed } from "./db/seed";

async function boot(importFile?: unknown) {
  const hono = new Hono();
  const dataDir = mkdtempSync(join(tmpdir(), "family-calendar-schema-"));
  if (importFile) { mkdirSync(join(dataDir, ".flock"), { recursive: true }); writeFileSync(join(dataDir, ".flock", "import.json"), JSON.stringify(importFile)); }
  await mountKit({ hono, env: { appId: "t", dataDir, apiUrl: null, token: null, agent: null } }, { schema, seed, dbFile: ":memory:", appName: "T" });
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await hono.request(path, { method, headers: { "Content-Type": "application/json", "X-Flock-User": "tester" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as any };
  };
  return { call };
}
const columns = (s: any, table: string) => (s.tables[table].columns as { name: string }[]).map((c) => c.name);
const required = (s: any, table: string) => (s.tables[table].columns as { name: string; required: boolean }[]).filter((c) => c.required).map((c) => c.name);

describe("family-calendar data, as agents see it", () => {
  it("lists members, events and reminders in /_schema, with only a title and a date (or a due time) required", async () => {
    const { call } = await boot();
    const s = (await call("GET", "/api/_data/_schema")).body;
    expect(Object.keys(s.tables).sort()).toEqual(["events", "members", "reminders"]);
    expect(columns(s, "events")).toEqual(expect.arrayContaining(["title", "date", "start_time", "end_time", "who", "location", "notes", "reminder_minutes"]));
    expect(columns(s, "reminders")).toEqual(expect.arrayContaining(["title", "due", "repeat", "who"]));
    expect(columns(s, "members")).toEqual(expect.arrayContaining(["name", "colour", "emoji"]));
    expect(required(s, "events")).toEqual(["title", "date"]);
    expect(required(s, "reminders")).toEqual(["title", "due"]);
    expect(required(s, "members")).toEqual(["name"]);
  });
  it("seeds the family, two weeks of events and the four reminders, all marked as samples", async () => {
    const { call } = await boot();
    const members = (await call("GET", "/api/_data/members?limit=50")).body.rows as { name: string; _sample?: boolean }[];
    const events = (await call("GET", "/api/_data/events?limit=500")).body.rows as { who: string | null; _sample?: boolean }[];
    const reminders = (await call("GET", "/api/_data/reminders?limit=50")).body.rows as { repeat: string }[];
    expect(members.length).toBe(4);
    expect(events.length).toBeGreaterThanOrEqual(14);
    expect(reminders.map((r) => r.repeat).sort()).toEqual(["daily", "monthly", "none", "weekly"]);
    for (const r of [...members, ...events]) expect(r._sample).toBe(true);
    const names = new Set(members.map((m) => m.name));
    for (const e of events) if (e.who) expect(names.has(e.who), e.who).toBe(true);
  });
  it("lets an agent add an event with a title and a date, and refuses one without a date", async () => {
    const { call } = await boot();
    const ok = await call("POST", "/api/_data/events", { title: "Swimming", date: "2026-10-20", start_time: "15:00", who: "Aarav" });
    expect(ok.status).toBe(201);
    expect(ok.body.row).toMatchObject({ title: "Swimming", date: "2026-10-20", start_time: "15:00", end_time: null, who: "Aarav", reminder_minutes: null });
    expect((await call("POST", "/api/_data/events", { title: "Swimming" })).status).toBe(400);
  });
  it("a reminder repeats `none` unless told, and lists by the next time it is due", async () => {
    const { call } = await boot();
    const made = await call("POST", "/api/_data/reminders", { title: "Library books back", due: "2026-10-20T17:00" });
    expect(made.status).toBe(201);
    expect(made.body.row).toMatchObject({ repeat: "none", who: null });
    const rows = (await call("GET", "/api/_data/reminders?sort=due&limit=50")).body.rows as { due: string }[];
    expect(rows.map((r) => r.due)).toEqual([...rows.map((r) => r.due)].sort());
  });
  it("reads this week's events by date range, the way the week page does", async () => {
    const { call } = await boot();
    const all = (await call("GET", "/api/_data/events?limit=500")).body.rows as { date: string }[];
    const from = [...all.map((e) => e.date)].sort()[0];
    const to = from.slice(0, 8) + String(Number(from.slice(8)) + 2).padStart(2, "0");
    const week = (await call("GET", `/api/_data/events?date[gte]=${from}&date[lte]=${to}&sort=date&limit=500`)).body.rows as { date: string }[];
    expect(week.length).toBeGreaterThan(0);
    expect(week.length).toBeLessThan(all.length);
    for (const e of week) { expect(e.date >= from).toBe(true); expect(e.date <= to).toBe(true); }
  });
  it("an import brings the family and their events instead of the seed", async () => {
    const { call } = await boot({ importId: "imp-1", by: "agent", rows: {
      members: [{ $key: "anita", name: "Anita", colour: "accent" }],
      events: [{ $key: "dentist", title: "Dentist", date: "2026-10-16", start_time: "16:30", who: "Anita" }],
      reminders: [{ $key: "fees", title: "Pay the fees", due: "2026-11-01T09:00", repeat: "monthly" }],
    } });
    expect((await call("GET", "/api/_data/members?limit=50")).body.rows.map((m: { name: string }) => m.name)).toEqual(["Anita"]);
    expect((await call("GET", "/api/_data/events?limit=50")).body.rows.map((e: { title: string }) => e.title)).toEqual(["Dentist"]);
    expect((await call("GET", "/api/_data/reminders?limit=50")).body.rows.map((r: { repeat: string }) => r.repeat)).toEqual(["monthly"]);
  });
});
