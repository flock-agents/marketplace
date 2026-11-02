import { describe, it, expect } from "bun:test";
import { householdKnownFrom } from "./IdleNotice";

describe("householdKnownFrom", () => {
  it("is idle with no profile, an empty one, or a malformed one", () => {
    expect(householdKnownFrom({})).toBe(false);
    expect(householdKnownFrom({ "household.profile": null })).toBe(false);
    expect(householdKnownFrom({ "household.profile": {} })).toBe(false);
    expect(householdKnownFrom({ "household.profile": ["x"] })).toBe(false);
  });
  it("is known once the family's answers are saved", () => {
    expect(householdKnownFrom({ "household.profile": { people: "2 adults" } })).toBe(true);
  });
});
