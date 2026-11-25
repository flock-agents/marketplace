// The week's plan on the slot model (docs/slot-model-spec.md §5), made in steps the app's code drives (make_plan, and the
// Sunday run). The model reads words and fills slots; code stores, counts and checks:
//   1. the week's slot-days in code (planDays.ts): who each slot is for on each day, from the slots, the weekday patterns,
//      the calendar (or the household's dated stays), fasts and the meals eaten out; a slot-day the family changed is kept;
//   2. the feasibility check (planChecks.ts): where a slot's library is too thin, relaxed in a fixed order, logged;
//   3. one balanced call per slot for the whole week, in planning order (breakfast, tiffin, lunch, snacks, dinner, add-ons),
//      at most SLOT_CALLS_AT_ONCE at once, an add-on after its main slot (it gets that slot's dishes);
//   4. code's checks after each call (a dish not in the library gets a contains read first); one fix call for what fails;
//      then rotation in code; never a loop;
//   5. each day's ingredients from one fast call, an avoided ingredient taken out; saved in one transaction;
//   6. the message: the week by day, standing notes once, what could not be kept, the new dishes, what to ask.
// One run per week at a time: a second make_plan for the same week joins the one running, and a run never starts a model
// call on top of one still running from before (Flock's SDK cannot abort a call). Nothing here messages anyone.
import type { Hono } from "hono";
import { asc } from "drizzle-orm";
import { people as people_t } from "./db/schema";
import { CONTAINS_BATCH, DEFAULT_DISH_DAYS, REPEAT_WINDOW_DAYS, SLOT_CALLS_AT_ONCE } from "./db/constants";
import { addDays, todayStr, weekDates, weekdayLong, weekdayOf } from "./dates";
import { dishKey } from "./dishText";
import { closeWeek, dateOf } from "./meals";
import { changeMessage, planMessage, planQuestion, weekLink, type ShortAsk } from "./messages";
import { isObject, refuse, writeRoutes, type Db, type Emit } from "./family";
import { STOP_CODES, stopSaid, type ModelCall, type ModelFailure, type ModelRequest, type ModelResult } from "./model";
import { commit, deleteSlotDays, listLibrary, listRules, listSlotDays, listSlots, newDishesPerWeek, recent, saveSlotDay, slotHistory, upsertLibrary,
  type Rule, type Slot } from "./slotStore";
import { buildDays, slotDayKey, lunchSaid, platformPeers, readEvents, readHousehold, ruleHolds, withLunchSaid, type PlanDay, type Peers } from "./planDays";
import { addDaily, canonTag, checkSlot, isVariantOf, isVariantRow, variantRow, factsOf, feasibility, ownAddon, forbidden, frequencyRange, hardOnly, isStapleAt, notFor, plannable, resolveSlot, rotate, ruleBreaks, ruleTags, settingUsed, softSwapNotes,
  slotFacts, swapNotes, thinAddon, type Problem, type Proposal, type ShortSlot, type Week } from "./planChecks";

export type MakePlanResult =
  | { ok: true; week_start: string; message: string; intro?: string; instructions: string; unmet?: string[]; asked?: string[]; no_ingredients?: string[];
      /** Slots whose repeat window the feasibility check narrowed (§5.2), with the days it now is. */ relaxed?: Record<string, number> }
  | { ok: false; reason: string; say: string; /** A question for the family (no_dishes). */ ask?: string };
type Ingredient = { item: string; amount: number | null; unit: string | null };
type Failure = Extract<ModelResult, { ok: false }>;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const isStop = (code: ModelFailure) => (STOP_CODES as readonly string[]).includes(code);
const uniq = <T>(xs: T[]) => [...new Set(xs)];
const andList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()) : []);

// ── The slot call (§5.3) ──

export const SLOT_SCHEMA = { type: "object", required: ["days"], properties: {
  days: { type: "object", additionalProperties: { type: "array", items: { type: "string" } } },
  new: { type: "array", items: { type: "object", required: ["dish"], properties: { dish: { type: "string" }, why: { type: "string" }, like: { type: "string" } } } },
  notes: { type: "object", additionalProperties: { type: "string" } } } };

export const SLOT_SYSTEM = [
  "You plan one meal slot of an Indian family's week: the dishes made at that slot on each day in `days`. Answer with JSON only: { days: { \"YYYY-MM-DD\": [dish names] }, new: [{ dish, why, like }], notes: { \"YYYY-MM-DD\": note } }.",
  "Every date in `days` without `skip` gets its dishes; a date with `skip` gets none. Dish names only, no ingredients. A day's dishes are made once and eaten by everyone in its `for`.",
  "A good week is one this family would happily eat: their own dishes first, in the proportions their plates show; a different main dish from one day to the next; everyday home food on weekdays and their special dishes on the days they have them; food the children and elders at the table can eat.",
  "Read each plate in `looks_like` as its parts: the main dish, the dal, the dry or gravy vegetable, the rice or bread it is eaten with, the side (curd, raita, chutney, salad). Work out yourself which part each library dish is, and make every day of the same parts as one of their plates.",
  "Shape each day like `looks_like`, this family's own plates at this slot: the same parts (a staple, a dal, a dry vegetable, a side…) and as many dishes as `plate` says, never thinner. `staples` come as often as the plates show them, and only on a day shaped like a plate that has them (a one-pot rice dish needs no plain rice beside it). The rest from `library`: rotate them so a dish is not within `gap` days of itself here; a dish comes at most `left` more days, at least `at_least` days when given, and only on its `days`. A dish with `days` is what the family has on those days: put it on each of them where its people can eat it.",
  "A dish's `not_for` people do not eat it: that is fine, as long as each of them has a dish of their own that day beside the staples. `guests` eat that meal too: keep their `rules` for them the same way. People in a day's `own_slot` get their own dish at their own slot that day.",
  "Some library dishes name a kind of dish, not one dish: \"Sabzi\", \"Dal\", \"Chutney\", \"Paratha\", or a dish with one (\"Idli with chutney\"). Never write that name as it is day after day: each day, name one particular dish of that kind, as a home cook of this family's region makes it, keeping every word of the family's name in it (\"Bhindi sabzi\", \"Aloo gobi sabzi\", \"Moong dal\", \"Dal tadka\", \"Methi paratha\", \"Idli with coconut chutney\"). The same goes for one of their dishes with another accompaniment (\"Idli with tomato chutney\" for their \"Idli with coconut chutney\"). List each in `new` with `like` set to the family's dish name exactly as given: it is their own dish made a particular way, so it does not use up `new_dishes_allowed`. Vary it across the week (a different sabzi on each day that has one), keep it quick enough for the cook, and keep every rule of the people eating it (no onion chutney for someone who has no onion that day).",
  "Write the names of `library` and `staples` dishes exactly as given.",
  "Any other dish that is not in `library` or `staples` is new: list it in `new` with why it suits this family and `like`, the dish of theirs it stands in for; at most `new_dishes_allowed` new dishes in all; none when it is 0.",
  "`short_of_dishes` given: the family's known dishes here do not cover the week. Their plates in `looks_like` are the template: where the library runs out, add new dishes that sit in the same place on their plates and are of the same cuisine (another dry vegetable like their Kantola fry, another fish curry like their Fish moilee), each listed in `new` with `like`. Never a plate thinner than their usual plates, and never a bare staple, because the known dishes ran out.",
  "Every rule in `rules` holds for its person (everyone when it says so): a dish against their rule is simply not theirs, so on every day they are in `for` they need at least one dish they can eat beside the staples, as their past plates show. A rule with a count a week is kept that many times in the week, not every day. `notes_for_people` are preferences to keep in mind. A person in `fasting` eats only what it says.",
  "Do not repeat what `already_this_week` has at another meal the same day, and avoid what `recent` had. An add-on slot (`main_slot` given) holds only what its people have in place of, or beside, the main slot's dishes that day, and only as often as its dishes' `left` and `days` allow: a day past that gets [] (they eat the main slot's dishes), never a dish again past its `left`.",
  "Each day's dishes are one whole meal as a home serves it, like their plates: at lunch and dinner one main dish with the rice or bread it is eaten with (dal with rice, a sabzi with roti), never three curries or three mains side by side with nothing to eat them with. With no `looks_like`, a plate is a main, a side and its rice or bread.",
  "notes: only for a day that needs a word for someone at the table (\"millet rice for one person only\"); never about your choices or changes; leave other days out.",
].join("\n");

export const FIX_SYSTEM = [
  "You fix some days of one meal slot of an Indian family's week. Answer with JSON only, in the same shape: { days: { \"YYYY-MM-DD\": [dish names] }, new: [{ dish, why }], notes: { ... } }.",
  "Send back ONLY the dates in `fix`, each day whole (all its dishes), changed so every reason given for it is gone. The other days stay as `now` has them. `week` lists what is off across the week: keep it in mind.",
  "A dish that is wrong is changed for another dish of the same kind in its place (a dal for a dal, a dry vegetable for a dry vegetable, as `looks_like` shows), never just left out; with `short_of_dishes`, a new one of that kind is fine, listed in `new` with `like`. Only an add-on slot (`main_slot` given) may get [] for a day, when its dishes' `left` is used up.",
  "Everything of the first request still holds: the library, staples, `left`, `days`, the rules (each person and the guests need a dish they can eat) and the new-dish limit.",
  "A particular dish of a kind the family names (\"Bhindi sabzi\" for their \"Sabzi\", every word of their name kept, in `new` with `like` their name) is their own dish, not a new one.",
  "notes: only a word for someone at the table that day; never what you changed or why.",
].join("\n");

/** The model's slot answer, read leniently: only the dates asked, dish names as strings, each once. */
/** A note that explains the plan's own choices, not a word for someone at the table (the prompt says never; onboarding run 24:
 *  "Gowri Shankar fasting, no onion garlic; Idli is safe, Chutney avoided by him"): left out. A person's fast is said by code. */
const CHOICE_WORDS = /\b(safe|avoid(s|ed|ing)?|chose|chosen|choosing|instead|swap(ped|s)?|replac(e|ed|es|ing)|because|so that|kept|fasting|fasts|fast day|rule|allowed|compl(y|ies|iant))\b/i;
export const explainsItself = (note: string): boolean => CHOICE_WORDS.test(note) || note.length > 80;

function proposalOf(json: unknown, dates: string[], emptyOk = false): { days: Map<string, string[]>; newNames: Map<string, { name: string; why: string; like?: string }>; notes: Map<string, string> } {
  const out = { days: new Map<string, string[]>(), newNames: new Map<string, { name: string; why: string; like?: string }>(), notes: new Map<string, string>() };
  if (!isObject(json)) return out;
  if (isObject(json.days)) for (const [date, ds] of Object.entries(json.days)) if (dates.includes(date)) {
    const list = strs(ds).filter((x, i, xs) => xs.findIndex((y) => dishKey(y) === dishKey(x)) === i);
    if (list.length || (emptyOk && Array.isArray(ds))) out.days.set(date, list);
  }
  if (Array.isArray(json.new)) for (const n of json.new) if (isObject(n) && typeof n.dish === "string" && n.dish.trim())
    out.newNames.set(dishKey(n.dish), { name: n.dish.trim(), why: typeof n.why === "string" ? n.why.trim() : "", ...(typeof n.like === "string" && n.like.trim() ? { like: n.like.trim() } : {}) });
  if (isObject(json.notes)) for (const [date, t] of Object.entries(json.notes)) if (dates.includes(date) && typeof t === "string" && t.trim() && !explainsItself(t)) out.notes.set(date, t.trim());
  return out;
}

// ── The contains read of a dish not in the library (§5.4 check 2: new dishes get a contains read before the check) ──

export const CONTAINS_SCHEMA = { type: "object", required: ["dishes"], properties: { dishes: { type: "array", items: { type: "object", required: ["dish", "has"], properties: {
  dish: { type: "string" }, has: { type: "array", items: { type: "string" } }, not: { type: "array", items: { type: "string" } } } } } } };
export const CONTAINS_SYSTEM = [
  "For each Indian dish given, say which of the given tags it has as usually made at home. Answer with JSON only: { dishes: [{ dish, has: [tags], not: [tags] }] }, every dish, its name exactly as given.",
  "Every tag of `tags` goes in has or in not; a tag you cannot tell for that dish goes in neither.",
].join("\n");

// ── The guests' food rules (their words) → the tags they forbid ──

export const GUESTS_SCHEMA = { type: "object", required: ["rules"], properties: { rules: { type: "array", items: { type: "object", required: ["rule", "never"],
  properties: { rule: { type: "string" }, never: { type: "array", items: { type: "string" } } } } } } };
export const GUESTS_SYSTEM = [
  "Guests are coming for a meal. For each of their food rules, in their words, say which of the given tags a dish must not have for them. Answer with JSON only: { rules: [{ rule, never: [tags] }] }, every rule, its words exactly as given.",
  "Only tags from `tags`; [] when the rule forbids none of them.",
].join("\n");

// ── The ingredients (§5.5) ──

export const INGREDIENT_SCHEMA = { type: "object", required: ["dishes"], properties: { dishes: { type: "array", items: { type: "object", required: ["slot", "name", "ingredients"],
  properties: { slot: { type: "string" }, name: { type: "string" }, ingredients: { type: "array", items: { type: "object", required: ["item", "amount", "unit"],
    properties: { item: { type: "string" }, amount: { type: "number" }, unit: { type: "string" }, tags: { type: "array", items: { type: "string" } } } } } } } } } };
export const INGREDIENT_SYSTEM = [
  "You list what an Indian family's dishes for one day need bought. Answer with JSON only: { dishes: [{ slot, name, ingredients: [{ item, amount, unit, tags }] }] }, every dish you are given, its slot and name exactly as given.",
  "Amounts for the `people` eating that dish at that one meal. item is the plain word (\"atta\", \"toor dal\", \"onion\"); amount a number; unit g, kg, ml, l or pc (things counted). Leave out salt and water.",
  "tags: which of the dish's `tags` the ingredient is (sugar is \"sugar\", onion is \"onion_garlic\"); [] when none or when the dish has no tags.",
].join("\n");

export function ingredientsFrom(json: unknown): { slot: string; name: string; ingredients: (Ingredient & { tags: string[] })[] }[] {
  const raw = isObject(json) ? json.dishes : undefined;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((d) => {
    if (!isObject(d) || typeof d.name !== "string" || !Array.isArray(d.ingredients)) return [];
    const ingredients = d.ingredients.flatMap((i) => {
      if (!isObject(i)) return [];
      const item = typeof i.item === "string" ? i.item.trim() : "";
      if (!item) return [];
      return [{ item, amount: typeof i.amount === "number" && Number.isFinite(i.amount) && i.amount > 0 ? i.amount : null,
        unit: typeof i.unit === "string" && i.unit.trim() ? i.unit.trim() : null, tags: strs(i.tags).map(canonTag) }];
    });
    return [{ slot: typeof d.slot === "string" ? d.slot : "", name: d.name.trim(), ingredients }];
  });
}

// ── The run ──

/** `budgetMs`: how long the whole plan may take (Flock waits 6 minutes for make_plan); `clock`: milliseconds now, for tests;
 *  `household`: the household facts Flock sent; `peers`: the fresh household and the calendar (platformPeers), preferred. */
export type MakePlanDeps = { db: Db; emit: Emit; model: ModelCall; weekStart: string; today: string; basePath: string; budgetMs?: number; clock?: () => number;
  log?: (line: string) => void; household?: unknown; peers?: Peers;
  /** A later change (spec §6): plan only these slot-days of the week, every other one kept as saved and read for the checks;
   *  the answer's message names only them, and no intro is sent. None: the whole week. */
  only?: { date: string; slot: string }[];
  /** The raw database, for what setup kept beside the rows (house.setup_state: weekday lunch); none: not read. */
  sqlite?: { query: (q: string) => { get: () => unknown } };
  /** The family said to plan with new dishes where the planner knows none of theirs (their answer to the no_dishes question). */
  suggest_new?: boolean };

/** The question when the planner knows none of the family's dishes for some meals (reason no_dishes). */
export function noDishesAsk(slots: string[]): string {
  const names = slots.map((n) => (/^(Breakfast|Lunch|Dinner)$/.test(n) ? n.toLowerCase() : n));
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `I don't know your dishes for ${list} yet. What do you usually have? A few dishes each is enough. Or say "suggest some" and I'll plan with new dishes like a home kitchen's.`;
}

/** make_plan's time: inside Flock's 6 minutes for an operation, with room to save and answer. */
export const OP_BUDGET_MS = 330_000;
/** The Sunday run has no caller waiting, only Flock's own per-call deadlines. */
export const ROUTINE_BUDGET_MS = 20 * 60_000;
/** Kept back from the slot calls for the ingredients (asked for every day at once) and the save. */
const INGREDIENTS_RESERVE_MS = 90_000, SAVE_RESERVE_MS = 5_000;
const slotTokens = (days: number) => Math.min(6000, 1500 + 350 * days);

type Flight = { run?: Promise<MakePlanResult>; changes?: Promise<void>; inflight: Set<Promise<unknown>> };
const flights = new WeakMap<object, Map<string, Flight>>();
function flightOf(db: Db, weekStart: string): Flight {
  let byWeek = flights.get(db as object);
  if (!byWeek) flights.set(db as object, (byWeek = new Map()));
  let f = byWeek.get(weekStart);
  if (!f) byWeek.set(weekStart, (f = { inflight: new Set() }));
  return f;
}

/** Make and save the week's plan. Never messages anyone; answers the message and intro to send, or why not and the plain line
 *  to say instead. A stop the family must fix (credits, the day's budget, too many calls) ends the run at once. */
export function makePlan(deps: MakePlanDeps): Promise<MakePlanResult> {
  const log = deps.log ?? ((line: string) => console.log(`[planner] make_plan ${deps.weekStart}${deps.only ? " (a change)" : ""}: ${line}`));
  const f = flightOf(deps.db, deps.weekStart);
  if (deps.only) {
    // A change to some slot-days waits for the week's run (and any change before it), then plans on what that saved.
    const before = f.changes ?? Promise.resolve();
    const run = before.then(() => f.run).then(() => planWeek({ ...deps, log }, f.inflight), () => planWeek({ ...deps, log }, f.inflight));
    f.changes = run.then(() => undefined, () => undefined);
    return run;
  }
  if (f.run) { log("joined the run already going for this week"); return f.run; }
  const run: Promise<MakePlanResult> = planWeek({ ...deps, log }, f.inflight).finally(() => { if (f.run === run) f.run = undefined; });
  f.run = run;
  return run;
}

async function planWeek(deps: MakePlanDeps & { log: (line: string) => void }, inflight: Set<Promise<unknown>>): Promise<MakePlanResult> {
  const { db, weekStart, today, log } = deps;
  const clock = deps.clock ?? Date.now, end = clock() + (deps.budgetMs ?? OP_BUDGET_MS), started = clock();
  const done = (r: MakePlanResult): MakePlanResult => {
    log(r.ok ? `planned in ${clock() - started} ms${r.unmet?.length ? `, unmet: ${r.unmet.join("; ")}` : ""}${r.no_ingredients?.length ? `, ${r.no_ingredients.length} dishes without ingredients` : ""}`
      : `not planned (${r.reason}) after ${clock() - started} ms`);
    return r;
  };
  const stopped = (r: Failure): MakePlanResult => done({ ok: false, reason: r.code, say: stopSaid(r.code) });
  /** A model call that gives up (timeout) when the run's time, less `reserve`, is spent; it stays in `inflight` until it answers. */
  const model = async (req: ModelRequest, reserve: number): Promise<ModelResult> => {
    const left = end - reserve - clock();
    if (left <= 0) return { ok: false, code: "timeout", message: "the plan's time is spent" };
    const call = deps.model(req);
    inflight.add(call);
    const gone = () => { inflight.delete(call); };
    call.then(gone, gone);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<ModelResult>((resolve) => { timer = setTimeout(() => resolve({ ok: false, code: "timeout", message: "the plan's time is spent" }), left); });
    try { return await Promise.race([call.catch((e) => ({ ok: false as const, code: "unavailable" as const, message: String(e) })), late]); } finally { clearTimeout(timer); }
  };
  // Never a call on top of one still running from a run before.
  if (inflight.size) {
    const left = end - INGREDIENTS_RESERVE_MS - clock();
    log(`waiting for ${inflight.size} model call${inflight.size === 1 ? "" : "s"} still running before asking again`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (left > 0) await Promise.race([Promise.allSettled([...inflight]), new Promise((resolve) => { timer = setTimeout(resolve, left); })]);
    clearTimeout(timer);
  }

  // 1. The slot-days.
  const people = db.select().from(people_t).orderBy(asc(people_t.created_at)).all().filter((p) => p.active !== 0).map((p) => p.name);
  if (!people.length) return done({ ok: false, reason: "no_family", say: "Tell me who eats at home first, then I'll plan the week." });
  const slots = listSlots(db);
  if (!slots.length) return done({ ok: false, reason: "no_slots", say: "I don't know which meals you have at home yet. Tell me what a usual day's meals are, then I'll plan the week." });
  const weekEnd = addDays(weekStart, 6), from = weekStart < today ? today : weekStart;
  const fresh = deps.peers?.household ? await deps.peers.household() : null;
  const household = withLunchSaid(readHousehold(fresh ?? deps.household), deps.sqlite ? lunchSaid(deps.sqlite) : []);
  log(`household: ${fresh ? "read fresh" : deps.household !== undefined ? "as sent" : "none"}; weekly ${household.weekly ? `${household.weekly.length} patterns` : "unknown"}`);
  const events = deps.peers?.calendar ? await deps.peers.calendar(from, weekEnd) : null;
  const read = await readEvents({ events, dated: household.dated, from, to: weekEnd, people, slots: slots.map((s) => s.name), weekly: household.weekly, model: (req) => model(req, INGREDIENTS_RESERVE_MS), log });
  if (read.stop) return stopped(read.stop);
  const rules = listRules(db);
  const only = deps.only ? new Set(deps.only.map((x) => slotDayKey(x.date, x.slot))) : undefined;
  const saved = listSlotDays(db, { from: weekStart, to: weekEnd });
  const days = buildDays({ weekStart, from, slots, people, rules, household, changes: read.changes, saved, only });
  const toPlan = days.filter((d) => !d.fixed && !d.skip);
  if (!days.some((d) => !d.fixed)) return done({ ok: false, reason: "no_meals", say: only ? "There is no meal left to plan there." : "There are no days left to plan in that week." });

  // 2. Each slot's facts, and the feasibility check.
  const library = listLibrary(db);
  const order = slots.filter((s) => days.some((d) => same(d.slot, s.name) && !d.fixed)).map((s) => s.name);
  // A change plans inside the week's budget of new dishes: those already on the week's other slot-days count.
  const newKept = only ? new Set(days.filter((d) => d.fixed).flatMap((d) => saved.find((x) => x.date === d.date && same(x.slot, d.slot))?.dishes.filter((x) => x.new).map((x) => dishKey(x.dish)) ?? [])).size : 0;
  const w: Week = { days, slots: new Map(), rules, library, facts: new Map(), done: new Set(), newBudget: Math.max(0, newDishesPerWeek(db) - newKept), newDishes: new Map() };
  for (const s of slots) {
    const history = slotHistory(db, s.name, weekStart);
    w.slots.set(s.name.toLowerCase(), slotFacts(s, library, history, recent(history, weekStart, 3)));
    if (!order.includes(s.name)) w.done.add(s.name.toLowerCase());
  }
  // Never a plan from an empty library (#29): a meal with none of the family's dishes and no plate of theirs to go by is
  // asked about, unless they said to suggest new dishes there.
  const unknown = order.filter((n) => { const sf = w.slots.get(n.toLowerCase())!;
    return sf.slot.kind !== "addon" && !sf.looks_like.length && !sf.library.some((d) => plannable(d)); });
  if (unknown.length && !deps.only && !deps.suggest_new) return done({ ok: false, reason: "no_dishes", ask: noDishesAsk(unknown), say: noDishesAsk(unknown) });
  const unmet: string[] = [];
  const tags = ruleTags(rules);
  // The guests' food rules, in their words, read once into the tags they forbid (code then checks them like a person's).
  const guestWords = uniq(days.filter((d) => !d.fixed).flatMap((d) => d.guests.flatMap((g) => g.rules ?? [])).map((x) => x.trim().toLowerCase()).filter(Boolean));
  if (guestWords.length) {
    const r = await model({ tier: "fast", purpose: "meal plan: guests' food rules", system: GUESTS_SYSTEM, schema: GUESTS_SCHEMA, maxTokens: 800,
      user: JSON.stringify({ tags, rules: guestWords }) }, INGREDIENTS_RESERVE_MS);
    if (!r.ok) { log(`guests' rules read failed (${r.code}): not checked`); if (isStop(r.code)) return stopped(r); }
    else {
      w.guestTags = new Map();
      const raw = isObject(r.json) && Array.isArray(r.json.rules) ? r.json.rules : [];
      for (const x of raw) if (isObject(x) && typeof x.rule === "string" && guestWords.includes(x.rule.trim().toLowerCase()))
        w.guestTags.set(x.rule.trim().toLowerCase(), strs(x.never).map(canonTag).filter((t) => tags.includes(t)));
      log(`guests' rules: ${[...w.guestTags].map(([k, v]) => `${k} → ${v.join(", ") || "nothing"}`).join("; ")}`);
    }
  }

  /** A library dish not read for every tag the rules name (setup ran out of time before it read them: onboarding run 26). */
  const hardTags = uniq(rules.filter((r) => r.hard).flatMap(forbidden));
  const unreadIn = (d: (typeof library)[number]) => hardTags.some((t) => !d.contains_read.map(canonTag).includes(t));
  /** Read what the dishes contain, in batches: one not in the library, or a library dish not read for every tag (what is
   *  not read fails closed). */
  const readContains = async (dishes: string[]): Promise<Failure | null> => {
    const need = uniq(dishes.map(dishKey)).filter((k) => { const row = library.find((d) => d.key === k); return !w.facts.has(k) && (!row || unreadIn(row)); });
    const names = need.map((k) => dishes.find((x) => dishKey(x) === k)!);
    for (let i = 0; i < names.length; i += CONTAINS_BATCH) {
      const batch = names.slice(i, i + CONTAINS_BATCH);
      const r = await model({ tier: "fast", purpose: "meal plan: what new dishes contain", system: CONTAINS_SYSTEM, schema: CONTAINS_SCHEMA, maxTokens: 3000,
        user: JSON.stringify({ tags, dishes: batch }) }, INGREDIENTS_RESERVE_MS);
      if (!r.ok) { log(`contains read failed (${r.code}) for ${batch.join(", ")}`); if (isStop(r.code)) return r; continue; }
      const raw = isObject(r.json) && Array.isArray(r.json.dishes) ? r.json.dishes : [];
      for (const x of raw) {
        if (!isObject(x) || typeof x.dish !== "string" || !need.includes(dishKey(x.dish))) continue;
        const key = dishKey(x.dish);
        const has = strs(x.has).map(canonTag).filter((t) => tags.includes(t)), not = strs(x.not).map(canonTag).filter((t) => tags.includes(t) && !has.includes(t));
        // A library dish keeps what it was read for already.
        const row = library.find((d) => d.key === key);
        w.facts.set(key, { tags: new Set([...(row?.contains ?? []).map(canonTag), ...has]), read: new Set([...(row?.contains_read ?? []).map(canonTag), ...has, ...not]) });
      }
    }
    return null;
  };
  // The library's dishes not read for every tag are read now, before any slot is planned: else every one of them fails closed.
  const unread = library.filter(unreadIn).map((d) => d.name);
  if (unread.length) {
    log(`contains: ${unread.length} library dishes not read for every tag: reading them first`);
    const f = await readContains(unread);
    if (f) return stopped(f);
  }
  // The feasibility check after that read: before it, every unread dish counted as nobody's and a slot came out short (run 28).
  const feas = feasibility(w, order);
  for (const l of feas.log) log(l);
  const settled = (d: PlanDay) => d.fixed || w.done.has(d.slot.toLowerCase());

  /** The request for one slot's call (§5.3), from the week as it is now. */
  const request = (s: Slot) => {
    const sf = w.slots.get(s.name.toLowerCase())!;
    const mine = days.filter((d) => same(d.slot, s.name) && !d.fixed);
    const eaters = uniq(mine.flatMap((d) => d.people));
    const usedDays = (k: string) => new Set(days.filter((d) => settled(d) && d.dishes.some((x) => dishKey(x) === k)).map((d) => d.date)).size;
    const lib = sf.library.filter((d) => plannable(d) && !sf.staples.some((x) => dishKey(x) === d.key)).flatMap((d) => {
      const [min, max] = frequencyRange(d.frequency) ?? [0, DEFAULT_DISH_DAYS];
      // What a later slot sharing the dish was set aside (feasibility) is not this slot's to use.
      const later = [...w.slots.values()].filter((x) => x !== sf && order.includes(x.slot.name) && !w.done.has(x.slot.name.toLowerCase())).reduce((n, x) => n + (x.takes.get(d.key) ?? 0), 0);
      const left = Math.max(0, max - usedDays(d.key) - later);
      const not = eaters.filter((p) => mine.some((x) => x.people.includes(p) && ruleBreaks(w, { ...x, people: [p] }, d.name).length));
      if (!left || (eaters.length && not.length === eaters.length)) return [];
      // Its room here: the slot-days on its days; a dish the family has often comes at least that often.
      const room = mine.filter((x) => !x.skip && (!d.days?.length || d.days.includes(weekdayOf(x.date)))).length;
      const least = Math.min(room, Math.max(0, min - usedDays(d.key)));
      return [{ dish: d.name, left, ...(least ? { at_least: least } : {}), ...(d.days?.length ? { days: d.days } : {}), ...(d.frequency ? { how_often: d.frequency } : {}), ...(not.length ? { not_for: not } : {}) }];
    });
    const already: Record<string, Record<string, string[]>> = {};
    for (const d of days) if (settled(d) && d.dishes.length && d.date >= weekStart) (already[d.slot] ??= {})[d.date] = d.dishes;
    const holds = (r: Rule) => (!r.who || eaters.some((p) => same(p, r.who!))) && mine.some((d) => ruleHolds(r, d.date, s, s.name));
    const ruleLines = rules.filter((r) => r.what !== "fasting" && r.what !== "note" && holds(r)).map((r) => ruleLine(r, w, s.name));
    const notes = rules.filter((r) => r.what === "note" && holds(r)).map(noteLine);
    const main = s.kind === "addon" && s.addon_of ? Object.fromEntries(days.filter((d) => same(d.slot, s.addon_of!) && d.dishes.length).map((d) => [d.date, d.dishes])) : undefined;
    return {
      slot: s.name,
      days: mine.map((d) => d.skip ? { date: d.date, skip: d.skip } : { date: d.date, for: d.people, ...(d.why.length ? { why: d.why.join("; ") } : {}),
        ...(s.kind === "main" && d.people.some((p) => ownAddon(w, d, p)) ? { own_slot: d.people.filter((p) => ownAddon(w, d, p)) } : {}),
        ...(d.fasting.length ? { fasting: d.fasting } : {}), ...(d.guests.length ? { guests: d.guests } : {}), ...(d.occasion ? { occasion: d.occasion } : {}),
        ...(d.new_dishes_allowed != null ? { new_dishes_allowed: d.new_dishes_allowed } : {}) }),
      gap: sf.window, looks_like: sf.looks_like, ...(sf.plate ? { plate: sf.plate[0] === sf.plate[1] ? `${sf.plate[0]} dish${sf.plate[0] === 1 ? "" : "es"}` : `${sf.plate[0]} to ${sf.plate[1]} dishes` } : {}), staples: sf.staples, library: lib, already_this_week: already, recent: sf.recent, rules: ruleLines,
      // A short slot's own new dishes (its shortfall) beside the week's setting, which other slots share (owner 24 Nov).
      notes_for_people: notes, new_dishes_allowed: sf.shortNew + Math.min(sf.newAllowed, Math.max(0, w.newBudget - settingUsed(w))), ...(sf.short ? { short_of_dishes: true } : {}),
      occasion: null, ...(main ? { main_slot: main } : {}),
    };
  };

  // 3–4. The slot calls, in planning order, at most SLOT_CALLS_AT_ONCE at once; each checked, fixed once, then rotated.
  let stop: Failure | null = null, lastFailure: Failure | null = null, answered = false;
  const notesBy = new Map<string, string>();   // date|slot → the call's note
  const runSlot = async (s: Slot): Promise<void> => {
    const mine = toPlan.filter((d) => same(d.slot, s.name));
    if (!mine.length) return;
    const dates = mine.map((d) => d.date);
    const first = request(s);
    const p: Proposal & { notes: Map<string, string> } = { days: new Map(), newNames: new Map(), notes: new Map() };
    const ask = async (req: ModelRequest, only: string[]): Promise<void> => {
      if (stop) return;
      const t0 = clock();
      const r = await model(req, INGREDIENTS_RESERVE_MS);
      log(`${req.purpose}: ${r.ok ? "ok" : r.code} in ${clock() - t0} ms`);
      if (!r.ok) { if (isStop(r.code)) stop = r; else lastFailure = r; return; }
      answered = true;
      const got = proposalOf(r.json, only, s.kind === "addon");
      for (const [d, ds] of got.days) p.days.set(d, ds);
      for (const [k, v] of got.newNames) {
        // A particular way of a family entry ("Bhindi sabzi", like their "Sabzi"): their dish, planned as that entry, not new.
        const entry = v.like ? library.find((x) => same(x.slot, s.name) && x.key === dishKey(v.like!) && plannable(x)) : undefined;
        if (entry && isVariantOf(entry.name, v.name)) {
          if (!library.some((x) => same(x.slot, s.name) && x.key === k)) { library.push(variantRow(entry, v.name)); log(`${s.name}: ${v.name} is their ${entry.name}`); }
          continue;
        }
        p.newNames.set(k, v);
      }
      for (const d of only) p.notes.delete(d);
      for (const [d, t] of got.notes) p.notes.set(d, t);
    };
    const contains = async () => { const f = await readContains(mine.flatMap((d) => p.days.get(d.date) ?? [])); if (f) stop = f; };
    await ask({ tier: "balanced", purpose: `meal plan: the week's ${s.name}`, system: SLOT_SYSTEM, schema: SLOT_SCHEMA, maxTokens: slotTokens(mine.length), user: JSON.stringify(first) }, dates);
    if (!stop) await contains();
    if (stop) return;
    addDaily(w, s.name, p);
    // An add-on's days thinned to what its dishes allow, before anything is sent back (owner 23 Nov).
    const thin = () => { const t = thinAddon(w, s.name, p); if (t.changed.length) log(`${s.name}: add-on thinned: ${t.changed.join("; ")}`); return t.unmet; };
    let thinUnmet = thin();
    let problems = checkSlot(w, s.name, p);
    const hard = () => dates.filter((d) => hardOnly(problems.get(d)).length);
    // A dish back too soon, too often or twice a day is code's to swap in its place (owner 23 Nov: never a thinner plate),
    // before anything is sent back; where no swap fits it stays (noted at the end), and is not sent back either.
    const comesBack = (x: Problem) => !!x.dish && (x.kind === "repeat" || x.kind === "often" || x.kind === "same_day");
    const early = hard().filter((d) => hardOnly(problems.get(d)).some(comesBack));
    if (early.length) {
      const r = rotate(w, s.name, p, early, { swapsOnly: true });
      log(`${s.name}: code swapped first: ${r.changed.join("; ")}`);
      problems = checkSlot(w, s.name, p);
    }
    const bad = dates.filter((d) => hardOnly(problems.get(d)).some((x) => !comesBack(x)));
    if (bad.length) {
      const fix = { ...first, now: Object.fromEntries(dates.map((d) => [d, p.days.get(d) ?? []])),
        fix: bad.map((d) => ({ date: d, wrong: (problems.get(d) ?? []).filter((x) => !comesBack(x)).map((x) => x.text) })), week: (problems.get("") ?? []).map((x) => x.text) };
      log(`${s.name}: ${bad.length} day${bad.length === 1 ? "" : "s"} sent back (${kindsOf(problems)})`);
      await ask({ tier: "balanced", purpose: `meal plan: fix the ${s.name}`, system: FIX_SYSTEM, schema: SLOT_SCHEMA, maxTokens: slotTokens(bad.length), user: JSON.stringify(fix) }, bad);
      if (!stop) await contains();
      if (stop) return;
      addDaily(w, s.name, p);
      thinUnmet = thin();
    }
    unmet.push(...thinUnmet);
    // From here to the slot's acceptance nothing waits: the week it is checked against is the week it joins.
    problems = checkSlot(w, s.name, p);
    const still = hard();
    if (still.length) {
      const r = rotate(w, s.name, p, still);
      log(`${s.name}: code swapped ${r.changed.join("; ")}`);
      problems = checkSlot(w, s.name, p);
      // Still back too soon or too often: the slot's week chosen again in code by swaps in place, plates kept whole.
      const again = hard().length ? resolveSlot(w, s.name, p) : null;
      if (again) {
        for (const [d, ds] of again) p.days.set(d, ds);
        log(`${s.name}: code chose the week again: ${[...again].map(([d, ds]) => `${weekdayOf(d)} ${ds.join(", ")}`).join("; ")}`);
        problems = checkSlot(w, s.name, p);
        unmet.push(...hard().flatMap((d) => hardOnly(problems.get(d)).flatMap((x) => x.kind === "rule" && !x.dish ? [`${weekdayOf(d)} ${s.name}: ${x.text.split(":")[0]}`]
          : x.dish && (x.kind === "repeat" || x.kind === "often" || x.kind === "same_day") ? [`${weekdayOf(d)} ${s.name}: ${x.dish} comes back sooner than usual`] : [])));
      } else unmet.push(...r.unmet);
    }
    for (const d of mine) {
      d.dishes = p.days.get(d.date) ?? [];
      const note = p.notes.get(d.date);
      if (note) notesBy.set(`${d.date}|${d.slot}`, note);
    }
    for (const [k, v] of p.newNames) if (mine.some((d) => d.dishes.some((x) => dishKey(x) === k)) && !isStapleAt(w, s.name, v.name)
      && !library.some((x) => x.key === k && same(x.slot, s.name) && plannable(x))) w.newDishes.set(k, { name: v.name, slot: s.name, why: v.why || (v.like ? `like your ${v.like}` : ""), ...(v.like ? { like: v.like } : {}) });
    w.done.add(s.name.toLowerCase());
    const left = [...problems.values()].flatMap((ps) => ps.filter((x) => !x.soft));
    if (left.length) log(`${s.name}: left as least bad: ${left.map((x) => x.text).join("; ")}`);
  };

  // An add-on waits for its main slot; the rest start in planning order as a place frees up.
  const queue = order.map((n) => slots.find((s) => s.name === n)!);
  const running = new Map<string, Promise<void>>();
  const finished = new Set<string>();
  const waitsFor = (s: Slot) => (s.kind === "addon" && s.addon_of && order.some((n) => same(n, s.addon_of!)) ? s.addon_of.toLowerCase() : null);
  while ((queue.length || running.size) && !stop) {
    for (const s of [...queue]) {
      if (running.size >= SLOT_CALLS_AT_ONCE) break;
      const dep = waitsFor(s);
      if (dep && !finished.has(dep)) continue;
      queue.splice(queue.indexOf(s), 1);
      const key = s.name.toLowerCase();
      running.set(key, runSlot(s).finally(() => { running.delete(key); finished.add(key); }));
    }
    if (!running.size) break;
    await Promise.race(running.values());
  }
  await Promise.allSettled(running.values());
  if (stop) return stopped(stop);
  if (toPlan.length && !answered && lastFailure) return stopped(lastFailure);
  // An add-on day left empty (its dishes' count used up) is no slot-day: nothing saved, said or bought for it (owner 23 Nov).
  const emptyAddon = (d: PlanDay) => !d.fixed && !d.skip && !d.dishes.length && slots.find((s) => same(s.name, d.slot))?.kind === "addon";
  const empty = toPlan.filter((d) => !d.dishes.length && !emptyAddon(d));
  if (toPlan.length && empty.length === toPlan.length)
    return done({ ok: false, reason: "no_dishes", say: `I couldn't plan the week: I don't know any dishes for ${andList(uniq(empty.map((d) => d.slot.toLowerCase())))} yet. Tell me a few you usually have.` });

  // Notes on dishes: a hard swap's ("millet in place of white rice for ...").
  const dishNotes = new Map<string, string[]>();   // date|slot|dish key
  const noteOn = (d: PlanDay, dish: string, t: string) => { const k = `${d.date}|${d.slot}|${dishKey(dish)}`; dishNotes.set(k, uniq([...(dishNotes.get(k) ?? []), t])); };
  for (const d of toPlan) for (const dish of d.dishes) for (const t of swapNotes(w, d, dish)) noteOn(d, dish, t);
  // A soft swap with a count the week falls short of, kept by a note on some of the person's days.
  for (const [k, t] of softSwapNotes(w)) { const [date, slot] = k.split("|"); const d = toPlan.find((x) => x.date === date && same(x.slot, slot)); const dish = d?.dishes.find((x) => k.endsWith(`|${dishKey(x)}`)); if (d && dish) noteOn(d, dish, t); }

  // 5. Each day's ingredients, one fast call a day (all days at once), once more for what it left out.
  const got = new Map<string, (Ingredient & { tags: string[] })[]>();   // date|slot|dish key
  const noIngredients: string[] = [];
  const hardAt = (d: PlanDay, p: string) => rules.filter((r) => r.hard && r.what !== "swap" && (!r.who || same(r.who, p)) && ruleHolds(r, d.date, w.slots.get(d.slot.toLowerCase())?.slot, d.slot));
  const avoidTags = (d: PlanDay) => uniq(d.people.flatMap((p) => hardAt(d, p).flatMap(forbidden)));
  const dayStops = await Promise.all(uniq(toPlan.map((d) => d.date)).map(async (date): Promise<Failure | null> => {
    const mine = toPlan.filter((d) => d.date === date);
    const dishes = mine.flatMap((d) => d.dishes.map((name) => ({ slot: d.slot, name, people: d.people.length + d.guests.reduce((n, g) => n + (g.count || 0), 0),
      ...(avoidTags(d).length ? { tags: avoidTags(d) } : {}) })));
    const missing = () => dishes.filter((x) => !got.get(`${date}|${x.slot}|${dishKey(x.name)}`)?.length);
    for (let attempt = 0; attempt < 2 && missing().length; attempt++) {
      const r = await model({ tier: "fast", purpose: "meal plan: a day's ingredients", system: INGREDIENT_SYSTEM, schema: INGREDIENT_SCHEMA, maxTokens: 4000,
        user: JSON.stringify({ date, day: weekdayOf(date), dishes: attempt ? missing() : dishes }) }, SAVE_RESERVE_MS);
      if (!r.ok) { if (isStop(r.code)) return r; continue; }
      for (const x of ingredientsFrom(r.json)) {
        if (!x.ingredients.length) continue;
        const d = mine.find((y) => same(y.slot, x.slot) && y.dishes.some((z) => same(z, x.name))) ?? mine.find((y) => y.dishes.some((z) => same(z, x.name)));
        if (d) got.set(`${date}|${d.slot}|${dishKey(x.name)}`, x.ingredients);
      }
    }
    if (missing().length) noIngredients.push(...missing().map((x) => `${weekdayOf(date)} ${x.slot}: ${x.name}`));
    return null;
  }));
  const ingStop = dayStops.find((x) => x);
  if (ingStop) return stopped(ingStop);
  // An ingredient someone at the slot-day must avoid comes out; a dish others share says so. Not for a person the dish is
  // not for (the fish stays in the fish curry), and not when the read tags more than half of a dish's ingredients against
  // one rule: that read is wrong (rice, oil and onion all tagged for a no-red-meat rule), and the dish's checked contains
  // already holds.
  for (const d of toPlan) for (const dish of d.dishes) {
    const k = `${d.date}|${d.slot}|${dishKey(dish)}`, list = got.get(k);
    if (!list) continue;
    let left = list;
    const notHis = notFor(w, d, dish);
    for (const p of d.people.filter((x) => !notHis.includes(x))) for (const r of hardAt(d, p)) {
      const out = left.filter((i) => i.tags.some((t) => forbidden(r).includes(t)));
      if (!out.length) continue;
      if (out.length * 2 > list.length) { log(`${weekdayOf(d.date)} ${d.slot} ${dish}: the ingredients read tags ${out.length} of ${list.length} against ${p}'s rule; not believed, kept`); continue; }
      left = left.filter((i) => !out.includes(i));
      log(`${weekdayOf(d.date)} ${d.slot} ${dish}: took out ${out.map((i) => i.item).join(", ")} (${p})`);
      if (r.who && d.people.length > 1) noteOn(d, dish, `no ${andList(uniq(out.map((i) => i.item.toLowerCase())))} for ${p}`);
    }
    got.set(k, left);
  }

  // Saved in one transaction: the week's slot-days from `from` on, edited ones kept; new dishes in the library; each
  // placement of an untried dish one more offer (a re-plan first takes back the offers of the placements it replaces).
  commit(db, deps.emit, (tx, ch) => {
    const by = "app";
    const back = new Map<string, number>();   // slot|key → placements taken back
    const replaced = (d: { date: string | null; slot: string }) => days.some((y) => y.date === d.date && same(y.slot, d.slot) && !y.fixed);
    for (const d of listSlotDays(tx, { from, to: weekEnd })) for (const x of d.dishes) {
      const k = `${d.slot.toLowerCase()}|${dishKey(x.dish)}`;
      if (only ? replaced(d) : !d.edited || replaced(d)) back.set(k, (back.get(k) ?? 0) + 1);
    }
    // The whole week: its slot-days from `from` on go (edited ones kept) and are saved again. A change: only its slot-days
    // are saved over (saveSlotDay replaces their dishes).
    if (!only) deleteSlotDays(tx, { from, to: weekEnd, keepEdited: true }, by, ch);
    for (const [k, v] of w.newDishes) {
      const placedAt = toPlan.find((d) => d.dishes.some((x) => dishKey(x) === k))!.slot;
      const f = factsOf(w, placedAt, v.name);
      const eaten = library.some((x) => x.key === k && !x.untried);
      upsertLibrary(tx, { name: v.name, slot: placedAt, origin: "planner_suggested", suggested: true, untried: !eaten,
        ...(w.facts.has(k) ? { contains: [...f.tags], contains_read: [...f.read] } : {}) }, by, ch);
    }
    // Library dishes read in this run (they were not read for every tag): kept, so the next week does not read them again.
    for (const row of library) {
      if (isVariantRow(row)) continue;
      const f = w.facts.get(row.key);
      if (f && !w.newDishes.has(row.key)) upsertLibrary(tx, { name: row.name, slot: row.slot, contains: [...f.tags], contains_read: [...f.read] }, by, ch);
    }
    for (const d of days.filter((x) => !x.fixed && !emptyAddon(x))) {
      const note = [notesBy.get(`${d.date}|${d.slot}`), ...d.fasting].filter(Boolean).join("; ") || null;
      saveSlotDay(tx, { date: d.date, slot: d.slot, people: d.people, guests: d.guests, occasion: d.occasion, new_dishes_allowed: d.new_dishes_allowed,
        skip: d.skip, status: "planned", edited: d.edited, note, dishes: d.skip ? [] : d.dishes.map((name) => ({ dish: name, new: w.newDishes.has(dishKey(name)), not_for: notFor(w, d, name),
          note: (dishNotes.get(`${d.date}|${d.slot}|${dishKey(name)}`) ?? []).join("; ") || null,
          ingredients: (got.get(`${d.date}|${d.slot}|${dishKey(name)}`) ?? []).map(({ item, amount, unit }) => ({ item, amount, unit })) })) }, by, ch);
    }
    for (const row of listLibrary(tx).filter((x) => x.untried)) {
      const n = toPlan.filter((d) => same(d.slot, row.slot) && d.dishes.some((x) => dishKey(x) === row.key)).length;
      const was = back.get(`${row.slot.toLowerCase()}|${row.key}`) ?? 0;
      if (n || was) upsertLibrary(tx, { name: row.name, slot: row.slot, offers: Math.max(0, row.offers - was) + n }, by, ch);
    }
  });

  // A dish kept back early on several days is said once: "Pappu at Dinner comes back sooner than usual (Tue, Wed, Thu)".
  const BACK = " comes back sooner than usual";
  const backs = new Map<string, { slot: string; dish: string; days: string[] }>();
  for (const u of uniq(unmet)) {
    if (!u.endsWith(BACK) || !u.includes(": ")) continue;
    const head = u.slice(0, u.indexOf(": ")), dish = u.slice(u.indexOf(": ") + 2, -BACK.length);
    const day = head.slice(0, head.indexOf(" ")), slot = head.slice(head.indexOf(" ") + 1);
    const k = `${slot}|${dishKey(dish)}`;
    backs.set(k, { slot, dish, days: [...(backs.get(k)?.days ?? []), day] });
  }
  if (backs.size) unmet.splice(0, unmet.length, ...uniq(unmet).filter((u) => !u.endsWith(BACK)),
    ...[...backs.values()].map((x) => (x.days.length === 1 ? `${x.days[0]} ${x.slot}: ${x.dish}${BACK}` : `${x.dish} at ${x.slot}${BACK} (${x.days.join(", ")})`)));

  // 6. The message. One question at most (owner 25 Nov): the slots too thin for their week, the thinnest first (owner 23 Nov),
  // not a line in unmet, and the calendar entries the plan could not read, folded together. A new dish is said with the
  // family's dish it stands in for, never the model's reason.
  const question = planQuestion({ short: only ? [] : shortAsks(feas.short, slots, toPlan, w), events: read.asked });
  const asked = question ? [question] : [];
  const newDishes = [...w.newDishes.values()].map((v) => ({ name: v.name, like: v.like ?? null }));
  const relaxed = Object.fromEntries([...w.slots.values()].filter((x) => x.window !== REPEAT_WINDOW_DAYS && order.includes(x.slot.name)).map((x) => [x.slot.name, x.window]));
  const relaxedOut = Object.keys(relaxed).length ? { relaxed } : {};
  if (only) {
    const message = changeMessage({
      meals: days.filter((d) => !d.fixed && !emptyAddon(d)).map((d) => ({ label: `${weekdayLong(d.date)} ${d.slot}`, skip: d.skip,
        dishes: d.dishes.map((name) => ({ name, not_for: notFor(w, d, name), note: (dishNotes.get(`${d.date}|${d.slot}|${dishKey(name)}`) ?? []).join("; ") || null })) })),
      unmet: uniq(unmet), new_dishes: newDishes, link: weekLink(deps.basePath, weekStart) });
    return done({ ok: true, week_start: weekStart, message, instructions: "Send message to the family word for word, as one message, then end your turn.",
      ...(unmet.length ? { unmet: uniq(unmet) } : {}), ...(asked.length ? { asked } : {}), ...(noIngredients.length ? { no_ingredients: noIngredients } : {}), ...relaxedOut });
  }
  const closed = closeWeek(db, weekStart, deps.basePath, unmet);
  const standing = rules.filter((r) => r.what === "note" && !r.hard).map(noteLine);
  const message = planMessage({
    days: weekDates(weekStart).filter((d) => d >= from).map((date) => ({ label: weekdayLong(date), meals: days.filter((d) => d.date === date && !d.fixed && !emptyAddon(d)).map((d) => ({
      slot: d.slot, skip: d.skip, note: [notesBy.get(`${d.date}|${d.slot}`), ...d.fasting].filter(Boolean).join("; ") || null,
      dishes: d.dishes.map((name) => ({ name, not_for: notFor(w, d, name), note: (dishNotes.get(`${d.date}|${d.slot}|${dishKey(name)}`) ?? []).join("; ") || null })) })) })),
    standing, unmet: uniq(unmet), new_dishes: newDishes, question, link: weekLink(deps.basePath, weekStart),
  });
  return done({ ok: true, week_start: weekStart, message, ...(closed.intro ? { intro: closed.intro } : {}), instructions: closed.instructions,
    ...(unmet.length ? { unmet: uniq(unmet) } : {}), ...(asked.length ? { asked } : {}), ...(noIngredients.length ? { no_ingredients: noIngredients } : {}), ...relaxedOut });
}

/** At most this many meals short of dishes are named in the plan's question. */
export const SHORT_QUESTIONS_MAX = 2;

/** The slots too thin for their week (the feasibility check's `short`) as the plan's one question names them, the thinnest
 *  first, at most SHORT_QUESTIONS_MAX: the meal's name as said ("dinner", "Kabir's tiffin") and whether new dishes were
 *  placed there (owner 25 Nov: "I know only a few dishes for dinner and Kabir's tiffin, so I've added some new ones"). */
export function shortAsks(short: ShortSlot[], slots: Slot[], planned: PlanDay[], w: Week): ShortAsk[] {
  const ratio = (x: ShortSlot) => (x.places ? x.supply / x.places : 1);
  return [...short].sort((a, b) => ratio(a) - ratio(b) || a.known - b.known).slice(0, SHORT_QUESTIONS_MAX).map((x) => {
    const slot = slots.find((s) => same(s.name, x.slot));
    const added = planned.some((d) => same(d.slot, x.slot) && d.dishes.some((dish) => { const nw = w.newDishes.get(dishKey(dish)); return !!nw && same(nw.slot, x.slot); }));
    return { meal: slot?.kind === "main" ? x.slot.toLowerCase() : x.slot, added };
  });
}

/** A note rule as said: "Asha: less spicy", the name only when the family's words do not have it. */
const noteLine = (r: Rule): string => (r.who && !r.quote.toLowerCase().includes(r.who.toLowerCase()) ? `${r.who}: ${r.quote}` : r.quote);

/** A rule as the slot call reads it: whose, the family's words, and what code checks of it (a soft one with its count so far). */
function ruleLine(r: Rule, w: Week, slot: string): string {
  const what = ["avoid", "veg", "no_eggs", "egg"].includes(r.what) ? `never: ${forbidden(r).join(", ")}`
    : r.what === "swap" ? `${r.to ?? "something else"} in place of ${(r.items ?? []).join(", ")}`
    : r.what === "require" ? `one of ${(r.items ?? []).join(", ")}` : r.what === "only" ? `only ${(r.items ?? []).join(", ")}`
    : r.what === "cap" && r.per_meal ? `at most ${r.per_meal} dishes a meal` : "";
  const range = !r.hard ? frequencyRange(r.frequency) : null;
  let count = "";
  if (range) {
    const want = (r.what === "swap" ? [r.to ?? ""] : r.items ?? []).map(canonTag);
    const elsewhere = w.days.filter((d) => !same(d.slot, slot) && (d.fixed || w.done.has(d.slot.toLowerCase())) && (!r.who || d.people.some((p) => same(p, r.who!)))
      && d.dishes.some((x) => want.some((t) => factsOf(w, d.slot, x).tags.has(t)))).length;
    count = `; ${range[0]}–${range[1]} times a week, ${elsewhere} so far at other meals, so ${Math.max(0, range[0] - elsewhere)}–${Math.max(0, range[1] - elsewhere)} more here or at a later meal`;
  }
  return `${r.who ?? "everyone"}: ${r.quote}${what ? ` [${what}]` : ""}${r.days?.length ? ` (on ${r.days.join(", ")})` : ""}${count}`;
}

/** The problems by kind, for the log. */
function kindsOf(problems: Map<string, Problem[]>): string {
  const n = new Map<string, number>();
  for (const ps of problems.values()) for (const p of ps) n.set(p.kind, (n.get(p.kind) ?? 0) + 1);
  return n.size ? [...n].map(([k, v]) => `${k} ${v}`).join(", ") : "none";
}

/** make_plan { week_start, household?, suggest_new? }: the week planned in steps (makePlan), saved; answers { ok, week_start, message, intro?,
 *  instructions, unmet?, asked? } or { ok: false, reason, say }. `platform`: the SDK's platform context, read at each call for the
 *  fresh household and the calendar (an older SDK has neither). */
export function mountMakePlanRoute(hono: Hono<any>, db: Db, emit: Emit, opts: { basePath: string; model: ModelCall; now?: () => Date; platform?: () => unknown;
  sqlite?: MakePlanDeps["sqlite"] }) {
  const write = writeRoutes(hono);
  write("/api/weeks/:week_start/make-plan", async (b, _by, c) => {
    const weekStart = dateOf(c.req.param("week_start"), "week_start");
    if (weekdayOf(weekStart) !== "Mon") refuse(`week_start must be a Monday: ${weekStart} is a ${weekdayOf(weekStart)}`);
    const today = todayStr((opts.now ?? (() => new Date()))());
    if (addDays(weekStart, 6) < today) refuse(`the week of ${weekStart} is over: plan this week or a later one`);
    return { body: await makePlan({ db, emit, model: opts.model, weekStart, today, basePath: opts.basePath, budgetMs: OP_BUDGET_MS,
      household: b.household, peers: opts.platform ? platformPeers(opts.platform()) : undefined, sqlite: opts.sqlite, suggest_new: b.suggest_new === true }) };
  });
}
