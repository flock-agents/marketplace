// fillWeek.ts on hand-made weeks, no database and no model: the week filled by code from the meals' templates (kinds model
// contract, owner rules 1–8). Expected plates are worked out from the owner's rules, not read off the code.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fillWeek, templateCounts, type FillInput, type FillResult, type Visit } from "./fillWeek";
import { catalogIngredients, catalogItem, suggestable, type MealKind, type MealTemplate } from "./kinds";
import { OWN_SHARE } from "./planChecks";
import { slotDayKey, type PlanDay } from "./planDays";
import { dishKey } from "./dishText";
import type { HistoryRow, LibraryDish, Rule, Slot } from "./slotStore";
import { weekdayOf, type Weekday } from "./dates";

const WEEK = ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"];
const ALL_READ = ["egg", "meat", "fish", "onion_garlic", "nuts", "peanut", "dairy", "mushroom", "white_rice"];
const slot = (name: string, o: Partial<Slot> = {}): Slot => ({ id: name, name, kind: "main", addon_of: null, usual_people: [], days: [], skip_days: [],
  order: name === "Breakfast" ? 10 : name === "Lunch" ? 30 : 50, active: true, extras: false, templates: null, ...o });
const dish = (name: string, slotName: string, kind: string | null, o: Partial<LibraryDish> = {}): LibraryDish => ({ id: `${slotName}|${name}`, key: dishKey(name), slot: slotName,
  name, frequency: null, days: null, said: null, contains: [], contains_read: ALL_READ, origin: "setup_named", suggested: false, untried: false, offers: 0, disliked: false,
  prep: null, video_url: null, video_title: null, video_thumbnail: null, rating: null, rating_note: null, rated_on: null, rated_by: null, ratings: [], kind, sub: null,
  catalog_item: null, ...o });
const day = (date: string, slotName: string, people: string[]): PlanDay => ({ date, slot: slotName, people, guests: [], occasion: null, new_dishes_allowed: null, skip: null,
  edited: false, fixed: false, why: [], fasting: [], dishes: [], note: null });
const rule = (o: Partial<Rule>): Rule => ({ id: `r${Math.random()}`, hard: true, what: "avoid", who: null, slots: null, days: null, items: null, to: null, targets: null, gives: null, frequency: null,
  per_meal: null, fasting_food: null, quote: "", ...o });
const seed = (rows: string[][]): HistoryRow[] => rows.map((r) => ({ date: null, status: "confirmed", skip: null, dishes: r.map((d) => ({ dish: d })) }) as HistoryRow);

function run(o: { slots: Slot[]; library: LibraryDish[]; people?: string[]; rules?: Rule[]; history?: Record<string, HistoryRow[]>; cuisines?: string[]; newCap?: number | null;
  days?: PlanDay[]; visits?: Visit[] }): FillResult & { at: (date: string, slot: string) => string[]; dishAt: (date: string, slot: string, name: string) => { not_for: string[]; note: string | null; new: boolean } | undefined } {
  const people = o.people ?? ["Asha", "Ravi"];
  const days = o.days ?? o.slots.flatMap((s) => WEEK.map((d) => day(d, s.name, people)));
  const input: FillInput = { days, slots: o.slots, library: o.library, rules: o.rules ?? [], history: new Map(Object.entries(o.history ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
    cuisines: o.cuisines ?? [], newCap: o.newCap ?? null, ...(o.visits ? { visits: o.visits } : {}) };
  const r = fillWeek(input);
  const at = (date: string, s: string) => (r.plates.get(slotDayKey(date, s)) ?? []).map((x) => x.name);
  const dishAt = (date: string, s: string, name: string) => (r.plates.get(slotDayKey(date, s)) ?? []).find((x) => x.name === name);
  return { ...r, at, dishAt };
}
const T = (...parts: MealTemplate["parts"]): MealTemplate => ({ parts });
const share = (t: MealTemplate, s: MealTemplate["share"]): MealTemplate => ({ ...t, share: s });
/** The 7 days' plates of a slot. */
const weekOf = (r: ReturnType<typeof run>, s: string) => WEEK.map((d) => r.at(d, s));
const SABZIS = ["Aloo gobi", "Bhindi sabzi", "Lauki sabzi", "Jeera aloo", "Baingan bharta"];

describe("templates (rule 1)", () => {
  const kinds: MealKind[] = [{ name: "Roti", staple: true }, { name: "Sabzi" }, { name: "Dal" }];
  const lib = [dish("Phulka", "Dinner", "Roti"), ...SABZIS.map((n) => dish(n, "Dinner", "Sabzi")), ...["Moong dal", "Dal tadka", "Masoor dal"].map((n) => dish(n, "Dinner", "Dal"))];
  it("a template with a share comes exactly that often, spread out; the rest is the other template", () => {
    const r = run({ slots: [slot("Dinner", { templates: [T({ kind: "Roti" }, { kind: "Sabzi" }), share(T({ kind: "Roti" }, { kind: "Dal" }, { kind: "Sabzi" }), "2/week")] })], library: lib });
    const withDal = WEEK.filter((d) => r.at(d, "Dinner").some((x) => ["Moong dal", "Dal tadka", "Masoor dal"].includes(x)));
    expect(withDal).toHaveLength(2);
    expect(WEEK.indexOf(withDal[1]) - WEEK.indexOf(withDal[0])).toBeGreaterThan(1);
  });
  it("templates with no share spread evenly, never the same one two days running", () => {
    const r = run({ slots: [slot("Dinner", { templates: [T({ kind: "Roti" }, { kind: "Sabzi" }), T({ kind: "Roti" }, { kind: "Dal" }, { kind: "Sabzi" })] })], library: lib });
    const shape = weekOf(r, "Dinner").map((p) => p.length);
    expect(shape).toEqual([2, 3, 2, 3, 2, 3, 2]);
  });
  it("every part of the template is filled: never a bare staple plate", () => {
    const r = run({ slots: [slot("Dinner", { templates: [T({ kind: "Roti" }, { kind: "Sabzi" })] })], library: lib });
    for (const p of weekOf(r, "Dinner")) { expect(p[0]).toBe("Phulka"); expect(p).toHaveLength(2); }
  });
});

describe("a pinned dish (rule 2)", () => {
  it("is that item on its day, in the template that has its kind; the other days rotate without it", () => {
    const kinds: MealKind[] = [{ name: "Roti", staple: true }, { name: "Sabzi" }, { name: "Dal" }];
    const lib = [dish("Phulka", "Dinner", "Roti"), ...SABZIS.map((n) => dish(n, "Dinner", "Sabzi")), ...["Moong dal", "Dal tadka"].map((n) => dish(n, "Dinner", "Dal")),
      dish("Rajma", "Dinner", "Dal", { sub: "Rajma/Chole", days: ["Sun"] })];
    const r = run({ slots: [slot("Dinner", { templates: [T({ kind: "Roti" }, { kind: "Sabzi" }), share(T({ kind: "Roti" }, { kind: "Dal" }, { kind: "Sabzi" }), "2/week")] })], library: lib });
    expect(r.at(WEEK[6], "Dinner")).toContain("Rajma");
    expect(WEEK.slice(0, 6).filter((d) => r.at(d, "Dinner").includes("Rajma"))).toEqual([]);
    expect(WEEK.filter((d) => r.at(d, "Dinner").length === 3)).toHaveLength(2);
  });
});

describe("rotation (rule 3)", () => {
  const kinds: MealKind[] = [{ name: "Rice", staple: true }, { name: "Roti", staple: true }, { name: "Sabzi" }];
  const slots = [slot("Lunch", { templates: [T({ kind: "Rice" }, { kind: "Sabzi" })] }),
    slot("Dinner", { templates: [T({ kind: "Roti" }, { kind: "Sabzi" })] })];
  const lib = [dish("Rice", "Lunch", "Rice"), dish("Phulka", "Dinner", "Roti"), ...SABZIS.map((n) => dish(n, "Lunch", "Sabzi")), ...SABZIS.map((n) => dish(n, "Dinner", "Sabzi"))];
  it("no item repeats until every one of the family's is used, counted across lunch and dinner; never the next day, never at both meals", () => {
    const r = run({ slots, library: lib, newCap: 0 });
    const order = WEEK.flatMap((d) => [r.at(d, "Lunch")[1], r.at(d, "Dinner")[1]]);
    expect(new Set(order.slice(0, 5)).size).toBe(5);
    for (let i = 0; i < 7; i++) {
      expect(r.at(WEEK[i], "Lunch")[1]).not.toBe(r.at(WEEK[i], "Dinner")[1]);
      if (i) for (const s of ["Lunch", "Dinner"]) expect([r.at(WEEK[i - 1], "Lunch")[1], r.at(WEEK[i - 1], "Dinner")[1]]).not.toContain(r.at(WEEK[i], s)[1]);
    }
    for (const n of SABZIS) expect(order.filter((x) => x === n).length).toBeLessThanOrEqual(3);
    expect(r.placed).toEqual([]);
  });
  it("the least recently had comes first: last week's sabzis wait", () => {
    const history = { Lunch: [{ date: "2026-11-29", status: "planned", skip: null, dishes: [{ dish: "Rice" }, { dish: "Aloo gobi" }] },
      { date: "2026-11-28", status: "planned", skip: null, dishes: [{ dish: "Rice" }, { dish: "Bhindi sabzi" }] }] as HistoryRow[] };
    const r = run({ slots, library: lib, newCap: 0, history });
    expect(r.at(WEEK[0], "Lunch")[1]).not.toBe("Aloo gobi");
    expect(["Bhindi sabzi", "Aloo gobi"]).not.toContain(r.at(WEEK[0], "Dinner")[1]);
  });
  it("the family's own words limit a dish: once a week comes once", () => {
    const lib2 = lib.map((x) => (x.name === "Lauki sabzi" ? { ...x, frequency: "1/week" as const } : x));
    const r = run({ slots, library: lib2, newCap: 0 });
    expect(WEEK.flatMap((d) => [...r.at(d, "Lunch"), ...r.at(d, "Dinner")]).filter((x) => x === "Lauki sabzi")).toHaveLength(1);
  });
  it("staples are the family's usual item every time", () => {
    const r = run({ slots, library: lib, newCap: 0 });
    expect(WEEK.map((d) => r.at(d, "Lunch")[0])).toEqual(WEEK.map(() => "Rice"));
    expect(WEEK.map((d) => r.at(d, "Dinner")[0])).toEqual(WEEK.map(() => "Phulka"));
  });
});

describe("the same plate (rule 5)", () => {
  it("two parts of one kind from different sub-kinds: a sambar and a rasam, never two of one; the family's own sub-kinds first", () => {
    const kinds: MealKind[] = [{ name: "Rice", staple: true }, { name: "Rice curry", subs: ["Sambar", "Rasam"] }, { name: "Sabzi", subs: ["Poriyal/Thoran"] }, { name: "Curd", staple: true }];
    const lib = [dish("Rice", "Lunch", "Rice"), dish("Curd", "Lunch", "Curd"),
      ...["Drumstick sambar", "Arachuvitta sambar", "Vengaya sambar"].map((n) => dish(n, "Lunch", "Rice curry", { sub: "Sambar" })),
      ...["Tomato rasam", "Pepper rasam", "Lemon rasam"].map((n) => dish(n, "Lunch", "Rice curry", { sub: "Rasam" })),
      ...["Beans poriyal", "Cabbage poriyal", "Carrot poriyal"].map((n) => dish(n, "Lunch", "Sabzi", { sub: "Poriyal/Thoran" }))];
    const r = run({ slots: [slot("Lunch", { templates: [T({ kind: "Rice" }, { kind: "Rice curry", sub: "Sambar" }, { kind: "Rice curry", sub: "Rasam" }, { kind: "Sabzi" }, { kind: "Curd" })] })],
      library: lib });
    for (const p of weekOf(r, "Lunch")) {
      expect(p).toHaveLength(5);
      expect(p[1]).toMatch(/sambar/i);
      expect(p[2]).toMatch(/rasam/i);
    }
    for (const p of weekOf(r, "Lunch").slice(0, 3)) expect(p[3]).toMatch(/poriyal/i);
  });
  it("two parts of one kind with no sub-kind named are two different items", () => {
    const lib = [dish("Phulka", "Dinner", "Roti"), ...SABZIS.map((n) => dish(n, "Dinner", "Sabzi"))];
    const r = run({ slots: [slot("Dinner", { templates: [T({ kind: "Roti" }, { kind: "Sabzi" }, { kind: "Sabzi" })] })], library: lib });
    for (const p of weekOf(r, "Dinner")) { expect(p).toHaveLength(3); expect(p[1]).not.toBe(p[2]); }
  });
});

describe("new variants (rule 4)", () => {
  // Their bare word named one dish ("dal tadka"): that dish is theirs, other dals are new (§5.1).
  const slots = [slot("Dinner", { templates: [T({ kind: "Roti" }, { kind: "Dal", dish: "Dal tadka" })] })];
  const lib = [dish("Phulka", "Dinner", "Roti"), dish("Dal tadka", "Dinner", "Dal", { sub: "Dal" })];
  it("only once the family's own are used; at least 30% of the week's non-staple items their own; of the same kind, like their dish", () => {
    const r = run({ slots, library: lib });
    const dals = WEEK.map((d) => r.at(d, "Dinner")[1]);
    expect(dals[0]).toBe("Dal tadka");
    const own = dals.filter((x) => x === "Dal tadka").length;
    expect(own / 7).toBeGreaterThanOrEqual(OWN_SHARE - 0.15);   // the last day may go past it rather than repeat yesterday's
    const okNames = suggestable("Dal").map((i) => i.name);
    for (const x of dals.filter((x) => x !== "Dal tadka")) expect(okNames).toContain(x);
    for (let i = 1; i < 7; i++) expect(dals[i]).not.toBe(dals[i - 1]);
    expect(r.placed.every((p) => p.kind === "Dal" && p.like === "Dal tadka")).toBe(true);
    expect(r.placed.map((p) => p.dish)).toEqual(dals.filter((x) => x !== "Dal tadka"));
    expect(r.dishAt(WEEK[1], "Dinner", dals[1])!.new).toBe(true);
  });
  it("the family's setting caps them: then their dish comes back, never on the next day", () => {
    const r = run({ slots, library: lib, newCap: 1 });
    expect(r.placed).toHaveLength(1);
    const dals = WEEK.map((d) => r.at(d, "Dinner")[1]);
    expect(dals.filter((x) => x === "Dal tadka").length).toBeGreaterThanOrEqual(3);
  });
  it("a regional item only to a family of its cuisine", () => {
    const fk: MealKind[] = [{ name: "Rice", staple: true }, { name: "Fish & seafood", subs: ["Fish curry"] }];
    const fslots = [slot("Lunch", { templates: [T({ kind: "Rice" }, { kind: "Fish & seafood", sub: "Fish curry", dish: "Rohu ghar ka curry" })] })];
    const flib = [dish("Rice", "Lunch", "Rice"), dish("Rohu ghar ka curry", "Lunch", "Fish & seafood", { sub: "Fish curry", contains: ["fish"] })];
    const plain = run({ slots: fslots, library: flib });
    expect(plain.placed.map((p) => p.dish)).not.toContain("Macher jhol");
    const bengal = run({ slots: fslots, library: flib, cuisines: ["bengal"] });
    const regional = suggestable("Fish & seafood", { sub: "Fish curry", cuisines: ["bengal"] }).filter((i) => i.regional).map((i) => i.name);
    expect(bengal.placed.some((p) => regional.includes(p.dish))).toBe(true);
  });
  it("never a new kind, and never one for a kind only this family has or a part of their own dishes", () => {
    const r = run({ slots: [slot("Breakfast", { 
      templates: [T({ kind: "Appam", dish: "Appam" }, { items: ["Vegetable stew", "Egg roast"] }), T({ kind: "Boiled chicken" })] })],
      library: [dish("Appam", "Breakfast", "Appam"), dish("Vegetable stew", "Breakfast", "Gravy"), dish("Egg roast", "Breakfast", "Egg", { contains: ["egg"] }),
        dish("Boiled chicken", "Breakfast", "Boiled chicken", { contains: ["chicken"] })] });
    for (const p of weekOf(r, "Breakfast")) {
      expect(p.length).toBeGreaterThan(0);
      for (const x of p) expect(["Appam", "Vegetable stew", "Egg roast", "Boiled chicken"].includes(x) || r.placed.some((n) => n.dish === x && n.kind === "Appam")).toBe(true);
    }
    expect(WEEK.filter((d) => r.at(d, "Breakfast").includes("Vegetable stew")).length).toBeGreaterThan(0);
    expect(WEEK.filter((d) => r.at(d, "Breakfast").includes("Egg roast")).length).toBeGreaterThan(0);
    expect(WEEK.filter((d) => r.at(d, "Breakfast").includes("Boiled chicken")).length).toBeGreaterThan(0);
  });
  it("a part named as a bare category (\"Sabzi\") is never a dish on the plate: a real item stands there", () => {
    // The category word lives on the template part (its words), never as a library row (§5.3).
    const r = run({ slots: [slot("Dinner", { templates: [T({ kind: "Roti" }, { kind: "Sabzi", words: "sabzi" })] })],
      library: [dish("Roti", "Dinner", "Roti")] });
    for (const p of weekOf(r, "Dinner")) { expect(p).toHaveLength(2); expect(p[1]).not.toBe("Sabzi"); }
    // Their word named the category: its items are theirs (lead's rule, 25 Nov), not new, not asked about.
    expect(r.placed).toEqual([]);
    for (const d of WEEK) expect(r.plates.get(slotDayKey(d, "Dinner"))!.every((x) => !x.new)).toBe(true);
  });
  it("a sub-kind they named (\"sambar\", \"a poriyal\") is filled with its items as theirs; nothing new outside it", () => {
    const r = run({ slots: [slot("Lunch", { templates: [T({ kind: "Rice" }, { kind: "Rice curry", sub: "Sambar", words: "sambar" }, { kind: "Sabzi", sub: "Poriyal/Thoran", words: "a poriyal" })] })],
      library: [dish("Rice", "Lunch", "Rice")] });
    const sambars = suggestable("Rice curry", { sub: "Sambar" }).map((i) => i.name), poriyals = suggestable("Sabzi", { sub: "Poriyal/Thoran" }).map((i) => i.name);
    const plates = weekOf(r, "Lunch");
    for (const p of plates) expect(sambars).toContain(p[1]);
    // The poriyals all come before one comes back; never a sabzi of another sub-kind (the "etc." rule).
    for (const p of plates) expect(poriyals).toContain(p[2]);
    expect(new Set(plates.slice(0, poriyals.length).map((p) => p[2])).size).toBe(poriyals.length);
    expect(r.placed).toEqual([]);
  });
});

describe("food rules (rule 6) and onion and garlic (rule 7)", () => {
  const people = ["Asha", "Ravi", "Dadi", "Dada"];
  const veg = [rule({ what: "veg", who: "Dadi", quote: "Dadi is vegetarian" }), rule({ what: "veg", who: "Dada", quote: "Dada is vegetarian" })];
  it("vegetarian grandparents in a chicken household: never chicken for them, their own item for that part", () => {
    const kinds: MealKind[] = [{ name: "Roti", staple: true }, { name: "Chicken" }, { name: "Sabzi" }];
    const lib = [dish("Phulka", "Dinner", "Roti"), ...["Chicken curry", "Butter chicken", "Chicken 65"].map((n) => dish(n, "Dinner", "Chicken", { contains: ["chicken"] })),
      ...SABZIS.map((n) => dish(n, "Dinner", "Sabzi")), dish("Paneer butter masala", "Dinner", "Gravy")];
    const r = run({ slots: [slot("Dinner", { templates: [T({ kind: "Roti" }, { kind: "Chicken" }, { kind: "Sabzi" })] })], library: lib, people, rules: veg });
    for (const d of WEEK) {
      const plate = r.plates.get(slotDayKey(d, "Dinner"))!;
      const chicken = plate.find((x) => ["Chicken curry", "Butter chicken", "Chicken 65"].includes(x.name) || /chicken/i.test(x.name));
      expect(chicken).toBeDefined();
      expect(chicken!.not_for.sort()).toEqual(["Dada", "Dadi"]);
      // Their own item for the chicken's part, beside the sabzi everyone eats.
      const theirs = plate.filter((x) => !x.not_for.length && x.name !== "Phulka");
      expect(theirs.length).toBeGreaterThanOrEqual(2);
    }
  });
  it("an item a person's rule forbids is passed over while another fits: no not_for at all", () => {
    const kinds: MealKind[] = [{ name: "Roti", staple: true }, { name: "Gravy" }];
    const lib = [dish("Phulka", "Dinner", "Roti"), dish("Mushroom masala", "Dinner", "Gravy", { contains: ["mushroom"] }), dish("Aloo matar", "Dinner", "Gravy"),
      dish("Malai kofta", "Dinner", "Gravy", { contains: ["dairy"] })];
    const r = run({ slots: [slot("Dinner", { templates: [T({ kind: "Roti" }, { kind: "Gravy" })] })], library: lib,
      rules: [rule({ who: "Ravi", items: ["mushroom"], quote: "Ravi eats no mushroom" })] });
    expect(WEEK.flatMap((d) => r.at(d, "Dinner"))).not.toContain("Mushroom masala");
    for (const d of WEEK) for (const x of r.plates.get(slotDayKey(d, "Dinner"))!) expect(x.not_for).toEqual([]);
  });
  it("a grandmother who eats no egg: the egg breakfast is not for her, and she has her own", () => {
    const kinds: MealKind[] = [{ name: "Egg" }, { name: "Poha" }];
    const lib = [...["Egg bhurji", "Boiled eggs", "Masala omelette"].map((n) => dish(n, "Breakfast", "Egg", { contains: ["egg"] })), ...["Kanda poha", "Batata poha"].map((n) => dish(n, "Breakfast", "Poha"))];
    const r = run({ slots: [slot("Breakfast", { templates: [T({ kind: "Egg" }), T({ kind: "Poha" })] })], library: lib, people,
      rules: [rule({ what: "no_eggs", who: "Dadi", quote: "Dadi eats no egg" })] });
    let eggDays = 0;
    for (const d of WEEK) {
      const plate = r.plates.get(slotDayKey(d, "Breakfast"))!;
      const egg = plate.find((x) => ["Egg bhurji", "Boiled eggs", "Masala omelette"].includes(x.name));
      if (egg) { eggDays++; expect(egg.not_for).toEqual(["Dadi"]); expect(plate.some((x) => !x.not_for.includes("Dadi"))).toBe(true); }
    }
    expect(eggDays).toBeGreaterThan(0);
  });
  it("a person with nothing on the template they can eat is given something", () => {
    const lib = [dish("Fish fry", "Lunch", "Fish & seafood", { sub: "Fish fry", contains: ["fish"] }), dish("Dal fry", "Lunch", "Dal")];
    const r = run({ slots: [slot("Lunch", { templates: [T({ items: ["Fish fry"] })] })], library: lib, people, rules: veg });
    for (const d of WEEK) {
      const plate = r.plates.get(slotDayKey(d, "Lunch"))!;
      expect(plate.find((x) => x.name === "Fish fry")!.not_for.sort()).toEqual(["Dada", "Dadi"]);
      expect(plate.some((x) => !x.not_for.includes("Dadi"))).toBe(true);
    }
    expect(r.unmet.filter((u) => u.includes("nothing"))).toEqual([]);
  });
  it("onion and garlic never block a dish: it is planned with a note; a dish that is mostly onion is not theirs", () => {
    const kinds: MealKind[] = [{ name: "Roti", staple: true }, { name: "Sabzi" }];
    const lib = [dish("Phulka", "Dinner", "Roti"), dish("Bhindi masala", "Dinner", "Sabzi", { contains: ["onion_garlic"] }),
      dish("Aloo pyaaz sabzi", "Dinner", "Sabzi", { contains: ["onion_garlic", "root_veg"] })];
    const r = run({ slots: [slot("Dinner", { templates: [T({ kind: "Roti" }, { kind: "Sabzi" })] })], library: lib, newCap: 0,
      rules: [rule({ who: "Ravi", items: ["onion_garlic"], quote: "Ravi eats no onion or garlic" })] });
    const bhindi = WEEK.map((d) => r.dishAt(d, "Dinner", "Bhindi masala")).filter(Boolean);
    expect(bhindi.length).toBeGreaterThan(0);
    for (const b of bhindi) { expect(b!.not_for).toEqual([]); expect(b!.note).toBe("make without onion and garlic, or keep Ravi's portion aside"); }
    for (const d of WEEK) { const p = r.dishAt(d, "Dinner", "Aloo pyaaz sabzi"); if (p) expect(p.not_for).toEqual(["Ravi"]); }
  });
});

// "a meal set up before templates" (deriveTemplates) moved to migrateMeaning.test.ts with the function.

describe("an add-on", () => {
  it("a dish had twice a week comes on two days apart; the other days are empty where the main meal feeds its person", () => {
    const slots = [slot("Dinner", { templates: [T({ kind: "Roti" }, { kind: "Sabzi" })] }),
      slot("Papa's dinner", { kind: "addon", addon_of: "Dinner", order: 60, usual_people: ["Ravi"], templates: [T({ items: ["Jowar bhakri"] })] })];
    const lib = [dish("Phulka", "Dinner", "Roti"), ...SABZIS.map((n) => dish(n, "Dinner", "Sabzi")), dish("Jowar bhakri", "Papa's dinner", "Bhakri", { frequency: "2/week" })];
    const days = [...WEEK.map((d) => day(d, "Dinner", ["Asha", "Ravi"])), ...WEEK.map((d) => day(d, "Papa's dinner", ["Ravi"]))];
    const r = run({ slots, library: lib, days, newCap: 0 });
    const on = WEEK.filter((d) => r.at(d, "Papa's dinner").length);
    expect(on).toHaveLength(2);
    expect(WEEK.indexOf(on[1]) - WEEK.indexOf(on[0])).toBeGreaterThan(1);
    expect(r.unmet).toEqual([]);
  });
});

describe("an allergy (rule 6: checked by what the catalog says; no careful read)", () => {
  const peanut = rule({ who: "Ravi", items: ["peanut"], quote: "Ravi is allergic to peanuts" });
  it("a new poha is checked by its catalog contents: one with peanuts as a main ingredient is never on Ravi's plate while another fits; nothing is left unknown", () => {
    const r = fillWeek({ days: WEEK.map((d) => day(d, "Breakfast", ["Asha", "Ravi"])), slots: [slot("Breakfast", { templates: [T({ kind: "Poha", dish: "Kanda poha" })] })],
      library: [dish("Kanda poha", "Breakfast", "Poha")], rules: [peanut], history: new Map(), cuisines: [] });
    expect(r.placed.length).toBeGreaterThan(0);
    for (const d of WEEK) for (const x of r.plates.get(slotDayKey(d, "Breakfast"))!) {
      const main = (catalogIngredients(x.name) ?? []).some((i) => i.name === "peanuts" && i.main);
      expect(x.not_for).toEqual(main ? ["Ravi"] : []);
    }
    expect(r.unknowns).toEqual([]);
    expect(r.unmet.filter((u) => u.includes("nothing to eat"))).toEqual([]);
  });
});
const uniqSorted = (xs: string[]) => [...new Set(xs)].sort();

describe("a plate is never empty", () => {
  const weekdays = WEEK.slice(0, 5), weekend = WEEK.slice(5);
  const vegWeekdays = rule({ items: ["meat", "fish"], days: ["Mon", "Tue", "Wed", "Thu", "Fri"], quote: "non-veg only on weekends" });
  it("a template that cannot be filled that day (fish on a weekday the house keeps vegetarian) gives way to another of the meal's", () => {
    const kinds: MealKind[] = [{ name: "Roti", staple: true }, { name: "Sabzi" }, { name: "Fish & seafood" }];
    const fish = ["Surmai fry", "Bangda curry"];
    const lib = [dish("Phulka", "Dinner", "Roti"), ...SABZIS.map((n) => dish(n, "Dinner", "Sabzi")), ...fish.map((n) => dish(n, "Dinner", "Fish & seafood", { contains: ["fish"] }))];
    const r = run({ slots: [slot("Dinner", { templates: [T({ kind: "Roti" }, { kind: "Sabzi" }), T({ kind: "Roti" }, { kind: "Fish & seafood" })] })], library: lib, rules: [vegWeekdays], newCap: 0 });
    for (const d of WEEK) expect(r.at(d, "Dinner").filter((x) => x !== "Phulka").length).toBeGreaterThan(0);
    const fishy = (x: string) => fish.includes(x) || /fish|prawn/i.test(x);
    for (const d of weekdays) expect(r.at(d, "Dinner").some(fishy)).toBe(false);
    expect(weekend.some((d) => r.at(d, "Dinner").some(fishy))).toBe(true);
    expect(r.unmet.filter((u) => u.includes("nothing for"))).toEqual([]);
  });
  it("a one-dish breakfast that has nothing that day is another of the family's breakfasts, never an empty one", () => {
    const kinds: MealKind[] = [{ name: "Egg" }, { name: "Poha" }];
    const eggs = ["Egg bhurji", "Masala omelette"];
    const lib = [...eggs.map((n) => dish(n, "Breakfast", "Egg", { contains: ["egg"] })), ...["Kanda poha", "Batata poha", "Matar poha"].map((n) => dish(n, "Breakfast", "Poha"))];
    const r = run({ slots: [slot("Breakfast", { templates: [T({ kind: "Egg" }), T({ kind: "Poha" })] })], library: lib, newCap: 0,
      rules: [rule({ what: "no_eggs", days: ["Tue", "Thu"], quote: "no eggs on Tuesday and Thursday" })] });
    for (const d of WEEK) expect(r.at(d, "Breakfast").length).toBeGreaterThan(0);
    for (const d of [WEEK[1], WEEK[3]]) expect(r.at(d, "Breakfast").some((x) => eggs.includes(x))).toBe(false);
  });
});

describe("a plate never doubles its staple (class 3)", () => {
  it("varan bhaat beside the plate's rice, at any meal: the rice goes", () => {
    const kinds: MealKind[] = [{ name: "Roti", staple: true }, { name: "Rice", staple: true }, { name: "Dal", subs: ["Amti/Varan"] }];
    const lib = [dish("Poli", "Lunch", "Roti"), dish("Steamed rice", "Lunch", "Rice"), dish("Varan bhaat", "Lunch", "Dal", { sub: "Amti/Varan" })];
    const r = run({ slots: [slot("Lunch", { templates: [T({ kind: "Roti" }, { kind: "Rice" }, { kind: "Dal", sub: "Amti/Varan" })] })], library: lib, newCap: 0 });
    for (const d of WEEK.filter((x) => r.at(x, "Lunch").includes("Varan bhaat"))) expect(r.at(d, "Lunch")).toEqual(["Poli", "Varan bhaat"]);
  });
  it("a family dish that already holds the plate's rice ('rasam rice') takes the plain rice's place", () => {
    const kinds: MealKind[] = [{ name: "Rice", staple: true }, { name: "Rice curry", subs: ["Sambar", "Rasam"] }, { name: "Curd", staple: true }];
    const lib = [dish("Rice", "Lunch", "Rice"), dish("Curd", "Lunch", "Curd"), dish("Drumstick sambar", "Lunch", "Rice curry", { sub: "Sambar" }),
      dish("Rasam rice", "Lunch", "Rice curry", { sub: "Rasam" }), dish("Tomato rasam", "Lunch", "Rice curry", { sub: "Rasam" })];
    const r = run({ slots: [slot("Lunch", { templates: [T({ kind: "Rice" }, { kind: "Rice curry" }, { kind: "Curd" })] })], library: lib, newCap: 0 });
    const withIt = WEEK.filter((d) => r.at(d, "Lunch").includes("Rasam rice"));
    expect(withIt.length).toBeGreaterThan(0);
    for (const d of withIt) expect(r.at(d, "Lunch")).not.toContain("Rice");
    for (const d of WEEK.filter((x) => !withIt.includes(x))) expect(r.at(d, "Lunch")).toContain("Rice");
  });
  it("curd rice as the plate's curd: no plain rice beside it", () => {
    const kinds: MealKind[] = [{ name: "Rice", staple: true }, { name: "Curd", staple: true }];
    const lib = [dish("Steamed rice", "Tiffin", "Rice"), dish("Curd rice", "Tiffin", "Curd")];
    const r = run({ slots: [slot("Tiffin", { kind: "custom", order: 20, templates: [T({ kind: "Rice" }, { kind: "Curd" })] })], library: lib, newCap: 0 });
    for (const d of WEEK) expect(r.at(d, "Tiffin")).toEqual(["Curd rice"]);
  });
});

describe("a template made for a pinned dish, and one that would repeat yesterday's item", () => {
  it("a template whose part is only a dish kept to a day ('pongal on Sundays') comes only on that day", () => {
    const kinds: MealKind[] = [{ name: "Idli" }, { name: "Dosa" }, { name: "Khichdi", subs: ["Pongal"] }];
    const lib = [...["Rava idli", "Kanchipuram idli"].map((n) => dish(n, "Breakfast", "Idli")), ...["Masala dosa", "Ghee roast dosa"].map((n) => dish(n, "Breakfast", "Dosa")),
      dish("Ven pongal", "Breakfast", "Khichdi", { sub: "Pongal", days: ["Sun"] })];
    const r = run({ slots: [slot("Breakfast", { templates: [T({ kind: "Idli", dish: "Rava idli" }), T({ kind: "Dosa", dish: "Masala dosa" }), T({ kind: "Khichdi", sub: "Pongal", dish: "Ven pongal" })] })], library: lib });
    expect(r.at(WEEK[6], "Breakfast")).toEqual(["Ven pongal"]);
    for (const d of WEEK.slice(0, 6)) expect(r.at(d, "Breakfast").some((x) => /pongal/i.test(x))).toBe(false);
  });
  it("where a part's only item was had yesterday, another of the meal's templates comes instead of the repeat", () => {
    const kinds: MealKind[] = [{ name: "Roti", staple: true }, { name: "Dosa" }, { name: "Gravy", own: true }];
    const lib = [dish("Phulka", "Dinner", "Roti"), dish("Veg stew", "Dinner", "Gravy"), ...["Plain dosa", "Masala dosa", "Rava dosa", "Onion dosa"].map((n) => dish(n, "Dinner", "Dosa"))];
    const r = run({ slots: [slot("Dinner", { templates: [share(T({ kind: "Roti" }, { kind: "Gravy" }), "5/week"), T({ kind: "Dosa" })] })], library: lib });
    const stew = WEEK.map((d) => r.at(d, "Dinner").includes("Veg stew"));
    for (let i = 1; i < 7; i++) expect(stew[i] && stew[i - 1]).toBe(false);
    for (const d of WEEK) expect(r.at(d, "Dinner").filter((x) => x !== "Phulka").length).toBeGreaterThan(0);
  });
});

describe("a category kept to a day", () => {
  it("'pongal on Sundays' said as the category: a pongal on Sunday, none on other days", () => {
    const lib = [...["Rava idli", "Kanchipuram idli"].map((n) => dish(n, "Breakfast", "Idli")), ...["Masala dosa", "Ghee roast dosa"].map((n) => dish(n, "Breakfast", "Dosa"))];
    const r = run({ slots: [slot("Breakfast", { templates: [T({ kind: "Idli" }), T({ kind: "Dosa" }), { parts: [{ kind: "Khichdi", sub: "Pongal", words: "pongal" }], days: ["Sun"] }] })], library: lib });
    expect(r.at(WEEK[6], "Breakfast").some((x) => /pongal/i.test(x))).toBe(true);
    expect(r.at(WEEK[6], "Breakfast")).not.toContain("Pongal");
    for (const d of WEEK.slice(0, 6)) expect(r.at(d, "Breakfast").some((x) => /pongal/i.test(x))).toBe(false);
  });
});

describe("a house-wide allergy and a category the family named (class 1: empty meals)", () => {
  it("the family's 'poha' under 'nothing at home has peanuts': their poha items are checked like any catalog item (decided 21: no longer vouched), made without peanuts; breakfast is never empty", () => {
    const peanut = rule({ items: ["peanut"], quote: "nothing at home has peanuts, he is allergic" });
    const r = fillWeek({ days: WEEK.map((d) => day(d, "Breakfast", ["Asha", "Ravi"])), slots: [slot("Breakfast", { templates: [T({ kind: "Poha", words: "poha" })] })],
      library: [], rules: [peanut], history: new Map(), cuisines: [] });
    // Not vouched: each item placed is checked by the catalog's contents, and none is left unknown.
    expect(r.unknowns).toEqual([]);
    for (const d of WEEK) {
      const plate = r.plates.get(slotDayKey(d, "Breakfast"))!;
      expect(plate.length).toBe(1);
      expect(plate[0].not_for).toEqual([]);
      expect(plate[0].name).not.toBe("Poha");
      const peanuts = (catalogIngredients(plate[0].name) ?? []).some((i) => i.name === "peanuts");
      expect(plate[0].note).toBe(peanuts ? "make without peanuts" : null);
    }
  });
});

describe("a dish had every day (class 2: daily items)", () => {
  it("'eggs every morning', said as the category, comes every day beside whatever the template brings, a different egg dish where it can", () => {
    // The category is a part of every template (setup's shape for "every morning"), never a library row.
    const eggs = { kind: "Egg", sub: "Eggs", words: "eggs" };
    const lib = [dish("Oats porridge", "Breakfast", "Porridge"), dish("Butter toast", "Breakfast", "Toast")];
    const r = run({ slots: [slot("Breakfast", { templates: [T(eggs), T({ kind: "Porridge", dish: "Oats porridge" }, eggs), T({ kind: "Toast", dish: "Butter toast" }, eggs)] })], library: lib });
    for (const d of WEEK) {
      const p = r.at(d, "Breakfast");
      expect(p.filter((x) => /egg|omelette|half fry|bhurji/i.test(x)).length).toBe(1);
      expect(p).not.toContain("Eggs");
    }
  });
  it("a dish of theirs had every day is on every plate of its meal", () => {
    const kinds: MealKind[] = [{ name: "Roti", staple: true }, { name: "Sabzi" }];
    const lib = [dish("Phulka", "Dinner", "Roti"), ...SABZIS.map((n) => dish(n, "Dinner", "Sabzi")), dish("Kachumber", "Dinner", "Salad", { frequency: "daily" })];
    const r = run({ slots: [slot("Dinner", { templates: [T({ kind: "Roti" }, { kind: "Sabzi" })] })], library: lib });
    for (const d of WEEK) expect(r.at(d, "Dinner")).toContain("Kachumber");
  });
});

describe("a category said how often of", () => {
  it("'dal sometimes' at dinner: dals there on at most three days, though both templates hold a dal", () => {
    const kinds: MealKind[] = [{ name: "Roti", staple: true }, { name: "Sabzi" }, { name: "Dal" }, { name: "Chicken" }];
    const lib = [dish("Phulka", "Dinner", "Roti"), ...SABZIS.map((n) => dish(n, "Dinner", "Sabzi")), dish("Dal", "Dinner", "Dal", { frequency: "sometimes" }),
      ...["Chicken curry", "Kadai chicken"].map((n) => dish(n, "Dinner", "Chicken", { contains: ["chicken"] }))];
    const r = run({ slots: [slot("Dinner", { templates: [T({ kind: "Roti" }, { kind: "Chicken" }, { kind: "Sabzi" }, { kind: "Dal" }), T({ kind: "Roti" }, { kind: "Sabzi" }, { kind: "Dal" })] })], library: lib });
    expect(WEEK.filter((d) => r.at(d, "Dinner").some((x) => /dal/i.test(x))).length).toBeLessThanOrEqual(3);
    for (const d of WEEK) expect(r.at(d, "Dinner").length).toBeGreaterThanOrEqual(2);
  });
});

describe("a dish had most days, kept by its template's share", () => {
  it("'idli most days' with an idli template @usually: never a second idli beside another breakfast", () => {
    const kinds: MealKind[] = [{ name: "Idli" }, { name: "Dosa" }];
    const lib = [dish("Idli", "Breakfast", "Idli", { frequency: "usually" }), ...["Masala dosa", "Rava dosa"].map((n) => dish(n, "Breakfast", "Dosa"))];
    const r = run({ slots: [slot("Breakfast", { templates: [share(T({ kind: "Idli" }), "usually"), T({ kind: "Dosa" })] })], library: lib });
    for (const d of WEEK) expect(r.at(d, "Breakfast")).toHaveLength(1);
  });
});

describe("template shares (rule 1)", () => {
  it("an exact '2/week' is never exceeded: the days left go to the templates said in words", () => {
    const t = (sh: MealTemplate["share"]) => share(T({ kind: "Dosa" }), sh);
    expect(templateCounts([t("2/week"), t("sometimes"), t("sometimes")], 7)).toEqual([2, 3, 2]);
  });
});

describe("an add-on with nothing to give (safety)", () => {
  it("a grandmother's own breakfast with no dish of hers: she is fed at the family's breakfast", () => {
    const slots = [slot("Breakfast", { templates: [T({ kind: "Porridge" }), T({ kind: "Idli" })] }),
      slot("Dadi's breakfast", { kind: "addon", addon_of: "Breakfast", order: 15, usual_people: ["Dadi"] })];
    const lib = [dish("Ragi java", "Breakfast", "Porridge", { contains: ["sugar", "dairy"] }), ...["Rava idli", "Kanchipuram idli"].map((n) => dish(n, "Breakfast", "Idli"))];
    const days = [...WEEK.map((d) => day(d, "Breakfast", ["Asha", "Dadi"])), ...WEEK.map((d) => day(d, "Dadi's breakfast", ["Dadi"]))];
    const r = run({ slots, library: lib, days, newCap: 0, rules: [rule({ who: "Dadi", items: ["sugar"], quote: "Dadi: no sugar" })] });
    for (const d of WEEK) expect(r.plates.get(slotDayKey(d, "Breakfast"))!.some((x) => !x.not_for.includes("Dadi"))).toBe(true);
  });
});

describe("a new item's diet (rule 4: new variants are like the family's own)", () => {
  it("a house whose only meat is chicken is never suggested a mutton or egg pulao", () => {
    const kinds: MealKind[] = [{ name: "Pulao" }];
    const lib = [dish("Veg pulao", "Tiffin", "Pulao"), dish("Chicken curry", "Lunch", "Chicken", { contains: ["chicken"] })];
    const r = run({ slots: [slot("Tiffin", { kind: "custom", order: 20, templates: [T({ kind: "Pulao", dish: "Veg pulao" })] })], library: lib });
    const all = WEEK.flatMap((d) => r.at(d, "Tiffin"));
    expect(all.some((x) => /mutton|yakhni|egg|fish|prawn/i.test(x))).toBe(false);
    expect(r.placed.length).toBeGreaterThan(0);
  });
});

describe("the family's day and count words hold for whatever stands for the dish (owner rule 3, class 1)", () => {
  const dinnerKinds: MealKind[] = [{ name: "Roti", staple: true }, { name: "Gravy", subs: ["Kurma"] }, { name: "Dosa" }, { name: "Rice curry", subs: ["Sambar"] }];
  const others = [...["Masala dosa", "Rava dosa", "Onion dosa"].map((n) => dish(n, "Dinner", "Dosa")), ...["Drumstick sambar", "Mixed vegetable sambar"].map((n) => dish(n, "Dinner", "Rice curry", { sub: "Sambar" }))];
  const kurmaWeek = (lib: LibraryDish[]) => run({ slots: [slot("Dinner", { templates: [T({ kind: "Roti" }, { kind: "Gravy", sub: "Kurma" }), T({ kind: "Dosa" }, { kind: "Rice curry", sub: "Sambar" })] })], library: lib, cuisines: ["south", "tamil"] });
  it("'chapati and a kurma twice a week' with no share on the template: chapati and kurma on two nights, every night a whole plate", () => {
    const r = kurmaWeek([dish("Chapati", "Dinner", "Roti", { frequency: "2/week" }), dish("Kurma", "Dinner", "Gravy", { sub: "Kurma", frequency: "2/week" }), ...others]);
    expect(WEEK.filter((d) => r.at(d, "Dinner").includes("Chapati")).length).toBeLessThanOrEqual(2);
    expect(WEEK.filter((d) => r.at(d, "Dinner").some((x) => /kurma/i.test(x))).length).toBeLessThanOrEqual(2);
    for (const d of WEEK) expect(r.at(d, "Dinner").length).toBe(2);
  });
  it("a staple said how often ('chapati twice a week') limits the template it comes in, though the kurma was not counted", () => {
    const r = kurmaWeek([dish("Chapati", "Dinner", "Roti", { frequency: "2/week" }), dish("Kurma", "Dinner", "Gravy", { sub: "Kurma" }), ...others]);
    expect(WEEK.filter((d) => r.at(d, "Dinner").includes("Chapati")).length).toBeLessThanOrEqual(2);
    for (const d of WEEK) expect(r.at(d, "Dinner").length).toBe(2);
  });
  it("a dish said how often, the only one of its part ('veg kurma twice a week'): no new kurma stands in for it on a third night", () => {
    const r = kurmaWeek([dish("Phulka", "Dinner", "Roti"), dish("Vegetable kurma", "Dinner", "Gravy", { sub: "Kurma", frequency: "2/week" }), ...others]);
    expect(WEEK.filter((d) => r.at(d, "Dinner").some((x) => /kurma/i.test(x))).length).toBeLessThanOrEqual(2);
    for (const d of WEEK) expect(r.at(d, "Dinner").length).toBe(2);
  });
  it("'pasta on Sundays' said as the category: a pasta only on Sunday, never another pasta on a weekday", () => {
    const kinds: MealKind[] = [{ name: "Roti", staple: true }, { name: "Sabzi" }, { name: "Pasta" }];
    const lib = [dish("Phulka", "Dinner", "Roti"), ...SABZIS.map((n) => dish(n, "Dinner", "Sabzi"))];
    const r = run({ slots: [slot("Dinner", { templates: [T({ kind: "Roti" }, { kind: "Sabzi" }), { parts: [{ kind: "Pasta", words: "pasta" }], days: ["Sun"] }] })], library: lib });
    for (const d of WEEK.slice(0, 6)) expect(r.at(d, "Dinner").some((x) => /pasta|macaroni|spaghetti|penne/i.test(x))).toBe(false);
    expect(r.at(WEEK[6], "Dinner").length).toBeGreaterThan(0);
  });
  it("'white sauce pasta on Sundays', a dish, in a pasta part: no other pasta stands in for it on a weekday", () => {
    const kinds: MealKind[] = [{ name: "Roti", staple: true }, { name: "Sabzi" }, { name: "Pasta" }];
    const lib = [dish("Phulka", "Dinner", "Roti"), ...SABZIS.map((n) => dish(n, "Dinner", "Sabzi")), dish("White sauce pasta", "Dinner", "Pasta", { days: ["Sun"] })];
    const r = run({ slots: [slot("Dinner", { templates: [T({ kind: "Roti" }, { kind: "Sabzi" }), T({ kind: "Pasta", dish: "White sauce pasta" })] })], library: lib });
    for (const d of WEEK.slice(0, 6)) expect(r.at(d, "Dinner").some((x) => /pasta|macaroni|spaghetti|penne/i.test(x))).toBe(false);
    expect(r.at(WEEK[6], "Dinner")).toContain("White sauce pasta");
  });
  it("a template with a pinned part shared with another template: the shared kind still rotates on other days (rajma on Sundays)", () => {
    const kinds: MealKind[] = [{ name: "Roti", staple: true }, { name: "Dal" }, { name: "Sabzi" }];
    const lib = [dish("Phulka", "Dinner", "Roti"), ...SABZIS.map((n) => dish(n, "Dinner", "Sabzi")), ...["Moong dal", "Dal tadka"].map((n) => dish(n, "Dinner", "Dal")),
      dish("Rajma", "Dinner", "Dal", { sub: "Rajma/Chole", days: ["Sun"] })];
    const r = run({ slots: [slot("Dinner", { templates: [T({ kind: "Roti" }, { kind: "Dal" }, { kind: "Sabzi" })] })], library: lib });
    expect(r.at(WEEK[6], "Dinner")).toContain("Rajma");
    expect(WEEK.slice(0, 6).filter((d) => r.at(d, "Dinner").some((x) => /dal/i.test(x))).length).toBeGreaterThan(0);
  });
});

describe("a regional word the family used as a category (decided 20)", () => {
  it("'a curry' in an Andhra home, stored as Sabzi / Vepudu: never the bare word on a plate, always a real dry vegetable dish", () => {
    const kinds: MealKind[] = [{ name: "Rice", staple: true }, { name: "Sabzi", subs: ["Vepudu"] }];
    const lib = [dish("Rice", "Lunch", "Rice"), dish("Cabbage curry", "Lunch", "Sabzi", { sub: "Vepudu" })];
    const r = run({ slots: [slot("Lunch", { templates: [T({ kind: "Rice" }, { kind: "Sabzi", sub: "Vepudu", words: "a curry" })] })], library: lib, cuisines: ["andhra", "south"] });
    for (const d of WEEK) { expect(r.at(d, "Lunch")).not.toContain("Curry"); expect(r.at(d, "Lunch")).toHaveLength(2); }
    expect(r.ownItems?.size).toBeGreaterThan(0);
  });
});

describe("a family dish fills places only at the meal it was named for (class 1)", () => {
  it("their dinner's 'rasam rice' never fills lunch's rasam place: lunch takes rasams of its own, dinner has its rasam rice", () => {
    const lunch = slot("Lunch", { 
      templates: [T({ kind: "Rice" }, { kind: "Rice curry", sub: "Rasam" }, { kind: "Curd" })] });
    const dinner = slot("Dinner", { 
      templates: [T({ kind: "Roti" }, { kind: "Gravy", sub: "Kurma" }), share(T({ kind: "Rice" }, { kind: "Rice curry", sub: "Rasam" }), "sometimes")] });
    const lib = [dish("Rice", "Lunch", "Rice"), dish("Rasam", "Lunch", "Rice curry", { sub: "Rasam" }), dish("Curd", "Lunch", "Curd"),
      dish("Chapati", "Dinner", "Roti"), dish("Kurma", "Dinner", "Gravy", { sub: "Kurma" }), dish("Rasam rice", "Dinner", "Rice curry", { sub: "Rasam", frequency: "sometimes" })];
    const r = run({ slots: [lunch, dinner], library: lib, cuisines: ["south", "tamil"] });
    expect(WEEK.filter((d) => r.at(d, "Lunch").includes("Rasam rice"))).toEqual([]);
    for (const d of WEEK) expect(r.at(d, "Lunch").some((x) => /rasam/i.test(x))).toBe(true);
    expect(WEEK.filter((d) => r.at(d, "Dinner").includes("Rasam rice")).length).toBeGreaterThan(0);
  });
  it("a category named at dinner ('uthappam sometimes') makes its items theirs at dinner only: breakfast's dosas are breakfast's own", () => {
    const bf = slot("Breakfast", { templates: [T({ kind: "Dosa", dish: "Masala dosa" })] });
    const dinner = slot("Dinner", { templates: [T({ kind: "Dosa" }, { kind: "Gravy", sub: "Kurma" })] });
    const lib = [dish("Masala dosa", "Breakfast", "Dosa"), dish("Rava dosa", "Breakfast", "Dosa"), dish("Neer dosa", "Breakfast", "Dosa"),
      dish("Uthappam", "Dinner", "Dosa", { frequency: "sometimes" }), dish("Kurma", "Dinner", "Gravy", { sub: "Kurma" })];
    const r = run({ slots: [bf, dinner], library: lib, newCap: 0, cuisines: ["south"] });
    for (const d of WEEK) expect(["Masala dosa", "Rava dosa", "Neer dosa"]).toContain(r.at(d, "Breakfast")[0]);
  });
});

describe("a count said of a dish holds across the day's meals (class 2)", () => {
  it("'kadhi three times a week' at lunch and 'khichdi and kadhi twice a week' at dinner: at most 3 kadhi days in all, each meal within its own words", () => {
    const sabzis = ["Tindora shaak", "Bhindi shaak", "Cabbage shaak", "Lauki shaak"];
    // Lunch is had at home on Monday and the weekend only (the days it is cooked), so its kadhi days fall apart from dinner's.
    const lunch = slot("Lunch", { days: ["Mon", "Sat", "Sun"], 
      templates: [T({ kind: "Roti" }, { kind: "Dal", sub: "Dal", words: "dal" }, { kind: "Rice" }, { kind: "Sabzi" }), share(T({ kind: "Roti" }, { kind: "Rice curry", sub: "Kadhi", dish: "Kadhi" }, { kind: "Rice" }, { kind: "Sabzi" }), "3/week")] });
    const dinner = slot("Dinner", { 
      templates: [share(T({ kind: "Khichdi", sub: "Khichdi", dish: "Khichdi" }, { kind: "Rice curry", sub: "Kadhi", dish: "Kadhi" }), "2/week"), T({ kind: "Bhakri" }, { kind: "Sabzi" })] });
    const lib = [dish("Rotli", "Lunch", "Roti"), dish("Bhaat", "Lunch", "Rice"), ...sabzis.map((n) => dish(n, "Lunch", "Sabzi")),
      dish("Kadhi", "Lunch", "Rice curry", { sub: "Kadhi", frequency: "3/week" }),
      dish("Khichdi", "Dinner", "Khichdi", { sub: "Khichdi", frequency: "2/week" }), dish("Kadhi", "Dinner", "Rice curry", { sub: "Kadhi", frequency: "2/week" }),
      dish("Bhakri", "Dinner", "Bhakri"), ...sabzis.map((n) => dish(n, "Dinner", "Sabzi"))];
    const days = WEEK.flatMap((d, i) => [...(i === 0 || i >= 5 ? [day(d, "Lunch", ["Asha", "Ravi"])] : []), day(d, "Dinner", ["Asha", "Ravi"])]);
    const r = run({ slots: [lunch, dinner], library: lib, cuisines: ["gujarat", "west"], days });
    const kadhiAt = (s: string) => WEEK.filter((d) => r.at(d, s).some((x) => /kadhi/i.test(x)));
    expect(kadhiAt("Lunch").length).toBeLessThanOrEqual(3);
    expect(kadhiAt("Dinner").length).toBeLessThanOrEqual(2);
    expect(new Set([...kadhiAt("Lunch"), ...kadhiAt("Dinner")]).size).toBeLessThanOrEqual(3);
    expect(new Set([...kadhiAt("Lunch"), ...kadhiAt("Dinner")]).size).toBeGreaterThan(0);
  });
  it("a dish said 'twice a week' at lunch and also had at dinner where it is said nowhere comes twice in all", () => {
    const lunch = slot("Lunch", { templates: [T({ kind: "Rice" }, { kind: "Sabzi" })] });
    const dinner = slot("Dinner", { templates: [T({ kind: "Roti" }, { kind: "Sabzi" }, { items: ["Aloo gobi"] })] });
    const lib = [dish("Rice", "Lunch", "Rice"), dish("Phulka", "Dinner", "Roti"), ...SABZIS.filter((n) => n !== "Aloo gobi").map((n) => dish(n, "Lunch", "Sabzi")),
      dish("Aloo gobi", "Lunch", "Sabzi", { frequency: "2/week" }), ...SABZIS.filter((n) => n !== "Aloo gobi").map((n) => dish(n, "Dinner", "Sabzi"))];
    const r = run({ slots: [lunch, dinner], library: lib, newCap: 0 });
    expect(WEEK.filter((d) => [...r.at(d, "Lunch"), ...r.at(d, "Dinner")].includes("Aloo gobi")).length).toBeLessThanOrEqual(2);
  });
});

describe("a dish had every day comes every day it is had there, in any kind of meal (class 5)", () => {
  for (const kind of ["addon", "custom"] as const) it(`'a glass of milk every day' at her own dinner (${kind})`, () => {
    const own = slot("Nani's dinner", { kind, addon_of: kind === "addon" ? "Dinner" : null, usual_people: ["Nani"], order: kind === "addon" ? 60 : 55 });
    const lib = [dish("Phulka", "Dinner", "Roti"), ...SABZIS.map((n) => dish(n, "Dinner", "Sabzi")),
      dish("Vegetable upma", "Nani's dinner", "Upma"), dish("Ragi roti", "Nani's dinner", "Roti"), dish("Milk", "Nani's dinner", null, { frequency: "daily", contains: ["dairy"] })];
    const days = WEEK.flatMap((d) => [day(d, "Dinner", ["Asha", "Ravi"]), day(d, "Nani's dinner", ["Nani"])]);
    const r = run({ slots: [slot("Dinner", { templates: [T({ kind: "Roti" }, { kind: "Sabzi" })] }), { ...own, templates: [T({ items: ["Vegetable upma"] }), T({ items: ["Ragi roti"] })] }],
      library: lib, days, history: { Dinner: seed([["Phulka", "Aloo gobi"], ["Phulka", "Lauki sabzi"]]), "Nani's dinner": seed([["Vegetable upma", "Milk"], ["Ragi roti", "Milk"]]) } });
    for (const d of WEEK) expect(r.at(d, "Nani's dinner")).toContain("Milk");
  });
});

describe("a dish of one person's own meal never comes to the family's (class 6)", () => {
  it("her bajra roti every day at her own dinner is never the family dinner's roti, nor her daily dish theirs", () => {
    const own = slot("Nani's dinner", { kind: "custom", usual_people: ["Nani"], order: 55, templates: [T({ kind: "Roti" }, { items: ["Milk"] })] });
    const dinner = slot("Dinner", { usual_people: ["Asha", "Ravi"], templates: [T({ kind: "Roti" }, { kind: "Sabzi" })] });
    const lib = [...SABZIS.map((n) => dish(n, "Dinner", "Sabzi")), dish("Bajra roti", "Nani's dinner", "Roti", { frequency: "daily" }),
      dish("Milk", "Nani's dinner", null, { frequency: "daily", contains: ["dairy"] })];
    const days = WEEK.flatMap((d) => [day(d, "Dinner", ["Asha", "Ravi"]), day(d, "Nani's dinner", ["Nani"])]);
    const r = run({ slots: [dinner, own], library: lib, days });
    for (const d of WEEK) {
      expect(r.at(d, "Dinner")).not.toContain("Bajra roti");
      expect(r.at(d, "Dinner")).not.toContain("Milk");
      expect(r.at(d, "Dinner")).toHaveLength(2);
      expect(r.at(d, "Nani's dinner")).toEqual(["Bajra roti", "Milk"]);
    }
  });
});

describe("an add-on's own dishes kept to their words still feed its person when the main meal cannot (class 1 with rule 6)", () => {
  it("her ragi dosa or ragi java a few times a week: on the other days, with nothing at breakfast she may eat, one of hers comes back", () => {
    const bf = slot("Breakfast", { templates: [T({ kind: "Toast" })] });
    const own = slot("Nani's breakfast", { kind: "addon", addon_of: "Breakfast", usual_people: ["Nani"], order: 60,
      templates: [share(T({ kind: "Dosa" }), "sometimes"), share(T({ kind: "Porridge" }), "sometimes")] });
    const lib = [dish("Peanut butter toast", "Breakfast", "Toast", { contains: ["sugar", "nuts"] }), dish("Jam toast", "Breakfast", "Toast", { contains: ["sugar"] }),
      dish("Ragi dosa", "Nani's breakfast", "Dosa", { frequency: "sometimes" }), dish("Ragi java", "Nani's breakfast", "Porridge", { frequency: "sometimes" })];
    const days = WEEK.flatMap((d) => [day(d, "Breakfast", ["Asha", "Nani"]), day(d, "Nani's breakfast", ["Nani"])]);
    const r = run({ slots: [bf, own], library: lib, days, newCap: 0, rules: [rule({ who: "Nani", items: ["sugar", "nuts"], quote: "no sugar or nuts for her" })] });
    for (const d of WEEK) expect(r.at(d, "Nani's breakfast").length + r.at(d, "Breakfast").filter((x) => !/toast/i.test(x)).length).toBeGreaterThan(0);
  });
});

describe("a rule kept to days and meals holds in every meal outside them (safety: \"chicken only at Sunday lunch\")", () => {
  const only = ["Ravi", "Karan"].map((who) => rule({ what: "only", who, items: ["chicken"], days: ["Sun"], slots: ["Lunch"], quote: "We eat chicken only on Sunday lunch." }));
  it("a new pulao in a child's tiffin never carries chicken, while Sunday lunch keeps the family's chicken", () => {
    const tiffin = slot("Karan's tiffin", { kind: "custom", order: 20, usual_people: ["Karan"], templates: [T({ kind: "Pulao", dish: "Veg pulao" })] });
    const lunch = slot("Lunch", { templates: [T({ kind: "Rice" }, { kind: "Dal" })] });
    const lib = [dish("Veg pulao", "Karan's tiffin", "Pulao"), dish("Rice", "Lunch", "Rice"), dish("Dal tadka", "Lunch", "Dal"), dish("Moong dal", "Lunch", "Dal"),
      dish("Chicken curry", "Lunch", "Chicken", { contains: ["chicken"], days: ["Sun"] })];
    const days = [...WEEK.map((d) => day(d, "Karan's tiffin", ["Karan"])), ...WEEK.map((d) => day(d, "Lunch", ["Ravi", "Asha"]))];
    const r = run({ slots: [tiffin, lunch], library: lib, rules: only, days });
    const tiffins = WEEK.flatMap((d) => r.at(d, "Karan's tiffin"));
    expect(tiffins.length).toBeGreaterThanOrEqual(7);
    expect(tiffins.filter((x) => /chicken|murgh/i.test(x))).toEqual([]);
    expect(r.placed.length).toBeGreaterThan(0);   // new pulaos were placed: they were checked like the family's
    expect(r.at(WEEK[6], "Lunch")).toContain("Chicken curry");
    expect(r.dishAt(WEEK[6], "Lunch", "Chicken curry")!.not_for).toEqual([]);
  });
  it("a chicken dish on a weekday dinner is not for the people the rule is of", () => {
    const dinner = slot("Dinner", { templates: [T({ kind: "Roti" }, { kind: "Chicken" })] });
    const lib = [dish("Phulka", "Dinner", "Roti"), dish("Chicken curry", "Dinner", "Chicken", { contains: ["chicken"] }), ...SABZIS.map((n) => dish(n, "Dinner", "Sabzi"))];
    const r = run({ slots: [dinner], library: lib, rules: only, people: ["Ravi", "Karan", "Asha"], newCap: 0 });
    for (const d of WEEK) {
      const c = r.dishAt(d, "Dinner", "Chicken curry");
      if (c) expect(c.not_for.sort()).toEqual(["Karan", "Ravi"]);
      // Ravi and Karan each still have something beside the staple.
      const plate = r.plates.get(slotDayKey(d, "Dinner"))!;
      for (const p of ["Ravi", "Karan"]) expect(plate.some((x) => x.name !== "Phulka" && !x.not_for.includes(p))).toBe(true);
    }
  });
});

describe("nobody at a meal is left with nothing (safety)", () => {
  it("a person fed at their own breakfast still counts at the family's: the shared item is one they can eat while one fits", () => {
    const slots = [slot("Breakfast", { templates: [T({ kind: "Toast" })] }),
      slot("Dadu's breakfast", { kind: "addon", addon_of: "Breakfast", order: 60, usual_people: ["Dadu"], templates: [T({ items: ["Ragi malt"] })] })];
    const lib = [dish("French toast", "Breakfast", "Toast", { contains: ["egg", "dairy"] }), dish("Bread butter toast", "Breakfast", "Toast", { contains: ["dairy"] }),
      dish("Ragi malt", "Dadu's breakfast", "Porridge")];
    const days = [...WEEK.map((d) => day(d, "Breakfast", ["Asha", "Ravi", "Dadu"])), ...WEEK.map((d) => day(d, "Dadu's breakfast", ["Dadu"]))];
    const r = run({ slots, library: lib, days, newCap: 0, rules: [rule({ what: "veg", who: "Dadu", quote: "Dadu is pure veg" }), rule({ what: "no_eggs", who: "Dadu", quote: "no eggs for Dadu" })] });
    // The first morning both fit: the one Dadu can eat comes first.
    expect(r.at(WEEK[0], "Breakfast")).toEqual(["Bread butter toast"]);
    // Every morning the shared plate holds something for him, or his own breakfast does.
    for (const d of WEEK) {
      const shared = r.plates.get(slotDayKey(d, "Breakfast"))!, own = r.plates.get(slotDayKey(d, "Dadu's breakfast")) ?? [];
      expect(shared.some((x) => !x.not_for.includes("Dadu")) || own.some((x) => !x.not_for.includes("Dadu"))).toBe(true);
    }
  });
});

describe("rotation: the family's own items of a kind come before another item of it comes back (rule 3)", () => {
  it("a family that says \"upma\" and \"poha\" gets upmas and pohas, not a sabudana khichdi or avalakki oggarane, before any repeat", () => {
    // Regional items of their cuisines rank high among the catalog's; the family's own word (the part's words) still comes first.
    const r = run({ slots: [slot("Breakfast", { templates: [T({ kind: "Upma", words: "upma" }), T({ kind: "Poha", words: "poha" })] })], library: [], cuisines: ["maharashtra", "karnataka"], newCap: 0 });
    const all = WEEK.flatMap((d) => r.at(d, "Breakfast"));
    expect(all).toHaveLength(7);
    for (const x of all) expect(x).toMatch(/\b(upma|poha)\b/i);
    expect(new Set(all).size).toBe(7);
  });
});

describe("one meaning model fill", () => {
  it("a category part is filled with catalog items of its kind, never the family's word", () => {
    const r = run({ slots: [slot("Lunch", { templates: [T({ kind: "Rice" }, { kind: "Sabzi", words: "dry sabji" })] })], library: [] });
    for (const p of weekOf(r, "Lunch")) {
      expect(p).toHaveLength(2);
      expect(catalogItem(p[1])!.kind.name).toBe("Sabzi");
      expect(p[1]).not.toBe("Dry sabji");
    }
    // The category's items are the family's own: none placed as new.
    expect(r.placed).toEqual([]);
    expect(r.places.get(dishKey(r.at(WEEK[0], "Lunch")[1]))).toMatchObject({ kind: "Sabzi" });
  });
  it("a part with a dish places that dish first; other items of the kind are new", () => {
    const r = run({ slots: [slot("Breakfast", { templates: [T({ kind: "Dosa", dish: "Plain dosa", words: "dosa" })] })], library: [] });
    expect(r.at(WEEK[0], "Breakfast")).toEqual(["Plain dosa"]);
    const others = WEEK.flatMap((d) => r.at(d, "Breakfast")).filter((x) => x !== "Plain dosa");
    expect(others.length).toBeGreaterThan(0);
    for (const x of others) {
      expect(catalogItem(x)!.kind.name).toBe("Dosa");
      expect(r.placed.map((p) => p.dish)).toContain(x);
    }
  });
  it("the family's words for a category pick its items first", () => {
    const r = run({ slots: [slot("Breakfast", { templates: [T({ kind: "Upma", words: "upma" })] })], library: [] });
    expect(r.at(WEEK[0], "Breakfast")[0]).toMatch(/upma/i);
  });
  it("a template kept to days comes only on those days", () => {
    const r = run({ slots: [slot("Breakfast", { templates: [{ parts: [{ items: ["Bread omelette"] }], days: ["Sun"] }, T({ kind: "Idli" })] })], library: [] });
    for (const d of WEEK.slice(0, 6)) expect(r.at(d, "Breakfast")).not.toContain("Bread omelette");
    expect(r.at(WEEK[6], "Breakfast")).toEqual(["Bread omelette"]);
  });
  it("one unknown never spreads: the person keeps the plate, the dish is asked once", () => {
    const gs = rule({ who: "GS", what: "avoid", targets: [{ type: "ingredient", tag: "egg" }], quote: "Dad doesn't eat egg" });
    const lib = [dish("Rice", "Lunch", "Rice"), dish("Kadhi", "Lunch", "Rice curry", { sub: "Kadhi", contains_read: [] })];
    const r = run({ slots: [slot("Lunch", { templates: [T({ kind: "Rice" }, { kind: "Rice curry", sub: "Kadhi" })] })], library: lib, people: ["Asha", "GS"], rules: [gs] });
    for (const p of weekOf(r, "Lunch")) expect(p).toHaveLength(2);
    const kadhiDays = WEEK.filter((d) => r.at(d, "Lunch").includes("Kadhi"));
    expect(kadhiDays.length).toBeGreaterThan(0);
    for (const d of kadhiDays) expect(r.dishAt(d, "Lunch", "Kadhi")!.not_for).toEqual([]);
    const asked = r.unknowns.filter((u) => u.dish === "Kadhi");
    expect(asked.map((u) => u.date).sort()).toEqual(kadhiDays);
    expect(asked.every((u) => u.who === "GS" && u.tag === "egg")).toBe(true);
    expect(r.unknowns.filter((u) => u.dish !== "Kadhi")).toEqual([]);
    expect(r.log.filter((l) => l.includes("nothing of its template"))).toEqual([]);
  });
  it("a meal with no templates plans nothing", () => {
    const r = run({ slots: [slot("Dinner")], library: [dish("Phulka", "Dinner", "Roti")] });
    for (const d of WEEK) expect(r.at(d, "Dinner")).toEqual([]);
    expect(r.log).toContain("Dinner: no templates");
  });
  it("never matches a family word", () => {
    const src = readFileSync(new URL("./fillWeek.ts", import.meta.url), "utf8");
    for (const f of ["matchDish(", "regionalWordOf(", "isCategoryName(", "contentsItem("]) expect(src).not.toContain(f);
  });
});

describe("per-person versions of a shared meal (§5.4) and the cook's visit (§9.3)", () => {
  // h18-like: Agastya's boxes replace Breakfast and Lunch on school days; Shiva carries the home lunch plus extras.
  const SCHOOL: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const FAM = ["Shiva", "Ankita", "Agastya", "Gowri Shankar"];
  const bBox = (templates: MealTemplate[]) => slot("Agastya's breakfast box", { kind: "custom", order: 15, usual_people: ["Agastya"], days: [...SCHOOL], templates });
  const lBox = (templates: MealTemplate[]) => slot("Agastya's lunch box", { kind: "custom", order: 35, usual_people: ["Agastya"], days: [...SCHOOL], templates });
  const sBox = (templates: MealTemplate[]) => slot("Shiva's lunch box", { kind: "addon", addon_of: "Lunch", order: 60, usual_people: ["Shiva"], days: [...SCHOOL], extras: true, templates });
  const breakfast = (...templates: MealTemplate[]) => slot("Breakfast", { templates });
  const lunch = (...templates: MealTemplate[]) => slot("Lunch", { templates });
  const LIB = [dish("Rice", "Lunch", "Rice"), ...SABZIS.map((n) => dish(n, "Lunch", "Sabzi")), ...["Moong dal", "Dal tadka", "Masoor dal"].map((n) => dish(n, "Lunch", "Dal"))];
  const swapUpma = rule({ who: "Agastya", what: "swap", targets: [{ type: "kind", kind: "Upma" }], gives: { type: "item", item: "Pancakes", kind: null },
    quote: "Pancakes for Agastya when we make upma, he doesn't like it" });
  /** The slot-days as planDays builds them: a box's person off the meal it replaces on box days; an extras add-on keeps its person. */
  const daysFor = (slots: Slot[], skip: { slot: string; date: string }[] = []): PlanDay[] => slots.flatMap((s) => WEEK.flatMap((date) => {
    if (s.days.length && !s.days.includes(weekdayOf(date))) return [];
    const box = (meal: string) => slots.find((x) => x.kind === "custom" && x.order === (meal === "Breakfast" ? 15 : 35) && x.days.includes(weekdayOf(date)));
    const people = s.usual_people.length ? s.usual_people : FAM.filter((p) => !box(s.name)?.usual_people.includes(p));
    const d = day(date, s.name, people);
    return [skip.some((x) => x.slot === s.name && x.date === date) ? { ...d, skip: "ordered_in" as const } : d];
  }));
  const plate = (r: ReturnType<typeof run>, date: string, s: string) => r.plates.get(slotDayKey(date, s)) ?? [];
  const kindOf = (r: ReturnType<typeof run>, name: string) => r.places.get(dishKey(name))?.kind ?? null;

  it("the lunch box rolls the day's lunch sabzi", () => {
    const slots = [lunch(T({ kind: "Rice" }, { kind: "Dal" }, { kind: "Sabzi" })), lBox([T({ items: ["Paratha"] }, { from: "Lunch", kind: "Sabzi" })])];
    const r = run({ slots, library: LIB, days: daysFor(slots), newCap: 0 });
    for (const d of WEEK.slice(0, 5)) {
      const sabzi = plate(r, d, "Lunch").find((x) => kindOf(r, x.name) === "Sabzi")!;
      const box = plate(r, d, "Agastya's lunch box");
      expect(box).toHaveLength(2);
      expect(box[0].name).toBe("Paratha");
      expect(box[1]).toMatchObject({ name: sabzi.name, linked: true });
    }
  });
  it("a linked dish is not a repeat and not counted twice for the cook", () => {
    const slots = [lunch(T({ kind: "Rice" }, { kind: "Dal" }, { kind: "Sabzi" })), lBox([T({ items: ["Paratha"] }, { from: "Lunch", kind: "Sabzi" })])];
    const visits: Visit[] = [{ cook: null, meals: ["Lunch", "Agastya's lunch box"], days: [...SCHOOL], cap: 4, label: "lunch" }];
    const r = run({ slots, library: LIB, days: daysFor(slots), newCap: 0, visits });
    // Rice, dal, sabzi and the paratha: 4 dishes, the sabzi once.
    expect(r.unmet.filter((u) => u.includes("dishes to cook"))).toEqual([]);
    const sabzis = WEEK.slice(0, 5).map((d) => plate(r, d, "Lunch").find((x) => kindOf(r, x.name) === "Sabzi")!.name);
    expect(new Set(sabzis).size).toBe(5);
    for (const n of SABZIS) expect(r.unmet.filter((u) => u.includes(n))).toEqual([]);
  });
  it("a linked dish the box's child may not eat: the box picks its own item", () => {
    const lib = [...LIB, dish("Paneer butter masala", "Lunch", "Sabzi", { sub: "Paneer", catalog_item: "Paneer butter masala", days: ["Wed"] })];
    const noPbm = rule({ who: "Agastya", what: "avoid", targets: [{ type: "item", item: "Paneer butter masala", kind: "Sabzi" }], quote: "Agastya won't have paneer butter masala" });
    const slots = [lunch(T({ kind: "Rice" }, { kind: "Sabzi" })), lBox([T({ items: ["Paratha"] }, { from: "Lunch", kind: "Sabzi" })])];
    const r = run({ slots, library: lib, days: daysFor(slots), rules: [noPbm], newCap: 0 });
    expect(plate(r, WEEK[2], "Lunch").map((x) => x.name)).toContain("Paneer butter masala");
    const box = plate(r, WEEK[2], "Agastya's lunch box");
    expect(box).toHaveLength(2);
    expect(box[1].name).not.toBe("Paneer butter masala");
    expect(kindOf(r, box[1].name)).toBe("Sabzi");
    expect(box[1]).toMatchObject({ linked: false, not_for: [] });
  });
  it("a linked dish whose fit is only unknown stays linked, and is asked", () => {
    const lib = [...LIB, dish("Mystery sabzi", "Lunch", "Sabzi", { contains_read: [], days: ["Wed"] })];
    const noEgg = rule({ who: "Agastya", what: "avoid", targets: [{ type: "ingredient", tag: "egg" }], quote: "Agastya doesn't eat egg" });
    const slots = [lunch(T({ kind: "Rice" }, { kind: "Sabzi" })), lBox([T({ items: ["Paratha"] }, { from: "Lunch", kind: "Sabzi" })])];
    const r = run({ slots, library: lib, days: daysFor(slots), rules: [noEgg], newCap: 0 });
    expect(plate(r, WEEK[2], "Agastya's lunch box")[1]).toMatchObject({ name: "Mystery sabzi", linked: true, not_for: [] });
    expect(r.unknowns.some((u) => u.dish === "Mystery sabzi" && u.who === "Agastya" && u.date === WEEK[2])).toBe(true);
  });
  it("a fixed dish of a meal with another way to plate it never comes the next day", () => {
    const slots = [breakfast(share(T({ items: ["Bread omelette"] }), "5/week"), T({ kind: "Idli", dish: "Idli" }))];
    const r = run({ slots, library: [], days: daysFor(slots) });
    const bo = WEEK.map((d) => plate(r, d, "Breakfast").some((x) => x.name === "Bread omelette"));
    expect(bo.some(Boolean)).toBe(true);
    for (let i = 1; i < 7; i++) expect(bo[i] && bo[i - 1]).toBe(false);
  });
  it("a box whose meal is not cooked that day picks its own item", () => {
    const slots = [lunch(T({ kind: "Rice" }, { kind: "Dal" }, { kind: "Sabzi" })), lBox([T({ items: ["Paratha"] }, { from: "Lunch", kind: "Sabzi" })])];
    slots[0].skip_days = [{ day: "Wed", skip: "ordered_in" }];
    const r = run({ slots, library: LIB, days: daysFor(slots, [{ slot: "Lunch", date: WEEK[2] }]), newCap: 0 });
    const box = plate(r, WEEK[2], "Agastya's lunch box");
    expect(box).toHaveLength(2);
    expect(kindOf(r, box[1].name)).toBe("Sabzi");
    expect(box[1].linked).toBe(false);
  });
  it("the breakfast box is the family breakfast, and pancakes on upma days", () => {
    const slots = [breakfast(T({ kind: "Upma", words: "upma" }), T({ kind: "Idli", dish: "Idli" })), bBox([T({ from: "Breakfast" })])];
    const r = run({ slots, library: [], days: daysFor(slots), rules: [swapUpma] });
    let upmaDays = 0;
    for (const d of WEEK.slice(0, 5)) {
      const fam = plate(r, d, "Breakfast").filter((x) => !x.for_people.length).map((x) => x.name);
      const box = plate(r, d, "Agastya's breakfast box").map((x) => x.name);
      const upma = fam.find((x) => kindOf(r, x) === "Upma");
      if (upma) {
        upmaDays++;
        expect(box).toContain("Pancakes");
        expect(box).not.toContain(upma);
      } else expect(box).toEqual(fam);
    }
    expect(upmaDays).toBeGreaterThan(0);
  });
  it("a swap item is a planned dish for that person", () => {
    const slots = [breakfast(T({ kind: "Upma", words: "upma" }), T({ kind: "Idli", dish: "Idli" }))];
    const r = run({ slots, library: [], days: daysFor(slots), rules: [swapUpma] });
    let upmaDays = 0;
    for (const d of WEEK) {
      const p = plate(r, d, "Breakfast");
      const upma = p.find((x) => kindOf(r, x.name) === "Upma");
      if (upma) {
        upmaDays++;
        expect(upma.for_people).toEqual([]);
        expect(p.find((x) => x.name === "Pancakes")).toMatchObject({ for_people: ["Agastya"], linked: false });
      } else expect(p.map((x) => x.name)).not.toContain("Pancakes");
    }
    expect(upmaDays).toBeGreaterThan(0);
  });
  it("a disliked swap item is still given", () => {
    const slots = [breakfast(T({ kind: "Upma", words: "upma" }))];
    const r = run({ slots, library: [dish("Pancakes", "Breakfast", null, { disliked: true })], days: daysFor(slots), rules: [swapUpma] });
    for (const d of WEEK) expect(plate(r, d, "Breakfast").find((x) => x.name === "Pancakes")).toMatchObject({ for_people: ["Agastya"] });
  });
  it("a swap that gives a kind the family has no item of: a catalog item, counted as new", () => {
    const toParatha = rule({ who: "Gowri Shankar", what: "swap", targets: [{ type: "kind", kind: "Roti" }], gives: { type: "kind", kind: "Paratha" }, quote: "Dad has parathas" });
    const slots = [slot("Dinner", { templates: [T({ kind: "Roti" }, { kind: "Sabzi" })] })];
    const lib = [dish("Phulka", "Dinner", "Roti"), ...SABZIS.map((n) => dish(n, "Dinner", "Sabzi"))];
    const r = run({ slots, library: lib, people: FAM, rules: [toParatha] });
    for (const d of WEEK) {
      const forDad = plate(r, d, "Dinner").filter((x) => x.for_people.includes("Gowri Shankar"));
      expect(forDad).toHaveLength(1);
      expect(kindOf(r, forDad[0].name)).toBe("Paratha");
      expect(forDad[0].new).toBe(true);
    }
    expect(r.placed.filter((x) => x.kind === "Paratha")).toHaveLength(7);
  });
  it("extras ride beside the home lunch", () => {
    const noSabzi = rule({ who: "Shiva", what: "avoid", targets: [{ type: "kind", kind: "Sabzi" }], quote: "Shiva doesn't eat sabzi" });
    const slots = [lunch(T({ kind: "Rice" }, { kind: "Sabzi" })), sBox([T({ items: ["4 boiled eggs"] }, { kind: "Salad", words: "salad" })])];
    const r = run({ slots, library: LIB.filter((x) => x.kind !== "Dal"), days: daysFor(slots), rules: [noSabzi] });
    const mon = plate(r, WEEK[0], "Lunch");
    // Shiva is at the table: the sabzi is not for him, and he has his own dish there beside the rice.
    expect(mon.find((x) => kindOf(r, x.name) === "Sabzi")!.not_for).toEqual(["Shiva"]);
    expect(mon.some((x) => x.name !== "Rice" && !x.not_for.includes("Shiva"))).toBe(true);
    const box = plate(r, WEEK[0], "Shiva's lunch box").map((x) => x.name);
    expect(box).toHaveLength(2);
    expect(box[0]).toBe("4 boiled eggs");
    expect(catalogItem(box[1])!.kind.name).toBe("Salad");
  });
  it("egg or cheese roll on wet sabzi days", () => {
    const lib = [...LIB, dish("Paneer butter masala", "Lunch", "Sabzi", { sub: "Paneer", catalog_item: "Paneer butter masala", days: ["Wed"] })];
    const slots = [lunch(T({ kind: "Rice" }, { kind: "Sabzi" })),
      lBox([T({ items: ["Paratha"] }, { from: "Lunch", kind: "Sabzi" }), share(T({ items: ["Egg paratha roll"] }), "sometimes"), share(T({ items: ["Cheese paratha roll"] }), "sometimes")])];
    const r = run({ slots, library: lib, days: daysFor(slots), newCap: 0 });
    const ROLLS = ["Egg paratha roll", "Cheese paratha roll"];
    expect(plate(r, WEEK[2], "Lunch").map((x) => x.name)).toContain("Paneer butter masala");
    const box = plate(r, WEEK[2], "Agastya's lunch box").map((x) => x.name);
    expect(box.length).toBe(1);
    expect(ROLLS).toContain(box[0]);
    // The "sometimes" rolls keep their share: the day given to the wet sabzi is taken from another.
    expect(WEEK.slice(0, 5).filter((d) => ROLLS.includes(plate(r, d, "Agastya's lunch box")[0]?.name ?? "")).length).toBe(2);
  });
  it("the cook's morning is kept to her dishes where a template fits, and said where none does", () => {
    const visit: Visit = { cook: null, meals: ["Breakfast", "Lunch", "Agastya's breakfast box", "Agastya's lunch box"], cap: 4, days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
      label: "breakfast and lunch" };
    const slots = [breakfast(T({ kind: "Upma", words: "upma" }), T({ kind: "Idli", dish: "Idli" }, { kind: "Chutney" })),
      lunch(T({ kind: "Rice" }, { kind: "Dal" }, { kind: "Sabzi" }), T({ kind: "Rice" }, { kind: "Dal" }, { kind: "Sabzi" }, { kind: "Curd" })),
      bBox([T({ from: "Breakfast" })]), lBox([T({ from: "Lunch", kind: "Sabzi" })])];
    const r = run({ slots, library: LIB, days: daysFor(slots), visits: [visit] });
    let oneDish = 0;
    for (const d of WEEK.slice(0, 6)) {
      const b = plate(r, d, "Breakfast"), l = plate(r, d, "Lunch");
      expect(b.length).toBeGreaterThanOrEqual(1);
      expect(l.length).toBeGreaterThanOrEqual(3);
      if (b.length === 1) { oneDish++; expect(l).toHaveLength(3); }
    }
    expect(oneDish).toBeGreaterThan(0);
    // A week where no template fits: every part kept, the day said.
    const forced = [breakfast(T({ kind: "Idli", dish: "Idli" }, { kind: "Chutney" })), lunch(T({ kind: "Rice" }, { kind: "Dal" }, { kind: "Sabzi" }, { kind: "Curd" })),
      bBox([T({ from: "Breakfast" })]), lBox([T({ from: "Lunch", kind: "Sabzi" })])];
    const f = run({ slots: forced, library: LIB, days: daysFor(forced), visits: [visit] });
    expect(f.unmet).toContain("Mon breakfast and lunch: 6 dishes to cook, more than the cook's 4");
    for (const d of WEEK.slice(0, 6)) { expect(plate(f, d, "Breakfast")).toHaveLength(2); expect(plate(f, d, "Lunch")).toHaveLength(4); }
    // Sunday is not one of the visit's days.
    expect(f.unmet.some((u) => u.startsWith("Sun ") && u.includes("dishes to cook"))).toBe(false);
  });
});
