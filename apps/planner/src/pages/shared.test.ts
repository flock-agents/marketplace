import { describe, it, expect } from "bun:test";
import { inStockOptionsFor, parseQuickWhen } from "./shared";

describe("inStockOptionsFor", () => {
  it("offers only a few days for a fast-spoiling category", () => {
    const opts = inStockOptionsFor("dairy", "2026-10-28");
    expect(opts.map((o) => o.label)).toEqual(["1 day", "2 days", "3 days"]);
  });
  it("reaches into weeks for a long-shelf-life category", () => {
    const opts = inStockOptionsFor("spices", "2026-10-28");
    expect(opts.map((o) => o.label)).toEqual(["1 week", "2 weeks", "1 month"]);
  });
  it("falls back to the pantry-ish default for an unknown or mixed category", () => {
    expect(inStockOptionsFor(null, "2026-10-28").map((o) => o.label)).toEqual(inStockOptionsFor("pantry", "2026-10-28").map((o) => o.label));
  });
  it("values are real calendar dates from today", () => {
    expect(inStockOptionsFor("vegetables", "2026-10-28").map((o) => o.value)).toEqual(["2026-10-30", "2026-11-01", "2026-11-04"]);
  });
});

describe("parseQuickWhen", () => {
  const now = new Date(2026, 9, 28, 14, 30); // Oct 28, 2:30 PM

  it("reads a unit suffixed directly onto the number", () => {
    expect(parseQuickWhen("5d", "hours", now)).toBe("2026-11-02");
    expect(parseQuickWhen("1w", "hours", now)).toBe("2026-11-04");
  });
  it("keeps the exact time of day for an hour-based duration", () => {
    expect(parseQuickWhen("3h", "days", now)).toBe("2026-10-28T17:30");
  });
  it("lands on a bare date (no time) for a day/week/month duration", () => {
    expect(parseQuickWhen("2mo", "hours", now)).toBe("2026-12-28");
  });
  it("pairs a bare number with the dropdown unit", () => {
    expect(parseQuickWhen("3", "weeks", now)).toBe("2026-11-18");
  });
  it("falls back to Date.parse for an explicit date with no duration shape", () => {
    expect(parseQuickWhen("2026-11-02", "days", now)).toBe("2026-11-02");
  });
  it("keeps a time of day when one was given explicitly", () => {
    expect(parseQuickWhen("2026-11-02 18:00", "days", now)).toBe("2026-11-02T18:00");
  });
  it("rejects an unrecognised unit rather than silently falling through to Date.parse", () => {
    expect(parseQuickWhen("5zz", "days", now)).toBeNull();
  });
  it("rejects empty input", () => {
    expect(parseQuickWhen("   ", "days", now)).toBeNull();
  });
  it("rejects text that is neither a duration nor a parseable date", () => {
    expect(parseQuickWhen("whenever", "days", now)).toBeNull();
  });
});
