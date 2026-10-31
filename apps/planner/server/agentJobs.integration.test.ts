// Background jobs end to end against a real (in-memory) kit database: fill_recipe, find_patterns / learned prefs,
// and the agent-jobs routine that wakes the agent promptly (and its on-demand poke).
import { describe, it, expect } from "bun:test";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { mountKit } from "@flock/app-kit";
import * as schema from "./db/schema";
import { SETTINGS } from "./db/constants";
import { syncMealRecipes } from "./mealRecipes";
import { queueMealReview } from "./mealReview";
import { mountJobRoutes } from "./jobRoutes";
import { queueRecipeFill, queueRecipeFillsForMeal, queueUpcomingRecipeFills } from "./recipeFill";
import { bestMessageTime, learnedRule, queueFindPatterns, queueWeeklyFindPatterns } from "./patterns";
import { logChoice } from "./choices";
import { createJobsWaker, runAgentJobs } from "./routines/agent-jobs";
import rollingPlan from "./routines/rolling-plan";

const now = new Date(2026, 9, 29, 18, 0);   // Oct 29, 2026, evening
const later = (min: number) => new Date(now.getTime() + min * 60_000);
const DAY_MIN = 24 * 60;

async function boot() {
  const hono = new Hono();
  const dataDir = mkdtempSync(join(tmpdir(), "planner-jobs-"));
  const kit = await mountKit({ hono, env: { appId: "t", dataDir, apiUrl: null, token: null, agent: null } },
    { schema, dbFile: ":memory:", appName: "T", settings: SETTINGS, privateTables: { prep_reminders: "server-only" } });
  let clock = now;
  mountJobRoutes(hono, kit.db, undefined, undefined, () => clock);
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await hono.request(path, { method, headers: { "Content-Type": "application/json", "X-Flock-User": "tester" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as any };
  };
  const potato = (await call("POST", "/api/_data/ingredients", { name: "Potato", category: "vegetables", default_unit: "g" })).body.row;
  const bare = (await call("POST", "/api/_data/recipes", { name: "Aloo paratha" })).body.row;
  const meal = async (date: string, recipeId?: string, extra: Record<string, unknown> = {}) => {
    const m = (await call("POST", "/api/_data/meals", { date, slot: "Breakfast", dish: "Aloo paratha", ...(recipeId ? { recipe_id: recipeId } : {}), ...extra })).body.row;
    syncMealRecipes(kit.db, m.id);
    return m;
  };
  const jobs = (kind?: string) => (kit.db.select().from(schema.agent_jobs).all() as { id: string; kind: string; status: string; asked_at: string | null; facts: string }[])
    .filter((j) => !kind || j.kind === kind);
  const wakes: { message: string; data: any }[] = [];
  let wakeOk = true;
  const ctx = {
    wakeAgent: async (message: string, data?: unknown) => { wakes.push({ message, data }); return wakeOk ? { ok: true } : { ok: false, reason: "down" }; },
    routine: { id: "agent-jobs-routine" },
    platform: { dataDir },
    kit: { db: kit.db },
  };
  return { kit, call, potato, bare, meal, jobs, wakes, ctx, dataDir, setClock: (d: Date) => { clock = d; }, failWakes: (v: boolean) => { wakeOk = !v; } };
}

describe("fill_recipe", () => {
  it("a planned recipe with no lines gets one fill job; the answer is accepted only once every line is complete", async () => {
    const { kit, call, potato, bare, meal, jobs } = await boot();
    const m = await meal("2026-10-30", bare.id);
    const [jobId] = queueRecipeFillsForMeal(kit.db, m.id, now);
    expect(jobId).toBeTruthy();
    expect(queueRecipeFill(kit.db, bare.id, now)).toBe(jobId);                 // one open job per recipe
    const facts = (await call("GET", `/api/jobs/${jobId}`)).body.facts;
    expect(facts).toMatchObject({ recipe_id: bare.id, name: "Aloo paratha" });
    expect(facts.meals).toEqual([expect.objectContaining({ meal_id: m.id, date: "2026-10-30", servings: 1 })]);
    expect(facts.catalog_search).toContain("/api/search");

    expect((await call("POST", `/api/jobs/${jobId}/answer`, {})).status).toBe(400);   // no lines yet
    const line = (await call("POST", "/api/_data/recipe_ingredients", { recipe_id: bare.id, item: "Potato" })).body.row;
    const res = await call("POST", `/api/jobs/${jobId}/answer`, {});
    expect(res.status).toBe(400);
    expect(res.body.reason).toContain("Potato: no catalog ingredient_id");
    await call("PATCH", `/api/_data/recipe_ingredients/${line.id}`, { ingredient_id: potato.id });
    expect((await call("POST", `/api/jobs/${jobId}/answer`, {})).body.reason).toContain("Potato: no qty_per_adult");
    await call("PATCH", `/api/_data/recipe_ingredients/${line.id}`, { qty_per_adult: 120, unit: "g" });
    expect((await call("POST", `/api/jobs/${jobId}/answer`, {})).status).toBe(200);
    expect(jobs("fill_recipe")[0].status).toBe("answered");
    expect(queueRecipeFill(kit.db, bare.id, now)).toBeNull();                  // has its lines now
  });

  it("past meals ask nothing; the sweep finds every upcoming meal's bare recipe once", async () => {
    const { kit, bare, meal } = await boot();
    const past = await meal("2026-10-20", bare.id);
    expect(queueRecipeFillsForMeal(kit.db, past.id, now)).toEqual([]);
    expect(queueUpcomingRecipeFills(kit.db, now)).toEqual([]);
    await meal("2026-10-30", bare.id);
    await meal("2026-10-31", bare.id);
    const ids = queueUpcomingRecipeFills(kit.db, now);
    expect(ids).toHaveLength(1);
    expect(queueUpcomingRecipeFills(kit.db, now)).toEqual(ids);
  });

  it("a review that links a bare recipe opens its fill job and hands it over in the answer's more_jobs", async () => {
    const { kit, call, bare, jobs } = await boot();
    const m = (await call("POST", "/api/_data/meals", { date: "2026-10-30", slot: "Breakfast", dish: "Alu parantha" })).body.row;
    const reviewId = queueMealReview(kit.db, m.id, now)!;
    const res = await call("POST", `/api/jobs/${reviewId}/answer`, { recipes: [{ recipe_id: bare.id }], adjustments: [] });
    expect(res.status).toBe(200);
    const fill = jobs("fill_recipe");
    expect(fill).toHaveLength(1);
    expect(res.body.more_jobs).toEqual([{ id: fill[0].id, kind: "fill_recipe", subject: bare.id }]);
    expect(fill[0].asked_at).toBe(now.toISOString());                        // handed over: the next tick won't ask again
  });

  it("a deleted recipe expires its job", async () => {
    const { kit, call, bare, jobs } = await boot();
    const jobId = queueRecipeFill(kit.db, bare.id, now)!;
    kit.db.delete(schema.recipes).where(eq(schema.recipes.id, bare.id)).run();
    expect((await call("POST", `/api/jobs/${jobId}/answer`, {})).status).toBe(404);
    expect(jobs()[0].status).toBe("expired");
  });
});

describe("learned prefs", () => {
  const pref = (kit: { db: any }, p: Partial<Omit<typeof schema.learned_prefs.$inferInsert, "rule">> & { kind: string; rule: unknown }) =>
    kit.db.insert(schema.learned_prefs).values({ summary: "s", found_at: now.toISOString(), ...p, rule: JSON.stringify(p.rule) }).returning().get();

  it("learnedRule applies only active, auto-apply rules (by subject when given, newest first)", async () => {
    const { kit } = await boot();
    expect(learnedRule(kit.db, "service")).toBeNull();
    pref(kit, { kind: "service", rule: { pick: "blinkit" }, auto_apply: false });
    pref(kit, { kind: "drop_item", subject: "curd", rule: { off: true }, auto_apply: true, active: false });
    expect(learnedRule(kit.db, "service")).toBeNull();
    expect(learnedRule(kit.db, "drop_item", "curd")).toBeNull();
    pref(kit, { kind: "service", rule: { pick: "zepto" }, auto_apply: true, found_at: "2026-10-01T00:00:00.000Z" });
    pref(kit, { kind: "service", rule: { pick: "bigbasket" }, auto_apply: true, found_at: "2026-10-20T00:00:00.000Z" });
    pref(kit, { kind: "drop_item", subject: "milk", rule: { weekday: true }, auto_apply: true });
    expect(learnedRule<{ pick: string }>(kit.db, "service")).toEqual({ pick: "bigbasket" });
    expect(learnedRule<{ weekday: boolean }>(kit.db, "drop_item", "milk")).toEqual({ weekday: true });
    expect(learnedRule(kit.db, "drop_item", "curd")).toBeNull();
  });

  it("bestMessageTime reads an active engagement_time pattern", async () => {
    const { kit } = await boot();
    expect(bestMessageTime(kit.db)).toBeNull();
    pref(kit, { kind: "engagement_time", rule: { time: "21:15" }, active: false });
    pref(kit, { kind: "engagement_time", rule: { time: "9pm" } });
    expect(bestMessageTime(kit.db)).toBeNull();
    pref(kit, { kind: "engagement_time", rule: { time: "20:30" } });
    expect(bestMessageTime(kit.db)).toBe("20:30");
  });
});

describe("find_patterns", () => {
  it("is asked only with something new to learn from, once while open, and weekly after that", async () => {
    const { kit, call, jobs } = await boot();
    queueFindPatterns(kit.db, now);
    expect(jobs("find_patterns")).toHaveLength(0);                            // nothing logged yet
    logChoice(kit.db, { kind: "item_dropped", subject: "curd", source: "owner", at: later(-60) });
    queueFindPatterns(kit.db, now);
    queueFindPatterns(kit.db, now);
    const [job] = jobs("find_patterns");
    expect(jobs("find_patterns")).toHaveLength(1);
    const facts = JSON.parse(job.facts);
    expect(facts.choices).toEqual([expect.objectContaining({ kind: "item_dropped", subject: "curd", source: "owner" })]);
    expect(facts).toHaveProperty("learned_prefs");
    expect(facts).toHaveProperty("meals");
    expect(facts).toHaveProperty("carts");
    expect((await call("POST", `/api/jobs/${job.id}/answer`, { patterns: [], retire: [] })).status).toBe(200);

    queueFindPatterns(kit.db, later(5));
    expect(jobs("find_patterns")).toHaveLength(1);                            // nothing new since
    logChoice(kit.db, { kind: "item_dropped", subject: "curd", source: "owner", at: later(DAY_MIN) });
    queueWeeklyFindPatterns(kit.db, later(2 * DAY_MIN));
    expect(jobs("find_patterns")).toHaveLength(1);                            // not a week yet
    queueWeeklyFindPatterns(kit.db, later(8 * DAY_MIN));
    expect(jobs("find_patterns")).toHaveLength(2);
  });

  it("validates the answer, upserts by kind+subject, and retires", async () => {
    const { kit, call } = await boot();
    logChoice(kit.db, { kind: "item_dropped", subject: "curd", source: "owner", at: later(-60) });
    const choiceId = (kit.db.select().from(schema.choice_log).get() as { id: string }).id;
    const ask = () => { queueFindPatterns(kit.db, now); return (kit.db.select().from(schema.agent_jobs).where(eq(schema.agent_jobs.status, "open")).get() as { id: string }).id; };
    const good = { kind: "drop_item", subject: "curd", summary: "Skips curd on weekday orders", rule: { weekdays: true }, confidence: 0.8, evidence: [choiceId], auto_apply: true };
    const jobId = ask();
    for (const bad of [
      { ...good, kind: "nope" },
      { ...good, kind: "engagement_time", rule: { at: "evening" } },
      { ...good, evidence: ["not-a-choice"] },
      { ...good, confidence: 1.5 },
      { ...good, auto_apply: undefined },
      { ...good, summary: "" },
      { ...good, rule: "leave curd out" },
    ]) expect((await call("POST", `/api/jobs/${jobId}/answer`, { patterns: [bad] })).status).toBe(400);
    expect((await call("POST", `/api/jobs/${jobId}/answer`, { retire: ["nope"] })).status).toBe(400);
    expect((await call("POST", `/api/jobs/${jobId}/answer`, { patterns: [good, { ...good, kind: "engagement_time", subject: null, rule: { time: "20:30" }, auto_apply: false }] })).status).toBe(200);
    expect(learnedRule<{ weekdays: boolean }>(kit.db, "drop_item", "curd")).toEqual({ weekdays: true });
    expect(bestMessageTime(kit.db)).toBe("20:30");

    logChoice(kit.db, { kind: "item_restored", subject: "curd", source: "owner", at: later(10) });
    const next = (() => { queueFindPatterns(kit.db, later(20)); return (kit.db.select().from(schema.agent_jobs).where(eq(schema.agent_jobs.status, "open")).get() as { id: string }).id; })();
    expect((await call("POST", `/api/jobs/${next}/answer`, { patterns: [{ ...good, confidence: 0.4, auto_apply: false }] })).status).toBe(200);
    const rows = kit.db.select().from(schema.learned_prefs).where(eq(schema.learned_prefs.kind, "drop_item")).all() as { id: string; confidence: number; auto_apply: boolean }[];
    expect(rows).toHaveLength(1);                                             // updated, not duplicated
    expect(rows[0]).toMatchObject({ confidence: 0.4, auto_apply: false });

    logChoice(kit.db, { kind: "item_added", subject: "curd", source: "owner", at: later(30) });
    queueFindPatterns(kit.db, later(40));
    const third = (kit.db.select().from(schema.agent_jobs).where(eq(schema.agent_jobs.status, "open")).get() as { id: string }).id;
    expect((await call("POST", `/api/jobs/${third}/answer`, { patterns: [{ ...good, id: rows[0].id }], retire: [rows[0].id] })).status).toBe(400);
    expect((await call("POST", `/api/jobs/${third}/answer`, { retire: [rows[0].id] })).status).toBe(200);
    expect((kit.db.select().from(schema.learned_prefs).where(eq(schema.learned_prefs.id, rows[0].id)).get() as { active: boolean }).active).toBe(false);
  });
});

describe("agent-jobs routine", () => {
  it("wakes only for jobs not asked in the last 30 minutes, all in one wake, never to message the family", async () => {
    const { kit, call, bare, meal, wakes, ctx, jobs } = await boot();
    await runAgentJobs(ctx as any, now);
    expect(wakes).toHaveLength(0);                                            // nothing open: no model call

    const m = await meal("2026-10-30", bare.id, { note: "kids only" });
    queueMealReview(kit.db, m.id, now);
    await runAgentJobs(ctx as any, now);                                      // the sweep adds the fill job
    expect(wakes).toHaveLength(1);
    expect(wakes[0].message).toContain("never message the family");
    expect(wakes[0].message).toContain("review_meal —");
    expect(wakes[0].message).toContain("fill_recipe —");
    expect(wakes[0].data.jobs.map((j: { kind: string }) => j.kind).sort()).toEqual(["fill_recipe", "review_meal"]);
    expect(jobs().every((j) => j.asked_at === now.toISOString())).toBe(true);

    await runAgentJobs(ctx as any, later(15));
    expect(wakes).toHaveLength(1);                                            // asked 15 min ago
    await runAgentJobs(ctx as any, later(31));
    expect(wakes).toHaveLength(2);                                            // still unanswered: asked again
    expect((await call("GET", "/api/jobs")).body.jobs).toHaveLength(2);
  });

  it("a failed wake un-asks the jobs so the next tick tries again", async () => {
    const { kit, bare, wakes, ctx, failWakes, jobs } = await boot();
    queueRecipeFill(kit.db, bare.id, now);
    failWakes(true);
    await runAgentJobs(ctx as any, now);
    expect(jobs()[0].asked_at).toBeNull();
    failWakes(false);
    await runAgentJobs(ctx as any, later(15));
    expect(wakes).toHaveLength(2);
  });

  it("asks for the weekly pattern run when there is something new", async () => {
    const { kit, wakes, ctx } = await boot();
    logChoice(kit.db, { kind: "service_picked", subject: "zepto", source: "owner", at: later(-60) });
    await runAgentJobs(ctx as any, now);
    expect(wakes[0].data.jobs.map((j: { kind: string }) => j.kind)).toEqual(["find_patterns"]);
    expect(wakes[0].message).toContain("find_patterns —");
  });

  it("the on-demand poke wakes the same routine once per burst, after its first tick", async () => {
    const { kit, bare, ctx, dataDir } = await boot();
    const calls: { routineId: string; data: any }[] = [];
    const waker = createJobsWaker({ db: kit.db, dataDir, delayMs: 5, clock: () => now,
      wake: async (routineId, _message, data) => { calls.push({ routineId, data }); return { ok: true }; } });
    queueRecipeFill(kit.db, bare.id, now);
    waker.poke();
    await Bun.sleep(20);
    expect(calls).toHaveLength(0);                                            // routine id not known before its first tick

    await runAgentJobs({ ...ctx, wakeAgent: async () => ({ ok: true }) } as any, later(-60));   // first tick remembers the routine id
    kit.db.update(schema.agent_jobs).set({ asked_at: null }).run();                              // a freshly queued job again
    waker.poke(); waker.poke(); waker.poke();
    await Bun.sleep(20);
    expect(calls).toHaveLength(1);
    expect(calls[0].routineId).toBe("agent-jobs-routine");
    expect(calls[0].data.jobs).toHaveLength(1);
  });
});

describe("rolling-plan", () => {
  it("no longer carries open jobs or recipes needing ingredients", async () => {
    const { kit, bare } = await boot();
    queueRecipeFill(kit.db, bare.id, now);
    const wakes: { data: any }[] = [];
    await rollingPlan({ wakeAgent: async (_m: string, data?: unknown) => { wakes.push({ data }); return {}; },
      kit: { db: kit.db, sqlite: kit.sqlite, emitChange: () => {} } } as any);
    expect(wakes).toHaveLength(1);                                            // empty slots still wake it
    expect(wakes[0].data).not.toHaveProperty("openJobs");
    expect(wakes[0].data).not.toHaveProperty("needIngredients");
  });
});
