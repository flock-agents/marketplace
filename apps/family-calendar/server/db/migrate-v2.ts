// Carries a 2.x install into 3.0 on the first start after the update.
//
// 3.0 has no `reminders` table: a reminder is a `deadline` event on its due date with one to-do. Left in place, the table would be
// a table the schema no longer has, and the kit's sync would hold the whole update for the owner's approval to delete it. So:
//  1. Before mountKit (prepareV2Data): a 2.x `reminders` table is renamed to a kept name (v2_reminders, or v2_reminders_2 and so on
//     when taken), rows and definition as they were. Kept tables are listed in mountKit's keepTables: the kit never touches them.
//     This always runs, in the kit's check mode too, so a migration trial sees a renamed table, not a deleted one.
//  2. After mountKit (finishV2Data), in one transaction: each kept set not yet carried becomes deadline events (a reminder the kit
//     marked as a sample is left behind: the sample family's reminders are not the owner's) with one to-do each, the set is renamed
//     to <name>_moved so it is never carried twice, and, once per install, every event's reminder of exactly the old "evening
//     before" value is cleared (the 9 pm brief covers tomorrow). Nothing is deleted. The to-dos go to Flock on the next sync.
import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { join } from "path";
import { eveningBeforeMinutes, isoDate } from "../../src/pages/dates";
import { getMeta, setMeta, type KitLike } from "../calendar";
import { reminderAsDeadline, defaultShowFrom, slug } from "./reminder-events";
import { nextOccurrence } from "../../src/pages/dates";

const KEPT = /^v2_reminders(?:_(\d+))?(_moved)?$/;
const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
const tableNames = (db: Database) => new Set((db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));
/** A 2.x kit table: text ids (1.x's were integers, and those are migrate-v1's). */
const isKitTable = (db: Database, name: string) => (db.query(`PRAGMA table_info(${q(name)})`).all() as { name: string; type: string }[]).some((c) => c.name === "id" && /text/i.test(c.type));

export interface V2Prepared { moved: string | null; keep: string[] }

/** Step 1: rename a 2.x `reminders` table to the first free kept name. Reports every kept table for mountKit's keepTables. */
export function prepareV2Data(dataDir: string): V2Prepared {
  const file = join(dataDir, "app.db");
  if (!existsSync(file)) return { moved: null, keep: [] };
  const db = new Database(file);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    let live = tableNames(db), moved: string | null = null;
    if (live.has("reminders") && isKitTable(db, "reminders")) {
      let n = 1;
      const name = (i: number) => `v2_reminders${i === 1 ? "" : `_${i}`}`;
      while (live.has(name(n)) || live.has(`${name(n)}_moved`)) n++;
      db.exec(`ALTER TABLE "reminders" RENAME TO ${q(name(n))}`);
      moved = name(n);
      live = tableNames(db);
      console.log(`[family-calendar] kept the 2.x reminders as ${moved}; they become deadline events on this start`);
    }
    return { moved, keep: [...live].filter((t) => KEPT.test(t)).sort() };
  } finally { db.close(); }
}

type V2Reminder = { id: string; title: string; due: string; repeat: string | null; who: string | null; updated_by: string | null };

/** Step 2, after mountKit: carry each kept set into deadline events and to-dos; clear the old evening-before reminders once. */
export function finishV2Data(kit: KitLike, now = new Date()): { events: number; todos: number; samplesLeft: number } {
  const { sqlite } = kit;
  const today = isoDate(now);
  let made = 0, todos = 0, samplesLeft = 0;
  sqlite.transaction(() => {
    for (const t of [...tableNames(sqlite)].filter((n) => KEPT.test(n) && !n.endsWith("_moved")).sort()) {
      const rows = sqlite.query(`SELECT * FROM ${q(t)} ORDER BY created_at, rowid`).all() as V2Reminder[];
      const samples = new Set((sqlite.query(`SELECT row_id FROM "_samples" WHERE table_name = 'reminders'`).all() as { row_id: string }[]).map((r) => r.row_id));
      for (const r of rows) {
        if (samples.has(r.id)) { samplesLeft++; continue; }
        const { event, todo } = reminderAsDeadline(r, today);
        const e = sqlite.query(`INSERT INTO events (id, created_at, updated_at, updated_by, title, date, repeat, start_time, end_time, who, location, notes, reminder_minutes, kind, status, added_by, imported)
          VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?, 'deadline', 'active', NULL, 0) RETURNING id`)
          .get(now.toISOString(), now.toISOString(), r.updated_by ?? "app:family-calendar", event.title, event.date, event.repeat, event.start_time, event.who, event.reminder_minutes) as { id: string };
        made++;
        if (todo) {
          sqlite.run(`INSERT INTO todos (id, created_at, updated_at, updated_by, event_id, key, title, due, show_from, why, status, synced)
            VALUES (lower(hex(randomblob(16))), ?, ?, 'app:family-calendar', ?, ?, ?, ?, ?, 'Carried over from the Reminders page', 'open', 0)`,
            [now.toISOString(), now.toISOString(), e.id, todo.key, todo.title, todo.due, todo.show_from]);
          todos++;
        }
      }
      sqlite.run(`DELETE FROM "_samples" WHERE table_name = 'reminders'`);
      sqlite.exec(`ALTER TABLE ${q(t)} RENAME TO ${q(`${t}_moved`)}`);
    }
    if (!getMeta<number>(sqlite, "evening_before_cleared")) {
      for (const e of sqlite.query("SELECT id, start_time, reminder_minutes FROM events WHERE reminder_minutes IS NOT NULL").all() as { id: string; start_time: string | null; reminder_minutes: number }[])
        if (e.reminder_minutes === eveningBeforeMinutes(e.start_time)) sqlite.run("UPDATE events SET reminder_minutes = NULL WHERE id = ?", [e.id]);
      setMeta(sqlite, "evening_before_cleared", now.getTime());
    }
  })();
  if (made) console.log(`[family-calendar] carried ${made} reminders across as deadline events, with ${todos} to-dos${samplesLeft ? ` (${samplesLeft} sample reminders left behind)` : ""}`);
  return { events: made, todos, samplesLeft };
}

/**
 * After the kit applied a 1.x boot import (migrate-v1.ts): each deadline event it made from a 1.x reminder gets its one to-do,
 * due on its day, unless that day has passed. Once per applied import, in one transaction.
 */
export function finishV1Todos(kit: KitLike, now = new Date()): number {
  const { sqlite } = kit;
  const today = isoDate(now);
  let applied: string[] = [];
  try { applied = (sqlite.query(`SELECT import_id FROM "_imports"`).all() as { import_id: string }[]).map((r) => r.import_id).filter((id) => /^family-calendar-1x(-\d+)?$/.test(id)); } catch { return 0; }
  const done = getMeta<string[]>(sqlite, "v1_todos_for") ?? [];
  const waiting = applied.filter((id) => !done.includes(id));
  if (!waiting.length) return 0;
  let made = 0;
  sqlite.transaction(() => {
    const rows = sqlite.query(`SELECT e.id, e.title, e.date, e.repeat FROM events e WHERE e.kind = 'deadline' AND e.imported = 0 AND e.updated_by = 'app:family-calendar'
      AND NOT EXISTS (SELECT 1 FROM todos t WHERE t.event_id = e.id)`).all() as { id: string; title: string; date: string; repeat: string }[];
    for (const e of rows) {
      const due = nextOccurrence(e, today);
      if (!due) continue;
      sqlite.run(`INSERT INTO todos (id, created_at, updated_at, updated_by, event_id, key, title, due, show_from, why, status, synced)
        VALUES (lower(hex(randomblob(16))), ?, ?, 'app:family-calendar', ?, ?, ?, ?, ?, 'Carried over from the reminders', 'open', 0)`,
        [now.toISOString(), now.toISOString(), e.id, slug(e.title), e.title, due, defaultShowFrom(due, today)]);
      made++;
    }
    setMeta(sqlite, "v1_todos_for", [...done, ...waiting]);
  })();
  return made;
}
