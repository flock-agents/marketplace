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
  it("a box saved after Breakfast (order 20, no instead_of) replaces nothing: the child stays on Breakfast (J10 documents it)", () => {
    const slots = base().filter((s) => s.name !== "Agastya's lunch box").map((s) => (s.name === "Agastya's breakfast box" ? { ...s, order: SLOT_ORDER.tiffin } : s));
    const d = run(slots);
    expect(at(d, MON, "Breakfast")!.people).toContain("Agastya");
    expect(at(d, MON, "Agastya's breakfast box")!.people).toEqual(["Agastya"]);
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
  describe("a school child at weekday Lunch (OD2)", () => {
    const slots = [slot("Breakfast", "main", SLOT_ORDER.Breakfast), slot("Lunch", "main", SLOT_ORDER.Lunch), slot("Dinner", "main", SLOT_ORDER.Dinner)];
    const go = (lunch?: string) => buildDays({ weekStart: MON, from: MON, slots, people: ["Rohit", "Vihaan"], rules: [], changes: [], saved: [],
      household: { dated: [], weekly: [{ person: "Vihaan", where: "school", weekdays: [...WEEK], from: "08:00", to: "15:00", ...(lunch ? { lunch } : {}) }] } });
    const lunchAt = (d: ReturnType<typeof go>, date: string) => at(d, date, "Lunch")!.people;
    const WEEKDAYS5 = ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"];
    it("with no lunch word, off Mon-Fri Lunch", () => { for (const day of WEEKDAYS5) expect(lunchAt(go(), day)).toEqual(["Rohit"]); });
    it("even when the lunch word says home", () => { for (const day of WEEKDAYS5) expect(lunchAt(go("home"), day)).toEqual(["Rohit"]); });
    it("whose lunch is carries, stays at Lunch", () => { for (const day of WEEKDAYS5) expect(lunchAt(go("carries"), day)).toEqual(["Rohit", "Vihaan"]); });
    it("keeps Breakfast, and weekend Lunch", () => {
      expect(at(go(), MON, "Breakfast")!.people).toEqual(["Rohit", "Vihaan"]);
      expect(lunchAt(go(), SAT)).toEqual(["Rohit", "Vihaan"]);
    });
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
