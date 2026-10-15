import { describe, it, expect } from "bun:test";
import { sampleEntries, staggered } from "./seed";
import { KINDS } from "./schema";

describe("directory sample entries", () => {
  const rows = sampleEntries();
  it("are realistic, use only the kinds the pages know, and carry no tags", () => {
    expect(rows.length).toBe(8);
    for (const r of rows) {
      expect(KINDS as readonly string[]).toContain(r.kind);
      expect(Object.keys(r)).not.toContain("tags");
      expect(r.name.toLowerCase()).not.toContain("lorem");
    }
  });
  it("covers several kinds, so the filter has something to filter", () => {
    expect(new Set(rows.map((r) => r.kind)).size).toBeGreaterThanOrEqual(6);
  });
  it("created_at strictly increases, so the seed order survives", () => {
    const at = staggered(new Date(2026, 9, 8, 10, 0, 0)).map((r) => r.created_at);
    for (let i = 1; i < at.length; i++) expect(at[i] > at[i - 1]).toBe(true);
  });
});
