// Nothing runs until the app knows the family: at least one person at home. A plan or an order made before that is noise.
// An install upgraded from Meal Planner 2.0 has no people yet, only the profile the family once gave in their own words
// (the `household.profile` setting): that text is carried into house.profile_to_structure, and while it waits there the
// routines run so the agent can be asked to turn it into people, rules, the cook and the slots.
import type { Database } from "bun:sqlite";

const OLD_PROFILE_KEY = "household.profile";

/** A count or a value read straight from the database; null when its table is not there yet (a boot before the schema landed). */
function read<T>(sqlite: Database, sql: string, ...args: string[]): T | null {
  try { return sqlite.query(sql).get(...args) as T | null; } catch { return null; }
}

/** True once at least one person eats at home. */
export function familyKnown(sqlite: Database): boolean {
  return (read<{ n: number }>(sqlite, `SELECT count(*) n FROM people WHERE active = 1`)?.n ?? 0) > 0;
}

/** True while a profile carried over from 2.0 waits to be structured. */
export function profilePending(sqlite: Database): boolean {
  return (read<{ n: number }>(sqlite, `SELECT count(*) n FROM house WHERE profile_to_structure IS NOT NULL AND profile_to_structure != ''`)?.n ?? 0) > 0;
}

/** Whether routines do anything yet. */
export function routinesMayRun(sqlite: Database): boolean {
  return familyKnown(sqlite) || profilePending(sqlite);
}

/** A routine: the kit calls it with its context alone; `now` is the time, for tests. */
type Handler<C> = (ctx: C, now?: Date) => void | Promise<void>;

/** The routines, each a silent no-op until the family is known or a carried-over profile waits. The gate decides only whether
 *  a routine's body runs: a routine with something to do on every run, family or not, composes `routinesMayRun` itself. */
export function gateRoutines<C extends { kit: { sqlite: Database } }>(routines: Record<string, Handler<C>>): Record<string, Handler<C>> {
  return Object.fromEntries(Object.entries(routines).map(([id, run]) =>
    [id, (ctx: C, now?: Date) => (routinesMayRun(ctx.kit.sqlite) ? run(ctx, now) : undefined)]));
}

/** The 2.0 profile as text: a string as it is, anything else as readable JSON. Null when there is none, or nothing in it. */
function oldProfileText(sqlite: Database): string | null {
  const raw = read<{ value: string | null }>(sqlite, `SELECT value FROM _settings WHERE key = ?`, OLD_PROFILE_KEY)?.value;
  if (!raw?.trim()) return null;
  let v: unknown = raw;
  try { v = JSON.parse(raw); } catch { /* written as plain text: kept as it is */ }
  if (typeof v === "string") return v.trim() || null;
  if (v === null || (typeof v === "object" && Object.keys(v).length === 0)) return null;
  return JSON.stringify(v, null, 1);
}

/** At boot: an install that still has its 2.0 profile and no people gets that text in house.profile_to_structure, once.
 *  The old setting stays where it is. "already": the text is waiting there, or the family has people (nothing to carry). */
export function migrateOldProfile(sqlite: Database): "migrated" | "none" | "already" {
  const text = oldProfileText(sqlite);
  if (!text) return "none";
  if (profilePending(sqlite) || (read<{ n: number }>(sqlite, `SELECT count(*) n FROM people`)?.n ?? 0) > 0) return "already";
  const now = new Date().toISOString();
  const row = sqlite.query(`SELECT id FROM house ORDER BY created_at LIMIT 1`).get() as { id: string } | null;
  if (row) sqlite.query(`UPDATE house SET profile_to_structure = ?, updated_at = ?, updated_by = 'app' WHERE id = ?`).run(text, now, row.id);
  else sqlite.query(`INSERT INTO house (id, created_at, updated_at, updated_by, profile_to_structure) VALUES (?, ?, ?, 'app', ?)`).run(crypto.randomUUID(), now, now, text);
  return "migrated";
}
