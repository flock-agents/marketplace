// A planner setup as rows: what Eval 1's apply_setup left in the database, or TRUTH in the planner's terms. Eval 2 loads one
// into a fresh planner through the app's own routes (no model), so a week can be planned from a perfect setup, from Eval 1's,
// or from TRUTH with one deliberate defect (--perturb).
import type { boot } from "../../server/testkit";
import { WEEK, type Household, type PlannerRule } from "./truth";

type Kit = Awaited<ReturnType<typeof boot>>;

export type Setup = {
  people: { name: string; group: string; relationship?: string; note?: string }[];
  cook: { name: string; days: string[]; visits: { at: string; meals?: string[] }[]; time_limit?: string | null; note?: string | null } | null;
  extraSlots: { name: string; days?: string[]; for?: string[] }[];
  orderIn: { day: string; slot: string; note?: string }[];
  rules: (PlannerRule & { often?: string })[];
  dishes: { name: string; slots: string[]; for?: string[]; often?: string; per_week?: number; days?: string[] }[];
  examples: { slot: string; group?: string; words: string }[];
};

/** TRUTH as a setup: hard rules as checked rules, soft notes as notes of their person, who cooks on the cook's days off as
 *  the notes apply_setup writes ("Neha cooks", on that day). */
export function setupOfTruth(h: Household): Setup {
  const t = h.truth;
  const cookTime = h.facts.find((f) => f.id === "cookTime")?.text;
  return {
    people: t.people.map((p) => ({ name: p.name, group: p.group, ...(p.age !== undefined ? { note: `age ${p.age}` } : {}) })),
    cook: t.cook ? { name: t.cook.name, days: t.cook.days, visits: t.cook.visits, ...(cookTime && /hour|dish|minutes/i.test(cookTime) ? { time_limit: cookTime } : {}) } : null,
    extraSlots: t.extraSlots.map((s) => ({ name: s.name, ...(s.days ? { days: s.days } : {}), ...(s.for ? { for: s.for } : {}) })),
    orderIn: t.orderIn,
    rules: [
      ...t.hardRules.map((r) => r.rule),
      ...t.softNotes.map((n): PlannerRule & { often?: string } => n.rule ?? ({ kind: "other", ...(n.who ? { who: n.who } : {}), note: n.text, ...(n.often ? { often: n.often } : {}) })),
      ...t.homeCook.flatMap((c) => c.days.filter((d) => !t.cook?.days.includes(d)).map((d) => ({ kind: "other", days: [d], ...(c.slots ? { slots: c.slots } : {}), note: `${c.by} cooks` }))),
    ],
    dishes: t.dishes.map((d) => ({ name: d.name, slots: d.slots, ...(d.for ? { for: d.for } : {}), ...(d.often ? { often: d.often } : {}), ...(d.per_week ? { per_week: d.per_week } : {}), ...(d.days ? { days: d.days } : {}) })),
    examples: t.examples.map((e) => ({ slot: e.slot, ...(e.group ? { group: e.group } : {}), words: e.words })),
  };
}

const json = (s: string | null | undefined) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

/** The setup a planner database holds now (after apply_setup). Fields the current code does not have (a dish's `often`)
 *  are read when present. */
export async function setupOfDb(k: Kit): Promise<Setup> {
  const fam = (await k.owner("GET", "/api/family")).body;
  const h = fam.house;
  return {
    people: fam.people.map((p: any) => ({ name: p.name, group: p.group, ...(p.relationship ? { relationship: p.relationship } : {}), ...(p.note ? { note: p.note } : {}) })),
    cook: h.cook_name ? { name: h.cook_name, days: h.cook_days ?? [], visits: h.cook_visits ?? [], time_limit: h.cook_time_limit, note: h.cook_note } : null,
    extraSlots: h.extra_slots ?? [],
    orderIn: h.order_in ?? [],
    rules: h.rules ?? [],
    dishes: k.rows("dish_book").filter((b) => b.slots).map((b) => ({ name: b.name, slots: json(b.slots) ?? [], ...(json(b.eaten_by) ? { for: json(b.eaten_by) } : {}),
      ...(b.often ? { often: b.often } : {}), ...(b.per_week != null ? { per_week: b.per_week } : {}), ...(json(b.days) ? { days: json(b.days) } : {}) })),
    examples: h.meal_examples ?? [],
  };
}

/** Load a setup into a fresh planner through its own routes, one thing at a time; what a route refuses is listed. Fields the
 *  current code does not take (a dish's or a rule's `often`) are sent, and dropped and sent again if refused. */
export async function loadSetup(k: Kit, s: Setup): Promise<string[]> {
  const refused: string[] = [];
  const post = async (path: string, body: any, what: string, retry?: any) => {
    let r = await k.owner("POST", path, body);
    if (r.status >= 300 && retry) r = await k.owner("POST", path, retry);
    if (r.status >= 300) refused.push(`${what}: ${r.body?.reason ?? r.status}`);
  };
  for (const p of s.people) await post("/api/family/people", p, `person ${p.name}`);
  if (s.cook) await post("/api/family/cook", { name: s.cook.name, days: s.cook.days.length ? s.cook.days : WEEK, arrival: s.cook.visits,
    ...(s.cook.time_limit ? { time_limit: s.cook.time_limit } : {}), ...(s.cook.note ? { note: s.cook.note } : {}) }, "cook");
  if (s.extraSlots.length) await post("/api/family/slots", { add: true, extra_slots: s.extraSlots }, "extra slots");
  for (const o of s.orderIn) await post("/api/family/slots", { add: true, order_in: [o] }, `order in ${o.day} ${o.slot}`);
  for (const r of s.rules) {
    const { often, ...plain } = r;
    await post("/api/family/rules", { add: true, rules: [r] }, `rule ${JSON.stringify(plain)}`, often ? { add: true, rules: [plain] } : undefined);
  }
  for (const d of s.dishes) {
    const { often, per_week, days, ...plain } = d;
    await post("/api/dish-book/family", { dishes: [d] }, `dish ${d.name}`, often || per_week || days ? { dishes: [plain] } : undefined);
  }
  if (s.examples.length) await post("/api/family/meal-examples", { examples: s.examples }, "meal examples");
  return refused;
}

// ── Robustness: TRUTH with one defect ──

export const PERTURBATIONS = {
  lunch_restricted: "every Lunch dish restricted to two of the people (live bug: all lunch dishes tagged Ankita + Gowri Shankar)",
  thin_dishes: "only two dishes known for Lunch and two for Dinner",
  no_examples: "no meal examples at all",
  lunch_misfiled: "half of the Lunch dishes saved under Breakfast or Dinner instead",
  personal_dish: "a personal occasional dish (curd rice when he's tired) for one person, with no frequency",
} as const;
export type Perturbation = keyof typeof PERTURBATIONS;

/** TRUTH's setup with one defect. */
export function perturb(h: Household, s: Setup, kind: Perturbation): Setup {
  const out: Setup = JSON.parse(JSON.stringify(s));
  const ppl = h.truth.people;
  switch (kind) {
    case "lunch_restricted": {
      const adult = ppl.find((p) => p.group === "adult")!, second = ppl.find((p) => p.group === "elder") ?? ppl.filter((p) => p.group === "adult")[1] ?? ppl[1];
      for (const d of out.dishes) if (d.slots.includes("Lunch")) d.for = [adult.name, second.name];
      break;
    }
    case "thin_dishes": {
      for (const slot of ["Lunch", "Dinner"]) {
        let kept = 0;
        out.dishes = out.dishes.flatMap((d) => {
          if (!d.slots.includes(slot)) return [d];
          if (kept < 2 && !d.for) { kept++; return [d]; }
          const rest = d.slots.filter((x) => x !== slot);
          return rest.length ? [{ ...d, slots: rest }] : [];
        });
      }
      break;
    }
    case "no_examples": out.examples = []; break;
    case "lunch_misfiled": {
      let i = 0;
      for (const d of out.dishes) if (d.slots.length === 1 && d.slots[0] === "Lunch" && i++ % 2 === 0) d.slots = [i % 4 === 1 ? "Breakfast" : "Dinner"];
      break;
    }
    case "personal_dish": {
      const who = ppl.find((p) => p.group === "child") ?? ppl[0];
      out.dishes = out.dishes.filter((d) => !/curd rice/i.test(d.name));
      out.dishes.push({ name: "Curd rice", slots: ["Dinner"], for: [who.name] });
      break;
    }
  }
  return out;
}

/** The person the personal-dish defect names. */
export const personalDishOwner = (h: Household) => (h.truth.people.find((p) => p.group === "child") ?? h.truth.people[0]).name;
