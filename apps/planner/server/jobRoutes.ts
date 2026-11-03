// Background jobs the app asks the agent to answer (docs/V3-FLOW-SPEC.md "Asking the agent for help"). One set of
// endpoints for every kind; each kind brings its own answer check (ANSWERS). The agent reads open jobs, answers
// each with structured data, and the app validates before using it.
import type { Hono } from "hono";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { asc, eq, inArray } from "drizzle-orm";
import { agent_jobs, meals, recipes } from "./db/schema";
import { answerMealReview, type JobAnswerResult } from "./mealReview";
import { answerRecipeFill } from "./recipeFill";
import { answerFindPatterns } from "./patterns";
import type { Emit } from "./mealRecipes";

type Db = BunSQLiteDatabase<any>;
export type Job = { id: string; kind: string; subject: string | null; facts: string; status: string; asked_at: string | null; expires_at: string };
type Answer = (db: Db, job: Job, answer: unknown, emit: Emit | undefined, now: Date) => JobAnswerResult;

const ANSWERS: Record<string, Answer> = {
  review_meal: answerMealReview,
  fill_recipe: answerRecipeFill,
  find_patterns: (db, job, answer, _emit, now) => answerFindPatterns(db, job, answer, now),
};

export const jobView = (j: Job) => ({ ...j, facts: JSON.parse(j.facts) });
const localStamp = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/** The row a job is about, per kind; a job whose row was deleted (a meal re-planned away) has nothing left to answer. */
const SUBJECT_TABLES: Record<string, typeof meals | typeof recipes> = { review_meal: meals, fill_recipe: recipes };
function subjectGone(db: Db, j: Job): boolean {
  const table = SUBJECT_TABLES[j.kind];
  return !!table && !db.select({ id: table.id }).from(table).where(eq(table.id, j.subject ?? "")).get();
}

const closeJob = (db: Db, id: string, status: "fallback" | "expired") =>
  db.update(agent_jobs).set({ status, updated_by: "app" }).where(eq(agent_jobs.id, id)).run();

/** Open jobs past their expiry fall back (the app keeps its plain rule), jobs about a deleted row expire; returns
 *  what is still open. */
export function openJobs(db: Db, now = new Date()): Job[] {
  const stamp = localStamp(now);
  const open = db.select().from(agent_jobs).where(eq(agent_jobs.status, "open")).orderBy(asc(agent_jobs.created_at)).all() as Job[];
  return open.filter((j) => {
    if (j.expires_at < stamp) closeJob(db, j.id, "fallback");
    else if (subjectGone(db, j)) closeJob(db, j.id, "expired");
    else return true;
    return false;
  });
}

/** Open jobs the agent hasn't been asked about. Each job is asked ONCE: one the agent leaves unanswered is never asked
 *  again — it falls back to the app's plain rule at its expiry. Only a wake that never reached the agent un-asks. */
export function jobsDue(db: Db, now = new Date()): Job[] {
  return openJobs(db, now).filter((j) => !j.asked_at);
}

/** Stamp asked_at (null un-asks a wake that never reached the agent), so no tick or poke asks about them again. */
export function markAsked(db: Db, ids: string[], at: string | null): void {
  if (ids.length) db.update(agent_jobs).set({ asked_at: at, updated_by: "app" }).where(inArray(agent_jobs.id, ids)).run();
}

export function mountJobRoutes(hono: Hono<any>, db: Db, emit?: Emit, onAnswered?: () => void, clock: () => Date = () => new Date()) {
  hono.get("/api/jobs", (c) => c.json({ jobs: openJobs(db, clock()).map(jobView) }));

  hono.get("/api/jobs/:id", (c) => {
    const j = db.select().from(agent_jobs).where(eq(agent_jobs.id, c.req.param("id"))).get() as Job | undefined;
    return j ? c.json(jobView(j)) : c.json({ ok: false, reason: "job_not_found" }, 404);
  });

  hono.post("/api/jobs/:id/answer", async (c) => {
    const j = db.select().from(agent_jobs).where(eq(agent_jobs.id, c.req.param("id"))).get() as Job | undefined;
    if (!j) return c.json({ ok: false, reason: "job_not_found" }, 404);
    if (j.status !== "open") return c.json({ ok: false, reason: `job is ${j.status}` }, 409);
    const answer = ANSWERS[j.kind];
    if (!answer) return c.json({ ok: false, reason: `no answer handler for ${j.kind}` }, 400);
    let payload: unknown;
    try { payload = await c.req.json(); } catch { return c.json({ ok: false, reason: "invalid_json" }, 400); }
    const now = clock();
    const res = answer(db, j, payload, emit, now);
    if (!res.ok) return c.json(res, res.status);
    onAnswered?.();
    // Jobs this answer (or anything since the last wake) opened are handed over here, so the same session answers them.
    const more = jobsDue(db, now);
    markAsked(db, more.map((m) => m.id), now.toISOString());
    return c.json({ ok: true, more_jobs: more.map((m) => ({ id: m.id, kind: m.kind, subject: m.subject })) });
  });
}
