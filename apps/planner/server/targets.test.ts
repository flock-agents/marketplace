import { describe, it, expect } from "bun:test";
import { isAllergyRule } from "./allergy";
import { hitsTarget, resolveGives, resolveTarget, resolveTargets, targetsOf, targetText } from "./targets";

describe("rule targets", () => {
  it("a kind word the catalog also lists as an ingredient resolves to both", () => {
    expect(resolveTargets("rice")).toEqual([{ type: "kind", kind: "Rice" }, { type: "ingredient", tag: "white_rice" }]);
    for (const w of ["salad", "upma"]) expect(resolveTargets(w)).toEqual([resolveTarget(w)]);
    expect(resolveTargets("egg")).toEqual([{ type: "ingredient", tag: "egg" }]);
    expect(targetsOf({ what: "avoid", items: ["rice", "rice"], targets: null })).toEqual(resolveTargets("rice"));
  });

  // H7 fix round 1 (controller ruling): a word naming a family of dishes ("uthappam": the uttapams) is one item's other name in
  // the catalog. An exclusion of it holds for every dish of the family; a swap or a require on it gives the one item.
  it("no uthappam: every uttapam, never a dosa; a swap or require to uthappam gives Plain uttapam", () => {
    const items = (ts: ReturnType<typeof resolveTargets>) => ts.filter((t) => t.type === "item").map((t) => (t as { item: string }).item).sort();
    const uttapams = ["Mixed vegetable uttapam", "Onion uttapam", "Plain uttapam", "Podi uttapam", "Rava uttapam", "Tomato uttapam"];
    expect(items(targetsOf({ what: "avoid", items: ["uthappam"], targets: null }))).toEqual(uttapams);
    expect(items(targetsOf({ what: "avoid", items: ["uthappam"], targets: null }))).not.toContain("Plain dosa");
    expect(items(targetsOf({ what: "avoid", items: ["adai"], targets: null }))).toEqual(["Adai", "Murungai keerai adai", "Vegetable adai"]);
    expect(items(targetsOf({ what: "avoid", items: ["payasam"], targets: null }))).toEqual(expect.arrayContaining(["Rice kheer", "Semiya payasam", "Parippu payasam", "Sabudana kheer"]));
    // A word naming its one dish stays that dish.
    expect(targetsOf({ what: "avoid", items: ["ghee rice"], targets: null })).toEqual([{ type: "item", item: "Ghee rice", kind: "Pulao" }]);
    expect(targetsOf({ what: "require", items: ["uthappam"], targets: null })).toEqual([{ type: "item", item: "Plain uttapam", kind: "Dosa" }]);
    expect(resolveGives("uthappam")).toEqual({ type: "item", item: "Plain uttapam", kind: "Dosa" });
  });

  it("tags are ingredients, dish words land on the catalog", () => {
    expect(resolveTarget("egg")).toEqual({ type: "ingredient", tag: "egg" });
    expect(resolveTarget("eggs")).toEqual({ type: "ingredient", tag: "egg" });
    expect(resolveTarget("salad")).toEqual({ type: "kind", kind: "Salad" });
    expect(resolveTarget("upma")).toEqual({ type: "kind", kind: "Upma" });
    expect(resolveTarget("rava upma")).toEqual({ type: "item", item: "Rava upma", kind: "Upma" });
    expect(resolveTarget("sambar")).toEqual({ type: "sub", kind: "Rice curry", sub: "Sambar" });
    expect(resolveTarget("maida")).toEqual({ type: "ingredient", tag: "maida" });
  });

  it("an ingredient word stays an ingredient even where a dish carries it", () => {
    for (const w of ["curd", "paneer", "peanuts"]) expect(resolveTarget(w).type).toBe("ingredient");
    expect(resolveTarget("curd")).toEqual({ type: "ingredient", tag: "curd" });
    expect(resolveTarget("shrimp")).toEqual({ type: "ingredient", tag: "prawn" });
    expect(resolveTarget("poha").type).toBe("kind");
    expect(isAllergyRule({ hard: true, what: "avoid", items: ["shrimp"], quote: "Ira is allergic to shrimp" })).toBe(true);
    expect(isAllergyRule({ hard: true, what: "avoid", items: ["shrimp"], quote: "Ira doesn't eat shrimp" })).toBe(false);
  });

  // J9 (D1): "rice" is the catalog's rice tag, so idli rice, rice flour and poha are rice too.
  it("an ingredient word the catalog tags by its own name is that tag; one the catalog tags more widely stays its own word", () => {
    expect(resolveTargets("rice")).toEqual([{ type: "kind", kind: "Rice" }, { type: "ingredient", tag: "white_rice" }]);
    expect(resolveTarget("curd")).toEqual({ type: "ingredient", tag: "curd" });
    expect(resolveTarget("maida")).toEqual({ type: "ingredient", tag: "maida" });
    expect(resolveTarget("onion")).toEqual({ type: "ingredient", tag: "onion" });
  });
  it("a rule saved with the ingredient rice before is read as the catalog's rice tag", () => {
    const old = [{ type: "kind", kind: "Rice" }, { type: "ingredient", tag: "rice" }] as const;
    expect(targetsOf({ what: "avoid", items: ["rice"], targets: [...old] })).toEqual([{ type: "kind", kind: "Rice" }, { type: "ingredient", tag: "white_rice" }]);
    const curd = [{ type: "ingredient", tag: "curd" }] as const;
    expect(targetsOf({ what: "avoid", items: ["curd"], targets: [...curd] })).toEqual([...curd]);
  });

  it("a swap gives an item or a kind, never an ingredient", () => {
    expect(resolveGives("pancakes")).toEqual({ type: "item", item: "Pancakes", kind: null });
    expect(resolveGives("dosa")).toEqual({ type: "item", item: "Plain dosa", kind: "Dosa" });
    expect(resolveGives("upma")).toEqual({ type: "kind", kind: "Upma" });
    expect(resolveGives("rasam")).toEqual({ type: "item", item: "Tomato rasam", kind: "Rice curry" });
    expect(resolveGives("sambar")).toEqual({ type: "sub", kind: "Rice curry", sub: "Sambar" });
    expect(resolveGives("paratha")).toEqual({ type: "item", item: "Plain paratha", kind: "Paratha" });
    // H7 fix round 1: one meaning per word. "saaru" is any rasam in setup (Udupi saaru holds it), so a swap to it gives the
    // Rasam sub-kind, never Tomato rasam; "charu", held only by Tomato rasam's own names, is Tomato rasam.
    expect(resolveGives("saaru")).toEqual({ type: "sub", kind: "Rice curry", sub: "Rasam" });
    expect(resolveGives("charu")).toEqual({ type: "item", item: "Tomato rasam", kind: "Rice curry" });
  });

  it("a kind target holds for every item of the kind, read from the saved place", () => {
    const upma = { type: "kind", kind: "Upma" } as const;
    expect(hitsTarget(upma, { kind: "Upma", sub: "Upma", item: "Rava upma" })).toBe(true);
    expect(hitsTarget(upma, { kind: "Poha", sub: null, item: "Poha" })).toBe(false);
    expect(hitsTarget({ type: "sub", kind: "Rice curry", sub: "Sambar" }, { kind: "Rice curry", sub: "Sambar", item: "Sambar" })).toBe(true);
    expect(hitsTarget({ type: "sub", kind: "Rice curry", sub: "Sambar" }, { kind: "Rice curry", sub: "Rasam", item: "Tomato rasam" })).toBe(false);
    expect(hitsTarget({ type: "item", item: "Pancakes", kind: null }, { kind: null, sub: null, item: "pancakes" })).toBe(true);
    expect(hitsTarget({ type: "item", item: "Pancakes", kind: null }, { kind: "Dosa", sub: null, item: "Plain dosa" })).toBe(false);
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
