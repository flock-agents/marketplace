import { describe, it, expect } from "bun:test";
import { inDays, sampleItems, staggered } from "./seed";
import { STATUSES, PRIORITIES } from "./schema";

describe("tracker sample rows", () => {
  const rows = sampleItems(new Date(2026, 9, 8));
  it("are realistic and use only the statuses and priorities the pages know", () => {
    expect(rows.length).toBe(6);
    for (const r of rows) {
      expect(r.title.length).toBeGreaterThan(10);
      expect(STATUSES as readonly string[]).toContain(r.status);
      expect(PRIORITIES as readonly string[]).toContain(r.priority);
      expect(r.title.toLowerCase()).not.toContain("lorem");
    }
  });
  it("carry only the fields the tracker keeps: no amount or link", () => {
    const keys = new Set(rows.flatMap((r) => Object.keys(r)));
    expect([...keys].sort()).toEqual(["due", "notes", "owner", "priority", "status", "title"]);
  });
  it("dates are relative to today, so some are overdue and some are coming up", () => {
    expect(inDays(0, new Date(2026, 9, 31))).toBe("2026-10-31");
    expect(inDays(4, new Date(2026, 9, 29))).toBe("2026-11-02");
    const open = rows.filter((r) => r.status !== "Done");
    expect(open.some((r) => r.due < "2026-10-08")).toBe(true);
    expect(open.some((r) => r.due > "2026-10-08")).toBe(true);
  });
  it("have distinct, ordered created_at stamps in the past", () => {
    const now = new Date();
    const at = staggered(now).map((r) => r.created_at);
    expect(new Set(at).size).toBe(at.length);
    expect([...at].sort()).toEqual(at);
    expect(at.every((t) => t <= now.toISOString())).toBe(true);
  });
});
