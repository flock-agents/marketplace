// planChecks.ts on a hand-made week, no database and no model: the allergy rules (a family dish vouched for by the family's
// own plates, every other dish read carefully), onion and garlic as a note (kinds model rule 7), and the check a saved week is
// read against (changes.ts). The week's fill is fillWeek.test.ts's.
import { describe, expect, it } from "bun:test";
import { allergyNotes, carefulTags, checkSlot, mostlyOnion, notFor, onionNotes, ruleBreaks, slotFacts, vouched, type Proposal, type Week } from "./planChecks";
import { dishKey } from "./dishText";
import type { PlanDay } from "./planDays";
import type { HistoryRow, LibraryDish, Rule, Slot } from "./slotStore";

const WEEK = ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"];
const READ = ["egg", "meat", "fish", "onion_garlic"];
const slot = (name: string, o: Partial<Slot> = {}): Slot => ({ id: name, name, kind: "main", addon_of: null, usual_people: [], days: [], skip_days: [], order: 30, active: true, kinds: null, templates: null, ...o });
const dish = (name: string, slotName: string, o: Partial<LibraryDish> = {}): LibraryDish => ({ id: `${slotName}|${name}`, key: dishKey(name), slot: slotName, name, frequency: null, days: null, said: null,
  contains: [], contains_read: READ, origin: "setup_named", suggested: false, untried: false, offers: 0, disliked: false, prep: null, video_url: null, video_title: null,
  video_thumbnail: null, rating: null, rating_note: null, rated_on: null, rated_by: null, ratings: [], kind: null, sub: null, catalog_item: null, ...o });
const day = (date: string, slotName: string, people = ["Asha", "Ravi"]): PlanDay => ({ date, slot: slotName, people, guests: [], occasion: null, new_dishes_allowed: null, skip: null,
  edited: false, fixed: false, why: [], fasting: [], dishes: [], note: null });
const seed = (slotName: string, rows: string[][]): HistoryRow[] => rows.map((r) => ({ date: null, status: "confirmed", skip: null, dishes: r.map((d) => ({ dish: d })) }) as HistoryRow);
const rule = (o: Partial<Rule>): Rule => ({ id: "r", hard: true, what: "avoid", who: null, slots: null, days: null, items: null, to: null, frequency: null, per_meal: null, fasting_food: null, quote: "", ...o });

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
    w.careful = new Map();
    return w;
  };
  it("a family dish on the plates of a slot the allergic person eats is safe by the family's word, no read; its note keeps his portion aside", () => {
    const w = make(peanut);
    const d = w.days.find((x) => x.slot === "Breakfast")!;
    expect(vouched(w, peanut, "Poha")).toBe(true);
    expect(carefulTags(w, "Poha")).toEqual([]);
    expect(ruleBreaks(w, d, "Poha")).toEqual([]);
    expect(allergyNotes(w, d, "Poha")).toEqual(["Ravi's Poha without peanut"]);
    expect(allergyNotes(w, d, "Upma")).toEqual([]);
  });
  it("a family dish only others eat, a new dish and a variant are read carefully; not read, or read as maybe having it, is not his", () => {
    const w = make(peanut);
    const d = w.days.find((x) => x.slot === "Breakfast")!;
    expect(vouched(w, peanut, "Peanut chikki")).toBe(false);   // on Asha's snack plates only
    expect(carefulTags(w, "Peanut chikki")).toEqual(["peanut"]);
    expect(carefulTags(w, "Sabudana khichdi")).toEqual(["peanut"]);
    expect(ruleBreaks(w, d, "Sabudana khichdi")[0]).toContain("not read carefully for peanut");
    w.careful!.set(dishKey("Sabudana khichdi"), new Set(["peanut"]));
    expect(ruleBreaks(w, d, "Sabudana khichdi")[0]).toContain("may have peanut");
    w.careful!.set(dishKey("Rava idli"), new Set());
    expect(ruleBreaks(w, d, "Rava idli")).toEqual([]);
  });
  it("a house-wide allergy makes every family dish safe; new dishes still read carefully", () => {
    const house = rule({ who: null, items: ["peanut"], quote: "nobody here eats peanuts, an allergy" });
    const w = make(house);
    const d = w.days.find((x) => x.slot === "Breakfast")!;
    expect(ruleBreaks(w, d, "Peanut chikki")).toEqual([]);
    expect(allergyNotes(w, d, "Poha")).toEqual([]);
    expect(carefulTags(w, "Sabudana khichdi")).toEqual(["peanut"]);
  });
});

describe("onion and garlic (kinds model rule 7)", () => {
  const noOnion = rule({ who: "Ravi", items: ["onion_garlic"], quote: "Ravi eats no onion or garlic" });
  const lib = [dish("Bhindi masala", "Dinner", { contains: ["onion_garlic"] }), dish("Aloo pyaaz", "Dinner", { contains: ["onion_garlic"] }), dish("Lauki sabzi", "Dinner")];
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
  it("an onion allergy still blocks", () => {
    const w = week({ slots: [slot("Dinner", { order: 50 })], library: lib, rules: [rule({ who: "Ravi", items: ["onion_garlic"], quote: "Ravi is allergic to onion" })] });
    expect(notFor(w, w.days[0], "Bhindi masala")).toEqual(["Ravi"]);
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
