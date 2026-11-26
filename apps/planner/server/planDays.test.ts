import { describe, expect, it } from "bun:test";
import { buildDays, replacedMeal, ruleHolds, type Attendance, type Household } from "./planDays";
import { INSTEAD_STEP, SLOT_ORDER } from "./db/constants";
import type { Slot } from "./slotStore";

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;
const slot = (name: string, kind: Slot["kind"], order: number, o: Partial<Slot> = {}): Slot => ({ id: name, name, kind, addon_of: null, usual_people: [],
  days: [], skip_days: [], order, active: true, extras: false, templates: null, ...o });
const bBox = () => slot("Agastya's breakfast box", "custom", SLOT_ORDER.Breakfast + INSTEAD_STEP, { usual_people: ["Agastya"], days: [...WEEK] });
const lBox = () => slot("Agastya's lunch box", "custom", SLOT_ORDER.Lunch + INSTEAD_STEP, { usual_people: ["Agastya"], days: [...WEEK] });
const base = (): Slot[] => [slot("Breakfast", "main", SLOT_ORDER.Breakfast), slot("Lunch", "main", SLOT_ORDER.Lunch), slot("Dinner", "main", SLOT_ORDER.Dinner),
  bBox(), lBox(), slot("Shiva's lunch box", "addon", SLOT_ORDER.addon, { addon_of: "Lunch", usual_people: ["Shiva"], days: [...WEEK], extras: true })];
const people = ["Shiva", "Ankita", "Agastya", "Gowri Shankar"];
const household: Household = { dated: [], weekly: [
  { person: "Ankita", where: "office", weekdays: [...WEEK], from: "09:00", to: "16:00", lunch: "away" },
  { person: "Agastya", where: "school", weekdays: [...WEEK], from: "07:20", to: "15:00" },
  { person: "Shiva", where: "office", weekdays: [...WEEK], lunch: "carries" }] };
const MON = "2026-11-23", SAT = "2026-11-28";
const run = (slots: Slot[], changes: Attendance[] = []) => buildDays({ weekStart: MON, from: MON, slots, people, rules: [], household, changes, saved: [] });
const at = (d: ReturnType<typeof run>, date: string, name: string) => d.find((x) => x.date === date && x.slot === name);

describe("attendance: only a box that replaces a meal takes its person off it", () => {
  it("a lunch box takes its child off Lunch on box days only", () => {
    const d = run(base());
    expect(at(d, MON, "Lunch")!.people).toEqual(["Shiva", "Gowri Shankar"]);
    expect(at(d, SAT, "Lunch")!.people.sort()).toEqual([...people].sort());
  });
  it("a breakfast box takes its child off Breakfast, never off Lunch", () => {
    const d = run(base().filter((s) => s.name !== "Agastya's lunch box"));
    const b = at(d, MON, "Breakfast")!;
    expect(b.people).not.toContain("Agastya");
    expect(b.why.some((w) => w.includes("Agastya's breakfast box"))).toBe(true);
    for (const w of at(d, MON, "Lunch")!.why) expect(w).not.toContain("breakfast box");
  });
  it("an extras add-on keeps its person at the main meal", () => {
    const d = run(base());
    expect(at(d, MON, "Lunch")!.people).toContain("Shiva");
    expect(at(d, MON, "Shiva's lunch box")!.people).toEqual(["Shiva"]);
  });
  it("a box person away that day: no box slot-day and nobody taken off", () => {
    const d = run(base(), [{ effect: "away", people: ["Agastya"], dates: [MON], slots: null, why: "school trip" }]);
    expect(at(d, MON, "Agastya's lunch box")).toBeUndefined();
    const l = at(d, MON, "Lunch")!;
    expect(l.people).not.toContain("Agastya");
    expect(l.why.some((w) => w.includes("has their own box"))).toBe(false);
  });
  it("a school tiffin saved in place of Lunch takes its child off weekday Lunch even when he carries, never off Breakfast (F1, D2)", () => {
    const tiffin = slot("Vihaan's tiffin", "custom", SLOT_ORDER.Lunch + INSTEAD_STEP, { usual_people: ["Vihaan"], days: [...WEEK] });
    const slots = [slot("Breakfast", "main", SLOT_ORDER.Breakfast), slot("Lunch", "main", SLOT_ORDER.Lunch), slot("Dinner", "main", SLOT_ORDER.Dinner), tiffin];
    const d = buildDays({ weekStart: MON, from: MON, slots, people: ["Rohit", "Vihaan"], rules: [], changes: [], saved: [],
      household: { dated: [], weekly: [{ person: "Vihaan", where: "school", weekdays: [...WEEK], from: "08:00", to: "15:00", lunch: "carries" }] } });
    expect(at(d, MON, "Lunch")!.people).toEqual(["Rohit"]);
    expect(at(d, MON, "Lunch")!.why).toContain("Vihaan: has Vihaan's tiffin on Mon");
    expect(at(d, MON, "Breakfast")!.people).toEqual(["Rohit", "Vihaan"]);
    expect(at(d, MON, "Vihaan's tiffin")!.people).toEqual(["Vihaan"]);
  });
  it("replacedMeal: only a custom slot with named people one step after a main", () => {
    const s = base();
    expect(replacedMeal(lBox(), s)?.name).toBe("Lunch");
    expect(replacedMeal(s[5]!, s)).toBeNull();
    expect(replacedMeal(slot("x", "custom", 31, { usual_people: [] }), s)).toBeNull();
  });
});

describe("a meal's rules hold at the box that replaces it", () => {
  const slots = base();
  const rule = { days: [], slots: ["Breakfast"] };
  it("a Breakfast rule holds at the breakfast box, not the lunch box", () => {
    expect(ruleHolds(rule, "2026-11-25", slots[3], slots[3].name, slots)).toBe(true);
    expect(ruleHolds(rule, "2026-11-25", slots[4], slots[4].name, slots)).toBe(false);
  });
});
