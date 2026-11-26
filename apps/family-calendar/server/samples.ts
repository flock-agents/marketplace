// The sample family the calendar opens with (seed.ts, marked in the kit's _samples table) is an example for the page, never the
// family's own: what other apps and agents read (get_events, the brief, the reminders) leaves those rows out, so a planner never
// plans around a sample "School run" (setup e2e, 27 Nov). The page still shows them, marked, until the family clears them.
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import { _samples } from "@flock/app-kit";
import { events } from "./db/schema";

type Db = BunSQLiteDatabase<any>;
export type EventRow = typeof events.$inferSelect;

/** The ids of a table's rows that are samples. */
export function sampleIds(db: Db, table: string): Set<string> {
  return new Set(db.select({ id: _samples.row_id }).from(_samples).where(eq(_samples.table_name, table)).all().map((r) => r.id));
}
/** The family's own events: every event that is not a sample. */
export function realEvents(db: Db): EventRow[] {
  const samples = sampleIds(db, "events");
  return db.select().from(events).all().filter((e) => !samples.has(e.id));
}
