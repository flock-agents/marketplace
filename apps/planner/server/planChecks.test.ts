// planChecks.ts on a hand-made week, no database and no model: the slot's whole week chosen again in code when rotation
// leaves dishes back too soon (resolveSlot), a dish the family has on some days or often put on free days (checkSlot's
// "few"), and the feasibility check's shared dishes and new dish for a person with nothing of their own.
import { describe, expect, it } from "bun:test";
import { checkSlot, feasibility, hardOnly, resolveSlot, rotate, slotFacts, thinAddon, type Proposal, type Week } from "./planChecks";
import { dishKey } from "./dishText";
import type { PlanDay } from "./planDays";
import type { HistoryRow, LibraryDish, Rule, Slot } from "./slotStore";

const WEEK = ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"];
const READ = ["egg", "meat", "fish", "onion_garlic"];
const slot = (name: string, o: Partial<Slot> = {}): Slot => ({ id: name, name, kind: "main", addon_of: null, usual_people: [], days: [], skip_days: [], order: 30, active: true, ...o });
const dish = (name: string, slotName: string, o: Partial<LibraryDish> = {}): LibraryDish => ({ id: `${slotName}|${name}`, key: dishKey(name), slot: slotName, name, frequency: null, days: null,
  contains: [], contains_read: READ, origin: "setup_named", suggested: false, untried: false, offers: 0, disliked: false, prep: null, video_url: null, video_title: null,
  video_thumbnail: null, rating: null, rating_note: null, rated_on: null, rated_by: null, ratings: [], ...o });
const day = (date: string, slotName: string, people = ["Asha", "Ravi"]): PlanDay => ({ date, slot: slotName, people, guests: [], occasion: null, new_dishes_allowed: null, skip: null,
  edited: false, fixed: false, why: [], fasting: [], dishes: [], note: null });
const seed = (slotName: string, rows: string[][]): HistoryRow[] => rows.map((r) => ({ date: null, status: "confirmed", skip: null, dishes: r.map((d) => ({ dish: d })) }) as HistoryRow);

function week(o: { slots: Slot[]; library: LibraryDish[]; rules?: Rule[]; history?: Record<string, HistoryRow[]>; newBudget?: number }): Week {
  const w: Week = { days: o.slots.flatMap((s) => WEEK.map((d) => day(d, s.name))), slots: new Map(), rules: o.rules ?? [], library: o.library, facts: new Map(), done: new Set(),
    newBudget: o.newBudget ?? 0, newDishes: new Map() };
  for (const s of o.slots) w.slots.set(s.name.toLowerCase(), slotFacts(s, o.library, o.history?.[s.name] ?? [], {}));
  return w;
}
const hardCount = (w: Week, s: string, p: Proposal) => [...checkSlot(w, s, p).values()].reduce((n, ps) => n + hardOnly(ps).length, 0);

describe("resolveSlot", () => {
  it("chooses the slot's week again by swaps in place when its days bring dishes back too soon: never a plate with fewer dishes, the staples kept", () => {
    const lib = ["Roti", "Dal", "Lauki", "Bhindi", "Aloo gobi", "Rajma"].map((n) => dish(n, "Dinner"));
    const w = week({ slots: [slot("Dinner", { order: 50 })], library: lib,
      history: { Dinner: seed("Dinner", [["Roti", "Dal", "Lauki"], ["Roti", "Dal", "Bhindi"], ["Roti", "Aloo gobi"], ["Roti", "Rajma"]]) } });
    // Roti is in every row (a staple); Dal in half (not). A week with Dal and Lauki every day:
    const p: Proposal = { days: new Map(WEEK.map((d) => [d, ["Roti", "Dal", "Lauki"]])), newNames: new Map() };
    const before = hardCount(w, "Dinner", p);
    expect(before).toBeGreaterThan(0);
    const again = resolveSlot(w, "Dinner", p)!;
    expect(again).not.toBeNull();
    expect(hardCount(w, "Dinner", { days: again, newNames: new Map() })).toBeLessThan(before);
    for (const d of WEEK) { expect(again.get(d)![0]).toBe("Roti"); expect(again.get(d)!).toHaveLength(3); }
    // Lauki's place takes Bhindi, its stand-in in the family's plates ("Roti, Dal, Bhindi").
    expect([...again.values()].some((ds) => ds.join() === "Roti,Dal,Bhindi")).toBe(true);
  });

  it("answers null when the week has no problem, or none better can be found", () => {
    const w = week({ slots: [slot("Lunch")], library: ["Khichdi"].map((n) => dish(n, "Lunch")) });
    const p: Proposal = { days: new Map(WEEK.map((d) => [d, ["Khichdi"]])), newNames: new Map() };
    expect(resolveSlot(w, "Lunch", p)).toBeNull();
  });
});

describe("checkSlot: too few", () => {
  it("a dish had on some days only comes at least once on them, put on a named free day; one the family has sometimes on two days", () => {
    const lib = [dish("Khichdi", "Dinner", { days: ["Sat"] }), dish("Rajma", "Dinner", { frequency: "sometimes" }), ...["Lauki", "Bhindi", "Tinda", "Turai"].map((n) => dish(n, "Dinner"))];
    const w = week({ slots: [slot("Dinner", { order: 50 })], library: lib });
    const plan = ["Lauki", "Bhindi", "Tinda", "Turai", "Lauki", "Bhindi", "Tinda"];
    const ps = checkSlot(w, "Dinner", { days: new Map(WEEK.map((d, i) => [d, [plan[i]]])), newNames: new Map() });
    expect(hardOnly(ps.get(WEEK[5])).map((x) => x.text)).toContain("Khichdi: the family has it on Sat; it is on none: add it on Sat");
    const rajma = [...ps.values()].flat().filter((x) => x.dish === "Rajma" && !x.soft);
    expect(rajma).toHaveLength(2);
  });
});

describe("feasibility", () => {
  const veg: Rule = { id: "r", hard: true, what: "veg", who: "Asha", slots: null, days: null, items: null, to: null, frequency: null, per_meal: null, fasting_food: null, quote: "Asha is vegetarian" };
  const keep = (w: Week, dates: string[]) => { for (const d of w.days.filter((x) => !dates.includes(x.date))) d.skip = "eaten_out"; };

  it("a dish two slots share has one count: what the earlier slot will take is set aside, and the later slot is short", () => {
    const lib = ["Lauki", "Bhindi"].flatMap((n) => [dish(n, "Lunch"), dish(n, "Dinner")]);
    const w = week({ slots: [slot("Lunch"), slot("Dinner", { order: 50 })], library: lib });
    keep(w, [WEEK[0], WEEK[1], WEEK[3], WEEK[6]]);
    const r = feasibility(w, ["Lunch", "Dinner"]);
    expect(r.log[0]).toBe("feasibility Lunch: 4 places (4 × 1), 4 from the library");
    expect([...w.slots.get("lunch")!.takes]).toEqual([["lauki", 2], ["bhindi", 2]]);
    expect(r.log[1]).toStartWith("feasibility Dinner: 4 places (4 × 1), 0 from the library");
    expect(r.short).toEqual([{ slot: "Dinner", known: 2, supply: 0, places: 4 }]);
  });

  it("a person who can eat none of a slot's dishes beside the staples on some day gets a new dish there first", () => {
    const lib = [dish("Rice", "Lunch"), dish("Fish curry", "Lunch", { contains: ["fish"], days: ["Sun"] }), dish("Mutton curry", "Lunch", { contains: ["meat"], days: ["Sun"] })];
    const w = week({ slots: [slot("Lunch")], library: lib, rules: [veg], newBudget: 2, history: { Lunch: seed("Lunch", [["Rice"], ["Rice"], ["Rice", "Fish curry"]]) } });
    const r = feasibility(w, ["Lunch"]);
    expect(r.log[0]).toBe("feasibility Lunch: 1 new dish for Asha (none of its dishes beside the staples is theirs on some day)");
    expect(w.slots.get("lunch")!.newAllowed).toBe(2);
  });
});

describe("a check never shrinks the model's plate (owner, 23 Nov)", () => {
  const dinner = (lib: string[]) => {
    const library = [dish("Bhindi shaak", "Lunch"), ...lib.map((n) => dish(n, "Dinner"))];
    const w = week({ slots: [slot("Lunch"), slot("Dinner", { order: 50 })], library,
      history: { Dinner: seed("Dinner", [["Khichdi", "Kadhi"], ["Bhakri", "Bhindi shaak"], ["Thepla", "Cabbage shaak"]]) } });
    for (const d of w.days.filter((x) => x.date !== WEEK[0])) d.skip = "eaten_out";
    w.days.find((x) => x.slot === "Lunch")!.dishes = ["Bhindi shaak"];
    w.done.add("lunch");
    return w;
  };
  it("a rejected dish is swapped in its place for its stand-in in the family's plates", () => {
    const w = dinner(["Bhakri", "Bhindi shaak", "Thepla", "Cabbage shaak", "Khichdi", "Kadhi", "Tindora shaak"]);
    const p: Proposal = { days: new Map([[WEEK[0], ["Bhakri", "Bhindi shaak"]]]), newNames: new Map() };
    expect(hardOnly(checkSlot(w, "Dinner", p).get(WEEK[0])).map((x) => x.kind)).toEqual(["same_day"]);
    const r = rotate(w, "Dinner", p, [WEEK[0]]);
    const plate = p.days.get(WEEK[0])!;
    expect(plate).toHaveLength(2);
    expect(plate[0]).toBe("Bhakri");
    expect(["Cabbage shaak", "Kadhi"]).toContain(plate[1]);   // the second place of the family's two-dish plates
    expect(r.unmet).toEqual([]);
  });
  it("no swap fits: the dish is kept, and the repeat said", () => {
    const w = dinner(["Bhakri", "Bhindi shaak"]);
    const p: Proposal = { days: new Map([[WEEK[0], ["Bhakri", "Bhindi shaak"]]]), newNames: new Map() };
    const r = rotate(w, "Dinner", p, [WEEK[0]]);
    expect(p.days.get(WEEK[0])).toEqual(["Bhakri", "Bhindi shaak"]);
    expect(r.unmet).toEqual(["Mon Dinner: Bhindi shaak comes back sooner than usual"]);
  });
  it("resolveSlot's every choice keeps each day's number of dishes", () => {
    const w = dinner(["Bhakri", "Bhindi shaak", "Thepla", "Cabbage shaak"]);
    for (const d of w.days.filter((x) => x.slot === "Dinner")) d.skip = null;
    const p: Proposal = { days: new Map(WEEK.map((d) => [d, ["Bhakri", "Bhindi shaak"]])), newNames: new Map() };
    const again = resolveSlot(w, "Dinner", p);
    for (const ds of (again ?? p.days).values()) expect(ds).toHaveLength(2);
  });
});

describe("add-on days (owner, 23 Nov)", () => {
  it("an add-on dish had twice a week stays on 2 days spread apart; the rest are empty, not sent back", () => {
    const lib = [dish("Roti", "Dinner"), dish("Dal", "Dinner"), dish("Fish curry", "Fish", { frequency: "2/week" as any })];
    const w = week({ slots: [slot("Dinner", { order: 50 }), slot("Fish", { kind: "addon", addon_of: "Dinner", order: 60, usual_people: ["Ravi"] })], library: lib });
    for (const d of w.days.filter((x) => x.slot === "Dinner")) d.dishes = ["Roti", "Dal"];
    for (const d of w.days.filter((x) => x.slot === "Fish")) d.people = ["Ravi"];
    w.done.add("dinner");
    const p: Proposal = { days: new Map(WEEK.map((d) => [d, ["Fish curry"]])), newNames: new Map() };
    const r = thinAddon(w, "Fish", p);
    const kept = WEEK.filter((d) => p.days.get(d)!.length);
    expect(kept).toEqual([WEEK[0], WEEK[3]]);
    expect(WEEK.filter((d) => !p.days.get(d)!.length)).toHaveLength(5);
    expect(r.unmet).toEqual([]);
    expect(hardCount(w, "Fish", p)).toBe(0);
  });
});

describe("a person with nothing of their own (rotate)", () => {
  it("gets a dish they can eat even when the only one comes back early", () => {
    const allergy: Rule = { id: "a", hard: true, what: "avoid", who: "Ravi", slots: null, days: null, items: ["peanut"], to: null, frequency: null, per_meal: null, fasting_food: null, quote: "no peanuts for Ravi" };
    const lib = [dish("Poha", "Breakfast", { contains: ["peanut"], contains_read: [...READ, "peanut"] }), dish("Upma", "Breakfast", { contains_read: [...READ, "peanut"] })];
    const w = week({ slots: [slot("Breakfast", { order: 10 })], library: lib, rules: [allergy] });
    for (const d of w.days.filter((x) => ![WEEK[0], WEEK[1], WEEK[3]].includes(x.date))) d.skip = "eaten_out";
    const p: Proposal = { days: new Map([[WEEK[0], ["Upma"]], [WEEK[1], ["Poha"]], [WEEK[3], ["Upma"]]]), newNames: new Map() };
    const r = rotate(w, "Breakfast", p, [WEEK[1]]);
    expect(p.days.get(WEEK[1])).toEqual(["Poha", "Upma"]);
    expect(r.unmet).toEqual(["Tue Breakfast: Upma comes back sooner than usual"]);
  });
  it("a repeat is never swapped for a dish that leaves someone with nothing of their own: it stays, said", () => {
    const allergy: Rule = { id: "a", hard: true, what: "avoid", who: "Ravi", slots: null, days: null, items: ["peanut"], to: null, frequency: null, per_meal: null, fasting_food: null, quote: "no peanuts for Ravi" };
    const lib = [dish("Poha", "Breakfast", { contains: ["peanut"], contains_read: [...READ, "peanut"] }), dish("Upma", "Breakfast", { contains_read: [...READ, "peanut"] })];
    const w = week({ slots: [slot("Breakfast", { order: 10 })], library: lib, rules: [allergy] });
    for (const d of w.days.filter((x) => ![WEEK[0], WEEK[1]].includes(x.date))) d.skip = "eaten_out";
    const p: Proposal = { days: new Map([[WEEK[0], ["Upma"]], [WEEK[1], ["Upma"]]]), newNames: new Map() };
    const r = rotate(w, "Breakfast", p, [WEEK[1]], { swapsOnly: true });
    expect(p.days.get(WEEK[1])).toEqual(["Upma"]);
    expect(r.unmet).toEqual(["Tue Breakfast: Upma comes back sooner than usual"]);
  });
});
