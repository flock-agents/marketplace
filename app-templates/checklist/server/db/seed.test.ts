import { describe, it, expect } from "bun:test";
import { inDays, sampleTasks } from "./seed";

describe("checklist sample rows", () => {
  const rows = sampleTasks(new Date(2026, 9, 8));
  it("are realistic, grouped, with some done and some open", () => {
    expect(rows.length).toBeGreaterThanOrEqual(8);
    for (const r of rows) {
      expect(r.label.length).toBeGreaterThan(10);
      expect(r.group_name.length).toBeGreaterThan(0);
      expect(r.label.toLowerCase()).not.toContain("lorem");
    }
    expect(new Set(rows.map((r) => r.group_name)).size).toBeGreaterThanOrEqual(3);
    expect(rows.some((r) => r.done)).toBe(true);
    expect(rows.some((r) => !r.done)).toBe(true);
  });
  it("dates are relative to today", () => {
    expect(inDays(4, new Date(2026, 9, 29))).toBe("2026-11-02");
    expect(rows.some((r) => !r.done && r.due > "2026-10-08")).toBe(true);
  });
});

describe("checklist sample order", () => {
  it("created_at is strictly increasing, so groups keep their order whatever the database does with ties", () => {
    const rows = sampleTasks(new Date(2026, 9, 8));
    for (let i = 1; i < rows.length; i++) expect(rows[i].created_at > rows[i - 1].created_at).toBe(true);
    const groups = rows.map((r) => r.group_name).filter((g, i, a) => a.indexOf(g) === i);
    expect(groups).toEqual(["Two weeks before", "Pack", "Move day", "After the move"]);
  });
});
