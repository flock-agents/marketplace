import { describe, it, expect } from "bun:test";
import { dayGoals, mealTotal, statusOf, waterLitres, workoutMinutes, type GoalEvent, type GoalReading } from "./goals";
import { dayOf, daysUntil } from "./routes";
import { focusProblem } from "./focus";

const r = (label: string, value: number, created_at: string): GoalReading => ({ label, value, created_at });
const READINGS = [
  r("Calorie target", 1800, "2026-10-10T03:00:00.000Z"),
  r("Calorie target", 1650, "2026-10-21T01:31:00.000Z"),   // 7:01 AM on the 21st
  r("Protein target", 130, "2026-10-21T01:31:00.000Z"),
  r("Calories in", 900, "2026-10-21T06:00:00.000Z"),
  r("Calories in", 1900, "2026-10-21T14:00:00.000Z"),      // the running total, newest wins
  r("Steps target", 8000, "2026-10-15T03:00:00.000Z"),
  r("Steps", 3452, "2026-10-20T18:29:00.000Z"),            // 23:59 on the 20th
  r("Steps", 9100, "2026-10-21T18:29:00.000Z"),
  r("Sleep", 6.3, "2026-10-21T00:30:00.000Z"),
];
const EVENTS: GoalEvent[] = [
  { title: "Workout · 12 min · 131 kcal", at: "2026-10-21T07:05" },
  { title: "Workout: Outdoor running · 31 min", at: "2026-10-21T18:40" },
  { title: "Lunch: 2 roti, dal, about 450 kcal", at: "2026-10-21T13:00" },
  { title: "Workout: Squats and planks · 15 min", at: "2026-10-21T20:00" },   // logged by the coach
  { title: "Workout · 9 min", at: "2026-10-20T20:40" },
];
const goals = (day: string) => dayGoals({ day, readings: READINGS, events: EVENTS, dayOf });

describe("dayOf", () => {
  it("reads UTC stamps in Kolkata time and bare times as local", () => {
    expect(dayOf("2026-10-20T18:29:00.000Z")).toBe("2026-10-20");
    expect(dayOf("2026-10-20T18:31:00.000Z")).toBe("2026-10-21");
    expect(dayOf("2026-10-21T07:05")).toBe("2026-10-21");
    expect(dayOf("2026-10-21")).toBe("2026-10-21");
  });
});

describe("statusOf", () => {
  it("food stays under its target, activity reaches it", () => {
    expect(statusOf("under", 1200, 1650)).toEqual({ status: "on_track", remaining: 450 });
    expect(statusOf("under", 1900, 1650)).toEqual({ status: "over", remaining: 250 });
    expect(statusOf("reach", 3000, 8000)).toEqual({ status: "to_go", remaining: 5000 });
    expect(statusOf("reach", 9000, 8000)).toEqual({ status: "done", remaining: 0 });
    expect(statusOf("reach", null, 8000)).toEqual({ status: "not_logged", remaining: 8000 });
    expect(statusOf("reach", 9000, null)).toEqual({ status: "no_target", remaining: null });
  });
});

describe("workoutMinutes", () => {
  it("adds up the day's workout minutes, ignoring meals", () => {
    expect(workoutMinutes(EVENTS, "2026-10-21", dayOf)).toBe(58);
    expect(workoutMinutes(EVENTS, "2026-10-19", dayOf)).toBeNull();
  });
});

describe("waterLitres", () => {
  it("adds up the day's glasses in litres, in local time", () => {
    const water = [{ at: "2026-10-21T08:00", ml: 250 }, { at: "2026-10-21T02:00:00.000Z", ml: 500 }, { at: "2026-10-20T18:00:00.000Z", ml: 250 }];
    expect(waterLitres(water, "2026-10-21", dayOf)).toBe(0.75);
    expect(waterLitres(water, "2026-10-20", dayOf)).toBe(0.25);   // 18:00Z on the 20th is 23:30 local, still the 20th
    expect(waterLitres(water, "2026-10-19", dayOf)).toBeNull();
  });
});

describe("dayGoals", () => {
  it("puts each day's numbers against the targets in force that day", () => {
    expect(goals("2026-10-21").map((g) => [g.label, g.current, g.target, g.status])).toEqual([
      ["Calories in", 1900, 1650, "over"],
      ["Protein", null, 130, "not_logged"],
      ["Water", null, 3, "not_logged"],
      ["Steps", 9100, 8000, "done"],
      ["Workout", 58, null, "no_target"],
      ["PAI", null, 100, "not_logged"],
      ["Sleep", 6.3, null, "no_target"],
    ]);
  });
  it("uses the target set before the day, not one set later", () => {
    const day = goals("2026-10-20");
    expect(day.find((g) => g.label === "Calories in")).toMatchObject({ current: null, target: 1800, status: "not_logged" });
    expect(day.find((g) => g.label === "Protein")).toBeUndefined();   // set on the 21st, never logged before
    expect(day.find((g) => g.label === "Steps")).toMatchObject({ current: 3452, remaining: 4548 });
  });
  it("falls back to a goal's default target until one is set", () => {
    const pai = { label: "PAI", group: "activity", target: "PAI target", unit: "PAI", aim: "reach", defaultTarget: 100 } as const;
    const withPai = [...READINGS, r("PAI", 57, "2026-10-20T18:30:00.000Z")];
    expect(dayGoals({ day: "2026-10-21", readings: withPai, events: EVENTS, dayOf }, [pai])).toEqual([
      { label: "PAI", group: "activity", focus: false, unit: "PAI", aim: "reach", current: 57, target: 100, status: "to_go", remaining: 43 },
    ]);
    const set = [...withPai, r("PAI target", 75, "2026-10-21T02:00:00.000Z")];
    expect(dayGoals({ day: "2026-10-21", readings: set, events: EVENTS, dayOf }, [pai])[0]).toMatchObject({ target: 75, remaining: 18 });
  });
});

describe("focus", () => {
  it("marks the goals in focus and shows each even before anything is logged", () => {
    const day = dayGoals({ day: "2026-10-21", readings: READINGS, events: EVENTS, dayOf, focus: ["Fiber", "PAI"] });
    expect(day.filter((g) => g.focus).map((g) => [g.label, g.group, g.current, g.status])).toEqual([
      ["Fiber", "diet", null, "no_target"],
      ["PAI", "activity", null, "not_logged"],
    ]);
    expect(day.find((g) => g.label === "Steps")?.focus).toBe(false);   // still tracked, just not in focus
  });
  it("leaves out an untracked goal that is not in focus", () => {
    expect(goals("2026-10-21").find((g) => g.label === "Fiber")).toBeUndefined();
  });
  it("accepts a list of goal labels, each once", () => {
    expect(focusProblem(["Workout", "PAI", "Calories in", "Protein", "Fiber"])).toBeNull();
    expect(focusProblem([])).toBeNull();
    expect(focusProblem("PAI")).toMatch(/list/);
    expect(focusProblem(["PAI", "Hydration"])).toMatch(/Hydration/);
    expect(focusProblem(["PAI", "PAI"])).toMatch(/twice/);
  });
});

describe("daysUntil", () => {
  it("counts back from the last day, newest first", () => {
    expect(daysUntil("2026-10-02", 3)).toEqual(["2026-10-02", "2026-10-01", "2026-09-30"]);
  });
});

describe("meals", () => {
  const MEALS: GoalEvent[] = [
    { title: "Besan chilla + chai (no sugar)", at: "2026-10-22T11:00:00+05:30", kcal: 155, protein_g: 9, fiber_g: 4 },
    { title: "Lunch: rice, dal, sabzi", at: "2026-10-22T13:30", kcal: 450, protein_g: 14.5 },
    { title: "Evening walk", at: "2026-10-22T18:00" },
    { title: "Dinner yesterday", at: "2026-10-21T20:00", kcal: 500, protein_g: 20 },
  ];
  const day = (d: string) => dayGoals({ day: d, readings: READINGS, events: MEALS, dayOf });

  it("adds up the day's meals for calories and protein", () => {
    expect(mealTotal(MEALS, "kcal", "2026-10-22", dayOf)).toBe(605);
    expect(mealTotal(MEALS, "protein_g", "2026-10-22", dayOf)).toBe(23.5);
    expect(mealTotal(MEALS, "kcal", "2026-10-23", dayOf)).toBeNull();
    expect(mealTotal(MEALS, "fiber_g", "2026-10-22", dayOf)).toBe(4);   // a meal without fiber adds nothing
    const [cal, protein] = day("2026-10-22");
    expect(cal).toMatchObject({ label: "Calories in", current: 605, target: 1650, status: "on_track", remaining: 1045 });
    expect(protein).toMatchObject({ label: "Protein", current: 23.5, target: 130, status: "to_go" });
  });

  it("meals win over a Calories in reading on the same day", () => {
    expect(day("2026-10-21")[0]).toMatchObject({ label: "Calories in", current: 500 });
  });

  it("falls back to the Calories in reading on a day no meal carries calories", () => {
    const [cal] = dayGoals({ day: "2026-10-21", readings: READINGS, events: [], dayOf });
    expect(cal).toMatchObject({ label: "Calories in", current: 1900 });
  });
});
