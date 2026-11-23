// Eval 2's scorecard: a planned week against TRUTH, in code. Read straight from the planner's tables (plan_meals, dishes,
// dish_items), with who eats each dish; checked independently of the planner's own checks (only its food vocabulary,
// rules.ts dishHas / isSide and meals.ts isStaple, is reused, so "paneer" is dairy here as it is there).
import { dishHas, isSide } from "../../server/rules";
import { isStaple } from "../../server/meals";
import type { boot } from "../../server/testkit";
import { oftenMax, plain, sameName, slotFor, truthDishOf, WEEK, type Household, type TruthDish, type Weekday } from "./truth";
import type { Rates } from "./score-setup";

type Kit = Awaited<ReturnType<typeof boot>>;
export type PDish = { name: string; eaters: string[]; portion_note: string | null; items: string[] };
export type PMeal = { day: Weekday; date: string; slot: string; ordered_in: boolean; dishes: PDish[] };
export type Week = PMeal[];

const MAINS = ["Breakfast", "Lunch", "Dinner"];
const dateOf = (week: string, i: number) => { const d = new Date(`${week}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); };

/** The week as planned, each dish with the people who eat it (everyone: the meal's diners). */
export async function readWeek(k: Kit, h: Household, week: string): Promise<{ meals: Week; slotNames: Map<string, string> }> {
  const house = (await k.owner("GET", "/api/family")).body.house;
  const slotNames = new Map<string, string>();
  for (const t of h.truth.extraSlots) { const s = slotFor(t, house.extra_slots ?? []); if (s) slotNames.set(t.name, s); }
  const extra = (house.extra_slots ?? []) as { name: string; for?: string[] }[];
  const all = h.truth.people.map((p) => p.name);
  const meals = k.rows("plan_meals").filter((m) => m.date >= week && m.date <= dateOf(week, 6));
  const dishes = k.rows("dishes"), items = k.rows("dish_items");
  const out: Week = meals.map((m) => {
    const i = WEEK.findIndex((_, n) => dateOf(week, n) === m.date);
    const diners = extra.find((s) => s.name === m.slot)?.for?.length ? extra.find((s) => s.name === m.slot)!.for! : all;
    return { day: WEEK[i], date: m.date, slot: m.slot, ordered_in: !!m.ordered_in,
      dishes: dishes.filter((d) => d.meal_id === m.id).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((d) => {
        const f: string[] | null = d.for_people ? JSON.parse(d.for_people) : null;
        const eaters = !f?.length || f.some((x) => /^everyone$/i.test(x)) ? diners : f;
        return { name: d.name, eaters, portion_note: d.portion_note, items: items.filter((x) => x.dish_id === d.id).map((x) => x.item) };
      }) };
  });
  out.sort((a, b) => a.date.localeCompare(b.date) || MAINS.indexOf(a.slot) - MAINS.indexOf(b.slot));
  return { meals: out, slotNames };
}

/** A week back from its text (weekText), for re-scoring a past run that kept only the text. */
export function weekOf(text: string, week: string): Week {
  const out: Week = [];
  for (const line of text.split("\n")) {
    const day = line.slice(0, 3) as Weekday, i = WEEK.indexOf(day);
    for (const part of line.slice(5).split(" | ")) {
      const at = part.indexOf(": ");
      const slot = part.slice(0, at), rest = part.slice(at + 2);
      const ordered = rest.startsWith("(ordered in");
      const dishes: PDish[] = [];
      if (!ordered) for (const m of rest.matchAll(/\s*([^[]+?)\s*\[([^\]]*)\](?:,|$)/g)) {
        const n = /^(.*?)(?: \((.*)\))?$/.exec(m[1].trim())!;
        dishes.push({ name: n[1], portion_note: n[2] ?? null, eaters: m[2].split(", ").filter(Boolean), items: [] });
      }
      out.push({ day, date: dateOf(week, i), slot, ordered_in: ordered, dishes });
    }
  }
  return out;
}

/** The week as text, for the judge and the report. */
export const weekText = (w: Week) => WEEK.map((day) => `${day}: ${w.filter((m) => m.day === day).map((m) => `${m.slot}: ${m.ordered_in ? "(ordered in / eaten out)"
  : m.dishes.map((d) => `${d.name}${d.portion_note ? ` (${d.portion_note})` : ""} [${d.eaters.join(", ")}]`).join(", ") || "(nothing)"}`).join(" | ")}`).join("\n");

const notMain = (name: string) => isSide(name) || isStaple(name);

export type PlanScore = { rates: Rates; notes: string[]; facts: Record<string, number | string> };

/** `extraPersonal`: a personal dish added by a defect (--perturb personal_dish), checked like the family's own. */
export function scorePlan(h: Household, w: Week, slotNames: Map<string, string>, plan: any, o: { extraPersonal?: TruthDish } = {}): PlanScore {
  const t = h.truth, rates: Rates = {}, notes: string[] = [], facts: Record<string, number | string> = {};
  const add = (field: string, ok: boolean, why?: string) => { const r = (rates[field] ??= [0, 0]); r[1]++; if (ok) r[0]++; else if (why) notes.push(`${field}: ${why}`); };
  const all = t.people.map((p) => p.name);
  const real = (slot: string) => slotNames.get(slot) ?? slot;
  const dinersOf = (slot: string) => t.extraSlots.find((s) => real(s.name) === slot)?.for ?? all;
  const fasting = (who: string, day: Weekday, slot: string) => t.hardRules.some((r) => r.check?.kind === "fasting" && sameName(r.check.who, who) && r.check.days.includes(day) && r.check.slots.includes(slot));
  const at = (day: Weekday, slot: string) => w.find((m) => m.day === day && m.slot === slot);
  const eats = (d: PDish, p: string) => d.eaters.some((e) => sameName(e, p));

  // 1. Every meal the family eats at home is planned; nothing at a meal eaten out or ordered in; no meal the family lacks.
  const expected = new Set<string>();
  for (const day of WEEK) {
    for (const slot of [...MAINS, ...t.extraSlots.filter((s) => !s.days || s.days.includes(day)).map((s) => real(s.name))]) {
      const diners = dinersOf(slot);
      if (diners.every((p) => fasting(p, day, slot))) continue;
      expected.add(`${day} ${slot}`);
      const ordered = t.orderIn.some((o) => o.day === day && o.slot === slot);
      const m = at(day, slot);
      if (ordered) add("order_in_kept", !m || m.ordered_in || !m.dishes.length, `${day} ${slot} has dishes though it is ${t.orderIn.find((o) => o.day === day && o.slot === slot)!.note}`);
      else add("meals_planned", !!m && !m.ordered_in && m.dishes.length > 0, `${day} ${slot}: ${!m ? "no meal" : m.ordered_in ? "marked ordered in" : "no dish"}`);
    }
  }
  const stray = w.filter((m) => m.dishes.length && !expected.has(`${m.day} ${m.slot}`));
  add("no_stray_meals", !stray.length, stray.map((m) => `${m.day} ${m.slot}`).join(", "));

  // 2. Hard rules, person by person, meal by meal.
  for (const hr of t.hardRules) {
    const c = hr.check;
    if (!c) continue;
    const breaks: string[] = [];
    for (const m of w) {
      if (m.ordered_in) continue;
      if ("days" in c && c.days?.length && !c.days.includes(m.day)) continue;
      if (c.kind !== "swap" && c.slots?.length && !c.slots.some((s) => real(s) === m.slot)) continue;
      const who = "who" in c && c.who ? [c.who] : dinersOf(m.slot);
      for (const p of who) for (const d of m.dishes.filter((x) => eats(x, p))) {
        const dish = { name: d.name, ingredients: d.items };
        if (c.kind === "fasting") breaks.push(`${m.day} ${m.slot}: ${p} has ${d.name}`);
        else if (c.kind === "avoid") { const i = c.items.find((x) => dishHas(dish, x)); if (i) breaks.push(`${m.day} ${m.slot}: ${d.name} for ${p} (${i})`); }
        else if (c.kind === "swap" && c.items.some((x) => dishHas(dish, x)) && !c.ok.test(`${d.name} ${d.portion_note ?? ""}`)) breaks.push(`${m.day} ${m.slot}: ${d.name} for ${p}`);
      }
    }
    const uniq = [...new Set(breaks)];
    add("hard_rules", !uniq.length, `${hr.title}: ${uniq.slice(0, 4).join("; ")}${uniq.length > 4 ? ` (+${uniq.length - 4})` : ""}`);
  }

  // 3. Everyone who eats a main meal has a main dish there.
  for (const m of w.filter((x) => MAINS.includes(x.slot) && !x.ordered_in && x.dishes.length)) {
    const hungry = dinersOf(m.slot).filter((p) => !fasting(p, m.day, m.slot) && !m.dishes.some((d) => !notMain(d.name) && eats(d, p)));
    add("everyone_fed", !hungry.length, `${m.day} ${m.slot}: no main for ${hungry.join(", ")}`);
  }

  // 4. Frequency: a personal or occasional dish not every day; a day-bound dish only on its days; "usually" most days.
  // Each planned dish is the family's dish it is most like, among all of them ("Rice" is Rice, not Curd rice).
  const book = [...t.dishes.filter((d) => !o.extraPersonal || plain(d.name) !== plain(o.extraPersonal.name)), ...(o.extraPersonal ? [o.extraPersonal] : [])];
  const dishDays = (td: TruthDish) => [...new Set(w.filter((m) => m.dishes.some((d) => truthDishOf(d.name, book) === td)).map((m) => m.day))];
  const personal = book.filter((d) => d.for);
  for (const td of personal) {
    const days = dishDays(td), max = td.per_week ?? oftenMax(td.often) ?? 3;
    add("personal_dish_freq", days.length <= max, `${td.name} [${td.for!.join("+")}] on ${days.length} days (${days.join(",")}), at most ${max}`);
  }
  // A one-person dish goes to its person: no one else is given it (Tanya's oats are not Nikhil's breakfast).
  for (const m of w.filter((x) => !x.ordered_in)) for (const d of m.dishes) {
    const td = truthDishOf(d.name, book);
    if (!td?.for || !td.slots.some((s) => real(s) === m.slot)) continue;
    const others = d.eaters.filter((e) => !td.for!.some((p) => sameName(p, e)));
    add("personal_dish_eaters", !others.length, `${m.day} ${m.slot}: ${d.name} (${td.for.join("+")}'s) given to ${others.join(", ")}`);
  }
  for (const td of book.filter((d) => d !== o.extraPersonal && (d.often || d.per_week || d.days))) {
    const days = dishDays(td);
    const max = td.per_week ?? oftenMax(td.often);
    const okCount = (max === null || days.length <= max) && (td.often !== "usually" || days.length >= 3);
    const okDays = !td.days || days.every((d) => td.days!.includes(d));
    add("dish_frequency", okCount && okDays, `${td.name} (${[td.often, td.per_week && `${td.per_week}/wk`, td.days?.join(",")].filter(Boolean).join(", ")}) planned on ${days.join(",") || "no day"}`);
  }
  for (const n of t.softNotes.filter((x) => x.per_week && x.items)) {
    const says = (d: PDish) => n.items!.some((i) => new RegExp(`\\b${i}`, "i").test(`${d.name} ${d.portion_note ?? ""}`) || dishHas({ name: d.name, ingredients: d.items }, i));
    const meals = w.filter((m) => !m.ordered_in && m.dishes.some((d) => eats(d, n.who!) && says(d)));
    add("soft_frequency", meals.length >= n.per_week![0] && meals.length <= n.per_week![1], `${n.who}: "${n.text}" in ${meals.length} meals (want ${n.per_week!.join("–")})`);
  }

  // 5. Meal shape against the family's own words: parts ±1, their staple when they name one.
  for (const ex of t.examples) {
    const slot = real(ex.slot);
    for (const m of w.filter((x) => x.slot === slot && !x.ordered_in && x.dishes.length)) {
      const diners = dinersOf(slot);
      const shared = m.dishes.filter((d) => d.eaters.length > 1 || diners.length === 1);
      const okParts = Math.abs(shared.length - ex.parts) <= 1;
      const okStaple = !ex.staple || m.dishes.some((d) => ex.staple!.test(d.name));
      add("meal_shape", okParts && okStaple, `${m.day} ${slot}: ${shared.length} shared parts (want ${ex.parts}±1)${okStaple ? "" : `, no ${ex.staple}`}: ${m.dishes.map((d) => d.name).join(", ")}`);
    }
  }

  // 6. Each meal from its own dishes: no breakfast or tiffin dish at lunch or dinner unless the family eats it there.
  for (const m of w.filter((x) => (x.slot === "Lunch" || x.slot === "Dinner") && !x.ordered_in)) {
    const off = m.dishes.filter((d) => { const td = truthDishOf(d.name, t.dishes); return td && !td.slots.includes(m.slot) && !td.slots.some((s) => s === "Lunch" || s === "Dinner"); });
    add("own_slot_dishes", !off.length, `${m.day} ${m.slot}: ${off.map((d) => d.name).join(", ")}`);
  }

  // Facts, not pass/fail: how much of the week is the family's own food, and what the planner said it could not do.
  const planned = w.flatMap((m) => m.dishes);
  facts.family_dish_share = planned.length ? Math.round((100 * planned.filter((d) => truthDishOf(d.name, t.dishes)).length) / planned.length) : 0;
  facts.dishes = planned.length;
  facts.unmet = (plan?.unmet ?? []).length;
  facts.flagged = (plan?.unmet ?? []).length || /don't know|only \d+ .* known|tell me a few/i.test(`${plan?.message ?? ""} ${plan?.say ?? ""}`) ? 1 : 0;
  return { rates, notes, facts };
}
