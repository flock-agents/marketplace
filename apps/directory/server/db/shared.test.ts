import { describe, it, expect } from "bun:test";
import { FIELDS, matches, type Entry } from "../../src/pages/shared";

describe("matches", () => {
  const e = { name: "Amma's Tiffin", kind: "Tiffin service", notes: "Lunch box delivered at 12:30." } as Entry;
  it("finds an entry by its name, kind or notes, whatever the case", () => {
    expect(matches(e, "amma")).toBe(true);
    expect(matches(e, "TIFFIN")).toBe(true);
    expect(matches(e, "lunch box")).toBe(true);
    expect(matches(e, "plumber")).toBe(false);
    expect(matches(e, "  ")).toBe(true);
  });
  it("survives an entry with no notes", () => expect(matches({ ...e, notes: null }, "lunch")).toBe(false));
});

describe("the entry form", () => {
  it("has no tags", () => expect(FIELDS.map((f) => f.name)).toEqual(["name", "kind", "phone", "url", "image", "notes"]));
});
