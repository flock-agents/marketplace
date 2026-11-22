// The week's plan, made in steps the app's code drives (make_plan, and the Sunday run): one long agent session following an
// eight-step prompt failed in every simulated run (cut off with half a week sent, repeats not fixed in two closing rounds,
// meals with no dish). Now:
//   a. each meal of the week, worked out in code: who eats it, that meal's family dishes, the rules that hold there, the cook;
//   b. the menu from one model call per meal of the day (Breakfast, Lunch, Dinner, each extra slot), all at once (live run
//      2026-11-23: one call for the whole week took 140-260 s, often with no JSON at all), assembled into the week and
//      checked in code with plan_menu's own checks, that every meal has a dish and that everyone who eats a meal has a
//      main dish there; a refusal sends back only the meals that fail, with why, again one call per meal of the day, at
//      most MENU_ROUNDS rounds; then code swaps each meal still failing for a family dish that passes, and where the rules
//      cannot all be kept (three breakfast dishes for seven days), takes the least bad and says so (`unmet`);
//   c. each day's ingredients from one cheap model call, tried once more on its own when it fails; an ingredient a person
//      avoids is taken out of the dishes they eat (noted on a shared dish);
//   d. the week saved final and closed as the closing plan_week call does: `message` and, the first time, `intro`.
// One run per week at a time: a second make_plan for the same week joins the one running, and a run never starts a model
// call on top of one still running from before (Flock's SDK cannot abort a call: the platform works on until it answers).
// Nothing here messages anyone: the caller sends `message` (the Sunday run wakes the agent only to deliver it).
import type { Hono } from "hono";
import { SLOTS } from "./db/constants";
import { addDays, todayStr, weekDates, weekdayOf } from "./dates";
import { dishKey } from "./dishText";
import { closest } from "./agentOps";
import { closeWeek, dateOf, isStaple, MAIN_DAYS_MAX, menuChecks, PLAN_METHOD, repeatedDays, saveWeek, weekContext, type WeekContext, type WeekView } from "./meals";
import { checkedAs, dinersOf, EVERYONE, hit, isCheckedFast, isSide, mealLabel, ruleText, type Rule } from "./rules";
import { refuse, writeRoutes, type Db, type Emit } from "./family";
import { STOP_CODES, stopSaid, type ModelCall, type ModelFailure, type ModelResult } from "./model";

/** How many times the menu goes to the model, the first time included, before code fixes what is left. */
export const MENU_ROUNDS = 5;

export type MenuDish = { name: string; for: string[]; except?: string[]; portion_note?: string | null };
export type MenuMeal = { date: string; slot: string; dishes: MenuDish[] };
/** One meal of the week to plan, worked out in code (step a). `ordered_in`: the family orders it in every week. */
/** `fasts`: who of `who` fasts at this meal (a checked fast): they eat nothing there. */
export type SlotNeed = { key: string; date: string; day: string; slot: string; who: string[]; rules: string[]; cook: string;
  family_dishes: { dish: string; for?: string[]; rating?: string }[]; ordered_in?: { note?: string }; fasts?: string[] };
/** What is wrong with one meal of the menu. A repeat weighs least: it is what the family can live with when nothing else fits.
 *  `uncovered`: people who eat the meal and have no main dish there (`people`). */
type Problem = { kind: "rule" | "repeat" | "eaters" | "empty" | "uncovered"; text: string; said: string; dish?: string; who?: string; people?: string[] };
type Ingredient = { item: string; amount: number | null; unit: string | null };

export type MakePlanResult =
  | { ok: true; week_start: string; message: string; intro?: string; instructions: string; unmet?: string[]; no_ingredients?: string[] }
  | { ok: false; reason: string; say: string };

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const keyOf = (date: string, slot: string) => `${date} ${slot}`;
const short = (n: { date: string; slot: string }) => `${weekdayOf(n.date)} ${n.slot}`;
const isStop = (code: ModelFailure) => (STOP_CODES as readonly string[]).includes(code);
const andList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
/** A dish that is no one's main: a side (chutney, curd) or a staple (rice, roti), which come with a main. */
const notMain = (name: string) => isSide(name) || isStaple(name);
/** Who eats at a meal: its diners but the ones who fast there. */
const eatingAt = (n: SlotNeed) => n.who.filter((p) => !(n.fasts ?? []).some((f) => same(f, p)));

// ── a. Each meal of the week, in code ──

/** Does a rule hold at this meal: its days (every day when none), its slots, and its person among the diners. A day in the
 *  family's own words ("Ekadashi") is kept with the rule: the model reads it. */
function ruleHolds(r: Rule, day: string, slot: string, who: string[]): boolean {
  const weekdays = r.days.filter((d) => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/.test(d));
  if (r.days.length && weekdays.length && !weekdays.includes(day)) return false;
  if (r.slots?.length && !r.slots.some((s) => same(s, slot))) return false;
  return !r.who || who.some((w) => same(w, r.who!));
}
const ruleWords = (r: Rule): string => {
  const text = (r.kind === "other" || (r.kind === "fasting" && !r.slots?.length)) && r.note ? `${r.who ? `${r.who}: ` : ""}${r.note}` : ruleText(r);
  return r.days.length && !r.days.every((d) => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/.test(d)) ? `${text} (${r.days.join(", ")})` : text;
};

/** Every meal of the week from `today` on, on the cooking days: Breakfast, Lunch, Dinner, and each extra slot on its days for its
 *  people; a meal the family orders in every week is ordered in. A meal everyone who eats it fasts at is no meal (live run
 *  2026-11-23: the father, alone at home, fasts Thursday breakfast and lunch; code could neither fill those meals nor keep
 *  his fast, and the plan ended "I don't know any dishes for breakfast, lunch"). */
export function slotNeeds(c: WeekContext, today: string): SlotNeed[] {
  const h = c.house, people = c.people.map((p) => ({ name: p.name }));
  const out: SlotNeed[] = [];
  for (const date of weekDates(c.week_start)) {
    const day = weekdayOf(date);
    if (date < today || !h.cooking_days.includes(day)) continue;
    const slots = [...SLOTS, ...h.extra_slots.filter((s) => !s.days?.length || s.days.includes(day)).map((s) => s.name)];
    for (const slot of slots) {
      const who = dinersOf(slot, people, h.extra_slots);
      const fasts = [...new Set(h.rules.filter((r) => isCheckedFast(r) && ruleHolds(r, day, slot, who)).map((r) => who.find((w) => same(w, r.who!))!))];
      if (fasts.length && who.every((w) => fasts.includes(w))) continue;
      const fam = Object.entries(c.family_dishes).find(([s]) => same(s, slot))?.[1] ?? [];
      const order = h.order_in.find((o) => o.day === day && same(o.slot, slot));
      const visit = h.cook_visits.find((v) => v.meals?.some((m) => same(m, slot)));
      const cook = !h.cook_name ? "the family cooks" : !h.cook_days.includes(day as never) ? `${h.cook_name} does not come: the family cooks`
        : visit ? `${h.cook_name} cooks it (comes at ${visit.at})` : `${h.cook_name} comes${h.cook_visits.length ? ` at ${h.cook_visits.map((v) => v.at).join(" and ")}` : ""}`;
      out.push({ key: keyOf(date, slot), date, day, slot, who, cook,
        rules: h.rules.filter((r) => ruleHolds(r, day, slot, who)).map(ruleWords),
        family_dishes: fam.filter((d) => !d.for?.length || d.for.every((p) => who.some((w) => same(w, p)))),
        ...(order ? { ordered_in: order.note ? { note: order.note } : {} } : {}), ...(fasts.length ? { fasts } : {}) });
    }
  }
  return out;
}

// ── b. The menu, checked ──

/** Who eats a dish as the model sent it, as plan_menu reads it: `["everyone"]`, names on the Family page, or everyone at the
 *  meal but `except`. Answers the names to keep (["everyone"] or the people), or what is wrong. */
export function eatersFor(d: MenuDish, who: string[], family: string[]): { for: string[] } | { problem: string } {
  const named = (d.for ?? []).map((w) => w.trim()).filter(Boolean);
  if (d.except?.length) {
    if (named.length && !(named.length === 1 && same(named[0], EVERYONE))) return { problem: `except goes with for: ["everyone"]` };
    const unknown = d.except.filter((o) => !who.some((p) => same(p, o)));
    if (unknown.length) return { problem: `except: ${unknown.map((u) => JSON.stringify(u)).join(", ")} does not eat this meal (${who.join(", ")})` };
    const rest = who.filter((p) => !d.except!.some((o) => same(o, p)));
    return rest.length ? { for: rest } : { problem: `everyone except ${d.except.join(", ")} leaves no one to eat it` };
  }
  if (!named.length) return { problem: `no for: say who eats it, ["everyone"] or the names` };
  if (named.some((w) => same(w, EVERYONE))) return named.length === 1 ? { for: [EVERYONE] } : { problem: `for: "everyone" goes alone` };
  const out: string[] = [], unknown: string[] = [];
  for (const w of named) {
    const p = family.find((x) => same(x, w));
    if (p) { if (!out.includes(p)) out.push(p); } else { const near = closest(w, family); unknown.push(`${JSON.stringify(w)} is not on the Family page${near ? ` (did you mean ${near}?)` : ""}`); }
  }
  return unknown.length ? { problem: `for: ${unknown.join(", ")}` } : { for: out };
}

/** The people who eat a dish at a meal, by name (["everyone"] read as the meal's diners), or null when its `for` is wrong. */
function dishEaters(d: MenuDish, n: SlotNeed, family: string[]): string[] | null {
  const e = eatersFor(d, n.who, family);
  return !("for" in e) ? null : e.for.length === 1 && same(e.for[0], EVERYONE) ? n.who : e.for;
}

/** The menu as a week the app's checks read (a WeekView with no rows behind it). */
function viewOf(weekStart: string, needs: SlotNeed[], menu: Map<string, MenuMeal>, family: string[]): WeekView {
  const meals = needs.map((n) => ({ id: "", date: n.date, slot: n.slot, ordered_in: !!n.ordered_in, note: n.ordered_in?.note ?? null,
    dishes: n.ordered_in ? [] : (menu.get(n.key)?.dishes ?? []).map((d) => {
      const e = eatersFor(d, n.who, family);
      return { id: "", name: d.name, for_people: "for" in e ? e.for : null, portion_note: d.portion_note ?? null, recipe_id: null, video_url: null, video: null,
        last_time: null, ingredients: [] };
    }) }));
  return { week_start: weekStart, status: "draft", planned_at: null, days: weekDates(weekStart).map((date) => ({ date, meals: meals.filter((m) => m.date === date) })) };
}

/** Everything wrong with the menu, by meal: who eats each dish, the family's rules and a main dish on too many days (plan_menu's
 *  checks, the same code), and a meal with no dish (every meal of `needs`, extra slots too). */
export function menuProblems(c: WeekContext, needs: SlotNeed[], menu: Map<string, MenuMeal>, today: string): Map<string, Problem[]> {
  const family = c.people.map((p) => p.name);
  const view = viewOf(c.week_start, needs, menu, family);
  const out = new Map<string, Problem[]>();
  const add = (key: string, p: Problem) => out.set(key, [...(out.get(key) ?? []), p]);
  const byLabel = new Map(needs.map((n) => [mealLabel(n), n]));
  for (const n of needs) {
    if (n.ordered_in) continue;
    const dishes = menu.get(n.key)?.dishes ?? [];
    if (!dishes.length) add(n.key, { kind: "empty", text: "no dish: every meal needs at least one dish", said: `${short(n)} had nothing planned` });
    let readable = true;
    for (const d of dishes) {
      const e = eatersFor(d, n.who, family);
      if ("problem" in e) { readable = false; add(n.key, { kind: "eaters", dish: d.name, text: `${d.name}: ${e.problem}`, said: `${short(n)}: ${d.name} has no one to eat it` }); }
    }
    // Everyone who eats the meal has a main dish there, not only rice, roti and sides (live run 2026-11-23: every main "for"
    // the father, the rest of the family given rice and curd). A meal of the house's own (a snack, a tiffin) may be all sides.
    const mains = dishes.filter((d) => !notMain(d.name));
    if (!dishes.length || !readable || (!mains.length && !SLOTS.some((s) => same(s, n.slot)))) continue;
    const fed = mains.flatMap((d) => dishEaters(d, n, family) ?? []);
    const hungry = eatingAt(n).filter((p) => !fed.some((f) => same(f, p)));
    if (hungry.length) add(n.key, { kind: "uncovered", people: hungry,
      text: `${andList(hungry)} ${hungry.length === 1 ? "has" : "have"} no main dish at ${short(n)}: give them one (a shared dish for everyone, except who has their own)`,
      said: `${short(n)}: no main dish for ${andList(hungry)}` });
  }
  const { breaks } = menuChecks(view, c.house, family.map((name) => ({ name })), today);
  for (const b of breaks) {
    const n = byLabel.get(b.meal);
    if (n) add(n.key, { kind: "rule", dish: b.dish, ...(b.who ? { who: b.who } : {}), text: `${b.dish ? `${b.dish}: ` : ""}${b.rule} (${b.fix})`, said: `${short(n)}${b.dish ? ` has ${b.dish}, against "${b.rule}"` : `: "${b.rule}" is not kept`}` });
  }
  for (const r of repeatedDays(view, c.house)) {
    const kept = r.dates.slice(0, MAIN_DAYS_MAX).map(weekdayOf).join(" and ");
    for (const date of r.dates.slice(MAIN_DAYS_MAX))
      for (const n of needs.filter((x) => x.date === date && (menu.get(x.key)?.dishes ?? []).some((d) => dishKey(d.name) === dishKey(r.name))))
        add(n.key, { kind: "repeat", dish: r.name, text: `${r.name} is already on ${kept}: a main dish is on ${MAIN_DAYS_MAX} days at most, plan something else here`,
          said: `${r.name} repeats on ${r.dates.length} days (${r.dates.map(weekdayOf).join(", ")}): only ${n.family_dishes.length} ${n.slot.toLowerCase()} dish${n.family_dishes.length === 1 ? "" : "es"} known` });
  }
  return out;
}

const weight = (ps: Problem[] | undefined) => (ps ?? []).reduce((s, p) => s + (p.kind === "repeat" ? 1 : 100), 0);
const total = (m: Map<string, Problem[]>) => [...m.values()].reduce((s, ps) => s + weight(ps), 0);

const MENU_SCHEMA = { type: "object", required: ["meals"], properties: { meals: { type: "array", items: { type: "object", required: ["date", "slot", "dishes"],
  properties: { date: { type: "string" }, slot: { type: "string" }, dishes: { type: "array", items: { type: "object", required: ["name", "for"],
    properties: { name: { type: "string" }, for: { type: "array", items: { type: "string" } }, except: { type: "array", items: { type: "string" } }, portion_note: { type: "string" } } } } } } } } };

export const MENU_SYSTEM = [
  "You plan one meal of the day (the `slot`) of an Indian family's week: each of its meals in `meals`. Answer with JSON only, as the schema says: { meals: [{ date, slot, dishes: [{ name, for, except?, portion_note? }] }] }.",
  "Dish names only, no ingredients. Every meal you are given gets at least one dish; use its date and slot exactly as given. A person listed in a meal's `fasts` eats nothing there.",
  "for: [\"everyone\"] (everyone who eats that meal) or the names of the people who eat it. A dish is for [\"everyone\"] unless one person has their own: their dish for [them], and the shared dish for [\"everyone\"] with except: [them].",
  "Everyone who eats a meal has a main dish there, not only rice, roti or sides like chutney and curd. Never put the family's main dish for one person.",
  "Every rule listed on a meal must hold there. A main dish is on two days of the week at most (roti, rice, plain dal and sides like chutney, curd come back freely; sambar and rasam are mains).",
  "How to plan:",
  PLAN_METHOD,
].join("\n");

const FIX_SYSTEM = [
  "You fix some meals of an Indian family's week plan. Answer with JSON only, as the schema says: { meals: [{ date, slot, dishes: [{ name, for, except?, portion_note? }] }] }.",
  "Send back ONLY the meals listed in `fix`, each one whole (all its dishes), changed so that every reason given for it is gone. Do not send any other meal: the rest of the week stays as it is (`rest_of_week`, to keep the variety).",
  "for: [\"everyone\"] or the names; a person's own dish is for [them] and the shared one is for [\"everyone\"] with except: [them]. Everyone who eats a meal has a main dish there; never put the family's main dish for one person. A person in a meal's `fasts` eats nothing there. A main dish is on two days of the week at most.",
].join("\n");

/** The family as the model needs it: who, and what each person said about how they eat. */
function familyOf(c: WeekContext) {
  return c.people.map((p) => Object.fromEntries(Object.entries({ name: p.name, group: p.group, portions: p.portions, diet: p.diet, allergies: p.allergies, dislikes: p.dislikes, note: p.note })
    .filter(([, v]) => v != null && v !== "")));
}
function cookOf(c: WeekContext) {
  const h = c.house;
  return h.cook_name ? Object.fromEntries(Object.entries({ name: h.cook_name, days: h.cook_days, makes_well: h.cook_makes_well, wont_make: h.cook_wont_make,
    time_limit: h.cook_time_limit, new_recipes: h.cook_new_recipes, note: h.cook_note }).filter(([, v]) => v != null && v !== "")) : null;
}
const mealAsked = (n: SlotNeed) => ({ date: n.date, day: n.day, slot: n.slot, who: n.who, ...(n.fasts?.length ? { fasts: n.fasts } : {}), rules: n.rules, cook: n.cook });

/** The model's meals, read leniently: each one that is a meal of `needs` (its slot whatever its capitals), with its dishes. */
function mealsFrom(json: unknown, needs: SlotNeed[]): MenuMeal[] {
  const raw = json && typeof json === "object" ? (json as { meals?: unknown }).meals : undefined;
  if (!Array.isArray(raw)) return [];
  const out: MenuMeal[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const { date, slot, dishes } = m as Record<string, unknown>;
    const n = needs.find((x) => x.date === date && typeof slot === "string" && same(x.slot, slot));
    if (!n || n.ordered_in || !Array.isArray(dishes)) continue;
    const list: MenuDish[] = [];
    for (const d of dishes) {
      if (!d || typeof d !== "object") continue;
      const r = d as Record<string, unknown>;
      const name = typeof r.name === "string" ? r.name.trim() : "";
      if (!name) continue;
      const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : []);
      list.push({ name, for: strs(r.for), ...(strs(r.except).length ? { except: strs(r.except) } : {}),
        ...(typeof r.portion_note === "string" && r.portion_note.trim() ? { portion_note: r.portion_note.trim() } : {}) });
    }
    out.push({ date: n.date, slot: n.slot, dishes: list });
  }
  return out;
}

// ── The code's last resort ──

/** The dishes a meal may take in place of one that fails, in tiers tried in turn: the meal's own family dishes (the ones least
 *  used this week first, a dish that did not work last); then the family's dishes rated well; then their dishes of any other
 *  meal. A later tier is reached only when no dish of the ones before keeps the meal's rules (a repeat is kept before it). */
function poolTiers(c: WeekContext, n: SlotNeed, menu: Map<string, MenuMeal>): { dish: string; for?: string[] }[][] {
  const used = new Map<string, number>();
  for (const m of menu.values()) for (const d of m.dishes) used.set(dishKey(d.name), (used.get(dishKey(d.name)) ?? 0) + 1);
  const seen = new Set<string>();
  const take = (xs: { dish: string; for?: string[]; rating?: string | null }[]) => xs.filter((x) => !seen.has(dishKey(x.dish)) && (seen.add(dishKey(x.dish)), true))
    .map(({ dish, for: f }) => ({ dish, ...(f?.length ? { for: f } : {}) }));
  const rank = (xs: { dish: string; for?: string[]; rating?: string | null }[]) => xs.map((x, i) => ({ x, i }))
    .sort((a, b) => (used.get(dishKey(a.x.dish)) ?? 0) - (used.get(dishKey(b.x.dish)) ?? 0) || +(a.x.rating === "didnt_work") - +(b.x.rating === "didnt_work") || a.i - b.i).map((y) => y.x);
  const others = Object.entries(c.family_dishes).filter(([s]) => !same(s, n.slot)).flatMap(([, ds]) => ds.filter((d) => !d.for?.length));
  return [take(rank(n.family_dishes)), take(rank(c.known_dishes.filter((k) => k.rating === "good" || k.rating === "okay").map((k) => ({ dish: k.dish })))),
    take(rank(others))];
}

/** The meals a failing meal could be instead, best first: each failing dish swapped for a dish of the pool (keeping who eats it),
 *  then the meal as one dish of the pool, for everyone (or for the person it is listed for, with a shared dish for the rest). */
function candidates(n: SlotNeed, meal: MenuMeal | undefined, problems: Problem[], pool: { dish: string; for?: string[] }[]): MenuDish[][] {
  const now = meal?.dishes ?? [];
  const out: MenuDish[][] = [];
  const bad = [...new Set(problems.map((p) => p.dish).filter((d): d is string => !!d))];
  for (const name of bad) {
    const at = now.findIndex((d) => dishKey(d.name) === dishKey(name));
    if (at < 0) continue;
    const was = now[at], eatersBroken = problems.some((p) => p.kind === "eaters" && p.dish === name);
    for (const p of pool) {
      if (now.some((d) => dishKey(d.name) === dishKey(p.dish))) continue;
      out.push(now.map((d, i) => (i === at ? { name: p.dish, for: eatersBroken ? [EVERYONE] : was.for, ...(was.except && !eatersBroken ? { except: was.except } : {}) } : d)));
    }
    // The dish dropped, when the meal has others.
    if (now.length > 1) out.push(now.filter((_, i) => i !== at));
  }
  // A person's rule broken by a dish they share (a fast, an avoid): the dish without them.
  for (const p of problems) {
    if (p.kind !== "rule" || !p.dish || !p.who) continue;
    const at = now.findIndex((d) => dishKey(d.name) === dishKey(p.dish!));
    if (at < 0) continue;
    const d = now[at], who = p.who;
    const named = d.for.filter((x) => !same(x, EVERYONE));
    const without: MenuDish | null = !named.length ? { ...d, for: [EVERYONE], except: [...new Set([...(d.except ?? []), who])] }
      : named.some((x) => same(x, who)) ? (named.length > 1 ? { ...d, for: named.filter((x) => !same(x, who)) } : null) : d;
    out.unshift(without ? now.map((x, i) => (i === at ? without : x)) : now.filter((_, i) => i !== at));
  }
  // People with no main dish: a main of one person's made the shared one (everyone but who has a main of their own), first;
  // else a family dish of the meal added for them.
  for (const p of problems) {
    if (p.kind !== "uncovered" || !p.people?.length) continue;
    const hungry = p.people;
    now.forEach((d, i) => {
      if (notMain(d.name) || d.for.some((x) => same(x, EVERYONE))) return;
      const own = now.filter((x, j) => j !== i && !notMain(x.name) && !x.for.some((y) => same(y, EVERYONE))).flatMap((x) => x.for)
        .filter((x) => n.who.some((w) => same(w, x)) && !d.for.some((y) => same(y, x)));
      out.unshift(now.map((x, j) => (j === i ? { ...x, for: [EVERYONE], ...(own.length ? { except: [...new Set(own)] } : {}) } : x)));
      out.push(now.map((x, j) => (j === i ? { ...x, for: [...x.for, ...hungry] } : x)));
    });
    for (const q of pool) if (!q.for?.length && !notMain(q.dish) && !now.some((d) => dishKey(d.name) === dishKey(q.dish))) out.push([...now, { name: q.dish, for: hungry }]);
  }
  const everyone = pool.filter((p) => !p.for?.length), own = pool.filter((p) => p.for?.length);
  for (const p of everyone) out.push([{ name: p.dish, for: [EVERYONE] }]);
  for (const o of own) for (const p of everyone) out.push([{ name: o.dish, for: o.for! }, { name: p.dish, for: [EVERYONE], except: o.for! }]);
  return out;
}

/** Each meal still failing after the model's rounds, swapped in code for the candidate that leaves the week least wrong (a
 *  repeat weighs least, a broken rule or a meal with nothing far more), tier by tier (poolTiers): a dish of the meal's own
 *  that comes back a third day is taken before a dish from elsewhere. Answers the menu as fixed. */
function fixInCode(c: WeekContext, needs: SlotNeed[], menu: Map<string, MenuMeal>, today: string): Map<string, MenuMeal> {
  const fixed = new Map(menu);
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const n of needs) {
      const now = menuProblems(c, needs, fixed, today);
      const mine = now.get(n.key);
      if (!mine?.length) continue;
      let best: { meal: MenuMeal; score: number } | null = null;
      const base = total(now);
      // A meal with nothing is filled even when no dish makes the week better (every one breaks something): the least bad.
      const empty = !fixed.get(n.key)?.dishes.length;
      // A meal whose only fault is a dish come back a third day keeps to its own dishes: a repeat before a dish from elsewhere.
      const tiers = poolTiers(c, n, fixed);
      for (const tier of mine.every((p) => p.kind === "repeat") ? tiers.slice(0, 1) : tiers) {
        for (const dishes of candidates(n, fixed.get(n.key), mine, tier)) {
          const meal = { date: n.date, slot: n.slot, dishes };
          const trial = new Map(fixed).set(n.key, meal);
          const after = menuProblems(c, needs, trial, today);
          const score = total(after);
          if (score < (best?.score ?? base) || (empty && !best && dishes.length && score <= base)) best = { meal, score };
          if (score === 0) break;
        }
        // This tier keeps every rule of the meal (at worst a dish comes back): no need to look further.
        if (best && !(menuProblems(c, needs, new Map(fixed).set(n.key, best.meal), today).get(n.key) ?? []).some((p) => p.kind !== "repeat")) break;
      }
      if (best) { fixed.set(n.key, best.meal); changed = true; }
    }
    if (!changed) break;
  }
  return fixed;
}

// ── c. Each day's ingredients ──

const INGREDIENT_SCHEMA = { type: "object", required: ["dishes"], properties: { dishes: { type: "array", items: { type: "object", required: ["slot", "name", "ingredients"],
  properties: { slot: { type: "string" }, name: { type: "string" }, ingredients: { type: "array", items: { type: "object", required: ["item", "amount", "unit"],
    properties: { item: { type: "string" }, amount: { type: "number" }, unit: { type: "string" } } } } } } } } };

export const INGREDIENT_SYSTEM = [
  "You list what an Indian family's dishes for one day need bought. Answer with JSON only: { dishes: [{ slot, name, ingredients: [{ item, amount, unit }] }] }, every dish you are given, its slot and name exactly as given.",
  "Amounts for the people each dish is for at that one meal: add up their portions. item is the plain word (\"atta\", \"toor dal\", \"onion\"); amount a number; unit g, kg, ml, l or pc (things counted). Leave out salt and water.",
].join("\n");

function ingredientsFrom(json: unknown): { slot: string; name: string; ingredients: Ingredient[] }[] {
  const raw = json && typeof json === "object" ? (json as { dishes?: unknown }).dishes : undefined;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((d) => {
    if (!d || typeof d !== "object") return [];
    const r = d as Record<string, unknown>;
    if (typeof r.name !== "string" || !Array.isArray(r.ingredients)) return [];
    const ingredients = r.ingredients.flatMap((i): Ingredient[] => {
      if (!i || typeof i !== "object") return [];
      const x = i as Record<string, unknown>;
      const item = typeof x.item === "string" ? x.item.trim() : "";
      if (!item) return [];
      return [{ item, amount: typeof x.amount === "number" && Number.isFinite(x.amount) && x.amount > 0 ? x.amount : null,
        unit: typeof x.unit === "string" && x.unit.trim() ? x.unit.trim() : null }];
    });
    return [{ slot: typeof r.slot === "string" ? r.slot : "", name: r.name.trim(), ingredients }];
  });
}

// ── c'. An ingredient a person avoids ──

/** Each dish's ingredients without what a person who eats it avoids (an avoid rule's items, @categories too, matched on the
 *  ingredient): the line taken out, and on a dish others share, a portion_note that says so ("no sugar for Gowri Shankar").
 *  The menu's checks read dish names only (live run 2026-11-23: poha with sugar for a diabetic who avoids sugar). Answers
 *  the notes to add, by meal key and dish, and what was taken out, for the log. */
export function dropAvoided(c: WeekContext, toPlan: SlotNeed[], menu: Map<string, MenuMeal>, got: Map<string, Ingredient[]>): { notes: Map<string, string[]>; dropped: string[] } {
  const family = c.people.map((p) => p.name);
  const notes = new Map<string, string[]>(), dropped: string[] = [];
  const avoids = c.house.rules.map(checkedAs).filter((r): r is Rule => r?.kind === "avoid" && !!r.items?.length)
    .filter((r) => !r.days.length || r.days.some((d) => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/.test(d)));
  for (const n of toPlan) for (const d of menu.get(n.key)?.dishes ?? []) {
    const key = `${n.key}|${dishKey(d.name)}`, list = got.get(key);
    if (!list?.length) continue;
    const eaters = dishEaters(d, n, family) ?? n.who;
    let left = list;
    for (const r of avoids) {
      if (!ruleHolds(r, n.day, n.slot, n.who) || (r.who && !eaters.some((e) => same(e, r.who!)))) continue;
      const out = left.filter((i) => r.items!.some((item) => hit(i.item, item) !== null));
      if (!out.length) continue;
      left = left.filter((i) => !out.includes(i));
      const what = [...new Set(out.map((i) => i.item.toLowerCase()))];
      dropped.push(`${short(n)} ${d.name}: ${what.join(", ")}${r.who ? ` (${r.who})` : ""}`);
      if (r.who && eaters.some((e) => !same(e, r.who!))) notes.set(key, [...(notes.get(key) ?? []), `no ${andList(what)} for ${r.who}`]);
    }
    if (left !== list) got.set(key, left);
  }
  return { notes, dropped };
}

// ── The plan, step by step ──

/** `budgetMs`: how long the whole plan may take (Flock waits 6 minutes for make_plan); `clock`: milliseconds now, for tests;
 *  `log`: where a line of the run goes (the app's log: console). */
export type MakePlanDeps = { db: Db; emit: Emit; model: ModelCall; weekStart: string; today: string; basePath: string; budgetMs?: number; clock?: () => number;
  log?: (line: string) => void };

/** make_plan's time: inside Flock's 6 minutes for an operation, with room to save and answer. */
export const OP_BUDGET_MS = 330_000;
/** The Sunday run has no caller waiting, only Flock's own per-call deadlines. */
export const ROUTINE_BUDGET_MS = 20 * 60_000;
/** Kept back from the menu's rounds for the ingredients (asked for every day at once) and the save. */
const INGREDIENTS_RESERVE_MS = 90_000, SAVE_RESERVE_MS = 5_000;

/** A menu call's reply budget, by how many meals it asks for (one meal of the day for a week: 5 to 7). */
const menuTokens = (meals: number) => Math.min(8000, 3000 + 400 * meals);
const fixTokens = (meals: number) => Math.min(6000, 2000 + 400 * meals);

/** One week's run, per database: the run going (a second make_plan joins it), and every model call still running, a run's
 *  that gave up on it included (the platform answers it in the end; a new call is never started on top of it). */
type Flight = { run?: Promise<MakePlanResult>; inflight: Set<Promise<unknown>> };
const flights = new WeakMap<object, Map<string, Flight>>();
function flightOf(db: Db, weekStart: string): Flight {
  let byWeek = flights.get(db as object);
  if (!byWeek) flights.set(db as object, (byWeek = new Map()));
  let f = byWeek.get(weekStart);
  if (!f) byWeek.set(weekStart, (f = { inflight: new Set() }));
  return f;
}

/** Make and save the week's plan (steps a to d). Never messages anyone; answers the message and intro to send, or why not and
 *  the plain line to say instead. A stop the family must fix (credits, the day's budget, too many calls) ends the run at once.
 *  A call for a week already being planned answers what that run answers. */
export function makePlan(deps: MakePlanDeps): Promise<MakePlanResult> {
  const log = deps.log ?? ((line: string) => console.log(`[planner] make_plan ${deps.weekStart}: ${line}`));
  const f = flightOf(deps.db, deps.weekStart);
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
  /** A model call that gives up (timeout) when the run's time, less `reserve`, is spent. The call itself runs on (the SDK
   *  cannot abort it) and stays in `inflight` until it answers. */
  const model = async (req: Parameters<ModelCall>[0], reserve: number): Promise<ModelResult> => {
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
  /** Wait for every call still running (this run's, or a run before that gave up on it), at most until the time less
   *  `reserve` is spent: false when the time ran out first. */
  const quiet = async (reserve: number): Promise<boolean> => {
    if (inflight.size) {
      const left = end - reserve - clock();
      if (left <= 0) return false;
      log(`waiting for ${inflight.size} model call${inflight.size === 1 ? "" : "s"} still running before asking again`);
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([Promise.allSettled([...inflight]), new Promise((resolve) => { timer = setTimeout(resolve, left); })]);
      clearTimeout(timer);
      if (inflight.size) return false;
    }
    return end - reserve - clock() > 0;
  };
  const c = weekContext(db, weekStart);
  if (!c.people.length) return done({ ok: false, reason: "no_family", say: "Tell me who eats at home first, then I'll plan the week." });
  const needs = slotNeeds(c, today);
  const toPlan = needs.filter((n) => !n.ordered_in);
  if (!needs.length) return done({ ok: false, reason: "no_meals", say: "There are no cooking days left to plan in that week." });
  const stopped = (r: Extract<ModelResult, { ok: false }>): MakePlanResult => done({ ok: false, reason: r.code, say: stopSaid(r.code) });

  // b. The menu: one call per meal of the day, all at once, then only the meals that fail (again by meal of the day), at
  //    most MENU_ROUNDS rounds. A meal of the day whose call failed is asked for whole again in the next round, alone.
  let menu = new Map<string, MenuMeal>();
  const family = familyOf(c), cook = cookOf(c);
  const known = c.known_dishes.map((k) => Object.fromEntries(Object.entries({ dish: k.dish, rating: k.rating, note: k.note }).filter(([, v]) => v != null)));
  const slots = [...new Set(toPlan.map((n) => n.slot))];
  const famOf = (slot: string) => Object.entries(c.family_dishes).find(([s]) => same(s, slot))?.[1] ?? [];
  const firstAsk = (slot: string, mine: SlotNeed[]) => ({ tier: "balanced" as const, purpose: `meal plan: the week's ${slot}`, system: MENU_SYSTEM, schema: MENU_SCHEMA,
    maxTokens: menuTokens(mine.length),
    user: JSON.stringify({ week_start: weekStart, slot, meals: mine.map(mealAsked), people: family, cook, family_dishes: famOf(slot),
      last_week: c.last_week.filter((m) => same(m.slot, slot)), known_dishes: known, house_notes: c.house.notes ?? undefined }) });
  const fixAsk = (slot: string, bad: SlotNeed[]) => ({ tier: "balanced" as const, purpose: `meal plan: fix the ${slot}`, system: FIX_SYSTEM, schema: MENU_SCHEMA,
    maxTokens: fixTokens(bad.length),
    user: JSON.stringify({ week_start: weekStart, slot,
      fix: bad.map((n) => ({ ...mealAsked(n), family_dishes: n.family_dishes.map((d) => d.dish), now: menu.get(n.key)?.dishes ?? [], wrong: problems.get(n.key)!.map((p) => p.text) })),
      rest_of_week: toPlan.filter((n) => !problems.has(n.key)).map((n) => ({ date: n.date, slot: n.slot, dishes: (menu.get(n.key)?.dishes ?? []).map((d) => d.name) })),
      people: family }) });
  let problems = menuProblems(c, needs, menu, today);
  let lastFailure: Extract<ModelResult, { ok: false }> | null = null, answered = false;
  const asked = new Set<string>();   // the meals of the day whose whole week came back
  for (let round = 1; round <= MENU_ROUNDS && toPlan.length && problems.size; round++) {
    // Never a round on top of a call still running.
    if (!(await quiet(INGREDIENTS_RESERVE_MS))) { log(`round ${round}: not started, the menu's time is spent`); break; }
    const asks = slots.flatMap((slot) => {
      const mine = toPlan.filter((n) => n.slot === slot);
      if (!asked.has(slot)) return [{ slot, first: true, keys: new Set(mine.map((n) => n.key)), req: firstAsk(slot, mine) }];
      const bad = mine.filter((n) => problems.has(n.key));
      return bad.length ? [{ slot, first: false, keys: new Set(bad.map((n) => n.key)), req: fixAsk(slot, bad) }] : [];
    });
    if (!asks.length) break;
    const t0 = clock();
    const results = await Promise.all(asks.map((a) => model(a.req, INGREDIENTS_RESERVE_MS)));
    results.forEach((r, i) => {
      const a = asks[i];
      if (!r.ok) { if (!lastFailure || !isStop(lastFailure.code)) lastFailure = r; return; }
      answered = true;
      if (a.first) asked.add(a.slot);
      // A call changes only the meals it was asked for.
      for (const m of mealsFrom(r.json, needs)) if (a.keys.has(keyOf(m.date, m.slot))) menu.set(keyOf(m.date, m.slot), m);
    });
    problems = menuProblems(c, needs, menu, today);
    log(`round ${round}: ${asks.length} call${asks.length === 1 ? "" : "s"} (${asks.map((a, i) => `${a.first ? "" : "fix "}${a.slot} ${a.keys.size}: ${results[i].ok ? "ok" : (results[i] as { code: string }).code}`).join(", ")}) in ${clock() - t0} ms; problems: ${kindsOf(problems)}`);
    const stop = results.find((r): r is Extract<ModelResult, { ok: false }> => !r.ok && isStop(r.code));
    if (stop) return stopped(stop);
  }
  // The model never answered (down, or every answer unreadable): no week rather than one the model had no part in.
  if (toPlan.length && !answered && lastFailure) return stopped(lastFailure);
  if (problems.size) {
    const before = menu;
    menu = fixInCode(c, needs, menu, today);
    problems = menuProblems(c, needs, menu, today);
    const changed = toPlan.filter((n) => JSON.stringify(before.get(n.key)?.dishes ?? []) !== JSON.stringify(menu.get(n.key)?.dishes ?? []));
    log(`code fixed ${changed.length} meal${changed.length === 1 ? "" : "s"}: ${changed.map((n) => `${short(n)} → ${(menu.get(n.key)?.dishes ?? []).map((d) => `${d.name} [${d.for.join(", ")}${d.except?.length ? ` except ${d.except.join(", ")}` : ""}]`).join(", ") || "nothing"}`).join("; ") || "none"}; left: ${kindsOf(problems)}`);
  }
  const empty = toPlan.filter((n) => !(menu.get(n.key)?.dishes.length));
  if (empty.length) return done({ ok: false, reason: "no_dishes",
    say: `I couldn't plan the week: I don't know any dishes for ${[...new Set(empty.map((n) => n.slot.toLowerCase()))].join(", ")} yet. Tell me a few you usually have.` });
  const unmet = [...new Set(toPlan.flatMap((n) => (problems.get(n.key) ?? []).map((p) => p.said)))];

  // c. Each day's ingredients, one call a day, once more on its own when it fails.
  const people = c.people.map((p) => p.name);
  const got = new Map<string, Ingredient[]>();   // by meal key and dish
  const noIngredients: string[] = [];
  // Every day at once (Flock allows 60 calls a minute): the run's time is spent on the slowest day, not on all of them.
  const days = await Promise.all([...new Set(toPlan.map((n) => n.date))].map(async (date): Promise<Extract<ModelResult, { ok: false }> | null> => {
    const day = toPlan.filter((n) => n.date === date);
    const dishes = day.flatMap((n) => menu.get(n.key)!.dishes.map((d) => {
      const e = eatersFor(d, n.who, people);
      const forWho = "for" in e ? (e.for.length === 1 && same(e.for[0], EVERYONE) ? eatingAt(n) : e.for) : eatingAt(n);
      return { slot: n.slot, name: d.name, for: forWho, ...(d.portion_note ? { portion_note: d.portion_note } : {}) };
    }));
    const missing = () => dishes.filter((d) => !got.get(`${keyOf(date, d.slot)}|${dishKey(d.name)}`)?.length);
    for (let attempt = 0; attempt < 2 && missing().length; attempt++) {
      const r = await model({ tier: "fast", purpose: "meal plan: a day's ingredients", system: INGREDIENT_SYSTEM, schema: INGREDIENT_SCHEMA, maxTokens: 4000,
        user: JSON.stringify({ date, day: weekdayOf(date), people: family.map((p) => ({ name: p.name, group: p.group, portions: p.portions })), dishes: attempt ? missing() : dishes }) }, SAVE_RESERVE_MS);
      if (!r.ok) { if (isStop(r.code)) return r; continue; }
      for (const d of ingredientsFrom(r.json)) {
        if (!d.ingredients.length) continue;
        const n = day.find((x) => same(x.slot, d.slot) && menu.get(x.key)!.dishes.some((y) => same(y.name, d.name)))
          ?? day.find((x) => menu.get(x.key)!.dishes.some((y) => same(y.name, d.name)));
        if (n) got.set(`${n.key}|${dishKey(d.name)}`, d.ingredients);
      }
    }
    if (missing().length) noIngredients.push(...missing().map((d) => `${weekdayOf(date)} ${d.slot}: ${d.name}`));
    return null;
  }));
  const stop = days.find((x) => x);
  if (stop) return stopped(stop);
  noIngredients.sort((a, b) => toPlan.findIndex((n) => a.startsWith(short(n) + ":")) - toPlan.findIndex((n) => b.startsWith(short(n) + ":")));
  const { notes, dropped } = dropAvoided(c, toPlan, menu, got);
  if (dropped.length) log(`ingredients taken out for an avoid rule: ${dropped.join("; ")}`);

  // d. Saved final, and closed as the closing plan_week call closes it.
  const meals = needs.map((n) => n.ordered_in
    ? { date: n.date, slot: n.slot, ordered_in: true, ...(n.ordered_in.note ? { note: n.ordered_in.note } : {}) }
    : { date: n.date, slot: n.slot, dishes: menu.get(n.key)!.dishes.map((d) => {
      const e = eatersFor(d, n.who, people), key = `${n.key}|${dishKey(d.name)}`;
      const note = [d.portion_note, ...(notes.get(key) ?? [])].filter(Boolean).join("; ");
      return { name: d.name, for: "for" in e ? e.for : [EVERYONE], ...(note ? { portion_note: note } : {}), ingredients: got.get(key) ?? [] };
    }) });
  // A week planned part way through keeps its meals before today.
  saveWeek(deps.db, deps.emit, weekStart, meals, { keepRest: weekDates(weekStart).some((d) => d < today) });
  const closed = closeWeek(db, weekStart, deps.basePath, unmet);
  return done({ ok: true, week_start: weekStart, message: closed.message, ...(closed.intro ? { intro: closed.intro } : {}), instructions: closed.instructions,
    ...(unmet.length ? { unmet } : {}), ...(noIngredients.length ? { no_ingredients: noIngredients } : {}) });
}

/** The problems by kind, for the log: "rule 2, repeat 1", or "none". */
function kindsOf(problems: Map<string, Problem[]>): string {
  const n = new Map<string, number>();
  for (const ps of problems.values()) for (const p of ps) n.set(p.kind, (n.get(p.kind) ?? 0) + 1);
  return n.size ? [...n].map(([k, v]) => `${k} ${v}`).join(", ") : "none";
}

/** make_plan { week_start }: the week planned in steps (makePlan), saved final; answers { ok, week_start, message, intro?,
 *  instructions, unmet? } or { ok: false, reason, say }. `model`: the platform's model call (model.ts). */
export function mountMakePlanRoute(hono: Hono<any>, db: Db, emit: Emit, opts: { basePath: string; model: ModelCall; now?: () => Date }) {
  const write = writeRoutes(hono);
  write("/api/weeks/:week_start/make-plan", async (_b, _by, c) => {
    const weekStart = dateOf(c.req.param("week_start"), "week_start");
    if (weekdayOf(weekStart) !== "Mon") refuse(`week_start must be a Monday: ${weekStart} is a ${weekdayOf(weekStart)}`);
    const today = todayStr((opts.now ?? (() => new Date()))());
    if (addDays(weekStart, 6) < today) refuse(`the week of ${weekStart} is over: plan this week or a later one`);
    return { body: await makePlan({ db, emit, model: opts.model, weekStart, today, basePath: opts.basePath, budgetMs: OP_BUDGET_MS }) };
  });
}
