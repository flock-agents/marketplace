// The raw record of every owner choice and every inference (docs/V3-FLOW-SPEC.md "Learned preferences"): the app
// never interprets it; the agent's find_patterns job reads it and saves what it finds in learned_prefs.
import { desc, gte, inArray } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { choice_log } from "./db/schema";
import type { CHOICE_KINDS } from "./db/constants";
import { parseJson } from "./quantity";

type Db = BunSQLiteDatabase<any>;
export type ChoiceKind = (typeof CHOICE_KINDS)[number];
export interface Choice { kind: ChoiceKind; subject?: string | null; detail?: unknown; source: "owner" | "inferred" | "auto"; at?: Date }
export interface LoggedChoice { id: string; kind: string; subject: string | null; detail: unknown; source: string; at: string }

export function logChoice(db: BunSQLiteDatabase<any>, c: Choice): void {
  db.insert(choice_log).values({
    kind: c.kind, subject: c.subject ?? null, detail: c.detail === undefined ? null : JSON.stringify(c.detail),
    source: c.source, at: (c.at ?? new Date()).toISOString(), updated_by: "app",
  }).run();
}

/** The newest `limit` choices at or after `sinceIso` (all of them when null), oldest first. */
export function choicesSince(db: Db, sinceIso: string | null, limit = 300): LoggedChoice[] {
  const q = db.select().from(choice_log);
  const rows = (sinceIso ? q.where(gte(choice_log.at, sinceIso)) : q).orderBy(desc(choice_log.at)).limit(limit).all() as
    { id: string; kind: string; subject: string | null; detail: string | null; source: string; at: string }[];
  return rows.reverse().map((r) => ({ id: r.id, kind: r.kind, subject: r.subject, detail: parseJson<unknown>(r.detail, null), source: r.source, at: r.at }));
}

/** Which of these ids are real choice_log entries. */
export function knownChoiceIds(db: Db, ids: string[]): Set<string> {
  if (!ids.length) return new Set();
  return new Set((db.select({ id: choice_log.id }).from(choice_log).where(inArray(choice_log.id, ids)).all() as { id: string }[]).map((r) => r.id));
}
