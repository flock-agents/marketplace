// inferMealOutcomes against a real (in-memory) kit database.
import { describe, it, expect } from "bun:test";
import * as schema from "./db/schema";
import { inferMealOutcomes, isPastLatest, latestTimeFor } from "./mealOutcomes";
import { bootKit, defaultSettings } from "./stock.testkit";

async function boot() {
  const { kit, insert, all } = await bootKit();
  const meal = (date: string, slot: string, extra: Record<string, unknown> = {}) => insert(schema.meals, { date, slot, dish: `${slot} dish`, ...extra });
  const mealRow = (id: string) => all(schema.meals).find((m) => m.id === id);
  const choices = () => all(schema.choice_log);
  return { kit, meal, mealRow, choices };
}

describe("latest times", () => {
  const s = defaultSettings();
  it("reads each slot's latest time from settings, dinner's for an unknown slot", () => {
    expect(latestTimeFor("Breakfast", s)).toBe("11:00");
    expect(latestTimeFor("Lunch", s)).toBe("15:00");
    expect(latestTimeFor("Snack", s)).toBe("23:00");
    expect(latestTimeFor("Lunch", defaultSettings({ "meal.latest.lunch": "16:30" }))).toBe("16:30");
  });
  it("a meal is over only once its latest time has passed", () => {
    expect(isPastLatest("2026-10-28", "Lunch", s, new Date(2026, 9, 28, 14, 59))).toBe(false);
    expect(isPastLatest("2026-10-28", "Lunch", s, new Date(2026, 9, 28, 15, 0))).toBe(true);
    expect(isPastLatest("2026-10-27", "Dinner", s, new Date(2026, 9, 28, 0, 5))).toBe(true);
  });
});

describe("inferMealOutcomes", () => {
  const now = new Date(2026, 9, 28, 16, 0);   // Wed 16:00: breakfast and lunch are over, dinner is not

  it("marks meals past their latest time cooked (inferred, at the planned cook time) and logs each", async () => {
    const { kit, meal, mealRow, choices } = await boot();
    const b = meal("2026-10-28", "Breakfast");
    const l = meal("2026-10-28", "Lunch", { time: "13:15" });
    const d = meal("2026-10-28", "Dinner");
    const yesterday = meal("2026-10-27", "Dinner");

    const marked = inferMealOutcomes(kit.db, defaultSettings(), now);
    expect(marked.sort()).toEqual([b.id, l.id, yesterday.id].sort());
    expect(mealRow(b.id)).toMatchObject({ outcome: "cooked", outcome_source: "inferred", outcome_at: new Date(2026, 9, 28, 7, 30).toISOString() });
    expect(mealRow(l.id).outcome_at).toBe(new Date(2026, 9, 28, 13, 15).toISOString());
    expect(mealRow(d.id).outcome).toBeNull();
    expect(choices().map((c) => [c.kind, c.subject, c.source])).toContainEqual(["meal_cooked", b.id, "inferred"]);
    expect(choices()).toHaveLength(3);
  });

  it("never overwrites an owner/agent outcome, and is idempotent", async () => {
    const { kit, meal, mealRow, choices } = await boot();
    const skipped = meal("2026-10-28", "Lunch", { outcome: "skipped", outcome_source: "owner", outcome_at: "2026-10-28T06:00:00.000Z" });
    const open = meal("2026-10-28", "Breakfast");

    expect(inferMealOutcomes(kit.db, defaultSettings(), now)).toEqual([open.id]);
    expect(inferMealOutcomes(kit.db, defaultSettings(), now)).toEqual([]);
    expect(mealRow(skipped.id)).toMatchObject({ outcome: "skipped", outcome_source: "owner" });
    expect(choices()).toHaveLength(1);
  });

  it("leaves future meals and old history (beyond the lookback) alone", async () => {
    const { kit, meal } = await boot();
    meal("2026-10-29", "Breakfast");
    meal("2026-09-01", "Dinner");
    expect(inferMealOutcomes(kit.db, defaultSettings(), now)).toEqual([]);
  });

  it("emits an update for each meal it marks", async () => {
    const { kit, meal } = await boot();
    const b = meal("2026-10-28", "Breakfast");
    const events: string[] = [];
    inferMealOutcomes(kit.db, defaultSettings(), now, (t, id, op) => events.push(`${t}:${id}:${op}`));
    expect(events).toEqual([`meals:${b.id}:update`]);
  });
});
