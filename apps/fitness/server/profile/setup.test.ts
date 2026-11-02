import { describe, it, expect } from "bun:test";
import { isSetUp } from "./setup";

const settings = (values: Record<string, unknown>) => (key: string) => values[key];

describe("isSetUp", () => {
  it("needs both the person and their time zone", () => {
    expect(isSetUp(settings({ person: "Alex", timezone: "Europe/London" }))).toBe(true);
    expect(isSetUp(settings({ person: "Alex", timezone: "" }))).toBe(false);
    expect(isSetUp(settings({ person: "", timezone: "Europe/London" }))).toBe(false);
    expect(isSetUp(settings({}))).toBe(false);
  });
  it("does not count blanks as filled in", () => {
    expect(isSetUp(settings({ person: "  ", timezone: "Europe/London" }))).toBe(false);
  });
});
