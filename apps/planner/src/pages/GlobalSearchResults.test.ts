import { describe, it, expect } from "bun:test";
import { groupHits, readHits, routeFor } from "./GlobalSearchResults";

describe("readHits", () => {
  it("reads a results list", () => {
    expect(readHits({ results: [{ type: "recipes", id: "r1", name: "Rajma" }, { kind: "x", id: "1", name: "?" }, { kind: "meal", id: "m" }] }))
      .toEqual([{ kind: "recipe", id: "r1", title: "Rajma", meta: null }]);
  });
  it("reads results grouped by kind", () => {
    expect(readHits({ ingredients: [{ id: "i", name: "Spinach", matched: "palak" }] })).toEqual([{ kind: "ingredient", id: "i", title: "Spinach", meta: "palak" }]);
  });
  it("ignores junk", () => { expect(readHits(null)).toEqual([]); expect(readHits("x")).toEqual([]); });
});

describe("groupHits / routeFor", () => {
  it("orders groups and counts starts", () => {
    const g = groupHits([{ kind: "order", id: "o", title: "o", meta: null }, { kind: "recipe", id: "a", title: "a", meta: null }, { kind: "recipe", id: "b", title: "b", meta: null }]);
    expect(g.map((x) => [x.kind, x.start])).toEqual([["recipe", 0], ["order", 2]]);
  });
  it("routes", () => {
    expect(routeFor({ kind: "ingredient", id: "i", title: "", meta: null })).toBe("ingredient/i");
    expect(routeFor({ kind: "order", id: "o", title: "", meta: null })).toBe("groceries");
  });
});
