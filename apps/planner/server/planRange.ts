// make_plan from a date (`{ from, days, keep_edited? }`): some days planned, not a whole week. The plan is made week by week
// with the plan's own steps (makePlan `range`), each week only on the range's days, and said as one message. The setup's
// first task is the first such call (3 days from today), so a household with nothing said about its meals gets the
// defaults here: lunch and dinner, and new dishes like a home kitchen's where none of theirs is known.
import type { Hono } from "hono";
import { slot_days } from "./db/schema";
import { DEFAULT_SLOTS, PLAN_DAYS_MAX, SETUP_PLAN_DAYS, SLOT_ORDER } from "./db/constants";
import { addDays, daysBetween, mondayOf, todayStr } from "./dates";
import { refuse, writeRoutes, type Db, type Emit } from "./family";
import { dateOf } from "./meals";
import { joinPlanTexts, planMessage, rangeTitle, setupPlanMessage, weekSendText, type PlanText } from "./messages";
import type { ModelCall } from "./model";
import { makePlan, OP_BUDGET_MS, type MakePlanDeps } from "./makePlan";
import { platformPeers } from "./planDays";
import { commit, listSlots, upsertSlot } from "./slotStore";

export type RangeResult =
  | { ok: true; from: string; to: string; message: string; intro?: string; instructions: string; defaults?: string[]; unmet?: string[]; asked?: string[]; no_ingredients?: string[] }
  | { ok: false; reason: string; say: string; ask?: string; planned_through?: string };

export type RangeDeps = Omit<MakePlanDeps, "weekStart" | "range"> & { from: string; days: number };

/** The weeks a range of dates falls in, each with its own part of the range. */
export function weekChunks(from: string, to: string): { weekStart: string; from: string; to: string }[] {
  const out: { weekStart: string; from: string; to: string }[] = [];
  for (let monday = mondayOf(from); monday <= to; monday = addDays(monday, 7)) {
    const end = addDays(monday, 6);
    out.push({ weekStart: monday, from: from > monday ? from : monday, to: to < end ? to : end });
  }
  return out;
}

/** The meals planned when the family has named none: lunch and dinner. Answers the defaults it applied, in words. */
export function applyMealDefaults(db: Db, emit: Emit): string[] {
  if (listSlots(db, { all: true }).length) return [];
  commit(db, emit, (tx, ch) => { for (const name of DEFAULT_SLOTS) upsertSlot(tx, { name, kind: "main", order: SLOT_ORDER[name] }, "app", ch); });
  return ["meals: lunch and dinner"];
}

/** The setup's first week: no day planned yet, or the first plan began less than SETUP_PLAN_DAYS ago. Meals the family named
 *  no dishes for are planned with new ones then, as the first plan was, rather than left out and asked about. */
function setupWeek(db: Db, today: string): boolean {
  const first = db.select({ date: slot_days.date }).from(slot_days).all().map((r) => r.date).filter((d): d is string => !!d).sort()[0];
  return !first || daysBetween(first, today) < SETUP_PLAN_DAYS;
}

/** Plan `days` days from `from` (today at the earliest), week by week, and say it as one message. A week that cannot be
 *  planned stops the run: what the weeks before it saved stays (`planned_through`). */
export async function planRange(deps: RangeDeps): Promise<RangeResult> {
  const from = deps.from < deps.today ? deps.today : deps.from;
  const to = addDays(deps.from, deps.days - 1);
  if (to < deps.today) refuse(`${deps.from} to ${to} is over: plan from today (${deps.today}) or later`);
  const setup = setupWeek(deps.db, deps.today);
  const suggest_new = deps.suggest_new ?? setup;
  const defaults = applyMealDefaults(deps.db, deps.emit);
  const texts: PlanText[] = [];
  let intro: string | undefined, through: string | undefined;
  const unmet: string[] = [], asked: string[] = [], none: string[] = [];
  const weeks = weekChunks(from, to);
  const budgetMs = Math.floor((deps.budgetMs ?? OP_BUDGET_MS) / weeks.length);
  for (const week of weeks) {
    const r = await makePlan({ ...deps, weekStart: week.weekStart, range: { from: week.from, to: week.to }, suggest_new, budgetMs, holdIntro: setup });
    if (!r.ok) return { ...r, ...(through ? { planned_through: through } : {}) };
    through = week.to;
    if (r.text) texts.push(r.text);
    intro ??= r.intro;
    unmet.push(...(r.unmet ?? [])); asked.push(...(r.asked ?? [])); none.push(...(r.no_ingredients ?? []));
  }
  const text = joinPlanTexts(texts, rangeTitle(from, to, deps.today));
  return { ok: true, from, to, message: setup ? setupPlanMessage(text) : planMessage(text), ...(intro ? { intro } : {}), instructions: weekSendText(!!intro),
    ...(defaults.length ? { defaults } : {}), ...(unmet.length ? { unmet: [...new Set(unmet)] } : {}), ...(asked.length ? { asked: [...new Set(asked)] } : {}),
    ...(none.length ? { no_ingredients: none } : {}) };
}

/** POST /api/plan { from, days, keep_edited?, household?, suggest_new? }: make_plan from a date (agentOps routes it here). */
export function mountPlanRangeRoute(hono: Hono<any>, db: Db, emit: Emit, opts: { basePath: string; model: ModelCall; now?: () => Date; platform?: () => unknown;
  sqlite?: MakePlanDeps["sqlite"] }) {
  writeRoutes(hono)("/api/plan", async (b) => {
    const from = dateOf(b.from, "from");
    const days = typeof b.days === "number" && Number.isInteger(b.days) && b.days >= 1 && b.days <= PLAN_DAYS_MAX ? b.days
      : refuse(`days must be a whole number from 1 to ${PLAN_DAYS_MAX}: how many days to plan from \`from\``);
    if (b.keep_edited !== undefined && typeof b.keep_edited !== "boolean") refuse("keep_edited must be true or false");
    if (b.suggest_new !== undefined && typeof b.suggest_new !== "boolean") refuse("suggest_new must be true or false");
    const today = todayStr((opts.now ?? (() => new Date()))());
    return { body: await planRange({ db, emit, model: opts.model, from, days, today, basePath: opts.basePath, budgetMs: OP_BUDGET_MS, household: b.household,
      peers: opts.platform ? platformPeers(opts.platform()) : undefined, sqlite: opts.sqlite, keepEdited: b.keep_edited !== false,
      ...(typeof b.suggest_new === "boolean" ? { suggest_new: b.suggest_new } : {}) }) };
  });
}
