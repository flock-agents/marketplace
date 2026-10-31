import { describe, it, expect } from "bun:test";
import { activeWindows, learnOrderWindows, mergeWindows, planOrderAt, type OrderWindow } from "./orderPatterns";

const NOW = new Date(2026, 9, 28, 9, 0);   // Wed Oct 28, 2026
/** An instant at IST (UTC+05:30) wall-clock time, whatever zone the test runner uses. */
const at = (day: number, h: number, m = 10) => new Date(Date.UTC(2026, 9, day, h, m) - 330 * 60_000);
const daily = (from: string, source: "learned" | "pinned" = "learned"): OrderWindow => ({ days: [0, 1, 2, 3, 4, 5, 6], from, to: from, source, confidence: 1, sample_count: 3 });

describe("learnOrderWindows", () => {
  it("needs ≥3 orders in an hour; seen on ≥3 weekdays → every day", () => {
    const w = learnOrderWindows([at(20, 18), at(21, 18, 40), at(22, 18), at(23, 9), at(24, 9)], NOW);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ days: [0, 1, 2, 3, 4, 5, 6], from: "18:00", to: "19:00", source: "learned", sample_count: 3 });
    expect(w[0].confidence).toBeGreaterThan(0.5);
  });
  it("only the weekdays seen when fewer than 3 distinct; recency-weighted confidence", () => {
    const w = learnOrderWindows([at(17, 8), at(24, 8), at(25, 8), at(26, 20), at(19, 20), at(12, 20)], NOW);   // Sat,Sat,Sun @8 ; Mon,Mon,Mon @20
    const morning = w.find((x) => x.from === "08:00")!;
    expect(morning.days).toEqual([0, 6]);
    expect(w.find((x) => x.from === "20:00")!.days).toEqual([1]);
    expect(morning.confidence).toBeGreaterThan(w.find((x) => x.from === "20:00")!.confidence);
  });
  it("nothing learned from too little history", () => {
    expect(learnOrderWindows([at(20, 18), at(21, 18)], NOW)).toEqual([]);
  });
});

describe("pinned vs learned", () => {
  it("merge keeps pinned and replaces learned; pinned always wins in planning", () => {
    const merged = mergeWindows([daily("10:00", "pinned"), daily("07:00")], [daily("18:00")]);
    expect(merged.map((w) => `${w.source}:${w.from}`)).toEqual(["pinned:10:00", "learned:18:00"]);
    expect(activeWindows(merged).map((w) => w.from)).toEqual(["10:00"]);
    expect(activeWindows([daily("18:00")]).map((w) => w.from)).toEqual(["18:00"]);
  });
});

describe("planOrderAt", () => {
  it("dinner at 21:00 with a learned 18:00 window → order 18:00 the same day", () => {
    expect(planOrderAt("2026-10-30T20:00", [daily("18:00")], NOW)).toBe("2026-10-30T18:00");   // 21:00 − 60 min delivery lead
  });
  it("keeps a comfortable margin: a window too close to the deadline moves to the day before", () => {
    expect(planOrderAt("2026-10-30T18:30", [daily("18:00")], NOW)).toBe("2026-10-29T18:00");
  });
  it("skips windows in the past and weekdays the window doesn't cover; null when nothing fits", () => {
    expect(planOrderAt("2026-10-28T12:00", [daily("08:00")], NOW)).toBeNull();
    expect(planOrderAt("2026-10-30T20:00", [{ ...daily("18:00"), days: [1] }], NOW)).toBeNull();   // Mondays only
  });
  it("never picks a window after the deadline", () => {
    expect(planOrderAt("2026-10-30T12:00", [daily("18:00")], NOW)).toBe("2026-10-29T18:00");
    for (const d of ["2026-10-29T07:00", "2026-10-30T19:30", "2026-11-01T09:00"]) {
      const at = planOrderAt(d, [daily("18:00"), daily("08:00")], NOW);
      expect(at === null || at <= d).toBe(true);
    }
  });
});
