// The week's plan on the kinds model (docs/kinds-model-build.md; docs/slot-model-spec.md §5), made in steps the app's code
// drives (make_plan, and the Sunday run). Code plans the week; the model only reads words and lists ingredients:
//   1. the week's slot-days in code (planDays.ts): who each slot is for on each day, from the slots, the weekday patterns,
//      the calendar (or the household's dated stays: one fast call for entries code cannot read), fasts and the meals eaten
//      out; a slot-day the family changed is kept;
//   2. what the dishes contain: the family's dishes never read for a rule's item (one fast call, batched; the catalog reads
//      a dish it knows), and the guests' food rules (one fast call when guests come);
//   3. the week filled by code from each meal's templates (fillWeek.ts): a template a day, each part an item of the family's
//      in rotation, a brand-new variant from the catalog only when theirs have all come; every known food rule kept, nobody
//      left with nothing; the cook's visits kept to her dish limit where a template fits (an over-limit day is said). A dish
//      whose fit for someone's rule is not known is planned and asked (one meaning model, spec §5.2: unknown = plan and ask,
//      allergies included, named first); a swap's item is saved for its person (for_people);
//   4. each day's ingredients from one fast call, an avoided ingredient taken out; saved in one transaction;
//   5. the message: the week by day, standing notes once, what could not be kept, the new dishes, the one question (meals
//      short of dishes, the dishes to check, calendar entries).
// One run per week at a time: a second make_plan for the same week joins the one running, and a run never starts a model
// call on top of one still running from before (Flock's SDK cannot abort a call). Nothing here messages anyone.
import type { Hono } from "hono";
import { asc, eq } from "drizzle-orm";
import { _settings } from "@flock/app-kit";
import { house, people as people_t } from "./db/schema";
import { CONTAINS_BATCH } from "./db/constants";
import { addDays, todayStr, weekDates, weekdayLong, weekdayOf, WEEKDAYS, type Weekday } from "./dates";
import { dishKey } from "./dishText";
import { closeWeek, dateOf } from "./meals";
import { changeMessage, planMessage, planQuestion, weekLink, type CheckAsk } from "./messages";
import { cookVisits, isObject, list, refuse, writeRoutes, type Db, type Emit } from "./family";
import { STOP_CODES, stopSaid, type ModelCall, type ModelFailure, type ModelRequest, type ModelResult } from "./model";
import { commit, deleteSlotDays, listLibrary, listRules, listSlotDays, listSlots, saveSlotDay, slotHistory, upsertLibrary, type LibraryDish,
  type Rule, type Slot } from "./slotStore";
import { buildDays, replacedMeal, slotDayKey, lunchSaid, platformPeers, readEvents, readHousehold, withLunchSaid, type PlanDay, type Peers } from "./planDays";
import { canonTag, allergyNotes, forbidden, isDropped, mostlyOnion, notFor, plannable, readFor, ruleTags, slotFacts, softSwapNotes, swapNotes,
  ruleBinds, vouched, withParents, type Week } from "./planChecks";
import { CATALOG_READ, catalogNameOf, fillWeek, type FillResult, type Visit } from "./fillWeek";
import { catalogItem, isLinkedPart } from "./kinds";
import { isAllergyRule } from "./allergy";
import { plainPlate } from "./migrateMeaning";

export type MakePlanResult =
  | { ok: true; week_start: string; message: string; intro?: string; instructions: string; unmet?: string[]; asked?: string[]; no_ingredients?: string[];
    }
  | { ok: false; reason: string; say: string; /** A question for the family (no_dishes). */ ask?: string };
type Ingredient = { item: string; amount: number | null; unit: string | null };
type Failure = Extract<ModelResult, { ok: false }>;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const isStop = (code: ModelFailure) => (STOP_CODES as readonly string[]).includes(code);
const uniq = <T>(xs: T[]) => [...new Set(xs)];
const andList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()) : []);

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

// ── The cook's visits (spec §9.3) ──

/** The cook's visits the fill keeps to a dish limit: one per visit of the cook's with a hard cap rule whose meals are all made
 *  in that visit (a visit with no meals said makes them all). Its meals: the rule's, and the boxes and add-ons cooked with them
 *  (a box replacing one of them, an add-on of one, a slot with a part linked to one); `cap` the rule's per_meal (the least
 *  when two fit); its days the rule's, else the cook's (`days`), else every day; `label` the main meals ("breakfast and
 *  lunch"). No cook, or no cap rule: none. */
export function visitsOf(rules: Rule[], cook: { name: string | null; visits: { at: string; meals?: string[] }[]; days?: Weekday[] } | null, slots: Slot[]): Visit[] {
  if (!cook) return [];
  const caps = rules.filter((r) => r.hard && r.what === "cap" && !!r.per_meal && !!r.slots?.length);
  const out: Visit[] = [];
  for (const v of cook.visits) {
    const made = (n: string) => !v.meals?.length || v.meals.some((m) => same(m, n));
    const r = caps.filter((c) => c.slots!.every(made)).sort((a, b) => a.per_meal! - b.per_meal!)[0];
    if (!r) continue;
    const mains = uniq(r.slots!.map((n) => slots.find((x) => same(x.name, n))?.name ?? n.trim()));
    const ofMain = (n: string | null | undefined) => !!n && mains.some((m) => same(m, n));
    const withThem = slots.filter((x) => !ofMain(x.name) && (ofMain(x.addon_of) || ofMain(replacedMeal(x, slots)?.name)
      || (x.templates ?? []).some((t) => t.parts.some((p) => isLinkedPart(p) && ofMain(p.from))))).map((x) => x.name);
    out.push({ cook: cook.name, meals: [...mains, ...withThem], days: r.days?.length ? [...r.days] : cook.days?.length ? [...cook.days] : [...WEEKDAYS],
      cap: r.per_meal!, label: andList(mains.map((m) => m.toLowerCase())) });
  }
  return out;
}
/** The house's cook as visitsOf reads it (without making the house row); none saved: null. */
function houseCook(db: Db): { name: string | null; visits: { at: string; meals?: string[] }[]; days: Weekday[] } | null {
  try {
    const row = db.select({ name: house.cook_name, days: house.cook_days, arrival: house.cook_arrival }).from(house).orderBy(asc(house.created_at)).limit(1).get();
    if (!row?.name) return null;
    return { name: row.name, visits: cookVisits(row.arrival), days: list<Weekday>(row.days) };
  } catch { return null; }
}

/** The plan's dishes to check (fillWeek's unknowns), one per dish, person and tag, by its first date then meal. */
function checksOf(unknowns: FillResult["unknowns"], slots: Slot[]): CheckAsk[] {
  const order = (n: string) => slots.find((x) => same(x.name, n))?.order ?? 0;
  const by = new Map<string, CheckAsk>();
  for (const u of [...unknowns].sort((a, b) => a.date.localeCompare(b.date) || order(a.slot) - order(b.slot))) {
    const k = `${dishKey(u.dish)}|${u.who.toLowerCase()}|${u.tag}`, had = by.get(k);
    if (!had) by.set(k, { dish: u.dish, who: u.who, tag: u.tag, allergy: u.allergy });
    else if (u.allergy) had.allergy = true;
  }
  return [...by.values()];
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
/** Kept back from the reads for the ingredients (asked for every day at once) and the save. */
const INGREDIENTS_RESERVE_MS = 90_000, SAVE_RESERVE_MS = 5_000;

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

  // 2. The family's dishes and each meal's history (its seed plates and what was planned or kept there before).
  const library = listLibrary(db);
  const histories = new Map(slots.map((s) => [s.name.toLowerCase(), slotHistory(db, s.name, weekStart)]));
  const order = slots.filter((s) => days.some((d) => same(d.slot, s.name) && !d.fixed)).map((s) => s.name);
  // Never a plan from an empty library (#29): a meal with no shape of its own, none of the family's dishes and no plate of
  // theirs is asked about, unless they said to suggest new dishes there. Only when no meal is known does it stop the plan:
  // else that meal is left out of the week and named in the plan's one question (owner 25 Nov).
  const known = (n: string) => { const s = slots.find((x) => same(x.name, n))!;
    return s.kind === "addon" || !!s.templates?.length || slotFacts(s, library, histories.get(n.toLowerCase()) ?? []).plates.length > 0
      || library.some((d) => same(d.slot, n) && plannable(d)); };
  const unknown = order.filter((n) => !known(n));
  const leftOut: string[] = [];
  if (unknown.length && !deps.only && !deps.suggest_new) {
    if (unknown.length === order.length) return done({ ok: false, reason: "no_dishes", ask: noDishesAsk(unknown), say: noDishesAsk(unknown) });
    const out = (n: string) => unknown.some((u) => same(u, n)) || (() => { const s = slots.find((x) => same(x.name, n)); return s?.kind === "addon" && !!s.addon_of && unknown.some((u) => same(u, s.addon_of!)); })();
    for (const xs of [days, toPlan]) for (let i = xs.length - 1; i >= 0; i--) if (!xs[i].fixed && out(xs[i].slot)) xs.splice(i, 1);
    for (const n of order.filter(out)) leftOut.push(n);
    log(`no dishes known for ${leftOut.join(", ")}: left out of this week, asked`);
  }
  // They said to suggest some (their answer to the no_dishes question): a meal with nothing of theirs is planned this once from
  // a plain plate of that meal, its dishes new (never saved as their templates).
  const suggested = deps.suggest_new ? unknown.filter((n) => { const s = slots.find((x) => same(x.name, n)); return !!s && s.kind !== "addon" && !s.templates?.length; }) : [];
  for (const n of suggested) { const i = slots.findIndex((x) => same(x.name, n)); slots[i] = { ...slots[i], templates: plainPlate(slots[i], slots) }; }
  if (suggested.length) log(`suggesting new dishes for ${suggested.join(", ")}: a plain plate of each`);
  const unmet: string[] = [];
  const tags = ruleTags(rules);
  const w: Week = { days, slots: new Map(slots.map((s) => [s.name.toLowerCase(), slotFacts(s, library, histories.get(s.name.toLowerCase()) ?? [])])), rules, library,
    facts: new Map(), done: new Set(), newDishes: new Map() };
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

  /** A library dish not read for every tag the hard rules name (setup ran out of time before it read them: onboarding run
   *  26). A dish the catalog knows is read by it for the catalog's tags. */
  const hardTags = uniq(rules.filter((r) => r.hard).flatMap(forbidden));
  const unreadIn = (d: LibraryDish) => {
    const read = new Set([...d.contains_read.map(canonTag), ...(catalogNameOf(d) || catalogItem(d.name) ? CATALOG_READ : [])]);
    return hardTags.some((t) => !readFor(read, t));
  };
  /** Read what the dishes contain, in batches (what is not read fails closed). */
  const readNow = new Set<string>();
  const readContains = async (dishes: string[]): Promise<Failure | null> => {
    const names = uniq(dishes.map(dishKey)).filter((k) => !w.facts.has(k)).map((k) => dishes.find((x) => dishKey(x) === k)!);
    for (let i = 0; i < names.length; i += CONTAINS_BATCH) {
      const batch = names.slice(i, i + CONTAINS_BATCH);
      const r = await model({ tier: "fast", purpose: "meal plan: what dishes contain", system: CONTAINS_SYSTEM, schema: CONTAINS_SCHEMA, maxTokens: 3000,
        user: JSON.stringify({ tags, dishes: batch }) }, INGREDIENTS_RESERVE_MS);
      if (!r.ok) { log(`contains read failed (${r.code}) for ${batch.join(", ")}`); if (isStop(r.code)) return r; continue; }
      const raw = isObject(r.json) && Array.isArray(r.json.dishes) ? r.json.dishes : [];
      for (const x of raw) {
        if (!isObject(x) || typeof x.dish !== "string" || !batch.some((y) => dishKey(y) === dishKey(x.dish as string))) continue;
        const key = dishKey(x.dish);
        // A tag's family counts: "chicken: yes" is meat whatever the read said of meat (a child's yes wins over a parent's no).
        const has = strs(x.has).map(canonTag).filter((t) => [...withParents([t])].some((y) => tags.includes(y)));
        const implied = withParents(has);
        const not = strs(x.not).map(canonTag).filter((t) => tags.includes(t) && !implied.has(t));
        // A library dish keeps what it was read for already.
        const row = library.find((d) => d.key === key);
        w.facts.set(key, { tags: withParents([...(row?.contains ?? []), ...has]), read: new Set([...(row?.contains_read ?? []).map(canonTag), ...implied, ...not]) });
        readNow.add(key);
      }
    }
    return null;
  };
  // The library's dishes not read for every tag are read now (one meaning model: no careful allergy read; what stays unknown
  // is planned and asked).
  const unread = library.filter((d) => !isDropped(d) && !d.disliked && unreadIn(d)).map((d) => d.name);
  if (unread.length) log(`contains: ${unread.length} library dishes not read for every tag: reading them first`);
  const f1 = unread.length ? await readContains(unread) : null;
  if (f1) return stopped(f1);

  // 3. The week filled by code from the templates; the cook's visits kept to her limit where a template fits; what is not
  // known for someone's rule comes back in unknowns, asked in the one question.
  const t0 = clock();
  const visits = visitsOf(rules, houseCook(db), slots);
  const filled: FillResult = fillWeek({ days, slots, library, history: histories, rules, cuisines: houseCuisines(db), newCap: newDishesSet(db),
    facts: w.facts, guestTags: w.guestTags, visits, suggested });
  for (const line of filled.log) log(line);
  log(`filled ${toPlan.length} slot-days in ${clock() - t0} ms: ${filled.placed.length} new dishes placed`);
  for (const [k, v] of filled.facts) if (!w.facts.has(k)) w.facts.set(k, v);
  if (filled.ownItems) w.ownItems = filled.ownItems;
  unmet.push(...filled.unmet);
  /** Each placed dish's own fields (new, not for, its note, who it is for), by date|slot|dish key. */
  const placedAs = new Map<string, { new: boolean; not_for: string[]; note: string | null; for_people: string[] }>();
  const forOf = (d: PlanDay, name: string): string[] => placedAs.get(`${d.date}|${d.slot}|${dishKey(name)}`)?.for_people ?? [];
  /** Who a dish is not for: among its own people when it is only for some (a swap's item). */
  const notForOf = (d: PlanDay, name: string): string[] => { const f = forOf(d, name); return notFor(w, f.length ? { ...d, people: f } : d, name); };
  for (const d of toPlan) {
    const plate = filled.plates.get(slotDayKey(d.date, d.slot)) ?? [];
    d.dishes = plate.map((x) => x.name);
    for (const x of plate) placedAs.set(`${d.date}|${d.slot}|${dishKey(x.name)}`, x);
  }
  /** The new dishes, by key: where first placed, its kind, and the family's item it stands in for. */
  const newDishes = new Map<string, { name: string; slot: string; like: string | null; kind: string; sub: string | null }>();
  for (const p of filled.placed) if (!newDishes.has(dishKey(p.dish))) newDishes.set(dishKey(p.dish), { name: p.dish, slot: p.slot, like: p.like, kind: p.kind, sub: p.sub });
  // An add-on day left empty (its people eat the main meal's dishes that day) is no slot-day: nothing saved, said or bought.
  const emptyAddon = (d: PlanDay) => !d.fixed && !d.skip && !d.dishes.length && slots.find((s) => same(s.name, d.slot))?.kind === "addon";
  const empty = toPlan.filter((d) => !d.dishes.length && !emptyAddon(d));
  if (toPlan.length && empty.length === toPlan.length)
    return done({ ok: false, reason: "no_dishes", say: `I couldn't plan the week: I don't know any dishes for ${andList(uniq(empty.map((d) => d.slot.toLowerCase())))} yet. Tell me a few you usually have.` });

  // Notes on dishes: onion and garlic left out or a portion kept aside (contract rule 7), a hard swap's ("millet in place of
  // white rice for ..."), and one person's allergy kept aside on a family dish that has it ("Ishaan's Poha without peanuts").
  const dishNotes = new Map<string, string[]>();   // date|slot|dish key
  const noteOn = (d: PlanDay, dish: string, t: string) => { const k = `${d.date}|${d.slot}|${dishKey(dish)}`; dishNotes.set(k, uniq([...(dishNotes.get(k) ?? []), t])); };
  // (An item of a category the family named is checked like any catalog item, decided 21: the fill's note says what to make
  // it without.)
  for (const d of toPlan) for (const dish of d.dishes) {
    const own = placedAs.get(`${d.date}|${d.slot}|${dishKey(dish)}`)?.note;
    for (const t of [...(own ? own.split("; ") : []), ...swapNotes(w, d, dish), ...allergyNotes(w, d, dish)]) noteOn(d, dish, t);
  }
  // A soft swap with a count the week falls short of, kept by a note on some of the person's days.
  for (const [k, t] of softSwapNotes(w)) { const [date, slot] = k.split("|"); const d = toPlan.find((x) => x.date === date && same(x.slot, slot)); const dish = d?.dishes.find((x) => k.endsWith(`|${dishKey(x)}`)); if (d && dish) noteOn(d, dish, t); }

  // 5. Each day's ingredients, one fast call a day (all days at once), once more for what it left out.
  const got = new Map<string, (Ingredient & { tags: string[] })[]>();   // date|slot|dish key
  const noIngredients: string[] = [];
  const hardAt = (d: PlanDay, p: string) => rules.filter((r) => r.hard && r.what !== "swap" && (!r.who || same(r.who, p)) && ruleBinds(r, d.date, w.slots.get(d.slot.toLowerCase())?.slot, d.slot));
  /** The tags a rule takes out of a dish's ingredients: onion and garlic stay where a portion is kept aside (contract rule 7). */
  const avoided = (r: Rule, dish: string) => forbidden(r).filter((t) => t !== "onion_garlic" || isAllergyRule(r) || mostlyOnion(dish));
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
      // A family dish one person's allergy is kept aside for: the rest of the family has it as made (its note says so).
      if (isAllergyRule(r) && r.who && vouched(w, r, dish)) continue;
      // Onion and garlic stay bought (contract rule 7): the dish says how their portion is kept.
      // (Once per person: the fill's note may already name them.)
      const said = (dishNotes.get(k) ?? []).some((t) => t.startsWith("make without onion and garlic") && t.split(/,|\band\b/).some((x) => x.includes(p)));
      if (forbidden(r).includes("onion_garlic") && !avoided(r, dish).includes("onion_garlic") && left.some((i) => i.tags.includes("onion_garlic")) && d.people.length > 1 && !said)
        noteOn(d, dish, `make without onion and garlic, or keep ${p}'s portion aside`);
      const out = left.filter((i) => i.tags.some((t) => avoided(r, dish).includes(t)));
      if (!out.length) continue;
      if (out.length * 2 > list.length) { log(`${weekdayOf(d.date)} ${d.slot} ${dish}: the ingredients read tags ${out.length} of ${list.length} against ${p}'s rule; not believed, kept`); continue; }
      left = left.filter((i) => !out.includes(i));
      log(`${weekdayOf(d.date)} ${d.slot} ${dish}: took out ${out.map((i) => i.item).join(", ")} (${p})`);
      // (Not said twice: the fill's "make without cashews for <person>" already says it.)
      if (r.who && d.people.length > 1 && !(dishNotes.get(k) ?? []).some((t) => t.startsWith("make without") && t.includes(p)))
        noteOn(d, dish, `no ${andList(uniq(out.map((i) => i.item.toLowerCase())))} for ${p}`);
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
    // A new variant placed: a library row of the planner's, untried, with its kind and catalog item, and what it contains.
    for (const [k, v] of newDishes) {
      const f = w.facts.get(k);
      const eaten = library.some((x) => x.key === k && !x.untried);
      upsertLibrary(tx, { name: v.name, slot: v.slot, origin: "planner_suggested", suggested: true, untried: !eaten, kind: v.kind, sub: v.sub, catalog_item: v.name,
        ...(f ? { contains: [...f.tags], contains_read: [...f.read] } : {}) }, by, ch);
    }
    // A catalog item of a category the family named ("dal", "a poriyal"), placed: theirs, kept in their library like a dish they named.
    for (const v of filled.named) {
      const k = dishKey(v.dish);
      if (library.some((x) => x.key === k) || newDishes.has(k)) continue;
      const f = w.facts.get(k);
      upsertLibrary(tx, { name: v.dish, slot: v.slot, origin: "planner_suggested", suggested: false, untried: false, kind: v.kind, sub: v.sub, catalog_item: v.dish,
        ...(f ? { contains: [...f.tags], contains_read: [...f.read] } : {}) }, by, ch);
    }
    // Library dishes read by a model in this run (they were not read for every tag): kept, so the next week does not read them again.
    for (const row of library) {
      const f = readNow.has(row.key) ? w.facts.get(row.key) : undefined;
      if (f && !newDishes.has(row.key)) upsertLibrary(tx, { name: row.name, slot: row.slot, contains: [...f.tags], contains_read: [...f.read] }, by, ch);
    }
    for (const d of days.filter((x) => !x.fixed && !emptyAddon(x))) {
      const note = d.fasting.join("; ") || null;
      saveSlotDay(tx, { date: d.date, slot: d.slot, people: d.people, guests: d.guests, occasion: d.occasion, new_dishes_allowed: d.new_dishes_allowed,
        skip: d.skip, status: "planned", edited: d.edited, note, dishes: d.skip ? [] : d.dishes.map((name) => ({ dish: name, new: placedAs.get(`${d.date}|${d.slot}|${dishKey(name)}`)?.new ?? false, not_for: notForOf(d, name),
          note: (dishNotes.get(`${d.date}|${d.slot}|${dishKey(name)}`) ?? []).join("; ") || null, for_people: forOf(d, name),
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
  // The dishes to check (spec §9.1): the whole week's, allergies first (a change's re-plan only says what it planned).
  const planned = new Set(toPlan.map((d) => slotDayKey(d.date, d.slot)));
  const checks = only ? [] : checksOf(filled.unknowns.filter((u) => planned.has(slotDayKey(u.date, u.slot))), slots);
  if (checks.length) log(`to check: ${checks.map((c) => `${c.dish} for ${c.who} (${c.tag}${c.allergy ? ", allergy" : ""})`).join("; ")}`);
  const question = planQuestion({ short: only ? [] : [...leftOut.filter((n) => slots.find((s) => same(s.name, n))?.kind !== "addon")
    .map((n) => ({ meal: slots.find((s) => same(s.name, n))?.kind === "main" ? n.toLowerCase() : n, added: false }))], checks, events: read.asked });
  const asked = question ? [question] : [];
  // One entry a placement, with its day and meal (the message names the weekday).
  const newNamed = filled.placed.filter((p) => toPlan.some((d) => d.date === p.date && same(d.slot, p.slot) && d.dishes.some((x) => dishKey(x) === dishKey(p.dish))))
    .map((p) => ({ name: p.dish, dish: p.dish, date: p.date, slot: p.slot, like: p.like }));
  if (only) {
    const message = changeMessage({
      meals: days.filter((d) => !d.fixed && !emptyAddon(d)).map((d) => ({ label: `${weekdayLong(d.date)} ${d.slot}`, skip: d.skip,
        dishes: d.dishes.map((name) => ({ name, not_for: notForOf(d, name), note: (dishNotes.get(`${d.date}|${d.slot}|${dishKey(name)}`) ?? []).join("; ") || null,
          for_people: forOf(d, name) })) })),
      unmet: uniq(unmet), new_dishes: newNamed, link: weekLink(deps.basePath, weekStart) });
    return done({ ok: true, week_start: weekStart, message, instructions: "Send message to the family word for word, as one message, then end your turn.",
      ...(unmet.length ? { unmet: uniq(unmet) } : {}), ...(asked.length ? { asked } : {}), ...(noIngredients.length ? { no_ingredients: noIngredients } : {}) });
  }
  const closed = closeWeek(db, weekStart, deps.basePath, unmet);
  const standing = rules.filter((r) => r.what === "note" && !r.hard).map(noteLine);
  const message = planMessage({
    days: weekDates(weekStart).filter((d) => d >= from).map((date) => ({ label: weekdayLong(date), meals: days.filter((d) => d.date === date && !d.fixed && !emptyAddon(d)).map((d) => ({
      slot: d.slot, skip: d.skip, note: d.fasting.join("; ") || null,
      dishes: d.dishes.map((name) => ({ name, not_for: notForOf(d, name), note: (dishNotes.get(`${d.date}|${d.slot}|${dishKey(name)}`) ?? []).join("; ") || null,
        for_people: forOf(d, name) })) })) })),
    standing, unmet: uniq(unmet), new_dishes: newNamed, question, link: weekLink(deps.basePath, weekStart),
  });
  return done({ ok: true, week_start: weekStart, message, ...(closed.intro ? { intro: closed.intro } : {}), instructions: closed.instructions,
    ...(unmet.length ? { unmet: uniq(unmet) } : {}), ...(asked.length ? { asked } : {}), ...(noIngredients.length ? { no_ingredients: noIngredients } : {}) });
}

/** A note rule as said: "Asha: less spicy", the name only when the family's words do not have it. */
const noteLine = (r: Rule): string => (r.who && !r.quote.toLowerCase().includes(r.who.toLowerCase()) ? `${r.who}: ${r.quote}` : r.quote);

/** The house's cuisine profile (kinds model: regional items only within it); none read yet: none. */
function houseCuisines(db: Db): string[] {
  try { const row = db.select({ cuisines: house.cuisines }).from(house).orderBy(asc(house.created_at)).limit(1).get(); return row?.cuisines ? list<string>(row.cuisines) : []; }
  catch { return []; }
}
/** The family's new-dishes-a-week setting, only when they set it (a settings row): its default does not cap the plan. */
function newDishesSet(db: Db): number | null {
  try {
    const row = db.select({ value: _settings.value }).from(_settings).where(eq(_settings.key, "new_dishes_per_week")).get();
    const v = row?.value ? JSON.parse(row.value) : null;
    return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
  } catch { return null; }
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
