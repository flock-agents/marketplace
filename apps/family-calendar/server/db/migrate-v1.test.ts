// A 1.x install's rows come across into 2.0's tables on the first start after the update; the 1.x tables stay, renamed, untouched.
import { describe, it, expect } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { mountKit, NO_APPROVALS } from "@flock/app-kit";
import * as schema from "./schema";
import { seed } from "./seed";
import { localParts, toneOf, v1Import, prepareV1Data, v1Names, v1ImportId, V1_IMPORT_ID, type V1Rows } from "./migrate-v1";

const KEPT = Object.values(v1Names());   // v1_members, v1_events, v1_reminders

process.env.TZ = "Asia/Kolkata";   // the zoned 1.x values below are read in the family's own time

/** 1.x's tables, exactly as family-calendar 1.0.3's server/db.ts made them. */
const V1_DDL = `
  CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#6366f1', emoji TEXT NOT NULL DEFAULT '👤',
    created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL,
    member_id INTEGER REFERENCES members(id) ON DELETE SET NULL, category TEXT NOT NULL DEFAULT 'other',
    status TEXT NOT NULL DEFAULT 'confirmed', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, due_time TEXT NOT NULL,
    event_id INTEGER REFERENCES events(id) ON DELETE SET NULL, status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')));`;

const NOW = new Date(2026, 9, 16, 12, 0);   // 16 October 2026, noon

const FIXTURE: V1Rows = {
  members: [
    { id: 1, name: "Priya", color: "#6366f1", emoji: "👩", created_at: "2026-09-01 10:00:00" },
    { id: 2, name: "Kabir", color: "#22c55e", emoji: "⚽", created_at: "2026-09-01 10:01:00" },
    { id: 3, name: "Nani", color: "#ef4444", emoji: "👤", created_at: "2026-09-01 10:02:00" },
  ],
  events: [
    { id: 1, title: "Football", start_time: "2026-10-13T17:00", end_time: "2026-10-13T18:00", member_id: 2, category: "social", status: "confirmed", notes: "Shin pads" },
    { id: 2, title: "Dentist", start_time: "2026-10-14T11:30:00.000Z", end_time: "2026-10-14T12:00:00.000Z", member_id: 1, category: "medical", status: "tentative", notes: "" },
    { id: 3, title: "School trip", start_time: "2026-10-20 08:00:00", end_time: "2026-10-21 18:00:00", member_id: null, category: "school", status: "confirmed", notes: "" },
    { id: 4, title: "Plumber", start_time: "2026-10-22", end_time: "2026-10-22", member_id: 99, category: "other", status: "done", notes: "Kitchen tap" },
    { id: 5, title: "Something", start_time: "next week", end_time: "later", member_id: 3, category: "other", status: "confirmed", notes: "", created_at: "2026-10-01 09:00:00" },
    { id: 6, title: "School holiday", start_time: "2026-10-26T00:00:00+05:30", end_time: "2026-10-26T23:59:00+05:30", member_id: null, category: "holiday", status: "confirmed", notes: "No school" },
    { id: 7, title: "Diwali", start_time: "2026-11-08T00:00", end_time: "2026-11-09T00:00", member_id: null, category: "social", status: "confirmed", notes: "" },
  ],
  reminders: [
    { id: 1, title: "Insurance card in the bag", due_time: "2026-10-13T19:00", event_id: 2, status: "pending" },
    { id: 2, title: "Call grandma", due_time: "2026-10-01T18:00", event_id: null, status: "done" },
    { id: 3, title: "Book the hall", due_time: "2026-11-01T09:00", event_id: null, status: "done" },
    { id: 4, title: "Pack the kit", due_time: "2026-10-13T07:30", event_id: 1, status: "pending" },
  ],
};

describe("reading 1.x values", () => {
  it("takes a date-time with no zone as written and converts one with a zone to the family's time", () => {
    expect(localParts("2026-10-13T17:00")).toEqual({ date: "2026-10-13", time: "17:00" });
    expect(localParts("2026-10-13 17:00:59")).toEqual({ date: "2026-10-13", time: "17:00" });
    expect(localParts("2026-10-13")).toEqual({ date: "2026-10-13", time: null });
    expect(localParts("2026-10-14T11:30:00.000Z")).toEqual({ date: "2026-10-14", time: "17:00" });
    expect(localParts("2026-10-25T08:00:00+05:30")).toEqual({ date: "2026-10-25", time: "08:00" });   // an offset: the clock time as written
    expect(localParts("2026-10-14T23:00:00-04:00")).toEqual({ date: "2026-10-14", time: "23:00" });
    expect(localParts("2026-10-14T23:00:00.000Z")).toEqual({ date: "2026-10-15", time: "04:30" });
    expect(localParts("next week")).toBeNull();
    expect(localParts("")).toBeNull();
  });
  it("turns a hex colour into the nearest theme tone", () => {
    expect(toneOf("#6366f1")).toBe("accent");   // 1.x's default, indigo
    expect(toneOf("#ef4444")).toBe("danger");
    expect(toneOf("#f59e0b")).toBe("warning");
    expect(toneOf("#22c55e")).toBe("success");
    expect(toneOf("#14b8a6")).toBe("success");
    expect(toneOf("#3b82f6")).toBe("info");
    expect(toneOf("#ec4899")).toBe("accent");
    expect(toneOf("#888")).toBe("accent");
    expect(toneOf("purple")).toBe("accent");
    expect(toneOf(null)).toBe("accent");
  });
});

describe("the 1.x rows as 2.0 rows", () => {
  const plan = v1Import(FIXTURE, NOW)!;
  it("is one boot import with a fixed id, stamped as the app", () => {
    expect(plan.importId).toBe(V1_IMPORT_ID);
    expect(plan.by).toBe("app:family-calendar");
  });
  it("keeps every member's name and emoji, with a tone for the colour", () => {
    expect(plan.rows.members).toEqual([
      { $key: "m1", name: "Priya", colour: "accent", emoji: "👩" },
      { $key: "m2", name: "Kabir", colour: "success", emoji: "⚽" },
      { $key: "m3", name: "Nani", colour: "danger", emoji: "👤" },
    ]);
  });
  it("splits every event into date and times, names its member, and keeps what 2.0 has no field for in the notes", () => {
    expect(plan.rows.events).toEqual([
      { $key: "e1", title: "Football", date: "2026-10-13", start_time: "17:00", end_time: "18:00", who: "Kabir", location: null, notes: "Shin pads\nCategory: Social.", reminder_minutes: null },
      { $key: "e2", title: "Dentist", date: "2026-10-14", start_time: "17:00", end_time: "17:30", who: "Priya", location: null, notes: "Category: Medical. Status: tentative.", reminder_minutes: null },
      { $key: "e3", title: "School trip", date: "2026-10-20", start_time: "08:00", end_time: null, who: null, location: null, notes: "Category: School.\nUntil 2026-10-21 18:00.", reminder_minutes: null },
      { $key: "e4", title: "Plumber", date: "2026-10-22", start_time: null, end_time: null, who: null, location: null, notes: "Kitchen tap\nStatus: done.", reminder_minutes: null },
      { $key: "e5", title: "Something", date: "2026-10-01", start_time: null, end_time: null, who: "Nani", location: null, notes: "Was set for \"next week\".", reminder_minutes: null },
      { $key: "e6", title: "School holiday", date: "2026-10-26", start_time: null, end_time: null, who: null, location: null, notes: "No school\nCategory: Holiday.", reminder_minutes: null },
      { $key: "e7", title: "Diwali", date: "2026-11-08", start_time: null, end_time: null, who: null, location: null, notes: "Category: Social.", reminder_minutes: null },
    ]);
  });
  it("keeps every reminder as a one-off for its event's member, except one already done ahead of its time", () => {
    expect(plan.rows.reminders).toEqual([
      { $key: "r1", title: "Insurance card in the bag", due: "2026-10-13T19:00", repeat: "none", who: "Priya" },
      { $key: "r2", title: "Call grandma", due: "2026-10-01T18:00", repeat: "none", who: null },
      { $key: "r4", title: "Pack the kit", due: "2026-10-13T07:30", repeat: "none", who: "Kabir" },
    ]);
  });
  it("leaves out any reminder the family dealt with (done, dismissed, …) whose time has not come, and keeps a past one", () => {
    const r = (id: number, due_time: string, status: string | null) => ({ id, title: `R${id}`, due_time, event_id: null, status });
    const plan = v1Import({ members: [], events: [], reminders: [
      r(1, "2026-11-01T09:00", "dismissed"), r(2, "2026-11-01T09:00", "Cancelled"), r(3, "2026-11-01T09:00", "done"),
      r(4, "2026-10-01T09:00", "dismissed"), r(5, "2026-11-01T09:00", "pending"), r(6, "2026-11-01T09:00", " Pending "), r(7, "2026-11-01T09:00", null),
    ] }, NOW)!;
    expect(plan.rows.reminders.map((x) => x.$key)).toEqual(["r4", "r5", "r6", "r7"]);
  });
  it("is nothing at all when 1.x had no rows", () => {
    expect(v1Import({ members: [], events: [], reminders: [] }, NOW)).toBeNull();
  });
});

/** A 1.x install's data dir holding the fixture, with the ids it had. */
function v1DataDir(rows: V1Rows = FIXTURE): string {
  const dir = mkdtempSync(join(tmpdir(), "family-calendar-v1-"));
  const db = new Database(join(dir, "app.db"));
  db.exec("PRAGMA journal_mode=WAL");
  db.exec(V1_DDL);
  for (const m of rows.members) db.run("INSERT INTO members (id, name, color, emoji) VALUES (?, ?, ?, ?)", [m.id, m.name, m.color, m.emoji]);
  for (const e of rows.events) db.run("INSERT INTO events (id, title, start_time, end_time, member_id, category, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [e.id, e.title, e.start_time, e.end_time, e.member_id, e.category, e.status, e.notes, e.created_at ?? "2026-10-01 09:00:00"]);
  for (const r of rows.reminders) db.run("INSERT INTO reminders (id, title, due_time, event_id, status) VALUES (?, ?, ?, ?, ?)", [r.id, r.title, r.due_time, r.event_id, r.status]);
  db.close();
  return dir;
}
/** Every row of the 1.x tables, under whichever names they have now. */
function v1Snapshot(dir: string, names = ["members", "events", "reminders"]) {
  const db = new Database(join(dir, "app.db"), { readonly: true });
  try { return names.map((t) => db.query(`SELECT * FROM "${t}" ORDER BY id`).all()); } finally { db.close(); }
}
const env = (dataDir: string) => ({ appId: "family-calendar", dataDir, apiUrl: null, token: null, agent: null });
/** One start of the app, as server/index.ts does it. */
const boot = (dir: string, schemaMode: "apply" | "check" = "apply") => {
  const v1 = prepareV1Data(dir, { writeImport: schemaMode === "apply", now: NOW });
  return mountKit({ hono: new Hono(), env: env(dir) }, { schema, seed, keepTables: v1.keep, approvals: NO_APPROVALS, schemaMode, appName: "Family Calendar" });
};

describe("the first start after the update", () => {
  it("renames the 1.x tables, leaves their rows as the boot import, and does nothing the next time", () => {
    const dir = v1DataDir();
    const before = v1Snapshot(dir);
    const out = prepareV1Data(dir, { now: NOW });
    expect(out).toEqual({ moved: ["v1_members", "v1_events", "v1_reminders"], imported: { importId: V1_IMPORT_ID, members: 3, events: 7, reminders: 3 }, waiting: null, keep: ["v1_events", "v1_members", "v1_reminders"] });
    expect(v1Snapshot(dir, KEPT)).toEqual(before);
    const file = JSON.parse(readFileSync(join(dir, ".flock", "import.json"), "utf8"));
    expect(file).toEqual(JSON.parse(JSON.stringify(v1Import(FIXTURE, NOW))));
    // The links follow the renamed parents.
    const db = new Database(join(dir, "app.db"), { readonly: true });
    const sql = (t: string) => (db.query("SELECT sql FROM sqlite_master WHERE name = ?").get(t) as { sql: string }).sql;
    expect(sql("v1_events")).toContain(`REFERENCES "v1_members"`);
    expect(sql("v1_reminders")).toContain(`REFERENCES "v1_events"`);
    db.close();
    // Before the kit has applied it, the next start writes the same import again; nothing moves twice.
    expect(prepareV1Data(dir, { now: NOW })).toMatchObject({ moved: [], imported: { importId: V1_IMPORT_ID, events: 7 } });
  });

  it("brings the owner's rows into 2.0 through the kit, with no samples, and keeps the 1.x tables as they were", async () => {
    const dir = v1DataDir();
    const before = v1Snapshot(dir);
    const kit = await boot(dir);
    expect(kit.status.state).toBe("ok");
    expect(kit.importState).toEqual({ state: "done", importId: V1_IMPORT_ID });
    const all = (t: string) => kit.sqlite.query(`SELECT * FROM "${t}" ORDER BY rowid`).all() as Record<string, unknown>[];
    expect(all("members").map((m) => [m.name, m.colour, m.emoji])).toEqual([["Priya", "accent", "👩"], ["Kabir", "success", "⚽"], ["Nani", "danger", "👤"]]);
    expect(all("events").map((e) => [e.title, e.date, e.start_time, e.end_time, e.who])).toEqual([
      ["Football", "2026-10-13", "17:00", "18:00", "Kabir"], ["Dentist", "2026-10-14", "17:00", "17:30", "Priya"],
      ["School trip", "2026-10-20", "08:00", null, null], ["Plumber", "2026-10-22", null, null, null], ["Something", "2026-10-01", null, null, "Nani"],
      ["School holiday", "2026-10-26", null, null, null], ["Diwali", "2026-11-08", null, null, null],
    ]);
    expect(all("reminders").map((r) => [r.title, r.due, r.repeat, r.who])).toEqual([
      ["Insurance card in the bag", "2026-10-13T19:00", "none", "Priya"], ["Call grandma", "2026-10-01T18:00", "none", null], ["Pack the kit", "2026-10-13T07:30", "none", "Kabir"],
    ]);
    for (const r of [...all("members"), ...all("events"), ...all("reminders")]) expect(r.updated_by).toBe("app:family-calendar");
    expect(all("_samples")).toEqual([]);
    kit.sqlite.close();
    expect(v1Snapshot(dir, KEPT)).toEqual(before);
    expect(existsSync(join(dir, ".flock", `imported-${V1_IMPORT_ID}.json`))).toBe(true);

    // The next start: nothing moves, nothing is imported twice, the 1.x tables are still kept.
    const again = await boot(dir);
    expect(again.status.state).toBe("ok");
    expect((again.sqlite.query(`SELECT count(*) AS n FROM "events"`).get() as { n: number }).n).toBe(7);
    again.sqlite.close();
    expect(v1Snapshot(dir, KEPT)).toEqual(before);
  });

  it("an install whose 1.x tables were empty starts with the samples, like a fresh one, and keeps the empty 1.x tables", async () => {
    const dir = v1DataDir({ members: [], events: [], reminders: [] });
    const kit = await boot(dir);
    expect(kit.status.state).toBe("ok");
    expect(kit.importState.state).toBe("none");
    expect((kit.sqlite.query(`SELECT count(*) AS n FROM "members"`).get() as { n: number }).n).toBe(4);   // the sample family
    const names = (kit.sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
    for (const t of KEPT) expect(names).toContain(t);
    kit.sqlite.close();
  });

  it("the update's trial (check mode, on a copy) sees 2.0's tables as new and no data to lose, and writes no import", async () => {
    const dir = v1DataDir();
    const kit = await boot(dir, "check");
    expect(kit.status.state).toBe("drift");
    if (kit.status.state === "drift") expect(kit.status.changes).toEqual([]);
    expect(existsSync(join(dir, ".flock", "import.json"))).toBe(false);
    kit.sqlite.close();
  });

  it("a fresh 2.0 install, or a data dir with no database yet, is left alone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "family-calendar-fresh-"));
    expect(prepareV1Data(dir)).toEqual({ moved: [], imported: null, waiting: null, keep: [] });
    const kit = await boot(dir);
    expect(kit.status.state).toBe("ok");
    kit.sqlite.close();
    expect(prepareV1Data(dir)).toEqual({ moved: [], imported: null, waiting: null, keep: [] });
  });
});

const count = (dir: string, table: string) => {
  const db = new Database(join(dir, "app.db"), { readonly: true });
  try { return (db.query(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number }).n; } finally { db.close(); }
};
const titles = (kit: Awaited<ReturnType<typeof boot>>) => (kit.sqlite.query(`SELECT title FROM "events" ORDER BY title`).all() as { title: string }[]).map((r) => r.title);

describe("an update that did not go straight through", () => {
  it("a rolled-back attempt's import file is replaced with the rows as they are now, so a row added since comes across", async () => {
    const dir = v1DataDir();
    copyFileSync(join(dir, "app.db"), join(dir, "before.db"));
    prepareV1Data(dir, { now: NOW });   // the attempt: tables renamed, import.json written, then the update is rolled back
    copyFileSync(join(dir, "before.db"), join(dir, "app.db"));   // the platform restores the database; the import file stays behind
    expect(existsSync(join(dir, ".flock", "import.json"))).toBe(true);
    const db = new Database(join(dir, "app.db"));
    db.run("INSERT INTO events (title, start_time, end_time) VALUES ('Added after the rollback', '2026-10-30T10:00', '2026-10-30T11:00')");
    db.close();
    const kit = await boot(dir);
    expect(kit.importState).toEqual({ state: "done", importId: V1_IMPORT_ID });
    expect(titles(kit)).toContain("Added after the rollback");
    expect(titles(kit).length).toBe(8);
    kit.sqlite.close();
  });

  it("someone else's waiting import is left alone; the 1.x tables are still kept, and their rows come across on the next start", async () => {
    const dir = v1DataDir();
    mkdirSync(join(dir, ".flock"), { recursive: true });
    const theirs = JSON.stringify({ importId: "make-42", by: "agent:helper", rows: { members: [{ $key: "a", name: "Ada" }] } });
    writeFileSync(join(dir, ".flock", "import.json"), theirs);
    const out = prepareV1Data(dir, { now: NOW });
    expect(out).toMatchObject({ moved: ["v1_members", "v1_events", "v1_reminders"], imported: null, waiting: V1_IMPORT_ID });
    expect(readFileSync(join(dir, ".flock", "import.json"), "utf8")).toBe(theirs);

    const first = await boot(dir);   // the kit applies theirs
    expect(first.importState).toEqual({ state: "done", importId: "make-42" });
    first.sqlite.close();
    const second = await boot(dir);       // and ours on the next start
    expect(second.importState).toEqual({ state: "done", importId: V1_IMPORT_ID });
    expect((second.sqlite.query(`SELECT name FROM "members" ORDER BY name`).all() as { name: string }[]).map((r) => r.name)).toEqual(["Ada", "Kabir", "Nani", "Priya"]);
    expect(titles(second).length).toBe(7);
    second.sqlite.close();
    const third = await boot(dir);        // nothing more after that
    expect(titles(third).length).toBe(7);
    third.sqlite.close();
  });

  it("a kept name already taken does not stop the start: the 1.x tables go to the next free set and their rows still come across", async () => {
    const dir = v1DataDir();
    const db = new Database(join(dir, "app.db"));
    db.exec(`CREATE TABLE v1_members (id TEXT PRIMARY KEY, note TEXT); INSERT INTO v1_members VALUES ('x', 'not ours');`);
    db.close();
    const out = prepareV1Data(dir, { now: NOW });
    expect(out.moved).toEqual(["v1_members_2", "v1_events_2", "v1_reminders_2"]);
    expect(out.imported).toMatchObject({ importId: v1ImportId(2), members: 3, events: 7, reminders: 3 });
    const kit = await boot(dir);
    expect(kit.status.state).toBe("ok");
    expect(kit.importState).toEqual({ state: "done", importId: v1ImportId(2) });
    expect(titles(kit).length).toBe(7);
    kit.sqlite.close();
    expect(count(dir, "v1_members")).toBe(1);     // the table that was there, untouched
    expect(count(dir, "v1_events_2")).toBe(7);    // 1.x's rows, kept
  });
});
