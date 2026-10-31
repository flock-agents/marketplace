// Background jobs, answered promptly (docs/V3-FLOW-SPEC.md "Asking the agent for help"). A 15-minute heartbeat
// that wakes the agent only when an open job hasn't been asked about in the last ASK_AGAIN_MIN, with every such
// job in one wake. The app decides WHEN to ask; the wake hands over the facts and the agent decides WHAT. Never a
// message to the family: these are background work, answered with informed guesses.
// Between ticks, index.ts pokes the same routine right after it queues a job (createJobsWaker, debounced).
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { jobsDue, jobView, markAsked, type Job } from "../jobRoutes";
import { queueUpcomingRecipeFills } from "../recipeFill";
import { queueWeeklyFindPatterns } from "../patterns";
import { readRoutineId, rememberRoutineId } from "../routineRegistry";

type Db = BunSQLiteDatabase<any>;
type WakeResult = { ok: boolean; skipped?: boolean; reason?: string };
type Wake = (message: string, data?: unknown) => Promise<WakeResult>;

interface Ctx {
  wakeAgent: Wake;
  routine: { id: string };
  platform: { dataDir: string };
  kit: { db: Db };
}

export const ROUTINE_KEY = "agent-jobs";
const POKE_DELAY_MS = 10_000;

/** One line per kind present in the wake: how to answer it. The app's guide operation has the full shapes. */
const GUIDE: Record<string, string> = {
  review_meal: "review_meal — read the dish, note and recipes' lines; answer {adjustments:[{ingredient_id, action: drop|scale|add, factor?|qty?+unit?, reason}], recipes?:[{recipe_id, servings?}]} (adjustments [] when the recipes are right). No recipes in the facts = the dish isn't linked yet: reuse an existing recipe if it is the same dish under another spelling (search operation), else write_recipe {name, lines}, and answer with recipes.",
  fill_recipe: "fill_recipe — write the recipe's lines for ONE regular adult portion from your own knowledge of the dish: write_recipe {recipe_id, lines:[{ingredient_id, item, qty_per_adult, unit, category}]}, each ingredient_id an existing catalog entry (search operation; the same ingredient under another name is the same entry) — add an ingredient (POST /a/<app>/api/_data/ingredients) only for a genuinely new one. Then answer {} — the app checks every line has an ingredient_id and a qty.",
  find_patterns: "find_patterns — look for patterns in the choices, meals and carts (weigh source \"inferred\" below \"owner\"); answer {patterns:[{id?, kind, subject?, summary, rule, confidence 0-1, evidence:[choice ids], auto_apply}], retire:[learned_prefs ids the newer events contradict]}. auto_apply only when you are sure the app can safely apply it unasked. A pattern the owner switched off (active false) stays off.",
};

/** The platform refuses a wake whose data is over 20,000 characters as JSON; facts beyond this budget are left for the
 *  agent to read with GET /api/jobs/<id> (a pattern run's facts alone can be ~30 KB). */
export const WAKE_FACTS_BUDGET = 15_000;

function wakeJobs(jobs: Job[]) {
  let used = 0;
  return jobs.map((j) => {
    const v = jobView(j);
    const size = JSON.stringify(v.facts).length;
    const inline = used + size <= WAKE_FACTS_BUDGET;
    if (inline) used += size;
    return { id: v.id, kind: v.kind, subject: v.subject, expires_at: v.expires_at, ...(inline ? { facts: v.facts } : { facts_at: `/api/jobs/${v.id}` }) };
  });
}

export function jobsWake(jobs: Job[]): { message: string; data: unknown } {
  const kinds = [...new Set(jobs.map((j) => j.kind))];
  return {
    message: `The meal planner has ${jobs.length} background job${jobs.length === 1 ? "" : "s"} for you (in data.jobs: each with its facts, or a facts_at path to read them from). ` +
      "Answer each with the answer_job operation {job_id, answer} as below; the reply may list more_jobs that opened meanwhile — answer those too. " +
      "This is background work: never message the family about it and never ask them anything to answer it — make an informed guess from the facts and what you know of this family. " +
      "A 400 says what to fix; a 409 means the job went stale — skip it. " +
      kinds.map((k) => GUIDE[k] ?? `${k} — answer as the app's guide operation describes for it.`).join(" "),
    data: { jobs: wakeJobs(jobs) },
  };
}

/** Wake the agent for every due job, in one wake; nothing due → no wake. A failed wake un-asks them for the next tick. */
export async function askDueJobs(db: Db, wake: Wake, now: Date): Promise<string[]> {
  const due = jobsDue(db, now);
  if (!due.length) return [];
  const ids = due.map((j) => j.id);
  markAsked(db, ids, now.toISOString());
  const { message, data } = jobsWake(due);
  const res = await wake(message, data).catch((e) => ({ ok: false, reason: String(e) }) as WakeResult);
  if (res.ok) return ids;
  for (const j of due) markAsked(db, [j.id], j.asked_at);
  return [];
}

export async function runAgentJobs(ctx: Ctx, now: Date): Promise<void> {
  rememberRoutineId(ctx.platform.dataDir, ctx.routine.id, ROUTINE_KEY);   // so createJobsWaker can wake this routine between ticks
  const db = ctx.kit.db;
  queueUpcomingRecipeFills(db, now);      // the sweep behind the meal-changed hook: no planned recipe stays without lines
  queueWeeklyFindPatterns(db, now);
  await askDueJobs(db, ctx.wakeAgent, now);
}

export default async function agentJobs(ctx: Ctx): Promise<void> {
  await runAgentJobs(ctx, new Date());
}

/** The on-demand path: poke() right after queueing a job; within POKE_DELAY_MS the due jobs go out in one wake of the
 *  agent-jobs routine (several pokes in a burst = one wake). Before the routine's first tick its id is unknown, so a
 *  poke does nothing and the tick asks instead. */
export function createJobsWaker(opts: { db: Db; dataDir: string; wake: (routineId: string, message: string, data?: unknown) => Promise<WakeResult>; delayMs?: number; clock?: () => Date }) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = async () => {
    timer = null;
    const routineId = readRoutineId(opts.dataDir, ROUTINE_KEY);
    if (!routineId) return;
    await askDueJobs(opts.db, (message, data) => opts.wake(routineId, message, data), (opts.clock ?? (() => new Date()))());
  };
  return {
    poke(): void {
      if (!timer) timer = setTimeout(() => { fire().catch((e) => console.warn(`[agent-jobs] poke failed: ${e}`)); }, opts.delayMs ?? POKE_DELAY_MS);
    },
  };
}
