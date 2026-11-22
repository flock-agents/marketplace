// A 2.1.0 install updated to 3.0: its reminders become deadline events with one to-do each, the sample family's reminders stay
// behind, the old "evening before" reminder is cleared, the 2.x table is kept (renamed) and nothing is carried twice.
import { describe, it, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Hono } from "hono";
import { mountKit } from "@flock/app-kit";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { kitColumns } from "@flock/app-kit";
import * as schema from "./schema";
import { prepareV2Data, finishV2Data } from "./migrate-v2";
import { ensureInternalTables, INTERNAL_TABLES, PRIVATE_TABLES, syncTodos } from "../calendar";
import { fakePlatform } from "../testkit";

/** 2.1.0's tables, exactly as its schema.ts declared them. */
const V21 = {
  members: sqliteTable("members", { ...kitColumns(), name: text("name").notNull(), colour: text("colour").notNull().default("accent"), emoji: text("emoji") }),
  events: sqliteTable("events", { ...kitColumns(), title: text("title").notNull(), date: text("date").notNull(), repeat: text("repeat").notNull().default("none"),
    start_time: text("start_time"), end_time: text("end_time"), who: text("who"), location: text("location"), notes: text("notes"), reminder_minutes: integer("reminder_minutes") }),
  reminders: sqliteTable("reminders", { ...kitColumns(), title: text("title").notNull(), due: text("due").notNull(), repeat: text("repeat").notNull().default("none"), who: text("who") }),
};
// Thursday 26 Nov 2026, 10 am.
const NOW = new Date(2026, 10, 26, 10, 0);
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const call = async (hono: Hono, method: string, path: string, body?: unknown) => {
  const r = await hono.request(path, { method, headers: { "Content-Type": "application/json", "X-Flock-User": "tester" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as any };
};

/** A 2.1.0 data dir: a sample reminder (seeded), the owner's own reminders and events, as 2.1.0's pages and add_events wrote them. */
async function v21DataDir() {
  const dataDir = mkdtempSync(join(tmpdir(), "family-calendar-v21-")); dirs.push(dataDir);
  const hono = new Hono();
  const kit = await mountKit({ hono, env: { appId: "t", dataDir, apiUrl: null, token: null, agent: null } }, { schema: V21, appName: "T",
    seed: async (db) => { await db.insert(V21.reminders).values({ title: "Water the plants", due: "2026-11-23T18:00", repeat: "daily", who: "Diya" }); } });
  for (const r of [
    { title: "Pay the school fees", due: "2026-12-10T09:00", repeat: "none", who: "Shiva" },
    { title: "Pack the PE kit", due: "2026-11-02T07:30", repeat: "weekly", who: "Agastya" },
    { title: "Library books back", due: "2026-11-20T17:00", repeat: "none", who: null }]) expect((await call(hono, "POST", "/api/_data/reminders", r)).status).toBe(201);
  for (const e of [
    { title: "Skating class", date: "2026-11-24", repeat: "weekly", start_time: "16:00", reminder_minutes: 21 * 60 },   // "evening before"
    { title: "Dentist", date: "2026-11-27", start_time: "11:00", reminder_minutes: 60 },
    { title: "Grandma's birthday", date: "2026-11-28", reminder_minutes: 5 * 60 }]) expect((await call(hono, "POST", "/api/_data/events", e)).status).toBe(201);
  kit.sqlite.close();
  return dataDir;
}

/** A 3.0 start on that data dir, as server/index.ts makes it. */
async function start3(dataDir: string) {
  const prepared = prepareV2Data(dataDir);
  const hono = new Hono();
  const kit = await mountKit({ hono, env: { appId: "t", dataDir, apiUrl: null, token: null, agent: null } },
    { schema, appName: "T", keepTables: [...INTERNAL_TABLES, ...prepared.keep], privateTables: PRIVATE_TABLES });
  expect(kit.status.state).not.toBe("blocked");
  ensureInternalTables(kit.sqlite);
  const finished = finishV2Data(kit, NOW);
  return { prepared, finished, kit, hono };
}

describe("from 2.1.0 to 3.0", () => {
  it("each reminder of the owner's becomes a deadline event on its due date with one to-do; the sample's stays behind", async () => {
    const { prepared, finished, kit, hono } = await start3(await v21DataDir());
    expect(prepared.moved).toBe("v2_reminders");
    expect(finished).toEqual({ events: 3, todos: 2, samplesLeft: 1 });
    const deadlines = kit.sqlite.query("SELECT * FROM events WHERE kind = 'deadline' ORDER BY title").all() as any[];
    expect(deadlines.map((e) => [e.title, e.date, e.repeat, e.start_time, e.who, e.reminder_minutes, e.status, e.imported])).toEqual([
      ["Library books back", "2026-11-20", "none", "17:00", null, 0, "active", 0],
      ["Pack the PE kit", "2026-11-02", "weekly", "07:30", "Agastya", 0, "active", 0],   // repeats as it did
      ["Pay the school fees", "2026-12-10", "none", "09:00", "Shiva", 0, "active", 0]]);
    // One to-do each, due on the next day it falls on; none for a one-off already past.
    const todos = kit.sqlite.query("SELECT t.title, t.due, t.show_from, t.status, t.synced FROM todos t ORDER BY t.title").all();
    expect(todos).toEqual([
      { title: "Pack the PE kit", due: "2026-11-30", show_from: "2026-11-27", status: "open", synced: 0 },
      { title: "Pay the school fees", due: "2026-12-10", show_from: "2026-12-07", status: "open", synced: 0 }]);
    // The 2.x table is kept, renamed, untouched; the kit shows no reminders any more.
    expect((kit.sqlite.query(`SELECT count(*) AS n FROM "v2_reminders_moved"`).get() as any).n).toBe(4);
    const s = (await call(hono, "GET", "/api/_data/_schema")).body;
    expect(Object.keys(s.tables).sort()).toEqual(["event_sources", "events", "members", "todos"]);   // the two private ones with their route hints
    expect((await call(hono, "GET", "/api/_data/reminders")).status).toBe(404);
    // Flock gets the to-dos on the next sync.
    const f = fakePlatform();
    await syncTodos({ kit, now: () => NOW, platform: () => f.platform });
    expect(f.published.map((t) => [t.title, t.showFrom]).sort()).toEqual([["Pack the PE kit", "2026-11-27"], ["Pay the school fees", "2026-12-07"]]);
  });

  it("clears a reminder of exactly the old evening-before value and keeps every other", async () => {
    const { kit } = await start3(await v21DataDir());
    const r = Object.fromEntries((kit.sqlite.query("SELECT title, reminder_minutes FROM events WHERE kind = 'event'").all() as any[]).map((e) => [e.title, e.reminder_minutes]));
    // 19:00 the day before is 21 hours before a 4 pm class, and 5 hours before an all-day one.
    expect(r).toEqual({ "Skating class": null, Dentist: 60, "Grandma's birthday": null });
  });

  it("a second start carries nothing again", async () => {
    const dir = await v21DataDir();
    const first = await start3(dir);
    first.kit.sqlite.close();
    const second = await start3(dir);
    expect(second.prepared).toEqual({ moved: null, keep: ["v2_reminders_moved"] });
    expect(second.finished).toEqual({ events: 0, todos: 0, samplesLeft: 0 });
    expect((second.kit.sqlite.query("SELECT count(*) AS n FROM events WHERE kind = 'deadline'").get() as any).n).toBe(3);
  });

  it("a fresh install has nothing to carry", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "family-calendar-new-")); dirs.push(dataDir);
    expect(prepareV2Data(dataDir)).toEqual({ moved: null, keep: [] });
  });
});
