import { describe, expect, test } from "bun:test";
import { dishNameOf } from "./truth";

describe("dishNameOf: the same words in any order (J8)", () => {
  test("a filling said with 'with' is the family's filled dish", () => {
    expect(dishNameOf("Paratha with egg", ["Egg paratha roll", "Plain paratha"])).toBe("Egg paratha roll");
    expect(dishNameOf("Paratha with cheese", ["Cheese paratha roll"])).toBe("Cheese paratha roll");
  });
  test("a different filling is no match", () => {
    expect(dishNameOf("Paratha with cheese", ["Egg paratha roll", "Plain paratha"])).toBeNull();
  });
});
