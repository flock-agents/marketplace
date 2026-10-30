// Daily 8 PM: fills the next plan.horizon_days, checks pending meals against the diners' targets, asks the family to
// confirm the near days, loops in both coaches on Sunday, and — whenever any of that changed the plan — gives the
// owner the first look at the shopping it creates. Everything here needs judgement, so it is one wake with
// everything due bundled in; nothing due at all is a silent run (no wake, no message).
import { appEmit } from "../appEmit";
import { and, gte, lte } from "drizzle-orm";
import type { Database } from "bun:sqlite";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { diners, ingredients, meals, SLOTS } from "../db/schema";
import { ensureMealGroceries, mealGroceriesAwaitingQty, recipeIngredientsMissingCatalogLink } from "../mealGroceries";
import { likelyDuplicateIngredients } from "../ingredients";
import { ingredientsNeedingShelfLife } from "../ingredients";
import { readSettings, settingsReaderFrom } from "../settings";
import { addDaysStr, recalcTimeline, todayStr } from "../timeline";

interface Ctx {
  wakeAgent(message: string, data?: unknown): Promise<unknown>;
  kit: { db: BunSQLiteDatabase<any>; sqlite: Database; emitChange(table: string, id: string, op: "insert" | "update" | "delete", by: string): void };
}

export default async function rollingPlan(ctx: Ctx): Promise<void> {
  const db = ctx.kit.db;
  const s = readSettings(ctx.kit.sqlite);
  const now = new Date();
  const today = todayStr(now);
  const horizon = s["plan.horizon_days"] as number;
  const confirmAhead = s["plan.confirm_ahead_days"] as number;
  const end = addDaysStr(today, horizon - 1);

  // Deterministic first: the timeline always stays current, whether or not anything below needs the agent.
  const emit = appEmit(ctx.kit);
  ensureMealGroceries(db, horizon, now, emit);   // dairy/vegetables from the meal plan; pantry/spices are deliberately left to the pantry check below
  recalcTimeline(db, settingsReaderFrom(ctx.kit.sqlite), horizon, now, emit);

  const rows = db.select().from(meals).where(and(gte(meals.date, today), lte(meals.date, end))).all() as
    { date: string; slot: string; status: string; coach_check: string }[];

  const haveSlot = new Set(rows.map((r) => `${r.date}|${r.slot}`));
  const missingSlots: string[] = [];
  for (let i = 0; i < horizon; i++) {
    const date = addDaysStr(today, i);
    for (const slot of SLOTS) if (!haveSlot.has(`${date}|${slot}`)) missingSlots.push(`${date}|${slot}`);
  }
  const pendingCoachCheck = rows.filter((r) => r.coach_check === "pending").map((r) => `${r.date}|${r.slot}`);
  const confirmByDate = addDaysStr(today, confirmAhead - 1);
  const unconfirmedDays = [...new Set(rows.filter((r) => r.date <= confirmByDate && r.status === "planned").map((r) => r.date))];
  const isSunday = now.getDay() === 0;
  const missingCatalogLinks = recipeIngredientsMissingCatalogLink(db);
  const awaitingQty = mealGroceriesAwaitingQty(db);
  const catalog = db.select({ id: ingredients.id, name: ingredients.name }).from(ingredients).all() as { id: string; name: string }[];
  const duplicateIngredients = likelyDuplicateIngredients(catalog);
  const shelfLifeToGuess = ingredientsNeedingShelfLife(db);

  if (!missingSlots.length && !pendingCoachCheck.length && !unconfirmedDays.length && !isSunday && !missingCatalogLinks.length
    && !awaitingQty.length && !duplicateIngredients.length && !shelfLifeToGuess.length) return;

  const dinersRows = db.select().from(diners).all();
  await ctx.wakeAgent(
    "The nightly meal-plan check found work for the next few days. Using the data below: " +
    "(1) fill any empty slots from the family's usual preferences and each diner's targets — save_meal, then set_meal_recipes (search for each dish's recipe first; write_recipe only for a genuinely new dish); " +
    "(2) check any meal still marked pending against its diner's targets and set it ok or flagged with a short note; " +
    "(3) for the unconfirmed days listed (only those), send the family one message with those days' menus and wait for a yes or changes; " +
    "(4) if today is Sunday, also send the coming week to each diner's coach (the diners' `source`, when it names one) for a full review and update the diners' targets from what they say; " +
    "(5) for every (recipe_id, item) pair listed under missingCatalogLinks, that row already exists with plain text but no ingredient_id yet — first check the existing ingredients catalog (GET /api/_data/ingredients) and reuse an existing entry's id as ingredient_id whenever it's the same ingredient under a different phrasing (\"tomato\"/\"Tomatoes\"/\"Fresh tomato\" are all one entry) — only POST a new ingredients row when it's genuinely new — and PATCH ingredient_id onto it; " +
    "(6) for every row listed under awaitingQty, review its suggested_qty (a raw portion-math draft — real packs come in fixed sizes it can't know, e.g. atta in 1/5kg bags, milk in 500ml/1L) and PATCH a sensible real-world qty onto the row; round to what's actually sold, don't just copy the draft number. Batch this into the same family message as anything else you're already telling them, don't ask about each one separately; " +
    "(7) for every pair listed under duplicateIngredients, decide whether they're really the same ingredient; if so, pick one as canonical, PATCH every recipe_ingredients and groceries row referencing the other one's id to the canonical id instead, then DELETE the retired ingredients row. If they're genuinely different, leave them. " +
    "(8) for every ingredient under shelfLifeToGuess, call set_shelf_life {ingredient_id, shelf_life_days, note} with how many days it keeps in THIS home — an informed guess from what you already know (the city and its current weather and season, how the family stores food, past orders). Never ask anyone about it; " +
    "Pantry items are never part of this wake — the family's own Pantry check-in page is the only thing that ever turns one into a grocery row; nothing to do about that here. " +
    "Whenever any of this filled or changed the plan, also give the owner the first look at the shopping it creates: the upcoming orders on the timeline, what each covers, and an estimate from usual prices — no service is searched yet. " +
    "Nothing to do here → do nothing and reply that there was nothing to change.",
    { today, horizonEnd: end, missingSlots, pendingCoachCheck, unconfirmedDays, isSunday, missingCatalogLinks, awaitingQty, duplicateIngredients, shelfLifeToGuess, diners: dinersRows },
  );
}
