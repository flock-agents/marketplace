import { describe, it, expect } from "bun:test";
import { hitsTarget, resolveGives, resolveTarget, targetsOf, targetText } from "./targets";

describe("rule targets", () => {
  it("tags are ingredients, dish words land on the catalog", () => {
    expect(resolveTarget("egg")).toEqual({ type: "ingredient", tag: "egg" });
    expect(resolveTarget("eggs")).toEqual({ type: "ingredient", tag: "egg" });
    expect(resolveTarget("salad")).toEqual({ type: "kind", kind: "Salad" });
    expect(resolveTarget("upma")).toEqual({ type: "kind", kind: "Upma" });
    expect(resolveTarget("rava upma")).toEqual({ type: "item", item: "Rava upma", kind: "Upma" });
    expect(resolveTarget("sambar")).toEqual({ type: "sub", kind: "Rice curry", sub: "Sambar" });
    expect(resolveTarget("maida")).toEqual({ type: "ingredient", tag: "maida" });
  });

  it("a swap gives an item or a kind, never an ingredient", () => {
    expect(resolveGives("pancakes")).toEqual({ type: "item", item: "Pancakes", kind: null });
    expect(resolveGives("dosa")).toEqual({ type: "item", item: "Plain dosa", kind: "Dosa" });
    expect(resolveGives("upma")).toEqual({ type: "kind", kind: "Upma" });
    expect(resolveGives("paratha")).toEqual({ type: "item", item: "Plain paratha", kind: "Paratha" });
  });

  it("a kind target holds for every item of the kind, read from the saved place", () => {
    const upma = { type: "kind", kind: "Upma" } as const;
    expect(hitsTarget(upma, { kind: "Upma", sub: "Upma", item: "Rava upma" })).toBe(true);
    expect(hitsTarget(upma, { kind: "Poha", sub: null, item: "Poha" })).toBe(false);
    expect(hitsTarget({ type: "ingredient", tag: "egg" }, { kind: "Upma", sub: null, item: null })).toBeNull();
  });

  it("veg is meat and fish; the family's words read back", () => {
    expect(targetsOf({ what: "veg", items: null, targets: null })).toEqual([{ type: "ingredient", tag: "meat" }, { type: "ingredient", tag: "fish" }]);
    expect(targetsOf({ what: "egg", items: null, targets: null }).length).toBe(2);
    expect(targetsOf({ what: "no_eggs", items: ["Salad"], targets: null })).toEqual([{ type: "ingredient", tag: "egg" }, { type: "kind", kind: "Salad" }]);
    expect(targetText({ type: "ingredient", tag: "egg" })).toBe("egg");
    expect(targetText({ type: "kind", kind: "Salad" })).toBe("salad");
    expect(targetText({ type: "item", item: "Pancakes", kind: null })).toBe("Pancakes");
  });
});
