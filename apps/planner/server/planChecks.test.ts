// planChecks.ts on a hand-made week, no database and no model: the slot's whole week chosen again in code when rotation
// leaves dishes back too soon (resolveSlot), a dish the family has on some days or often put on free days (checkSlot's
// "few"), and the feasibility check's shared dishes and new dish for a person with nothing of their own.
import { describe, expect, it } from "bun:test";
import { checkSlot, feasibility, hardOnly, resolveSlot, slotFacts, type Proposal, type Week } from "./planChecks";
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
  it("chooses the slot's week again when its days bring dishes back too soon, keeping the family's plates as units and the staples", () => {
    const lib = ["Roti", "Dal", "Lauki", "Bhindi", "Aloo gobi", "Rajma"].map((n) => dish(n, "Dinner"));
    const w = week({ slots: [slot("Dinner", { order: 50 })], library: lib,
      history: { Dinner: seed("Dinner", [["Roti", "Dal", "Lauki"], ["Roti", "Dal", "Bhindi"], ["Roti", "Aloo gobi"], ["Roti", "Rajma"]]) } });
    // Roti is in every row (a staple); Dal in half (not). A week with Dal and Lauki every day:
    const p: Proposal = { days: new Map(WEEK.map((d) => [d, ["Roti", "Dal", "Lauki"]])), newNames: new Map() };
    expect(hardCount(w, "Dinner", p)).toBeGreaterThan(0);
    const again = resolveSlot(w, "Dinner", p)!;
    expect(again).not.toBeNull();
    const next: Proposal = { days: again, newNames: new Map() };
    expect(hardCount(w, "Dinner", next)).toBe(0);
    for (const d of WEEK) expect(again.get(d)![0]).toBe("Roti");
    // The family's plate "Roti, Dal, Lauki" is a unit: Dal comes with Lauki or Bhindi as they eat it.
    expect([...again.values()].some((ds) => ds.join() === "Roti,Dal,Lauki")).toBe(true);
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
    expect(r.unmet).toEqual(["only 2 Dinner dishes known, so some come back more often than usual"]);
  });

  it("a person who can eat none of a slot's dishes beside the staples on some day gets a new dish there first", () => {
    const lib = [dish("Rice", "Lunch"), dish("Fish curry", "Lunch", { contains: ["fish"], days: ["Sun"] }), dish("Mutton curry", "Lunch", { contains: ["meat"], days: ["Sun"] })];
    const w = week({ slots: [slot("Lunch")], library: lib, rules: [veg], newBudget: 2, history: { Lunch: seed("Lunch", [["Rice"], ["Rice"], ["Rice", "Fish curry"]]) } });
    const r = feasibility(w, ["Lunch"]);
    expect(r.log[0]).toBe("feasibility Lunch: 1 new dish for Asha (none of its dishes beside the staples is theirs on some day)");
    expect(w.slots.get("lunch")!.newAllowed).toBe(2);
  });
});
