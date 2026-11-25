// The eval's own placing of dish names in the catalog (lib/catalog.ts), expectations from the owner's decided rules.
import { describe, expect, test } from "bun:test";
import { CUISINES, isBareKindWord, isStapleKind, kindOf } from "./catalog";

describe("kindOf", () => {
  test("an item, a sub-kind or a kind by its whole name", () => {
    expect(kindOf("Aloo gobi")).toMatchObject({ kind: "Sabzi", item: "Aloo gobi" });
    expect(kindOf("Poriyal")).toMatchObject({ kind: "Sabzi", sub: "Poriyal/Thoran", item: null });
    expect(kindOf("Uthappam")?.kind).toBe("Dosa");               // decided 9: uttapam is a Dosa
    expect(kindOf("Chapati")?.kind).toBe("Roti");
  });
  test("a name holding a catalog name: the protein wins, then the dish over its rice", () => {
    expect(kindOf("Bhindi sabzi")?.kind).toBe("Sabzi");
    expect(kindOf("Chicken rassa")?.kind).toBe("Chicken");
    expect(kindOf("Kadhi chawal")?.kind).toBe("Rice curry");
    expect(kindOf("Rui maacher jhol")?.kind).toBe("Fish & seafood");
  });
  test("unplaceable names are null", () => {
    expect(kindOf("Zorba special")).toBeNull();
    expect(kindOf("Bhindi")).toBeNull();   // a vegetable alone: TRUTH says its kind
  });
});

describe("isBareKindWord (owner 25 Nov: \"Sabzi\", \"Dal\", \"Curry\", \"Poriyal\" are not dishes)", () => {
  test("coarse lunch/dinner kinds and their sub-kinds are bare", () => {
    for (const w of ["Sabzi", "Dal", "Curry", "Poriyal", "Torkari", "Fish", "Chicken", "Paneer"]) expect(isBareKindWord(w)).toBe(true);
  });
  test("items, staples, breakfast dish families and whole-plate kinds are dishes", () => {
    for (const w of ["Toor dal", "Aloo gobi", "Rice", "Roti", "Curd", "Idli", "Poha", "Upma", "Khichdi", "Biryani", "Rava idli"]) expect(isBareKindWord(w)).toBe(false);
  });
});

test("staple kinds and the cuisine words", () => {
  expect(["Roti", "Rice", "Curd", "Bhakri"].every(isStapleKind)).toBe(true);
  expect(isStapleKind("Dal")).toBe(false);
  expect(CUISINES).toEqual(expect.arrayContaining(["north", "south", "tamil", "bengal", "maharashtra", "rajasthan", "andhra"]));
});
