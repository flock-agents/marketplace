// planChecks.ts on a hand-made week, no database and no model: the allergy rules (a family dish vouched for by the family's
// own plates, every other dish read carefully), onion and garlic as a note (kinds model rule 7), and the check a saved week is
// read against (changes.ts). The week's fill is fillWeek.test.ts's.
import { describe, expect, it } from "bun:test";
import { allergyNotes, checkSlot, forbidden, leaveOutNotes, mostlyOnion, notFor, onionNotes, placeOfDish, ruleBreaks, ruleUnknowns, slotFacts, swapNotes, swapsAt, vouched, type Proposal, type Week } from "./planChecks";
import { dishKey } from "./dishText";
import { resolveTarget, resolveTargets } from "./targets";
import type { PlanDay } from "./planDays";
import type { HistoryRow, LibraryDish, Rule, Slot } from "./slotStore";

const WEEK = ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"];
const READ = ["egg", "meat", "fish", "onion_garlic"];
const slot = (name: string, o: Partial<Slot> = {}): Slot => ({ id: name, name, kind: "main", addon_of: null, usual_people: [], days: [], skip_days: [], order: 30, active: true, extras: false, templates: null, ...o });
const dish = (name: string, slotName: string, o: Partial<LibraryDish> = {}): LibraryDish => ({ id: `${slotName}|${name}`, key: dishKey(name), slot: slotName, name, frequency: null, days: null, said: null,
  contains: [], contains_read: READ, origin: "setup_named", suggested: false, untried: false, offers: 0, disliked: false, prep: null, video_url: null, video_title: null,
  video_thumbnail: null, rating: null, rating_note: null, rated_on: null, rated_by: null, ratings: [], kind: null, sub: null, catalog_item: null, ...o });
const day = (date: string, slotName: string, people = ["Asha", "Ravi"]): PlanDay => ({ date, slot: slotName, people, guests: [], occasion: null, new_dishes_allowed: null, skip: null,
  edited: false, fixed: false, why: [], fasting: [], dishes: [], note: null });
const seed = (slotName: string, rows: string[][]): HistoryRow[] => rows.map((r) => ({ date: null, status: "confirmed", skip: null, dishes: r.map((d) => ({ dish: d })) }) as HistoryRow);
const rule = (o: Partial<Rule>): Rule => ({ id: "r", hard: true, what: "avoid", who: null, slots: null, days: null, items: null, to: null, targets: null, gives: null, frequency: null, per_meal: null, fasting_food: null, quote: "", ...o });

/** A week of the given slots, every day for Asha and Ravi. */
function week(o: { slots: Slot[]; library: LibraryDish[]; rules?: Rule[]; history?: Record<string, HistoryRow[]> }): Week {
  const w: Week = { days: o.slots.flatMap((s) => WEEK.map((d) => day(d, s.name))), slots: new Map(), rules: o.rules ?? [], library: o.library, facts: new Map(), done: new Set(),
    newDishes: new Map() };
  for (const s of o.slots) w.slots.set(s.name.toLowerCase(), slotFacts(s, o.library, o.history?.[s.name] ?? []));
  return w;
}
const plan = (rows: string[][]): Proposal => ({ days: new Map(WEEK.map((d, i) => [d, rows[i % rows.length]])) });

describe("allergies (owner 25 Nov)", () => {
  const peanut = rule({ who: "Ravi", items: ["peanut"], quote: "Ravi is allergic to peanuts" });
  const lib = [dish("Poha", "Breakfast", { contains: ["peanut"], contains_read: [...READ, "peanut"] }), dish("Upma", "Breakfast", { contains_read: READ }),
    dish("Peanut chikki", "Snack", { contains: ["peanut"], contains_read: [...READ, "peanut"] })];
  const make = (r: Rule) => {
    const w = week({ slots: [slot("Breakfast", { order: 10 }), slot("Snack", { kind: "custom", order: 40, usual_people: ["Asha"] })], library: lib, rules: [r],
      history: { Breakfast: seed("Breakfast", [["Poha"], ["Upma"]]), Snack: seed("Snack", [["Peanut chikki"]]) } });
    for (const d of w.days.filter((x) => x.slot === "Snack")) d.people = ["Asha"];
    return w;
  };
  it("a family dish on the plates of a slot the allergic person eats is safe by the family's word, no ask; its note keeps his portion aside", () => {
    const w = make(peanut);
    const d = w.days.find((x) => x.slot === "Breakfast")!;
    expect(vouched(w, peanut, "Poha")).toBe(true);
    expect(ruleUnknowns(w, d, "Poha")).toEqual([]);
    expect(ruleBreaks(w, d, "Poha")).toEqual([]);
    expect(allergyNotes(w, d, "Poha")).toEqual(["Ravi's Poha without peanut"]);
    expect(allergyNotes(w, d, "Upma")).toEqual([]);
  });
  it("a family dish only others eat, a new dish and a variant are checked by what is known of them; never read, it is planned and asked", () => {
    const w = make(peanut);
    const d = w.days.find((x) => x.slot === "Breakfast")!;
    expect(vouched(w, peanut, "Peanut chikki")).toBe(false);   // on Asha's snack plates only
    expect(ruleBreaks(w, d, "Peanut chikki")[0]).toContain("has peanut");
    // Peanuts are one of its ingredients the dish can be made without (decided 21): it is still his, with a note.
    expect(ruleBreaks(w, d, "Sabudana khichdi")).toEqual([]);
    expect(leaveOutNotes(w, d, "Sabudana khichdi")).toEqual(["make without peanuts for Ravi"]);
    // A main ingredient (peanut ladoo) is not his.
    expect(ruleBreaks(w, d, "Peanut ladoo")[0]).toContain("has peanut");
    // one meaning model: unknown = ask (no careful read, no fail closed): a dish nobody read is planned and asked, allergy first.
    expect(ruleBreaks(w, d, "Groundnut usili")).toEqual([]);
    expect(ruleUnknowns(w, d, "Groundnut usili")).toEqual([{ dish: "Groundnut usili", who: "Ravi", tag: "peanut", quote: "Ravi is allergic to peanuts", allergy: true, date: d.date, slot: "Breakfast" }]);
    expect(ruleBreaks(w, d, "Rava idli")).toEqual([]);
    expect(ruleUnknowns(w, d, "Rava idli")).toEqual([]);
  });
  it("a house-wide allergy makes every family dish safe; a new dish nobody read is asked", () => {
    const house = rule({ who: null, items: ["peanut"], quote: "nobody here eats peanuts, an allergy" });
    const w = make(house);
    const d = w.days.find((x) => x.slot === "Breakfast")!;
    expect(ruleBreaks(w, d, "Peanut chikki")).toEqual([]);
    expect(allergyNotes(w, d, "Poha")).toEqual([]);
    // one meaning model: unknown = ask
    expect(ruleBreaks(w, d, "Groundnut usili")).toEqual([]);
    expect(ruleUnknowns(w, d, "Groundnut usili").map((u) => [u.who, u.tag, u.allergy])).toEqual([["Asha", "peanut", true], ["Ravi", "peanut", true]]);
  });
});

describe("onion and garlic (kinds model rule 7)", () => {
  const noOnion = rule({ who: "Ravi", items: ["onion_garlic"], quote: "Ravi eats no onion or garlic" });
  const lib = [dish("Bhindi masala", "Dinner", { contains: ["onion_garlic"], catalog_item: "Bhindi sabzi" }), dish("Aloo pyaaz", "Dinner", { contains: ["onion_garlic"] }), dish("Lauki sabzi", "Dinner")];
  it("never blocks a dish: it is his with a note to make it without or keep his portion aside; a dish that is mostly onion is not his", () => {
    const w = week({ slots: [slot("Dinner", { order: 50 })], library: lib, rules: [noOnion] });
    const d = w.days[0];
    expect(notFor(w, d, "Bhindi masala")).toEqual([]);
    expect(onionNotes(w, d, "Bhindi masala")).toEqual(["make without onion and garlic, or keep Ravi's portion aside"]);
    expect(onionNotes(w, d, "Lauki sabzi")).toEqual([]);
    expect(notFor(w, d, "Aloo pyaaz")).toEqual(["Ravi"]);
    expect(onionNotes(w, d, "Aloo pyaaz")).toEqual([]);
    for (const x of ["Onion uttapam", "Kanda bhaji", "Vengaya sambar", "Ulli theeyal", "Chicken do pyaza"]) expect(mostlyOnion(x), x).toBe(true);
    for (const x of ["Bhindi masala", "Dal tadka"]) expect(mostlyOnion(x), x).toBe(false);
  });
  it("an onion allergy blocks a dish whose onion is a main ingredient, or whose ingredients are not known; one the dish can be made without is a note (decided 21)", () => {
    const w = week({ slots: [slot("Dinner", { order: 50 })], library: lib, rules: [rule({ who: "Ravi", items: ["onion_garlic"], quote: "Ravi is allergic to onion" })] });
    expect(notFor(w, w.days[0], "Aloo pyaaz")).toEqual(["Ravi"]);
    expect(notFor(w, w.days[0], "Onion uttapam")).toEqual(["Ravi"]);
    // Bhindi masala is saved as the catalog's Bhindi sabzi (catalog_item): okra, with onion it can be made without.
    expect(notFor(w, w.days[0], "Bhindi masala")).toEqual([]);
    expect(leaveOutNotes(w, w.days[0], "Bhindi masala")).toEqual(["make without onion for Ravi"]);
  });
});

describe("checkSlot (a saved week against the rules, changes.ts)", () => {
  it("says a person left with nothing of their own, and nothing else", () => {
    const veg = rule({ what: "veg", who: "Asha", quote: "Asha is vegetarian" });
    const w = week({ slots: [slot("Lunch")], library: [dish("Fish curry", "Lunch", { contains: ["fish"] }), dish("Dal", "Lunch")], rules: [veg] });
    const ps = checkSlot(w, "Lunch", plan([["Fish curry"], ["Dal"]]));
    expect(ps.get(WEEK[0])!.map((x) => x.kind)).toEqual(["rule"]);
    expect(ps.get(WEEK[0])![0].text).toStartWith(`Asha has nothing to eat on ${WEEK[0]} Lunch`);
    expect(ps.get(WEEK[1])).toBeUndefined();
  });
});

describe("a rule item said in the plural (safety)", () => {
  it("'peanuts', 'eggs', 'mushrooms' are the tags peanut, egg, mushroom", async () => {
    const { forbidden } = await import("./planChecks");
    const r = (items: string[]) => ({ id: "r", hard: true, what: "avoid", who: null, slots: null, days: null, items, to: null, frequency: null, per_meal: null, fasting_food: null, quote: "" }) as any;
    expect(forbidden(r(["peanuts"]))).toEqual(["peanut"]);
    expect(forbidden(r(["Eggs", "mushrooms", "nuts"]))).toEqual(["egg", "mushroom", "nuts"]);
  });
});

describe("one meaning model checks", () => {
  const GS = "Gowri Shankar", AG = "Agastya";
  const lunch = slot("Lunch", { order: 30 });
  const at = (people: string[], slotName = "Lunch"): PlanDay => day(WEEK[0], slotName, people);
  const make = (o: { library?: LibraryDish[]; rules: Rule[]; history?: Record<string, HistoryRow[]>; slots?: Slot[] }) =>
    week({ slots: o.slots ?? [lunch], library: o.library ?? [], rules: o.rules, history: o.history });

  it("a kind target breaks every item of the kind by its saved place", () => {
    const w = make({ rules: [rule({ who: GS, targets: [{ type: "kind", kind: "Salad" }], quote: "Dad doesn't eat salad" })] });
    w.places = new Map([[dishKey("Cucumber salad"), { kind: "Salad", sub: null, item: "Cucumber salad" }]]);
    expect(notFor(w, at([GS]), "Cucumber salad")).toEqual([GS]);
    expect(ruleBreaks(w, at([GS]), "Cucumber salad")).toEqual([`Cucumber salad is salad: against ${GS}'s rule "Dad doesn't eat salad"`]);
    expect(notFor(w, at([GS]), "Aloo gobi")).toEqual([]);
    // Without a saved place, the library row's kind, else the catalog item of that exact name.
    expect(placeOfDish(make({ rules: [] }), "Lunch", "Cucumber salad")).toEqual({ kind: "Salad", sub: "Salad", item: "Cucumber salad" });
    expect(placeOfDish(make({ rules: [] }), "Lunch", "Grandma's special")).toEqual({ kind: null, sub: null, item: null });
  });

  it("a dish never read for an ingredient is planned and asked, never kept from the person", () => {
    const egg = rule({ who: GS, targets: [{ type: "ingredient", tag: "egg" }], quote: "Dad doesn't eat egg" });
    const w = make({ library: [dish("Kadhi", "Lunch", { contains_read: [] })], rules: [egg] });
    expect(notFor(w, at([GS, AG]), "Kadhi")).toEqual([]);
    expect(ruleUnknowns(w, at([GS, AG]), "Kadhi")).toEqual([{ dish: "Kadhi", who: GS, tag: "egg", quote: "Dad doesn't eat egg", allergy: false, date: WEEK[0], slot: "Lunch" }]);
  });

  it("an allergy unknown is asked too, flagged as an allergy", () => {
    const peanut = rule({ who: AG, targets: [{ type: "ingredient", tag: "peanut" }], quote: "Agastya is allergic to peanuts" });
    const w = make({ library: [dish("Kadhi", "Lunch", { contains_read: [] })], rules: [peanut] });
    expect(notFor(w, at([GS, AG]), "Kadhi")).toEqual([]);
    expect(ruleUnknowns(w, at([GS, AG]), "Kadhi")).toEqual([{ dish: "Kadhi", who: AG, tag: "peanut", quote: "Agastya is allergic to peanuts", allergy: true, date: WEEK[0], slot: "Lunch" }]);
  });

  it("a family dish named like a catalog item but saved without one is the family's own: never read, it is asked, allergy first", () => {
    const onion = rule({ who: AG, targets: [{ type: "ingredient", tag: "onion_garlic" }], quote: "Agastya is allergic to onion" });
    const w = make({ library: [dish("Bhindi masala", "Lunch", { contains_read: [] })], rules: [onion] });
    expect(placeOfDish(w, "Lunch", "Bhindi masala")).toEqual({ kind: null, sub: null, item: null });
    expect(notFor(w, at([GS, AG]), "Bhindi masala")).toEqual([]);
    expect(ruleUnknowns(w, at([GS, AG]), "Bhindi masala")).toEqual([{ dish: "Bhindi masala", who: AG, tag: "onion_garlic", quote: "Agastya is allergic to onion", allergy: true, date: WEEK[0], slot: "Lunch" }]);
  });

  it("a family dish under an allergy is vouched: no break, no ask", () => {
    const peanut = rule({ who: AG, targets: [{ type: "ingredient", tag: "peanut" }], quote: "Agastya is allergic to peanuts" });
    const w = make({ library: [dish("Kadhi", "Lunch", { contains_read: [] })], rules: [peanut], history: { Lunch: seed("Lunch", [["Kadhi", "Rice"]]) } });
    for (const d of w.days) d.people = [GS, AG];
    expect(vouched(w, peanut, "Kadhi")).toBe(true);
    expect(notFor(w, at([GS, AG]), "Kadhi")).toEqual([]);
    expect(ruleUnknowns(w, at([GS, AG]), "Kadhi")).toEqual([]);
  });

  it("a known egg dish is not for the person who eats no egg", () => {
    const w = make({ rules: [rule({ who: GS, targets: [{ type: "ingredient", tag: "egg" }], quote: "Dad doesn't eat egg" })] });
    expect(notFor(w, at([GS, AG]), "Egg curry")).toEqual([GS]);
    expect(ruleUnknowns(w, at([GS, AG]), "Egg curry")).toEqual([]);
  });

  it("a swap never breaks; it names who gets what", () => {
    const swap = rule({ who: AG, what: "swap", targets: [{ type: "kind", kind: "Upma" }], gives: { type: "item", item: "Pancakes", kind: null }, to: "pancakes",
      quote: "Pancakes for Agastya when we make upma" });
    const w = make({ rules: [swap], slots: [slot("Breakfast", { order: 10 })] });
    const d = at([GS, AG], "Breakfast");
    expect(notFor(w, d, "Rava upma")).toEqual([]);
    expect(swapsAt(w, d, "Rava upma")).toEqual([{ who: AG, gives: { type: "item", item: "Pancakes", kind: null }, quote: "Pancakes for Agastya when we make upma" }]);
    expect(swapsAt(w, d, "Plain dosa")).toEqual([]);
    expect(swapNotes(w, d, "Rava upma")).toEqual(["Pancakes in place of upma for Agastya"]);
  });

  it("an ingredient target keeps its own name: no curd breaks a dish with curd as a main ingredient, and is a note where it can be left out", () => {
    const curd = rule({ who: GS, targets: [{ type: "ingredient", tag: "curd" }], quote: "Dad doesn't eat curd" });
    const w = make({ rules: [curd] });
    expect(notFor(w, at([GS]), "Cucumber raita")).toEqual([GS]);
    expect(ruleBreaks(w, at([GS]), "Cucumber raita")[0]).toContain("has curd");
    expect(notFor(w, at([GS]), "Methi thepla")).toEqual([]);
    expect(leaveOutNotes(w, at([GS, AG]), "Methi thepla")).toEqual([`make without curd for ${GS}`]);
    expect(notFor(w, at([GS]), "Lauki sabzi")).toEqual([]);
    expect(ruleUnknowns(w, at([GS]), "Lauki sabzi")).toEqual([]);
    // A family dish saved as having curd breaks it too; one saved as read for dairy without any is known to have none.
    const w2 = make({ library: [dish("Dahi bhindi", "Lunch", { contains: ["curd"], contains_read: [...READ, "dairy"] }), dish("Ghar ka dal", "Lunch", { contains_read: [...READ, "dairy"] })], rules: [curd] });
    expect(notFor(w2, at([GS]), "Dahi bhindi")).toEqual([GS]);
    expect(notFor(w2, at([GS]), "Ghar ka dal")).toEqual([]);
    expect(ruleUnknowns(w2, at([GS]), "Ghar ka dal")).toEqual([]);
  });

  it("a rule word no catalog place and no tag knows (no maida) is an ingredient: catalog dishes by their lists, the family's own dishes asked every day, never dropped", () => {
    const maida = rule({ who: GS, items: ["maida"], quote: "no maida for Dad" });
    expect(forbidden(maida)).toEqual(["maida"]);
    const w = make({ library: [dish("Amma's kurma", "Lunch", { contains_read: READ })], rules: [maida] });
    for (const d of w.days) d.people = [GS, AG];
    expect(notFor(w, at([GS]), "Bhatura")).toEqual([GS]);
    expect(notFor(w, at([GS]), "Lauki sabzi")).toEqual([]);
    expect(ruleUnknowns(w, at([GS]), "Lauki sabzi")).toEqual([]);
    for (const d of w.days) {
      expect(notFor(w, d, "Amma's kurma")).toEqual([]);
      expect(ruleUnknowns(w, d, "Amma's kurma").map((u) => [u.who, u.tag, u.date])).toEqual([[GS, "maida", d.date]]);
    }
  });
});

describe("a swap on rice stays on the Rice kind (G4 review)", () => {
  it("does not fire on Curd rice (kind Curd), fires on Rice", () => {
    const swap = rule({ who: "Ravi", what: "swap", slots: ["Dinner"], items: ["rice"], to: "ragi mudde", targets: [resolveTarget("rice")], gives: { type: "item", item: "Ragi mudde", kind: null }, quote: "ragi mudde for rice" });
    const lib = [dish("Curd rice", "Dinner", { kind: "Curd", contains: ["rice", "curd"], contains_read: [...READ, "rice", "curd"] }), dish("Rice", "Dinner", { kind: "Rice" })];
    const w = week({ slots: [slot("Dinner", { order: 30 })], library: lib, rules: [swap] });
    const d = w.days.find((x) => x.slot === "Dinner")!;
    expect(swapsAt(w, d, "Curd rice")).toEqual([]);
    expect(swapsAt(w, d, "Rice").length).toBe(1);
  });
});

describe("a rice rule holds the kind and the ingredient (G4)", () => {
  it("no rice at Dinner breaks Curd rice (kind Curd) by its facts, and Rice by its kind; Ragi mudde is fine", () => {
    const r = rule({ who: "Ravi", slots: ["Dinner"], items: ["rice"], targets: resolveTargets("rice"), quote: "no rice at night" });
    const lib = [dish("Curd rice", "Dinner", { kind: "Curd", contains: ["rice", "curd"], contains_read: [...READ, "rice", "curd"] }),
      dish("Ragi mudde", "Dinner", { kind: "Millet", contains: ["ragi"], contains_read: [...READ, "rice"] }), dish("Rice", "Dinner", { kind: "Rice" })];
    const w = week({ slots: [slot("Dinner", { order: 30 })], library: lib, rules: [r] });
    const d = w.days.find((x) => x.slot === "Dinner")!;
    expect(ruleBreaks(w, d, "Curd rice")[0]).toContain("Curd rice");
    expect(ruleBreaks(w, d, "Rice")).not.toEqual([]);
    expect(ruleBreaks(w, d, "Ragi mudde")).toEqual([]);
  });
});
