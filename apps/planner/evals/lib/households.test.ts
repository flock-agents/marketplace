// The fixtures themselves: every name, slot and quote in TRUTH refers to something in the household, the held-out set is
// kept apart, and TRUTH scores 100% against itself in Eval 1.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { ALL_HOUSEHOLDS, HELDOUT, HOUSEHOLDS, pick } from "../households";
import { scoreSetup } from "./score-setup";
import { setupOfTruth } from "./truth-setup";
import { expectedSlotDays } from "./score-plan";
import { catalogKindNamed, isBareKindWord, kindOf } from "./catalog";
import { plain, sameName, WEEK, type Household } from "./truth";

const MANIFEST = JSON.parse(readFileSync(join(import.meta.dir, "../../flock.app.json"), "utf8"));
/** The interview's question ids (Task 11 manifest), in order. */
const QUESTION_IDS: string[] = [...new Set((MANIFEST.setup as { id: string }[]).map((q) => q.id))];
/** A slot's TRUTH words for its parts: each kind, sub-kind (and each name of it) and the family's words, plain. */
function partWords(h: Household, slot: string): Set<string> {
  const meal = h.truth.meals?.find((m) => m.slot === slot);
  return new Set((meal?.templates ?? []).flatMap((tp) => tp.parts.flatMap((p) => ("kind" in p && !("from" in p)
    ? [p.kind, ...(p.sub ? [p.sub, ...p.sub.split("/")] : []), ...(p.words ? [p.words] : [])] : []))).map(plain));
}
/** A word of a slot's TRUTH parts by the catalog: a coarse kind's or sub-kind's own word ("Bhaji", "Fish", "Eggs") whose kind
 *  one of the slot's parts names. */
function kindWordOf(h: Household, slot: string, name: string): boolean {
  const meal = h.truth.meals?.find((m) => m.slot === slot);
  const kinds = new Set((meal?.templates ?? []).flatMap((tp) => tp.parts.flatMap((p) => ("kind" in p && !("from" in p) ? [p.kind] : []))));
  const hit = kindOf(name);
  return isBareKindWord(name) && !!hit && kinds.has(hit.kind);
}
/** A slot's TRUTH dishes named in its parts: a fixed-dishes part's, a kind part's one dish. */
function partDishes(h: Household, slot: string): Set<string> {
  const meal = h.truth.meals?.find((m) => m.slot === slot);
  return new Set((meal?.templates ?? []).flatMap((tp) => tp.parts.flatMap((p) => ("items" in p ? p.items : "dish" in p && p.dish ? [p.dish] : []))).map(plain));
}
/** Every file under a directory, recursively. */
const filesUnder = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const x = join(dir, f); return statSync(x).isDirectory() ? filesUnder(x) : [x]; });

describe("households", () => {
  test("ids are unique; held-out never in the tuning set or picked by default", () => {
    const ids = ALL_HOUSEHOLDS.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const h of HELDOUT) { expect(HOUSEHOLDS).not.toContain(h); expect(pick(undefined)).not.toContain(h); expect(pick(h.id.split("-")[0])).not.toContain(h); }
    expect(pick(undefined, { heldout: true })).toEqual(HELDOUT);
    expect(pick("h9", { heldout: true }).map((h) => h.id)).toEqual(["h9-mehta"]);
  });

  for (const h of ALL_HOUSEHOLDS) describe(h.id, () => {
    const t = h.truth;
    const people = t.people.map((p) => p.name);
    const known = (n: string) => people.some((p) => sameName(p, n));
    const slotNames = t.slots.map((s) => s.name);
    const words = [...h.facts.map((f) => f.text), ...(h.correction ? [h.correction.corrected, h.correction.line] : []), ...Object.values(h.household).map((v) => JSON.stringify(v))].join("\n");

    test("people match Flock's household.people", () => {
      const flock = (h.household["household.people"] as { name: string }[]).map((p) => p.name);
      expect(people.sort()).toEqual([...flock].sort());
    });
    test("every person named in slots, absences, rules and family cooks is in the household", () => {
      for (const s of t.slots) for (const p of s.usual_people ?? []) expect(known(p)).toBe(true);
      for (const a of t.away) expect(known(a.person)).toBe(true);
      for (const r of t.rules) if (r.who) expect(known(r.who)).toBe(true);
      for (const c of t.familyCooks) expect(known(c.person)).toBe(true);
      for (const p of t.lunchUnclear ?? []) expect(known(p)).toBe(true);
    });
    test("every slot named by the library, seed, rules, absences and add-ons exists", () => {
      for (const d of t.library) { expect(slotNames).toContain(d.slot); for (const x of d.alsoSlots ?? []) expect(slotNames).toContain(x); }
      for (const r of t.seed) expect(slotNames).toContain(r.slot);
      for (const r of t.rules) for (const s of r.slots ?? []) expect(slotNames).toContain(s);
      for (const a of t.away) for (const s of a.slots) expect(slotNames).toContain(s);
      for (const s of t.slots.filter((x) => x.kind === "addon")) expect(slotNames).toContain(s.addon_of!);
      for (const s of t.slots.filter((x) => x.kind !== "main")) expect(s.match).toBeDefined();
    });
    // A category word left the library (spec §5.3) but stays in the past week's plates: it must be the very word of one of the
    // slot's TRUTH parts (its kind, sub-kind or their words), so no removed row's word is lost from TRUTH.
    test("seed dishes are library dishes of their slot, or their words for one of its parts (history keeps the words)", () => {
      for (const r of t.seed) for (const d of r.dishes) expect([r.slot, d, t.library.some((x) => x.name === d && x.slot === r.slot) || partWords(h, r.slot).has(plain(d))]).toEqual([r.slot, d, true]);
    });
    test("every rule's quote and every noted item is something the family said", () => {
      for (const r of t.rules) expect(r.quote.test(words)).toBe(true);
      for (const n of t.noted ?? []) expect(n.re.test(words)).toBe(true);
    });
    test("a hard rule never carries a frequency", () => {
      for (const r of t.rules.filter((x) => x.hard)) expect(r.frequency).toBeUndefined();
    });
    test("household.weekly names household people and weekdays", () => {
      const weekly = (h.household["household.weekly"] ?? []) as { person: string; weekdays: string[] }[];
      expect(weekly.length).toBeGreaterThan(0);
      for (const w of weekly) { expect(known(w.person)).toBe(true); for (const d of w.weekdays) expect(WEEK).toContain(d as any); }
    });
    test("TRUTH scores 100% against itself (Eval 1 self-test)", () => {
      const s = scoreSetup(h, setupOfTruth(h));
      const fails = Object.entries(s.rates).filter(([, [p, n]]) => p < n);
      expect(fails.length ? s.notes : []).toEqual([]);
    });
    test("the week expects a slot-day for every main slot on every day it is not skipped", () => {
      const exp = expectedSlotDays(h, "2026-11-30");
      for (const s of t.slots.filter((x) => x.kind === "main")) for (const day of WEEK)
        if (!(s.skip_days ?? []).some((k) => k.day === day)) {
          const e = exp.find((x) => x.slot === s.name && x.day === day);
          // A slot nobody is at that day (everyone out at lunch) is not expected.
          if (e) expect(e.people.length + e.guests).toBeGreaterThan(0);
        }
    });
  });
});

// Kinds model (25 Nov): TRUTH's cuisines are catalog words; its meals name its own slots and only shapes the app accepts
// (server/kinds.ts checkMealShape, through the adapter); every family dish at a slot with a meal has a kind.
describe("households: kinds model truth", () => {
  test("cuisines are the catalog's words; meals are on real slots and pass the app's shape check", async () => {
    const { CUISINES } = await import("./catalog");
    const { shapeErrors } = await import("./adapter");
    for (const h of ALL_HOUSEHOLDS) {
      for (const c of [...(h.truth.cuisines ?? []), ...(h.truth.cuisinesAlso ?? [])]) expect(CUISINES).toContain(c);
      for (const m of h.truth.meals ?? []) expect(h.truth.slots.some((s) => s.name === m.slot && !s.optional)).toBe(true);
      expect(shapeErrors(setupOfTruth(h))).toEqual([]);
      const meals = new Set((h.truth.meals ?? []).map((m) => m.slot));
      // A dish with no catalog kind is a fixed dish of theirs (an items part, or what a swap gives: "Pancakes"), never a kind.
      const fixed = new Set([...(h.truth.meals ?? []).flatMap((m) => m.templates.flatMap((tp) => tp.parts.flatMap((p) => ("items" in p ? p.items : [])))),
        ...h.truth.rules.flatMap((r) => (r.gives && "item" in r.gives ? [r.gives.item] : []))]);
      const unmapped = setupOfTruth(h).library.filter((d) => meals.has(d.slot) && !d.kind && !fixed.has(d.name)).map((d) => `${d.slot}: ${d.name}`);
      expect(unmapped).toEqual([]);
    }
    // The tier households (e2e) all have cuisines and meals.
    for (const id of ["h1", "h2", "h3", "h4", "h5", "h6", "h7", "h8", "h13", "h14"]) { const h = pick(id)[0]; expect(h.truth.cuisines?.length).toBeGreaterThan(0); expect(h.truth.meals?.length).toBeGreaterThan(0); }
  });
});

// One meaning model (spec §5, §6.3b, §7, §10): the households in the new shapes.
describe("households: the one meaning model's shapes", () => {
  test("every household's facts answer the new question ids", () => {
    for (const h of ALL_HOUSEHOLDS) {
      for (const f of h.facts) expect([h.id, f.id, [...QUESTION_IDS, "correction"].includes(f.id)]).toEqual([h.id, f.id, true]);
      if (h.correction) for (const id of [h.correction.after, h.correction.fact]) expect([h.id, id, QUESTION_IDS.includes(id)]).toEqual([h.id, id, true]);
      // "Does the child eat what the family eats?" says whether childMeals is asked: only a household with children says it.
      const same = h.facts.find((f) => f.id === "childSame");
      if ((h.household["household.children"] as string[] | undefined)?.length) expect([h.id, typeof same?.differs]).toEqual([h.id, "boolean"]);
    }
  });

  test("every TRUTH template part is a real catalog kind/sub, an own kind, items, or a link to a slot of that household", () => {
    for (const h of ALL_HOUSEHOLDS) for (const m of h.truth.meals ?? []) for (const tp of m.templates) for (const p of tp.parts) {
      const at = `${h.id} ${m.slot} ${JSON.stringify(p)}`;
      if ("items" in p) { expect([at, p.items.length > 0]).toEqual([at, true]); continue; }
      if ("from" in p) {
        expect([at, h.truth.slots.some((s) => s.name === p.from && s.name !== m.slot)]).toEqual([at, true]);
        if (p.kind) expect([at, !!catalogKindNamed(p.kind)]).toEqual([at, true]);
        continue;
      }
      if (m.own?.includes(p.kind)) continue;
      const k = catalogKindNamed(p.kind);
      expect([at, !!k && (!p.sub || k.subs.some((s) => s.name === p.sub))]).toEqual([at, true]);
      // Their bare word's one dish is a catalog item of that kind (and sub-kind).
      if (p.dish) { const hit = kindOf(p.dish); expect([at, hit?.by === "item" && hit.kind === p.kind && (!p.sub || hit.sub === p.sub)]).toEqual([at, true]); }
    }
  });

  test("no TRUTH library row is a category word of a TRUTH part", () => {
    for (const h of ALL_HOUSEHOLDS) for (const d of h.truth.library) {
      const meal = h.truth.meals?.find((m) => m.slot === d.slot);
      if (!meal) continue;
      const word = partWords(h, d.slot).has(plain(d.name)) || kindWordOf(h, d.slot, d.name);
      // Their dish: a part's dish, a catalog item, or a kind of their own (their "Smoothie" is that dish).
      const dish = partDishes(h, d.slot).has(plain(d.name)) || kindOf(d.name)?.by === "item" || !!meal.own?.some((o) => plain(o) === plain(d.name));
      expect([h.id, d.slot, d.name, word && !dish]).toEqual([h.id, d.slot, d.name, false]);
    }
  });

  test("every household names its speaker as self exactly once, and no one 'me'", () => {
    for (const h of ALL_HOUSEHOLDS) {
      const people = h.household["household.people"] as { name: string; relation?: string }[];
      const self = people.filter((p) => p.relation === "self");
      const speaker = (h.household["household.speaker"] as string | undefined) ?? h.owner;
      expect([h.id, self.length, self[0]?.name]).toEqual([h.id, 1, speaker]);
      for (const p of people) expect([h.id, /^(me|i|myself)$/i.test(p.name)]).toEqual([h.id, false]);
      for (const w of (h.household["household.weekly"] ?? []) as { person: string }[]) expect([h.id, /^(me|i|myself)$/i.test(w.person)]).toEqual([h.id, false]);
    }
  });

  test("who looks after meals, groceries and school is a list of names", () => {
    for (const h of ALL_HOUSEHOLDS) {
      const names = (h.household["household.people"] as { name: string }[]).map((p) => p.name);
      for (const key of ["household.mealsBy", "household.groceriesBy", "household.schoolBy"]) {
        const v = h.household[key];
        if (v === undefined) continue;
        expect([h.id, key, Array.isArray(v) && v.length > 0]).toEqual([h.id, key, true]);
        for (const x of v as { person: unknown; part?: unknown }[]) {
          expect([h.id, key, typeof x.person === "string" && names.includes(x.person as string)]).toEqual([h.id, key, true]);
          expect([h.id, key, x.part === undefined || typeof x.part === "string"]).toEqual([h.id, key, true]);
          expect(Object.keys(x).every((k) => k === "person" || k === "part")).toBe(true);
        }
      }
    }
  });

  test("the planner's server never reads the looked-after-by facts as text", () => {
    // A reader added later must change this test on purpose (and read the list shape, spec §6.3b).
    const root = join(import.meta.dir, "../..");
    const dirs = ["server", "src", "evals/lib"].map((d) => join(root, d));
    const files = dirs.flatMap(filesUnder).filter((f) => /\.(ts|tsx|js)$/.test(f) && !f.endsWith(".test.ts") && !f.includes("node_modules"));
    const readers = files.filter((f) => /mealsBy|groceriesBy|schoolBy/.test(readFileSync(f, "utf8")));
    expect(readers).toEqual([]);
  });

  test("h18's transcript is the walk-through's answers", () => {
    const h = ALL_HOUSEHOLDS.find((x) => x.id === "h18-shiva-walkthrough")!;
    expect(h).toBeDefined();
    expect(HOUSEHOLDS).toContain(h);
    const tr = h.transcript ?? [];
    expect(tr.filter((l) => l.startsWith("A: ")).length).toBe(14);
    expect(tr.filter((l) => l.startsWith("Q: ")).length).toBe(14);
    expect(tr).toContain("A: lunch is mostly south indian - rice, dry sabji, and something like sambar/rasam/kootu/kadhi/dal/etc. I take 4 eggs for my lunch and some salad. Dad doesnt eat egg or salad. Ankita doesnt carry lunch.");
    // The Q lines are the manifest's asks as Flock fills them (the cook unnamed, the child by name).
    expect(tr).toContain("Q: Which meals does your cook make, and when does she come?");
    expect(tr).toContain("Q: On her days off, who cooks, and is any meal eaten out or ordered in?");
    expect(tr).toContain("Q: Does Agastya eat what the family eats, or something else at some meals? Does Agastya carry a box to school?");
    expect(tr).toContain("Q: What did the family have for breakfast over the past week? Tell me the dishes.");
  });

  // F8 (Task 15 D1, lead's ruling): Dad's egg and salad were already heard in the lunch answer, so Flock asks `differently` in
  // its recall form (spec §6.2, §10), the manifest's `recall` with {{heard}} filled; the A line stays word for word.
  test("h18 asks differently in its recall form, naming Dad, and keeps the family's '4 eggs'", () => {
    const h = ALL_HOUSEHOLDS.find((x) => x.id === "h18-shiva-walkthrough")!;
    const tr = h.transcript ?? [];
    const recall = (MANIFEST.setup as { id: string; recall?: string }[]).find((q) => q.id === "differently")!.recall!;
    const line = `Q: ${recall.replace("{{heard}}", "Dad doesn't eat egg or salad")}`;
    expect(line).toBe("Q: You mentioned Dad doesn't eat egg or salad. Anything else, for anyone, like an allergy or a fasting day?");
    const a = tr.indexOf(`A: ${h.facts.find((f) => f.id === "differently")!.text}`);
    expect(a).toBeGreaterThan(0);
    expect(tr[a - 1]).toBe(line);
    expect(tr).toContain("A: he doesnt eat eggs. nothing too spicy, but nothing else. on saturdays we make egg curry sometimes. And have bread omlette for sunday breakfast. Dad doesnt eat egg. Others are okay with it. So we have to make something else for him if we make egg curry or if mains contains eggs");
    // The library keeps the family's words (spec §5.1): "4 eggs", never a "4 boiled eggs" they did not say.
    expect(h.truth.library.filter((d) => d.slot === "Shiva's lunch box").map((d) => d.name)).toEqual(["4 eggs"]);
    const box = h.truth.meals!.find((m) => m.slot === "Shiva's lunch box")!;
    expect(box.templates.flatMap((tp) => tp.parts.flatMap((p) => ("items" in p ? p.items : [])))).toEqual(["4 eggs"]);
    expect(JSON.stringify(h.truth)).not.toContain("boiled");
  });
});

// The interview sim asks the manifest's questions as Flock fills them (spec §10 placeholders; first matching variant wins).
describe("interview sim: the new questions, filled as Flock fills them", () => {
  const asks = async (id: string) => (await import("./interview")).questionsFor(ALL_HOUSEHOLDS.find((h) => h.id === id)!);
  test("no placeholder is left in any household's questions; none asked twice", async () => {
    for (const h of ALL_HOUSEHOLDS) {
      const qs = (await import("./interview")).questionsFor(h);
      for (const q of qs) expect([h.id, q.id, /\{\{/.test(q.ask)]).toEqual([h.id, q.id, false]);
      expect(new Set(qs.map((q) => q.id)).size).toBe(qs.length);
    }
  });
  test("the cook by her name, the child by name, the lunch line with the speaker as you", async () => {
    const qs = await asks("h3-shiva");
    const ask = (id: string) => qs.find((q) => q.id === id)?.ask;
    expect(ask("lunchWhere")).toBe("On weekdays you and Ankita are at the office and Agastya is at school till 2:30; Gowri Shankar has lunch at home. Who carries lunch from home, and who eats out?");
    expect(ask("cook")).toBe("Which meals does Lakshmi make, and when does she come?");
    expect(ask("cookTime")).toBe("Is Lakshmi short of time, so only a few dishes?");
    expect(ask("otherDays")).toBe("On her days off, who cooks, and is any meal eaten out or ordered in?");
    expect(ask("childSame")).toBe("Does Agastya eat what the family eats, or something else at some meals? Does Agastya carry a box to school?");
    expect(ask("childMeals")).toBe("What does Agastya have at those meals, and what goes in the box?");
    expect(qs.map((q) => q.id)).toEqual(["pain", "apps", "mainApp", "lunchWhere", "cook", "cookTime", "otherDays", "childSame", "familyBreakfast", "familyLunch", "familyDinner", "childMeals", "differently", "subscriptions"]);
  });
  test("no cook: the no-cook otherDays; two children named together; no children: no child questions", async () => {
    const h2 = await asks("h2-iyer");
    expect(h2.some((q) => q.id === "cook" || q.id === "cookTime")).toBe(false);
    expect(h2.find((q) => q.id === "otherDays")?.ask).toBe("Who cooks at home, and is any meal eaten out or ordered in, on which days?");
    expect((await asks("h6-kulkarni")).find((q) => q.id === "childSame")?.ask).toBe("Does Aditi and Ishaan eat what the family eats, or something else at some meals? Does Aditi and Ishaan carry a box to school?");
    expect((await asks("h7-menon")).some((q) => q.id === "childSame" || q.id === "childMeals")).toBe(false);
  });
  test("childMeals is asked only when the childSame answer says a child differs", async () => {
    for (const h of ALL_HOUSEHOLDS) {
      const differs = h.facts.find((f) => f.id === "childSame")?.differs === true;
      const qs = (await import("./interview")).questionsFor(h);
      expect([h.id, qs.some((q) => q.id === "childMeals")]).toEqual([h.id, differs]);
    }
  });
});
