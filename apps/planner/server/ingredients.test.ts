// Decided 21 (owner, 26 Nov), from the owner's own statements: a catalog item's contents come from its ingredients, each main
// or one the dish can be made without. A main ingredient that breaks a person's hard rule or allergy means the dish is not
// theirs; only ingredients it can be made without mean it is theirs with a note. Items picked for a category the family named
// are checked like any other; every planned catalog item is read for every catalog tag. No database, no model.
import { describe, expect, it } from "bun:test";
import { fillWeek, type FillInput } from "./fillWeek";
import { CATALOG, catalogIngredients, plannerTags, PLANNER_READ_TAGS, type MealTemplate } from "./kinds";
import { factsOf, leaveOutNotes, notFor, readFor, ruleBreaks, slotFacts, type Week } from "./planChecks";
import { slotDayKey, type PlanDay } from "./planDays";
import { dishKey } from "./dishText";
import type { LibraryDish, Rule, Slot } from "./slotStore";

const WEEK = ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"];
const READ = ["egg", "meat", "fish", "onion_garlic", "nuts", "peanut", "dairy", "white_rice", "root_veg"];
const slot = (name: string, o: Partial<Slot> = {}): Slot => ({ id: name, name, kind: "main", addon_of: null, usual_people: [], days: [], skip_days: [],
  order: name === "Breakfast" ? 10 : name === "Lunch" ? 30 : 50, active: true, extras: false, templates: null, ...o });
const dish = (name: string, slotName: string, kind: string | null, o: Partial<LibraryDish> = {}): LibraryDish => ({ id: `${slotName}|${name}`, key: dishKey(name), slot: slotName,
  name, frequency: null, days: null, said: null, contains: [], contains_read: READ, origin: "setup_named", suggested: false, untried: false, offers: 0, disliked: false,
  prep: null, video_url: null, video_title: null, video_thumbnail: null, rating: null, rating_note: null, rated_on: null, rated_by: null, ratings: [], kind, sub: null,
  catalog_item: null, ...o });
const day = (date: string, slotName: string, people: string[]): PlanDay => ({ date, slot: slotName, people, guests: [], occasion: null, new_dishes_allowed: null, skip: null,
  edited: false, fixed: false, why: [], fasting: [], dishes: [], note: null });
const rule = (o: Partial<Rule>): Rule => ({ id: `r${Math.random()}`, hard: true, what: "avoid", who: null, slots: null, days: null, items: null, to: null, targets: null, gives: null, frequency: null,
  per_meal: null, fasting_food: null, quote: "", ...o });
const T = (...parts: MealTemplate["parts"]): MealTemplate => ({ parts });

/** A hand-made week of one slot for these people, the dishes checked as planChecks reads them. */
function week(o: { slot: Slot; library?: LibraryDish[]; rules: Rule[]; people: string[] }): Week {
  const w: Week = { days: WEEK.map((d) => day(d, o.slot.name, o.people)), slots: new Map(), rules: o.rules, library: o.library ?? [], facts: new Map(), done: new Set(),
    newDishes: new Map() };
  w.slots.set(o.slot.name.toLowerCase(), slotFacts(o.slot, o.library ?? [], []));
  return w;
}
const fill = (o: Omit<FillInput, "days" | "history" | "cuisines"> & { people: string[] }) =>
  fillWeek({ days: o.slots.flatMap((s) => WEEK.map((d) => day(d, s.name, o.people))), history: new Map(), cuisines: [], ...o });
const plates = (r: ReturnType<typeof fillWeek>, s: string) => WEEK.flatMap((d) => r.plates.get(slotDayKey(d, s)) ?? []);

describe("the catalog's ingredients (decided 21)", () => {
  it("every item has its ingredients, at least one main; its contents are derived from them", () => {
    let n = 0;
    for (const k of CATALOG.kinds) for (const it of k.items) {
      n++;
      expect(it.ingredients.length, it.name).toBeGreaterThan(0);
      expect(it.ingredients.some((x) => x.main), it.name).toBe(true);
      expect(it.contains_main.every((t) => it.contains.includes(t)), it.name).toBe(true);
      for (const x of it.ingredients) for (const t of CATALOG.ingredients![x.name] ?? []) expect(it.contains, `${it.name}: ${x.name}`).toContain(t);
    }
    expect(n).toBeGreaterThan(700);
  });
  it("mooli is a main root vegetable of mooli thepla and mooli paratha; cashews in rava upma and peanuts in vegetable poha can be left out", () => {
    for (const x of ["Mooli thepla", "Mooli paratha"]) expect(plannerTags(x)!.main, x).toContain("root_veg");
    expect(plannerTags("Rava upma")!.contains).toContain("nuts");
    expect(plannerTags("Rava upma")!.main).not.toContain("nuts");
    expect(catalogIngredients("Rava upma")!.find((x) => x.name === "cashews")).toEqual({ name: "cashews", main: false, tags: ["nuts"] });
    expect(catalogIngredients("Vegetable poha")!.find((x) => x.name === "peanuts")).toEqual({ name: "peanuts", main: false, tags: ["peanut", "nuts"] });
    expect(plannerTags("Kanda poha")!.main).toContain("onion_garlic");
    expect(plannerTags("Paneer bhurji")!.main).toContain("dairy");
  });
});

describe("a main ingredient that breaks a rule: not theirs; one the dish can be made without: a note (decided 21)", () => {
  const brk = slot("Breakfast");
  it("a Jain family (no root vegetables) is never planned mooli thepla, though they named thepla as a category", () => {
    const jain = rule({ items: ["root_veg"], quote: "we are Jain, no root vegetables" });
    const w = week({ slot: brk, rules: [jain], people: ["Asha", "Ravi"] });
    expect(notFor(w, w.days[0], "Mooli thepla")).toEqual(["Asha", "Ravi"]);
    expect(notFor(w, w.days[0], "Mooli paratha")).toEqual(["Asha", "Ravi"]);
    const r = fill({ slots: [slot("Breakfast", { templates: [T({ kind: "Thepla" })] })], library: [dish("Thepla", "Breakfast", "Thepla")],
      rules: [jain], people: ["Asha", "Ravi"] });
    const placed = plates(r, "Breakfast");
    expect(placed.length).toBe(7);
    expect(placed.map((x) => x.name)).not.toContain("Mooli thepla");
    for (const x of placed) expect(x.not_for).toEqual([]);
  });
  it("a cashew-allergic child is planned suji upma with a note to make it without cashews for her", () => {
    const nuts = rule({ who: "Anya", items: ["nuts"], quote: "Anya is allergic to cashews and other nuts" });
    // The catalog says only cashews and peanuts bring nuts, and it is upma without them (no careful read: one meaning model).
    const w = week({ slot: brk, rules: [nuts], people: ["Asha", "Anya"] });
    expect(ruleBreaks(w, w.days[0], "Suji upma")).toEqual([]);
    expect(leaveOutNotes(w, w.days[0], "Suji upma")).toEqual(["make without cashews and peanuts for Anya"]);
    // Placed by the fill from the family's category part, with the note on the plate.
    const r = fill({ slots: [slot("Breakfast", { templates: [T({ kind: "Upma", words: "upma" })] })], library: [],
      rules: [nuts], people: ["Asha", "Anya"] });
    const upma = plates(r, "Breakfast").find((x) => x.name === "Rava upma")!;
    expect(upma.not_for).toEqual([]);
    expect(upma.note).toBe("make without cashews and peanuts for Anya");
  });
  it("someone who eats no onion: kanda poha is not theirs (onion is its main ingredient); vegetable poha is, with the onion note", () => {
    const noOnion = rule({ who: "Ravi", items: ["onion_garlic"], quote: "Ravi eats no onion or garlic" });
    const w = week({ slot: brk, rules: [noOnion], people: ["Asha", "Ravi"] });
    expect(notFor(w, w.days[0], "Kanda poha")).toEqual(["Ravi"]);
    expect(leaveOutNotes(w, w.days[0], "Kanda poha")).toEqual([]);
    expect(notFor(w, w.days[0], "Vegetable poha")).toEqual([]);
    expect(leaveOutNotes(w, w.days[0], "Vegetable poha")).toEqual(["make without onion and garlic, or keep Ravi's portion aside"]);
  });
  it("a peanut allergy: poha with peanuts is planned, made without them for him", () => {
    const peanut = rule({ who: "Kabir", items: ["peanut"], quote: "Kabir is allergic to peanuts" });
    const w = week({ slot: brk, rules: [peanut], people: ["Asha", "Kabir"] });
    expect(notFor(w, w.days[0], "Batata poha")).toEqual([]);
    expect(leaveOutNotes(w, w.days[0], "Batata poha")).toEqual(["make without peanuts for Kabir"]);
    // Peanut chutney is peanuts: not his.
    expect(notFor(w, w.days[0], "Peanut chutney")).toEqual(["Kabir"]);
  });
  it("someone dairy-free is never given paneer bhurji (paneer is main); ghee on top of dal is a note", () => {
    const dairy = rule({ who: "Meera", items: ["dairy"], quote: "Meera eats no dairy" });
    const w = week({ slot: slot("Dinner"), rules: [dairy], people: ["Asha", "Meera"] });
    expect(notFor(w, w.days[0], "Paneer bhurji")).toEqual(["Meera"]);
    expect(notFor(w, w.days[0], "Dal tadka")).toEqual([]);
    expect(leaveOutNotes(w, w.days[0], "Dal tadka")).toEqual(["make without ghee for Meera"]);
  });
  it("a rule the whole house keeps: the note names no one", () => {
    const peanut = rule({ items: ["peanut"], quote: "nothing at home has peanuts" });
    const w = week({ slot: brk, rules: [peanut], people: ["Asha", "Ravi"] });
    expect(leaveOutNotes(w, w.days[0], "Vegetable poha")).toEqual(["make without peanuts"]);
  });
  it("a family's own dish the catalog does not know keeps its read: a rule item it has blocks it", () => {
    const dairy = rule({ who: "Meera", items: ["dairy"], quote: "Meera eats no dairy" });
    const w = week({ slot: slot("Dinner"), library: [dish("Amma's kurma", "Dinner", null, { contains: ["dairy"] })], rules: [dairy], people: ["Asha", "Meera"] });
    expect(notFor(w, w.days[0], "Amma's kurma")).toEqual(["Meera"]);
    expect(leaveOutNotes(w, w.days[0], "Amma's kurma")).toEqual([]);
  });
});

describe("items picked for a category the family named are checked for allergies (decided 21: the vouched hole closed)", () => {
  it("under a house-wide peanut allergy, the family's 'chutney' never brings peanut chutney; its items are checked by the catalog, none left unknown", () => {
    const peanut = rule({ items: ["peanut"], quote: "nothing at home has peanuts, he is allergic" });
    const r = fill({ slots: [slot("Lunch", { templates: [T({ kind: "Rice" }, { kind: "Chutney", words: "chutney" })] })],
      library: [dish("Rice", "Lunch", "Rice")], rules: [peanut], people: ["Asha", "Ravi"] });
    const placed = plates(r, "Lunch");
    expect(placed.map((x) => x.name)).not.toContain("Peanut chutney");
    expect(placed.map((x) => x.name)).not.toContain("Shenga chutney pudi");
    for (const x of placed) expect(x.not_for).toEqual([]);
    // Each chutney placed was not vouched: checked by the catalog's contents, so none is left to ask about.
    const chutneys = uniq(placed.filter((x) => x.name !== "Steamed rice" && x.name !== "Rice").map((x) => x.name));
    expect(chutneys.length).toBeGreaterThan(0);
    expect(r.unknowns.filter((u) => chutneys.includes(u.dish))).toEqual([]);
    // A category item read as having the allergen where it is main is not theirs.
    const w: Week = { days: WEEK.map((d) => day(d, "Lunch", ["Asha", "Ravi"])), slots: new Map(), rules: [peanut], library: [], facts: new Map(), done: new Set(), newDishes: new Map(),
      ownItems: new Set([dishKey("Thecha")]) };
    w.slots.set("lunch", slotFacts(slot("Lunch"), [], []));
    // Thecha's peanuts can be left out: a note for the house.
    expect(notFor(w, w.days[0], "Thecha")).toEqual([]);
    expect(leaveOutNotes(w, w.days[0], "Thecha")).toEqual(["make without peanuts"]);
  });
});

describe("every planned catalog item is read for every catalog tag (no tag left unread to fail closed on)", () => {
  it("a staple the planner brings from the catalog (Steamed rice) is read for pork, nuts and sugar; so is a family's 'Rice' read for fewer", () => {
    const noPork = rule({ who: "Asha", items: ["pork"], quote: "Asha eats no pork" });
    const sweet = rule({ who: "Ravi", items: ["sugar", "nuts"], quote: "Ravi: no sugar, no nuts" });
    const w = week({ slot: slot("Lunch"), library: [dish("Rice", "Lunch", "Rice", { contains: ["white_rice"], contains_read: ["white_rice"] })], rules: [noPork, sweet],
      people: ["Asha", "Ravi"] });
    for (const d of ["Steamed rice", "Rice"]) {
      const f = factsOf(w, "Lunch", d);
      for (const t of [...PLANNER_READ_TAGS, "pork", "nuts", "sugar"]) expect(readFor(f.read, t), `${d}: ${t}`).toBe(true);
      expect(ruleBreaks(w, w.days[0], d), d).toEqual([]);
    }
    // Placed by the fill with no library row of its own: still nobody's rule fails on it.
    const r = fill({ slots: [slot("Lunch", { templates: [T({ kind: "Rice" }, { kind: "Dal" })] })],
      library: [dish("Moong dal", "Lunch", "Dal")], rules: [noPork, sweet], people: ["Asha", "Ravi"] });
    const rice = plates(r, "Lunch").filter((x) => x.name === "Steamed rice");
    expect(rice.length).toBe(7);
    for (const x of rice) expect(x.not_for).toEqual([]);
    const facts = r.facts.get(dishKey("Steamed rice"))!;
    for (const t of ["pork", "nuts", "sugar", "egg", "dairy"]) expect(readFor(facts.read, t), t).toBe(true);
  });
});

const uniq = <T>(xs: T[]) => [...new Set(xs)];
