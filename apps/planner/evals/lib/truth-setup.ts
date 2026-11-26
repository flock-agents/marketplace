// TRUTH in the planner's own shapes (result.ts SetupOut): what Eval 2 loads into a fresh planner, and what Eval 1's
// --self-test scores against itself. Plus the Eval 2 perturbations: TRUTH with one deliberate defect.
import type { SavedDish, SavedMealKind, SavedRule, SavedSlot, SavedTarget, SavedTemplate, SetupOut } from "./result";
import { catalogKindNamed, kindOf } from "./catalog";
import { BASE_TAGS, canonTag, tagsOfName, withParents } from "./vocab";
import { MAIN_SLOTS, WEEK, sameName, type Household, type TruthDish, type TruthMeal, type TruthSlot, type TruthTarget, type Weekday } from "./truth";

/** The tags of a truth dish: its name's, plus its overrides, minus what it lacks. */
export function truthTags(d: TruthDish): Set<string> {
  const t = tagsOfName(d.name);
  for (const x of d.contains ?? []) for (const y of withParents([x])) t.add(y);
  for (const x of d.notContains ?? []) t.delete(canonTag(x));
  return t;
}

/** Every tag a household's rules name, with the base tags: what a contains read covers (spec §4.1). */
export function ruleTags(h: Household): string[] {
  return [...new Set([...BASE_TAGS, ...h.truth.rules.flatMap((r) => r.items ?? []).map(canonTag)])];
}

/** The family's sentence a quote pattern comes from (a persona fact, or a household fact). */
export function quoteOf(h: Household, re: RegExp): string {
  const texts = [...h.facts.map((f) => (f.id === h.correction.fact ? h.correction.corrected : f.text)), ...Object.values(h.household).filter((v): v is string => typeof v === "string")];
  for (const t of texts) {
    const m = re.exec(t);
    if (m) {
      // The sentence holding the match.
      const s = t.lastIndexOf(".", m.index) + 1, e = t.indexOf(".", m.index + m[0].length);
      return t.slice(s, e < 0 ? undefined : e + 1).trim();
    }
  }
  return re.source;
}

/** Who is at a slot on a weekday by the weekly pattern only (usual people minus weekly absences): the read-back's
 *  attendance. No fasts, no events, no skips. */
export function weeklyPeople(h: Household, slot: TruthSlot, day: Weekday): string[] {
  const all = h.truth.people.map((p) => p.name);
  const usual = slot.usual_people?.length ? slot.usual_people : all;
  const base = slot.kind === "addon" ? h.truth.slots.find((s) => s.name === slot.addon_of) : slot;
  return usual.filter((p) => !h.truth.away.some((a) => sameName(a.person, p) && a.days.includes(day) && (a.slots.includes(slot.name) || (!!base && a.slots.includes(base.name)))));
}

/** A TRUTH dish's place in the catalog: TRUTH's own kind where it gives one, else the eval's catalog reading; a dish its slot
 *  holds as a kind of the family's own is that kind. Kind and sub-kind only where the catalog has them; the item only when the
 *  name is the item. */
export function truthDishKind(d: TruthDish, meal?: TruthMeal): { kind: string | null; sub: string | null; catalog_item: string | null } {
  if (meal?.own?.some((o) => o.toLowerCase() === d.name.toLowerCase())) return { kind: d.name, sub: null, catalog_item: null };
  if (d.kind) return { kind: d.kind, sub: d.sub ?? null, catalog_item: null };
  const hit = kindOf(d.name);
  if (!hit) return { kind: null, sub: null, catalog_item: null };
  // A kind of one sub-kind names none (server/kinds.ts: "a kind of one sub-kind has no sub-kind of its own to name").
  const many = (catalogKindNamed(hit.kind)?.subs.length ?? 0) > 1;
  return { kind: hit.kind, sub: many ? hit.sub : null, catalog_item: hit.by === "item" ? hit.item : null };
}

/** A slot's expected kinds and templates (kinds model), from TRUTH's meal for it: every kind its templates name, its staples,
 *  its own kinds, and the family's own sub-kinds of each (their dishes' at that slot, and the templates'). */
export function mealShape(h: Household, slot: string): { kinds: SavedMealKind[]; templates: SavedTemplate[] } | null {
  const meal = h.truth.meals?.find((m) => m.slot === slot);
  if (!meal) return null;
  const kinds = new Map<string, SavedMealKind>();
  const kindNamed = (name: string) => kinds.get(name) ?? kinds.set(name, { name }).get(name)!;
  // A linked part's kind is the other meal's, not this one's.
  for (const tp of meal.templates) for (const p of tp.parts) if ("kind" in p && !("from" in p)) kindNamed(p.kind);
  for (const k of meal.staples ?? []) kindNamed(k);
  for (const [name, k] of kinds) {
    if (meal.staples?.includes(name)) k.staple = true;
    if (meal.own?.includes(name)) { k.own = true; continue; }
    const cat = catalogKindNamed(name);
    if (!cat || cat.subs.length < 2) continue;
    const subs = new Set<string>();
    for (const d of h.truth.library.filter((x) => x.slot === slot)) { const m = truthDishKind(d, meal); if (m.kind === name && m.sub) subs.add(m.sub); }
    for (const tp of meal.templates) for (const p of tp.parts) if ("kind" in p && !("from" in p) && p.kind === name && p.sub) subs.add(p.sub);
    if (subs.size) k.subs = [...subs];
  }
  return { kinds: [...kinds.values()], templates: meal.templates.map((tp) => ({ parts: tp.parts.map((p) => ({ ...p })), share: tp.share ?? null, ...(tp.said ? { said: tp.said } : {}), ...(tp.days ? { days: tp.days } : {}) })) };
}

/** A TRUTH target as the planner saves it (server/targets.ts RuleTarget). */
export function savedTarget(t: TruthTarget): SavedTarget {
  if ("ingredient" in t) return { type: "ingredient", tag: canonTag(t.ingredient) };
  if ("item" in t) return { type: "item", item: t.item, kind: t.kind ?? null };
  return "sub" in t ? { type: "sub", kind: t.kind, sub: t.sub } : { type: "kind", kind: t.kind };
}

/** The order a TRUTH slot is saved at: a main slot's own, a box that replaces a main meal at that meal's + 5 (server/db/constants.ts
 *  INSTEAD_STEP: only that box takes its people off the meal). Undefined: the adapter's default. */
export function slotOrder(h: Household, s: TruthSlot): number | undefined {
  const main = s.replaces ? h.truth.slots.find((x) => x.name === s.replaces) : undefined;
  return main ? ({ Breakfast: 10, Lunch: 30, Dinner: 50 } as Record<string, number>)[main.name] + 5 : undefined;
}

export function setupOfTruth(h: Household): SetupOut {
  const t = h.truth;
  const tags = ruleTags(h);
  const slots = t.slots.filter((s) => !s.optional);
  // Kinds model: when TRUTH states a slot's templates, its dishes carry their kinds too (Eval 2 then plans from the new shape);
  // otherwise kinds, templates and the dishes' kinds stay null and the planner derives them from the seed.
  const mealOf = (slot: string) => t.meals?.find((m) => m.slot === slot);
  const library: SavedDish[] = t.library.filter((d) => slots.some((s) => s.name === d.slot)).map((d) => ({
    slot: d.slot, name: d.name, frequency: d.frequency ?? null, days: d.days ?? null,
    contains: [...truthTags(d)].filter((x) => tags.includes(x) || BASE_TAGS.includes(x as any)), contains_read: tags, origin: "setup_named",
    ...(mealOf(d.slot) ? truthDishKind(d, mealOf(d.slot)) : {}),
  }));
  const rules: SavedRule[] = t.rules.map((r) => ({
    hard: r.hard, what: r.what, who: r.who ?? null, slots: r.slots ?? null, days: r.days ?? null, items: r.items ?? null, to: r.to ?? null,
    frequency: r.frequency ?? null, per_meal: r.per_meal ?? null, fasting_food: r.fasting_food ?? (r.what === "fasting" ? [] : null), quote: quoteOf(h, r.quote),
    ...(r.targets ? { targets: r.targets.map(savedTarget) } : {}), ...(r.gives ? { gives: savedTarget(r.gives) } : {}),
  }));
  const attendance: SetupOut["attendance"] = {};
  for (const s of slots) {
    attendance[s.name] = {};
    for (const day of s.days?.length ? s.days : WEEK) attendance[s.name]![day] = weeklyPeople(h, s, day);
  }
  // A deep copy: callers mutate it (perturbations, tests), and TRUTH shares arrays like SCHOOL.
  return copy({
    ok: true,
    slots: slots.map((s): SavedSlot => { const shape = mealShape(h, s.name); return { name: s.name, kind: s.kind, addon_of: s.addon_of ?? null, usual_people: s.usual_people ?? [], days: s.days ?? [], skip_days: s.skip_days ?? [],
      ...(s.extras ? { extras: true } : {}), ...(slotOrder(h, s) ? { order: slotOrder(h, s) } : {}), ...(shape ? shape : {}) }; }),
    library, rules, seed: t.seed.map((x) => ({ slot: x.slot, dishes: [...x.dishes] })),
    cook: t.cook ? { name: t.cook.name, days: t.cook.days, visits: t.cook.visits } : null,
    family_cooks: t.familyCooks, unplaced: (t.noted ?? []).map((n) => ({ text: quoteOf(h, n.re), quote: quoteOf(h, n.re) })),
    lunch_unclear: t.lunchUnclear ?? [], attendance, settings: { new_dishes_per_week: 2 },
    ...(t.cuisines ? { cuisines: [...t.cuisines] } : {}),
  });
}

// ── Robustness: TRUTH with one defect (spec §8 perturbations) ──

export const PERTURBATIONS = {
  thin_library: "only two non-staple dishes known for Lunch and for Dinner",
  no_seed: "no seed history at all (no 'looks like', no staples)",
  misfiled: "half of the Lunch-only dishes saved under Breakfast or Dinner instead",
  person_wrong_slot: "a person's own dishes (add-on / custom slot) saved on the shared main slot",
  missing_contains: "the tags the hard rules need left unread on half the dishes (the planner must fail closed)",
} as const;
export type Perturbation = keyof typeof PERTURBATIONS;

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const isStapleName = (s: SetupOut, slot: string, name: string) => {
  const rows = s.seed.filter((r) => r.slot === slot);
  return rows.length > 0 && rows.filter((r) => r.dishes.some((d) => d.toLowerCase() === name.toLowerCase())).length / rows.length >= 0.6;
};

/** TRUTH's setup with one defect; `moved` lists what was changed, for the report. */
export function perturb(h: Household, s0: SetupOut, kind: Perturbation): { setup: SetupOut; moved: string[] } {
  const s = copy(s0), moved: string[] = [];
  switch (kind) {
    case "thin_library":
      for (const slot of ["Lunch", "Dinner"]) {
        let kept = 0;
        s.library = s.library.filter((d) => {
          if (d.slot !== slot || isStapleName(s, slot, d.name)) return true;
          if (kept < 2) { kept++; return true; }
          moved.push(`${slot}: ${d.name} dropped`);
          return false;
        });
      }
      break;
    case "no_seed": moved.push(`${s.seed.length} seed rows dropped`); s.seed = []; break;
    case "misfiled": {
      const counts = new Map<string, number>();
      for (const d of s.library) counts.set(d.name, (counts.get(d.name) ?? 0) + 1);
      let i = 0;
      for (const d of s.library) if (d.slot === "Lunch" && counts.get(d.name) === 1 && !isStapleName(s, "Lunch", d.name) && i++ % 2 === 0) {
        d.slot = i % 4 === 1 ? "Breakfast" : "Dinner";
        moved.push(`${d.name}: Lunch → ${d.slot}`);
      }
      break;
    }
    case "person_wrong_slot": {
      const own = s.slots.filter((x) => x.kind !== "main");
      for (const d of s.library) {
        const sl = own.find((x) => x.name === d.slot);
        if (!sl) continue;
        const to = sl.addon_of ?? (/breakfast/i.test(sl.name) ? "Breakfast" : /dinner/i.test(sl.name) ? "Dinner" : "Lunch");
        moved.push(`${d.name}: ${d.slot} → ${to}`);
        d.slot = to;
      }
      // Two rows of one dish on one slot now: keep one.
      const seen = new Set<string>();
      s.library = s.library.filter((d) => { const k = `${d.slot}|${d.name.toLowerCase()}`; if (seen.has(k)) return false; seen.add(k); return true; });
      break;
    }
    case "missing_contains": {
      const need = [...new Set(h.truth.rules.filter((r) => r.hard).flatMap((r) => (r.items ?? []).map(canonTag)))];
      let i = 0;
      for (const d of s.library) if (i++ % 2 === 0) {
        d.contains_read = d.contains_read.filter((t) => !need.includes(t));
        d.contains = d.contains.filter((t) => !need.includes(t));
        moved.push(`${d.slot}: ${d.name} unread ${need.join("/")}`);
      }
      break;
    }
  }
  return { setup: s, moved };
}

/** The slots that are not main slots, for checks that need a person's own slot. */
export const ownSlots = (h: Household) => h.truth.slots.filter((x) => x.kind !== "main" && !x.optional);
export const isMain = (slot: string) => (MAIN_SLOTS as readonly string[]).includes(slot);
