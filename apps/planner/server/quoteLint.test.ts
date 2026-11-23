// spec §4.2's day/count lint: a quote with a day word or a number, saved with no frequency and no days, is flagged.
import { describe, expect, test } from "bun:test";
import { dayOrCount, lintLibrary, needsReread } from "./quoteLint";

describe("quote lint (spec §4.2)", () => {
  test("a day word or a count with nothing saved is flagged", () => {
    expect(needsReread({ quote: "lemon rice on Friday" })).toBe(true);
    expect(needsReread({ quote: "rajma chawal twice a week" })).toBe(true);
    expect(needsReread({ quote: "parathas on weekends" })).toBe(true);
    expect(needsReread({ quote: "chole once a week" })).toBe(true);
    expect(needsReread({ quote: "biryani 2 times a month" })).toBe(true);
    expect(needsReread({ quote: "pongal on Sundays", frequency: null, days: [] })).toBe(true);
  });
  test("saved days or a saved frequency clears it", () => {
    expect(needsReread({ quote: "lemon rice on Friday", days: ["Fri"] })).toBe(false);
    expect(needsReread({ quote: "rajma chawal twice a week", frequency: "2/week" })).toBe(false);
  });
  test("a quote with neither is not flagged; clock times are not counts; a weekday inside a word is not a day", () => {
    expect(needsReread({ quote: "dal, chawal, roti, ek sabzi aur raita" })).toBe(false);
    expect(needsReread({ quote: "poha with chai" })).toBe(false);
    expect(needsReread({ quote: "she comes at 7:30" })).toBe(false);
    expect(needsReread({ quote: "a satisfying sundal" })).toBe(false);
    expect(needsReread({ quote: "" })).toBe(false);
    expect(needsReread({ quote: null })).toBe(false);
  });
  test("what was found, and the library filter", () => {
    expect(dayOrCount("khichdi on Saturday night, twice")).toEqual({ days: ["Saturday"], counts: ["twice"] });
    const lib = [{ name: "Lemon rice", quote: "lemon rice on Friday" }, { name: "Dal", quote: "dal" }, { name: "Pongal", quote: "pongal on Sundays", days: ["Sun"] }];
    expect(lintLibrary(lib).map((d) => d.name)).toEqual(["Lemon rice"]);
  });
});
