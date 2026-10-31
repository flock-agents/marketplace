import { describe, it, expect } from "bun:test";
import { importMessage, normalizeTime, perAdult, scaledText, slotDefaultTime, timesText, usedInMeals } from "./recipes";

describe("quantities", () => {
  it("prefers qty_per_adult over legacy qty", () => { expect(perAdult({ qty: 1, qty_per_adult: 2 })).toBe(2); expect(perAdult({ qty: 1 })).toBe(1); });
  it("scales and rounds", () => {
    expect(scaledText({ qty_per_adult: 1 / 3, unit: "cup" }, 3)).toBe("1 cup");
    expect(scaledText({ qty_per_adult: 125, unit: "g" }, 4)).toBe("500 g");
    expect(scaledText({ qty: null, unit: "g" }, 4)).toBe("to taste");
  });
});

describe("timesText", () => {
  it("joins what is set", () => { expect(timesText(15, null, 8)).toBe("Prep 15 min · Start 8h ahead"); expect(timesText(null, null, null)).toBe(""); });
});

describe("usedInMeals", () => {
  const meals = [
    { date: "2026-10-20", dish: "Rajma", recipe_id: null }, { date: "2026-10-25", dish: "x", recipe_id: "r" },
    { date: "2026-11-02", dish: "x", recipe_id: "r" }, { date: "2026-10-30", dish: "Rajma", recipe_id: null }, { date: "2026-10-30", dish: "Dal", recipe_id: null },
  ];
  it("splits at today and orders each side", () => {
    const u = usedInMeals({ id: "r", name: "rajma" }, meals, "2026-10-29");
    expect(u.upcoming.map((m) => m.date)).toEqual(["2026-10-30", "2026-11-02"]);
    expect(u.past.map((m) => m.date)).toEqual(["2026-10-25", "2026-10-20"]);
  });
});

describe("meal time", () => {
  it("defaults from the slot and settings", () => {
    expect(slotDefaultTime("Breakfast", { "cook.morning": "07:15" })).toBe("07:15");
    expect(slotDefaultTime("Dinner", { "cook.evening": "bad" })).toBe("20:00");
    expect(slotDefaultTime("Lunch", {})).toBe("13:00");
    expect(slotDefaultTime(null, {})).toBeNull();
  });
  it("normalizes typed times", () => {
    expect(normalizeTime("7:30")).toBe("07:30"); expect(normalizeTime("1945")).toBe("19:45");
    expect(normalizeTime("25:00")).toBeNull(); expect(normalizeTime("soon")).toBeNull();
  });
});

describe("importMessage", () => {
  it("mentions source_url only for a link", () => {
    expect(importMessage({ id: "r1", name: "Rajma" }, " https://x.test/rajma ")).toContain("source_url");
    expect(importMessage({ id: "r1", name: "Rajma" }, "1 cup rajma")).not.toContain("source_url");
  });
});
