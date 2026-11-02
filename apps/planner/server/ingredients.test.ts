import { describe, it, expect } from "bun:test";
import { findIngredientMatch, likelyDuplicateIngredients, normalizeIngredientName } from "./ingredients";

describe("normalizeIngredientName", () => {
  it("lowercases and trims", () => expect(normalizeIngredientName("  Tomato  ")).toBe("tomato"));
  it("drops a trailing plural", () => expect(normalizeIngredientName("Tomatoes")).toBe("tomato"));
  it("drops common filler words", () => expect(normalizeIngredientName("Fresh chopped tomatoes")).toBe("tomato"));
});

describe("findIngredientMatch", () => {
  const catalog = [{ id: "i1", name: "Tomatoes" }, { id: "i2", name: "Onion" }];
  it("matches a differently-phrased name to the same catalog entry", () => {
    expect(findIngredientMatch(catalog, "Fresh tomato")?.id).toBe("i1");
  });
  it("finds nothing for a genuinely new ingredient", () => {
    expect(findIngredientMatch(catalog, "Capsicum")).toBeUndefined();
  });
});

describe("likelyDuplicateIngredients", () => {
  it("flags two names close enough to be the same ingredient, that findIngredientMatch wouldn't already treat as one", () => {
    const catalog = [{ id: "i1", name: "Capsicum" }, { id: "i2", name: "Capsicums" }];
    // "Capsicum" and "Capsicums" normalize to the SAME key (trailing plural dropped) — findIngredientMatch already
    // treats them as one, so they must NOT show up as a flagged pair (nothing to resolve: they already match).
    expect(likelyDuplicateIngredients(catalog)).toHaveLength(0);
  });
  it("flags a pair that's close but normalizes differently — one containing the other", () => {
    const catalog = [{ id: "i1", name: "Capsicum" }, { id: "i2", name: "Green capsicum" }];
    const out = likelyDuplicateIngredients(catalog);
    expect(out).toHaveLength(1);
    expect([out[0].a.name, out[0].b.name].sort()).toEqual(["Capsicum", "Green capsicum"]);
  });
  it("flags a pair within a small edit distance", () => {
    const catalog = [{ id: "i1", name: "Yoghurt" }, { id: "i2", name: "Yogurt" }];
    expect(likelyDuplicateIngredients(catalog)).toHaveLength(1);
  });
  it("leaves two genuinely unrelated ingredients alone", () => {
    const catalog = [{ id: "i1", name: "Onion" }, { id: "i2", name: "Paneer" }];
    expect(likelyDuplicateIngredients(catalog)).toHaveLength(0);
  });
});
