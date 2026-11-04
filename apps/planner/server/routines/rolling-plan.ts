// Daily 8 PM: fills the next plan.horizon_days, checks pending meals against the diners' targets, tells the family the
// near days' menus, loops in both coaches on Sunday, and — whenever any of that changed the plan — gives the owner the
// first look at the shopping it creates. The menus go out straight from the app (ctx.notify, no model call); the rest
// needs judgement, so it is one wake with everything new bundled in. Each item is handed over ONCE (ctx.state keeps
// what was): one the agent or the family left alone stands — silence means carry on — and is never asked again.
// Nothing new at all is a silent run (no wake, no message).
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
  notify(text: string): Promise<unknown>;
  state: { get<T = unknown>(): T | null; set(value: unknown): void };
  kit: { db: BunSQLiteDatabase<any>; sqlite: Database; emitChange(table: string, id: string, op: "insert" | "update" | "delete", by: string): void };
}

interface Asked { asked?: string[] }
type MealRow = { date: string; slot: string; dish: string; status: string; coach_check: string };

const delivered = (res: unknown) => !!res && (res as { ok?: boolean }).ok !== false;

/** The near days' menus, as the app says them: the plan stands unless someone changes it. */
export function menusText(days: string[], rows: MealRow[]): string {
  const lines = days.map((d) => `${d} — ${SLOTS.map((slot) => rows.find((r) => r.date === d && r.slot === slot))
    .filter((r): r is MealRow => !!r).map((r) => `${r.slot}: ${r.dish}`).join(" · ")}`);
  return `🍽️ Meals for the next few days:\n${lines.join("\n")}\nReply with any changes; otherwise the plan stands.`;
}

export default function rollingPlan(ctx: Ctx): Promise<void> {
  return runRollingPlan(ctx, new Date());
}

/** The routine's real body, with `now` as a parameter so a test can pin it. */
export async function runRollingPlan(ctx: Ctx, now: Date): Promise<void> {
  const db = ctx.kit.db;
  const s = readSettings(ctx.kit.sqlite);
  const today = todayStr(now);
  const horizon = s["plan.horizon_days"] as number;
  const confirmAhead = s["plan.confirm_ahead_days"] as number;
  const end = addDaysStr(today, horizon - 1);

  // Deterministic first: the timeline always stays current, whether or not anything below needs the agent.
  const emit = appEmit(ctx.kit);
  ensureMealGroceries(db, horizon, now, emit);   // dairy/vegetables from the meal plan; pantry/spices are deliberately left to the pantry check below
  recalcTimeline(db, settingsReaderFrom(ctx.kit.sqlite), horizon, now, emit);

  const rows = db.select().from(meals).where(and(gte(meals.date, today), lte(meals.date, end))).all() as MealRow[];
  const asked = new Set(ctx.state.get<Asked>()?.asked ?? []);
  const current = new Set<string>();
  /** The items not handed over before; every item seen is kept as current, so the ledger only holds live ones. */
  const fresh = <T>(kind: string, items: T[], id: (t: T) => string): T[] => items.filter((t) => {
    const key = `${kind}:${id(t)}`;
    current.add(key);
    return !asked.has(key);
  });
  const remember = () => ctx.state.set({ asked: [...asked].filter((k) => current.has(k)) });

  const haveSlot = new Set(rows.map((r) => `${r.date}|${r.slot}`));
  const allMissing: string[] = [];
  for (let i = 0; i < horizon; i++) {
    const date = addDaysStr(today, i);
    for (const slot of SLOTS) if (!haveSlot.has(`${date}|${slot}`)) allMissing.push(`${date}|${slot}`);
  }
  const confirmByDate = addDaysStr(today, confirmAhead - 1);
  const unconfirmedDays = fresh("day", [...new Set(rows.filter((r) => r.date <= confirmByDate && r.status === "planned").map((r) => r.date))], (d) => d);
  if (unconfirmedDays.length && delivered(await ctx.notify(menusText(unconfirmedDays, rows)).catch(() => null))) {
    for (const d of unconfirmedDays) asked.add(`day:${d}`);
  }

  const missingSlots = fresh("slot", allMissing, (k) => k);
  const pendingCoachCheck = fresh("coach", rows.filter((r) => r.coach_check === "pending").map((r) => `${r.date}|${r.slot}`), (k) => k);
  const isSunday = fresh("sunday", now.getDay() === 0 ? [today] : [], (d) => d).length > 0;
  const missingCatalogLinks = fresh("link", recipeIngredientsMissingCatalogLink(db), (l) => `${l.recipe_id}|${l.item}`);
  const awaitingQty = fresh("qty", mealGroceriesAwaitingQty(db), (g) => g.id);
  const catalog = db.select({ id: ingredients.id, name: ingredients.name }).from(ingredients).all() as { id: string; name: string }[];
  const duplicateIngredients = fresh("dup", likelyDuplicateIngredients(catalog), (p) => `${p.a.id}|${p.b.id}`);
  const shelfLifeToGuess = fresh("shelf", ingredientsNeedingShelfLife(db), (i) => i.id);

  const work = { missingSlots, pendingCoachCheck, missingCatalogLinks, awaitingQty, duplicateIngredients, shelfLifeToGuess };
  if (!isSunday && Object.values(work).every((items) => !items.length)) return remember();

  const dinersRows = db.select().from(diners).all();
  const res = await ctx.wakeAgent(
    "The nightly meal-plan check found work for the next few days. Using the data below: " +
    "(1) fill any empty slots from the family's usual preferences and each diner's targets — save_meal, then set_meal_recipes (search for each dish's recipe first; write_recipe only for a genuinely new dish); " +
    "(2) check any meal still marked pending against its diner's targets and set it ok or flagged with a short note; " +
    "(3) if today is Sunday, also send the coming week to each diner's coach (the diners' `source`, when it names one) for a full review and update the diners' targets from what they say; " +
    "(4) for every (recipe_id, item) pair listed under missingCatalogLinks, that row already exists with plain text but no ingredient_id yet — first check the existing ingredients catalog (GET /api/_data/ingredients) and reuse an existing entry's id as ingredient_id whenever it's the same ingredient under a different phrasing (\"tomato\"/\"Tomatoes\"/\"Fresh tomato\" are all one entry) — only POST a new ingredients row when it's genuinely new — and PATCH ingredient_id onto it; " +
    "(5) for every row listed under awaitingQty, review its suggested_qty (a raw portion-math draft — real packs come in fixed sizes it can't know, e.g. atta in 1/5kg bags, milk in 500ml/1L) and PATCH a sensible real-world qty onto the row; round to what's actually sold, don't just copy the draft number. Never ask the family about these; " +
    "(6) for every pair listed under duplicateIngredients, decide whether they're really the same ingredient; if so, pick one as canonical, PATCH every recipe_ingredients and groceries row referencing the other one's id to the canonical id instead, then DELETE the retired ingredients row. If they're genuinely different, leave them. " +
    "(7) for every ingredient under shelfLifeToGuess, call set_shelf_life {ingredient_id, shelf_life_days, note} with how many days it keeps in THIS home — an informed guess from what you already know (the city and its current weather and season, how the family stores food, past orders). Never ask anyone about it; " +
    "Pantry items are never part of this wake — the family's own Pantry check-in page is the only thing that ever turns one into a grocery row; nothing to do about that here. " +
    "The app has already sent the family the near days' menus; their replies come to you as usual. Each item here is handed over once: anything you leave stands as it is and is not asked again. " +
    "Whenever any of this filled or changed the plan, also give the owner the first look at the shopping it creates: the upcoming orders on the timeline, what each covers, and an estimate from usual prices — no service is searched yet. " +
    "Nothing to do here → do nothing and reply that there was nothing to change.",
    { today, horizonEnd: end, ...work, isSunday, diners: dinersRows },
  ).catch(() => null);
  if (delivered(res)) {
    for (const k of current) if (!k.startsWith("day:")) asked.add(k);   // everything in the wake has now been handed over once
  }
  remember();
}
