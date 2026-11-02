import { eq, gte } from "drizzle-orm";
import { createFlockApp } from "@flock/app-sdk";
import { agentOps } from "./agentOps";
import { setAppEmit } from "./appEmit";
import { mountKit } from "@flock/app-kit";
import * as schema from "./db/schema";
import { meal_recipes, meals } from "./db/schema";   // named, for this file's own routes and hooks below
import { seed } from "./db/seed";
import { SETTINGS } from "./db/constants";
import { todayStr } from "./timeline";
import { mountShoppingRoutes } from "./routes";
import { readRoutineId } from "./routineRegistry";
import { ensureRecipeForMeal, relinkLegacyMeals } from "./recipeStubs";
import { syncMealRecipes } from "./mealRecipes";
import { mountMealRoutes } from "./mealRoutes";
import { queueMealReview } from "./mealReview";
import { mountJobRoutes } from "./jobRoutes";
import agentJobs, { createJobsWaker } from "./routines/agent-jobs";
import { queueRecipeFillsForMeal, queueUpcomingRecipeFills } from "./recipeFill";
import { mountPantryRoutes } from "./pantryRoutes";
import { seedIngredientKnowledge } from "./db/ingredientSeed";
import { migrateCartStatuses, refreshShopping } from "./shopping";
import { refreshOrderPatterns } from "./orderPatterns";
import { backfillRecipeIngredientCatalog } from "./ingredients";
import rollingPlan from "./routines/rolling-plan";
import prepReminders from "./routines/prep-reminders";
import shoppingTimeline from "./routines/shopping-timeline";

// The app's operations for its agent (agentOps.ts): Flock relays the agent's calls to them.
const flock = createFlockApp({ ops: agentOps(() => flock.hono) });
const kit = await mountKit(flock, {
  schema, seed, settings: SETTINGS,
  privateTables: {
    prep_reminders: "server-only dedupe for the prep-reminders routine; nothing for an agent to read or write here",
    message_log: "server-only per-window message budget; the agent acks a message through its ack_message operation",
    agent_jobs: "background jobs for the agent: its list_jobs and answer_job operations",
    choice_log: "the raw record of choices and inferences; the agent reads it in its find_patterns job",
    learned_prefs: "patterns the agent found, written by its find_patterns answers",
    stock: "what is in the kitchen: GET /api/pantry, POST /api/pantry/have and /api/pantry/answer (the pantry, have_item, pantry_answer operations)",
    shopping_prefs: "order windows and household shopping prefs: GET /api/shopping/patterns, PUT /api/shopping/patterns/pinned",
    standing_consumption: "consumption no meal plans for (milk daily); background data for the stock estimate",
    meal_recipes: "a meal's recipes: POST /api/meals/:id/recipes (the set_meal_recipes operation)",
  },
  routines: { "rolling-plan": rollingPlan as any, "prep-reminders": prepReminders as any, "shopping-timeline": shoppingTimeline as any, "agent-jobs": agentJobs as any },
});

// Background jobs (meal reviews, recipe fills, pattern runs) wake the agent shortly after they're queued, not only on
// the agent-jobs routine's 15-minute tick.
const jobsWaker = createJobsWaker({ db: kit.db, dataDir: flock.platform.dataDir,
  wake: (routineId, message, data) => flock.platform.routines.wake(routineId, message, data) });

// Every meal written (the agent's own API calls, a routine, or the manual editor) is linked to a recipe of exactly
// its name, or left for the agent to link/create (a review_meal job) and fill (a fill_recipe job); the app never
// creates a recipe itself. Once a recipe has its structured ingredients, the plan's grocery rows follow at once.
// The app's own writes tell live pages without claiming the row: kit.emitChange would unmark a sample row on any update, so
// the app's bookkeeping (a meal's recipe link, its recipe set, an inferred outcome) would turn the template's samples into
// the owner's rows at first start.
const emitApp = (table: string, id: string, op: "insert" | "update" | "delete") =>
  kit.ctx.events.emit({ table, op, id, by: "app", at: new Date().toISOString() });
setAppEmit(emitApp);

// Any recipe_ingredients row still written as plain text (no ingredient_id) gets linked to the catalog — matching
// an existing entry over creating a near-duplicate. Idempotent; cheap once there's nothing left to backfill.
// Only once the schema sync actually landed — a schema-"check" boot (a dry-run smoke test, say) never applies the
// new columns this reads, and querying them anyway would crash the boot outright.
if (kit.status.state === "ok") {
  migrateCartStatuses(kit.db);   // upcoming/discussed/building/awaiting_yes → draft; skipped/missed → let_go (idempotent)
  backfillRecipeIngredientCatalog(kit.db, emitApp as any);
  seedIngredientKnowledge(kit.db, emitApp as any);   // aliases / unit conversions / shelf life: fills nulls only
  relinkLegacyMeals(kit.db, todayStr(), emitApp as any);         // a dish edited before links were stamped gets its own recipe
  // Every upcoming meal: its recipe set (from recipe_id on first boot) and a review if its note/dish needs one.
  for (const m of kit.db.select({ id: meals.id }).from(meals).where(gte(meals.date, todayStr())).all() as { id: string }[]) {
    syncMealRecipes(kit.db, m.id, emitApp);
    queueMealReview(kit.db, m.id);
  }
  queueUpcomingRecipeFills(kit.db);
  jobsWaker.poke();
  refreshOrderPatterns(kit.db);                      // learned order windows from history
}

const mealChanged = (mealId: string) => {
  ensureRecipeForMeal(kit.db, mealId, emitApp);
  syncMealRecipes(kit.db, mealId, emitApp);
  queueMealReview(kit.db, mealId);
  queueRecipeFillsForMeal(kit.db, mealId);
  jobsWaker.poke();
  refreshShopping(kit.db, kit.settings, new Date(), emitApp as any);
};

kit.ctx.events.subscribe((e) => {
  if (e.table === "meals" && (e.op === "insert" || e.op === "update") && (e as { by?: string }).by !== "app") mealChanged(e.id);
  if (e.table === "meal_recipes" && (e as { by?: string }).by !== "app") {
    const row = kit.db.select({ meal_id: meal_recipes.meal_id }).from(meal_recipes).where(eq(meal_recipes.id, e.id)).get() as { meal_id: string } | undefined;
    if (row) mealChanged(row.meal_id);
    else refreshShopping(kit.db, kit.settings, new Date(), emitApp as any);
  }
  // A moved or deleted meal moves/removes its own open grocery rows on the very next recompute.
  if (e.table === "meals" && e.op === "delete") refreshShopping(kit.db, kit.settings, new Date(), emitApp as any);
  if (e.table === "stock" && (e as { by?: string }).by !== "app") refreshShopping(kit.db, kit.settings, new Date(), emitApp as any);
  if (e.table === "recipe_ingredients" || (e.table === "ingredients" && e.op === "update" && (e as { by?: string }).by !== "app")) {
    refreshShopping(kit.db, kit.settings, new Date(), emitApp as any);
  }
});

// The frontend calls this after a meal or grocery edit so the Groceries timeline reflects it immediately; the
// three routines above also recompute it on their own schedule, so this is a convenience, never the only path.
flock.hono.post("/api/timeline/recalc", (c) => {
  refreshShopping(kit.db, kit.settings, new Date(), emitApp as any);
  return c.json({ ok: true });
});

// The page's "Order with <service>" (a family member's yes) wakes the shopping-timeline routine's agent to place it.
const shoppingWake = async (message: string, data: unknown) => {
  const routineId = readRoutineId(flock.platform.dataDir);
  if (!routineId) return { ok: false, reason: "not_ready" };
  const res = await flock.platform.routines.wake(routineId, message, data) as { ok: boolean; skipped?: boolean; reason?: string };
  return res.ok ? { ok: true } : { ok: false, reason: res.skipped ? "not_configured" : res.reason };
};

mountShoppingRoutes(flock.hono, kit.db, kit.settings, emitApp as any, undefined, shoppingWake);
mountPantryRoutes(flock.hono, kit.db, kit.settings, emitApp);
mountMealRoutes(flock.hono, kit.db, emitApp, mealChanged);
mountJobRoutes(flock.hono, kit.db, emitApp, () => refreshShopping(kit.db, kit.settings, new Date(), emitApp as any));

flock.listen();
