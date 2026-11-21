// Scores a saved week against a fixture's `expect` list. Independent of the app's own rule checker: who eats what, what a
// dish "contains" and every word list are the eval's own (terms.ts).
import { CATEGORIES, expand, firstHit, hasPhrase, positiveName, saysNoSugar, words } from "./terms";

export type Ingredient = { item: string };
export type Dish = { name: string; for_people: string[] | null; portion_note: string | null; ingredients: Ingredient[] };
export type Meal = { date: string; slot: string; ordered_in: boolean; note: string | null; dishes: Dish[] };
export type Week = { week_start: string; days: { date: string; meals: Meal[] }[] };

export type Check = Record<string, any> & { type: string };
export type Expectation = { id: string; says: string; check: Check; heuristic?: boolean; soft?: boolean };
export type Fixture = {
  id: string; title: string; today: string; week_start: string;
  people: { name: string; relationship?: string; group: string; diet?: string; allergies?: string; note?: string }[];
  cook: Record<string, unknown>; cooking_days: string[];
  slots: { extra_slots: { name: string; days?: string[]; for?: string[] }[]; order_in: { day: string; slot: string; note?: string }[] };
  absent: { who: string; days: string[]; slots: string[] }[];
  last_week: { date: string; slot: string; dishes?: string[]; ordered_in?: boolean; note?: string }[];
  told: Record<string, string>; rules: Record<string, any>[]; expect: Expectation[];
};
export type Outcome = { id: string; says: string; pass: boolean; breaks: string[]; heuristic?: boolean; soft?: boolean };

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const weekdayOf = (date: string): string => WEEKDAYS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7];
const lc = (s: string) => s.trim().toLowerCase();
const samePerson = (a: string, b: string) => lc(a) === lc(b);

function contains(d: Dish, terms: string[], namesOnly = false): string | null {
  // A name that says "no sugar" is not sweet by its name ("Banana sheera (no sugar)"): its ingredients still count.
  const sweetCheck = terms.includes("sugar") && saysNoSugar(d.name);
  const hit = sweetCheck ? null : firstHit(positiveName(d.name), terms);
  if (hit || namesOnly) return hit;
  for (const i of d.ingredients ?? []) { const h = firstHit(i.item, terms); if (h) return `${h} (in ${i.item})`; }
  return null;
}

export function makeScorer(fx: Fixture, week: Week) {
  const meals = week.days.flatMap((d) => d.meals);
  const slotFor = new Map(fx.slots.extra_slots.map((s) => [lc(s.name), s]));
  const isAbsent = (who: string, day: string, slot: string) =>
    fx.absent.some((a) => samePerson(a.who, who) && a.days.includes(day) && a.slots.some((s) => lc(s) === lc(slot)));
  const mealAt = (day: string, slot: string): Meal | undefined => meals.find((m) => weekdayOf(m.date) === day && lc(m.slot) === lc(slot));
  /** Is a dish for everyone who eats its meal: `["everyone"]`, or no one named (an older row). */
  const forEveryone = (d: Dish) => !d.for_people?.length || d.for_people.some((p) => lc(p) === "everyone");
  /** The dishes `who` eats in a meal, as written: the ones naming them, and the ones for everyone. Nobody eats a meal they
   *  are away for, or an extra slot that is someone else's (that slot's everyone is its own people). */
  const eats = (who: string, m: Meal): Dish[] => {
    const day = weekdayOf(m.date);
    const extra = slotFor.get(lc(m.slot));
    if (extra?.for?.length && !extra.for.some((p) => samePerson(p, who))) return [];
    if (isAbsent(who, day, m.slot) || m.ordered_in) return [];
    return m.dishes.filter((d) => forEveryone(d) || d.for_people!.some((p) => samePerson(p, who)));
  };
  const inScope = (m: Meal, c: Check) =>
    (!c.days || c.days.includes(weekdayOf(m.date))) && (!c.slots || c.slots.some((s: string) => lc(s) === lc(m.slot)));
  const label = (m: Meal, d?: Dish) => `${weekdayOf(m.date)} ${m.slot}${d ? `: ${d.name}` : ""}`;
  const dishesIn = (m: Meal, who?: string) => (who ? eats(who, m) : m.ordered_in ? [] : m.dishes);
  const cleanName = (name: string) => {
    let n = name.toLowerCase().replace(/\([^)]*\)/g, " ");
    for (const p of fx.people) n = n.replace(new RegExp(`\\b(for\\s+)?${lc(p.name)}('s|’s|s)?\\b`, "g"), " ");
    n = n.replace(/\b(for|only)\s*$/g, " ");
    return n.replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  };
  const isSide = (d: Dish) => !!firstHit(d.name, CATEGORIES.side) || CATEGORIES.side_exact.some((s) => words(d.name).join(" ") === words(s).join(" "));

  const run: Record<string, (c: Check) => string[]> = {
    present: (c) => {
      const days = c.days ?? WEEKDAYS, out: string[] = [];
      for (const day of days) for (const slot of c.slots) {
        if (c.who && isAbsent(c.who, day, slot)) continue;
        const extra = slotFor.get(lc(slot));
        if (extra?.days?.length && !extra.days.includes(day)) continue;
        const m = mealAt(day, slot);
        if (!m || m.ordered_in || !m.dishes.length) { out.push(`${day} ${slot}: no meal`); continue; }
        if (c.who && !eats(c.who, m).length) out.push(`${day} ${slot}: nothing for ${c.who}`);
      }
      return out;
    },
    present_each: (c) => (c.who as string[]).flatMap((who) => run.present({ ...c, type: "present", who })),
    nothing_cooked: (c) => meals.filter((m) => inScope(m, c) && !m.ordered_in && m.dishes.length).map((m) => `${label(m)}: ${m.dishes.map((d) => d.name).join(", ")}`),
    some_dish_named: (c) => {
      const terms = expand(c.terms), out: string[] = [];
      for (const day of c.days ?? WEEKDAYS) for (const slot of c.slots) {
        const m = mealAt(day, slot);
        if (!m || !m.dishes.some((d) => firstHit(d.name, terms))) out.push(`${day} ${slot}: ${m ? m.dishes.map((d) => d.name).join(", ") || "no dishes" : "no meal"}`);
      }
      return out;
    },
    avoid: (c) => {
      const terms = expand(c.terms), out: string[] = [];
      for (const m of meals.filter((m) => inScope(m, c))) for (const d of dishesIn(m, c.who)) {
        const hit = contains(d, terms, c.names_only);
        if (hit) out.push(`${label(m, d)} — ${hit}${c.who ? ` (${c.who})` : ""}`);
      }
      return out;
    },
    swap: (c) => {
      const terms = expand(c.terms), unless = c.unless_name ? expand(c.unless_name) : [], out: string[] = [];
      for (const m of meals.filter((m) => inScope(m, c))) for (const d of eats(c.who, m)) {
        if (unless.length && firstHit(d.name, unless)) continue;
        const hit = contains(d, terms);
        if (!hit) continue;
        const noted = !!d.portion_note && hasPhrase(d.portion_note, c.who);
        if (!noted) out.push(`${label(m, d)} — ${hit}, no portion note for ${c.who}`);
      }
      return out;
    },
    only: (c) => {
      const allow = (c.allow as string[]).map((r) => new RegExp(r, "i")), out: string[] = [];
      for (const m of meals.filter((m) => inScope(m, c))) for (const d of eats(c.who, m)) {
        const n = cleanName(d.name);
        if (!allow.some((r) => r.test(n))) out.push(`${label(m, d)} (${c.who})`);
      }
      return out;
    },
    require: (c) => {
      const terms = expand(c.terms), out: string[] = [];
      for (const m of meals.filter((m) => inScope(m, c))) {
        const ate = eats(c.who, m);
        if (ate.length && !ate.some((d) => contains(d, terms))) out.push(`${label(m)}: ${ate.map((d) => d.name).join(", ")} (${c.who})`);
      }
      return out;
    },
    cap: (c) => {
      const terms = expand(c.terms), skip = c.exclude_terms ? expand(c.exclude_terms) : [];
      const hits = meals.filter((m) => !m.ordered_in && m.dishes.some((d) => !(skip.length && firstHit(d.name, skip)) && contains(d, terms)));
      return hits.length > c.per_week ? [`${hits.length} meals (max ${c.per_week}): ${hits.map((m) => label(m)).join("; ")}`] : [];
    },
    max_dishes: (c) => meals.filter((m) => inScope(m, c) && !m.ordered_in).flatMap((m) => {
      const mains = [...new Set(m.dishes.filter((d) => !isSide(d)).map((d) => words(d.name).join(" ")))];
      return mains.length > c.max ? [`${label(m)}: ${mains.length} dishes (${mains.join(", ")})`] : [];
    }),
    distinct: (c) => {
      const seen = new Map<string, string[]>();
      for (const m of meals.filter((m) => inScope(m, c))) for (const d of m.dishes) {
        const k = words(d.name).join(" "); seen.set(k, [...(seen.get(k) ?? []), weekdayOf(m.date)]);
      }
      return [...seen.entries()].filter(([, days]) => new Set(days).size > 1).map(([k, days]) => `${k} on ${[...new Set(days)].join(", ")}`);
    },
    new_dish_not_on: (c) => {
      const isNew = (t?: string | null) => !!t && /\bnew\b|first time|\btry(ing)?\b/i.test(t);
      return meals.filter((m) => inScope(m, c) && (isNew(m.note) || m.dishes.some((d) => isNew(d.portion_note) || isNew(d.name))))
        .map((m) => `${label(m)} is marked new`);
    },
    max_from_last_week: (c) => {
      const last = new Set(fx.last_week.flatMap((m) => m.dishes ?? []).map((n) => words(n).join(" ")));
      const now = new Set(meals.flatMap((m) => m.dishes.map((d) => words(d.name).join(" "))));
      const back = [...now].filter((n) => last.has(n));
      return back.length > c.max ? [`${back.length} back from last week: ${back.join(", ")}`] : [];
    },
  };
  return (e: Expectation): Outcome => {
    const f = run[e.check.type];
    if (!f) throw new Error(`${fx.id}/${e.id}: unknown check ${e.check.type}`);
    const breaks = f(e.check);
    return { id: e.id, says: e.says, pass: breaks.length === 0, breaks, ...(e.heuristic ? { heuristic: true } : {}), ...(e.soft ? { soft: true } : {}) };
  };
}

export function scoreWeek(fx: Fixture, week: Week): Outcome[] {
  const one = makeScorer(fx, week);
  return fx.expect.map(one);
}
