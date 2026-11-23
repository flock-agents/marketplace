// TRUTH in the planner's own shapes (result.ts SetupOut): what Eval 2 loads into a fresh planner, and what Eval 1's
// --self-test scores against itself. Plus the Eval 2 perturbations: TRUTH with one deliberate defect.
import type { SavedDish, SavedRule, SetupOut } from "./result";
import { BASE_TAGS, canonTag, tagsOfName, withParents } from "./vocab";
import { MAIN_SLOTS, WEEK, sameName, type Household, type TruthDish, type TruthSlot, type Weekday } from "./truth";

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

export function setupOfTruth(h: Household): SetupOut {
  const t = h.truth;
  const tags = ruleTags(h);
  const slots = t.slots.filter((s) => !s.optional);
  const library: SavedDish[] = t.library.filter((d) => slots.some((s) => s.name === d.slot)).map((d) => ({
    slot: d.slot, name: d.name, frequency: d.frequency ?? null, days: d.days ?? null,
    contains: [...truthTags(d)].filter((x) => tags.includes(x) || BASE_TAGS.includes(x as any)), contains_read: tags, origin: "setup_named",
  }));
  const rules: SavedRule[] = t.rules.map((r) => ({
    hard: r.hard, what: r.what, who: r.who ?? null, slots: r.slots ?? null, days: r.days ?? null, items: r.items ?? null, to: r.to ?? null,
    frequency: r.frequency ?? null, per_meal: r.per_meal ?? null, fasting_food: r.fasting_food ?? (r.what === "fasting" ? [] : null), quote: quoteOf(h, r.quote),
  }));
  const attendance: SetupOut["attendance"] = {};
  for (const s of slots) {
    attendance[s.name] = {};
    for (const day of s.days?.length ? s.days : WEEK) attendance[s.name]![day] = weeklyPeople(h, s, day);
  }
  // A deep copy: callers mutate it (perturbations, tests), and TRUTH shares arrays like SCHOOL.
  return copy({
    ok: true,
    slots: slots.map((s) => ({ name: s.name, kind: s.kind, addon_of: s.addon_of ?? null, usual_people: s.usual_people ?? [], days: s.days ?? [], skip_days: s.skip_days ?? [] })),
    library, rules, seed: t.seed.map((x) => ({ slot: x.slot, dishes: [...x.dishes] })),
    cook: t.cook ? { name: t.cook.name, days: t.cook.days, visits: t.cook.visits } : null,
    family_cooks: t.familyCooks, unplaced: (t.noted ?? []).map((n) => ({ text: quoteOf(h, n.re), quote: quoteOf(h, n.re) })),
    lunch_unclear: t.lunchUnclear ?? [], attendance, settings: { new_dishes_per_week: 2 },
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
