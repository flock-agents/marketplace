// Patterns the agent found in the choice log, stored in learned_prefs and applied as-is (docs/V3-FLOW-SPEC.md
// "Learned preferences"). Finding a pattern is the agent's judgement (the `find_patterns` job); the app only stores
// what it posts back, checks its shape, and hands the saved rules to whoever applies them.
import { and, desc, eq, gte, inArray, isNull, type SQL } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { agent_jobs, carts, choice_log, learned_prefs, meals } from "./db/schema";
import { LEARNED_PREF_KINDS } from "./db/constants";
import { choicesSince, knownChoiceIds } from "./choices";
import type { JobAnswerResult } from "./mealReview";
import { parseJson } from "./quantity";
import { addDaysStr, todayStr } from "./timeline";

type Db = BunSQLiteDatabase<any>;
type PrefRow = { id: string; kind: string; subject: string | null; summary: string; rule: string; confidence: number | null;
  evidence: string | null; auto_apply: boolean; active: boolean; found_at: string; updated_by: string | null };

const DAY_MS = 86_400_000;
const PATTERN_EVERY_DAYS = 7;
const LOOKBACK_DAYS = 60;
const MEALS_LOOKBACK_DAYS = 28;
const FIND_EXPIRY_DAYS = 2;
const MAX_SUMMARY = 200;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Kinds the app reads a time from: their rule must carry `time: "HH:MM"`. */
const TIMED_KINDS = new Set(["engagement_time", "meal_latest", "order_window"]);

const isTime = (v: unknown): v is string => typeof v === "string" && TIME_RE.test(v);
const isoDaysAgo = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS).toISOString();

/** The active learned rule of a kind (for a subject, if given) that the agent marked auto_apply, parsed; null if none. */
export function learnedRule<T = unknown>(db: BunSQLiteDatabase<any>, kind: string, subject?: string): T | null {
  const conds: SQL[] = [eq(learned_prefs.kind, kind), eq(learned_prefs.active, true), eq(learned_prefs.auto_apply, true)];
  if (subject !== undefined) conds.push(eq(learned_prefs.subject, subject));
  const row = db.select({ rule: learned_prefs.rule }).from(learned_prefs).where(and(...conds)).orderBy(desc(learned_prefs.found_at)).get() as { rule: string } | undefined;
  return row ? parseJson<T | null>(row.rule, null) : null;
}

/** "HH:MM" the family usually engages with the meal plan, once learned; null until then. */
export function bestMessageTime(db: BunSQLiteDatabase<any>): string | null {
  const rows = db.select({ rule: learned_prefs.rule }).from(learned_prefs)
    .where(and(eq(learned_prefs.kind, "engagement_time"), eq(learned_prefs.active, true))).orderBy(desc(learned_prefs.found_at)).all() as { rule: string }[];
  for (const r of rows) {
    const time = parseJson<{ time?: unknown }>(r.rule, {}).time;
    if (isTime(time)) return time;
  }
  return null;
}

const lastRun = (db: Db) =>
  db.select({ created_at: agent_jobs.created_at }).from(agent_jobs).where(eq(agent_jobs.kind, "find_patterns")).orderBy(desc(agent_jobs.created_at)).get() as { created_at: string } | undefined;

/** Anything new to learn from since `sinceIso`: a choice logged, or an order placed. */
function newEvidenceSince(db: Db, sinceIso: string | null): boolean {
  if (db.select({ id: choice_log.id }).from(choice_log).where(sinceIso ? gte(choice_log.at, sinceIso) : undefined).get()) return true;
  return !!db.select({ id: carts.id }).from(carts).where(and(eq(carts.status, "ordered"), sinceIso ? gte(carts.ordered_at, sinceIso) : undefined)).get();
}

const prefView = (p: PrefRow) => ({ ...p, rule: parseJson<unknown>(p.rule, null), evidence: parseJson<string[]>(p.evidence, []) });

function patternFacts(db: Db, now: Date) {
  const since = isoDaysAgo(now, LOOKBACK_DAYS);
  const today = todayStr(now);
  const cartRows = db.select({ id: carts.id, status: carts.status, buy_at: carts.buy_at, order_at: carts.order_at, ordered_at: carts.ordered_at,
    chosen_service: carts.chosen_service, grand_total: carts.grand_total, quotes: carts.quotes, confirmed_by: carts.confirmed_by })
    .from(carts).where(gte(carts.buy_at, since.slice(0, 10))).orderBy(carts.buy_at).all() as { quotes: string | null }[];
  return {
    since,
    kinds: LEARNED_PREF_KINDS,
    choices: choicesSince(db, since),
    learned_prefs: (db.select().from(learned_prefs).all() as PrefRow[]).map(prefView),
    meals: db.select({ id: meals.id, date: meals.date, slot: meals.slot, dish: meals.dish, note: meals.note, outcome: meals.outcome,
      outcome_source: meals.outcome_source, outcome_at: meals.outcome_at }).from(meals).where(gte(meals.date, addDaysStr(today, -MEALS_LOOKBACK_DAYS))).orderBy(meals.date).all(),
    carts: cartRows.map((c) => ({ ...c, quotes: parseJson<unknown>(c.quotes, null) })),
  };
}

/** Ask for a pattern run (after a shopping window closes with new choices, and weekly). Idempotent while one is open;
 *  nothing is asked when no choice was logged and no order placed since the last run. */
export function queueFindPatterns(db: BunSQLiteDatabase<any>, now: Date): void {
  if (db.select({ id: agent_jobs.id }).from(agent_jobs).where(and(eq(agent_jobs.kind, "find_patterns"), eq(agent_jobs.status, "open"))).get()) return;
  if (!newEvidenceSince(db, lastRun(db)?.created_at ?? null)) return;
  db.insert(agent_jobs).values({
    kind: "find_patterns", subject: null, facts: JSON.stringify(patternFacts(db, now)), status: "open",
    expires_at: `${addDaysStr(todayStr(now), FIND_EXPIRY_DAYS)}T23:59`, asked_at: null, created_at: now.toISOString(), updated_by: "app",
  }).run();
}

/** The weekly run: due when the last one was asked more than a week ago (or never). */
export function queueWeeklyFindPatterns(db: Db, now: Date): void {
  const last = lastRun(db);
  if (last && now.getTime() - new Date(last.created_at).getTime() < PATTERN_EVERY_DAYS * DAY_MS) return;
  queueFindPatterns(db, now);
}

interface PatternIn { id?: string; kind: string; subject?: string | null; summary: string; rule: Record<string, unknown>; confidence: number; evidence: string[]; auto_apply: boolean }

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function patternProblem(p: unknown, knownPrefs: Set<string>, knownChoices: Set<string>): string | null {
  if (!isObject(p)) return "each pattern is an object";
  if (p.id !== undefined && (typeof p.id !== "string" || !knownPrefs.has(p.id))) return `unknown learned_prefs id ${String(p.id)}`;
  if (typeof p.kind !== "string" || !(LEARNED_PREF_KINDS as readonly string[]).includes(p.kind)) return `kind must be one of ${LEARNED_PREF_KINDS.join(", ")}`;
  if (p.subject !== undefined && p.subject !== null && typeof p.subject !== "string") return "subject is a string or null";
  if (typeof p.summary !== "string" || !p.summary.trim() || p.summary.length > MAX_SUMMARY) return `summary is one line of at most ${MAX_SUMMARY} characters`;
  if (!isObject(p.rule)) return "rule is a JSON object the app applies as-is";
  if (TIMED_KINDS.has(p.kind) && !isTime(p.rule.time)) return `a ${p.kind} rule needs time "HH:MM"`;
  if (typeof p.confidence !== "number" || p.confidence < 0 || p.confidence > 1) return "confidence is a number from 0 to 1";
  if (!Array.isArray(p.evidence) || !p.evidence.every((e) => typeof e === "string" && knownChoices.has(e))) return "evidence is a list of choice_log ids from the facts";
  if (typeof p.auto_apply !== "boolean") return "auto_apply is true or false";
  return null;
}

const stringsIn = (v: unknown): string[] => (Array.isArray(v) ? v.filter((e): e is string => typeof e === "string") : []);

/** The agent's answer: `{ patterns?: PatternIn[], retire?: learned_prefs ids }`. A pattern with an `id` updates that
 *  row; without one it updates the active row of the same kind and subject, else adds a new one. */
export function answerFindPatterns(db: Db, job: { id: string }, answer: unknown, now = new Date()): JobAnswerResult {
  if (!isObject(answer)) return { ok: false, status: 400, reason: "answer is {patterns: [], retire: []} (both empty when nothing new)" };
  const patterns = answer.patterns ?? [];
  const retire = answer.retire ?? [];
  if (!Array.isArray(patterns) || !Array.isArray(retire)) return { ok: false, status: 400, reason: "patterns and retire are lists" };
  const knownPrefs = new Set((db.select({ id: learned_prefs.id }).from(learned_prefs).all() as { id: string }[]).map((r) => r.id));
  const knownChoices = knownChoiceIds(db, [...new Set(patterns.flatMap((p) => (isObject(p) ? stringsIn(p.evidence) : [])))]);
  for (const p of patterns) { const problem = patternProblem(p, knownPrefs, knownChoices); if (problem) return { ok: false, status: 400, reason: problem }; }
  for (const id of retire) if (typeof id !== "string" || !knownPrefs.has(id)) return { ok: false, status: 400, reason: `retire: unknown learned_prefs id ${String(id)}` };
  const updated = new Set((patterns as PatternIn[]).map((p) => p.id).filter(Boolean));
  if ((retire as string[]).some((id) => updated.has(id))) return { ok: false, status: 400, reason: "a pattern can't be both updated and retired" };

  const foundAt = now.toISOString();
  db.transaction((tx) => {
    for (const p of patterns as PatternIn[]) savePattern(tx as unknown as Db, p, foundAt);
    if (retire.length) tx.update(learned_prefs).set({ active: false, updated_by: "app" }).where(inArray(learned_prefs.id, retire as string[])).run();
    tx.update(agent_jobs).set({ status: "answered", answer: JSON.stringify(answer), answered_at: foundAt, updated_by: "app" }).where(eq(agent_jobs.id, job.id)).run();
  });
  return { ok: true };
}

function savePattern(db: Db, p: PatternIn, foundAt: string): void {
  const subject = p.subject ?? null;
  const values = { kind: p.kind, subject, summary: p.summary.trim(), rule: JSON.stringify(p.rule), confidence: p.confidence,
    evidence: JSON.stringify(p.evidence), auto_apply: p.auto_apply, active: true, found_at: foundAt, updated_by: "app" };
  const sameSubject = subject === null ? isNull(learned_prefs.subject) : eq(learned_prefs.subject, subject);
  const existing = p.id ?? (db.select({ id: learned_prefs.id }).from(learned_prefs)
    .where(and(eq(learned_prefs.kind, p.kind), sameSubject, eq(learned_prefs.active, true))).get() as { id: string } | undefined)?.id;
  if (existing) db.update(learned_prefs).set(values).where(eq(learned_prefs.id, existing)).run();
  else db.insert(learned_prefs).values(values).run();
}
