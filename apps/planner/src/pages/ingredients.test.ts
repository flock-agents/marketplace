import { describe, it, expect } from "bun:test";
import { aliasesOf, cleanPrefs, editDistance, formatConversions, ingredientFormValues, ingredientPatch, matchIngredients, nameScore, parseConversions, parseJson, prefsSummary, splitList, type Ingredient } from "./ingredients";

const rows = [
  { id: "1", name: "Spinach", aliases: JSON.stringify(["palak"]) },
  { id: "2", name: "Paneer", aliases: null },
  { id: "3", name: "Tomato", aliases: JSON.stringify(["tamatar"]) },
];

describe("parseJson / aliasesOf", () => {
  it("falls back on bad JSON", () => { expect(parseJson("{", 5)).toBe(5); expect(parseJson(null, [])).toEqual([]); });
  it("keeps only strings", () => { expect(aliasesOf({ aliases: '["a",1,"b"]' })).toEqual(["a", "b"]); expect(aliasesOf({ aliases: '{"x":1}' })).toEqual([]); });
});

describe("splitList", () => {
  it("trims and drops blanks and case duplicates", () => expect(splitList("palak, spinach , ,Spinach")).toEqual(["palak", "spinach"]));
});

describe("conversions", () => {
  it("round-trips", () => {
    const c = parseConversions("pc=150, Bunch = 250, junk");
    expect(c).toEqual({ pc: 150, bunch: 250 });
    expect(formatConversions(c)).toBe("pc=150, bunch=250");
  });
});

describe("matching", () => {
  it("edit distance", () => { expect(editDistance("paner", "paneer")).toBe(1); expect(editDistance("abc", "xyzxyz", 2)).toBe(3); });
  it("scores exact, prefix, word, substring, typo", () => {
    expect(nameScore("Paneer", "paneer")).toBe(0);
    expect(nameScore("Paneer", "pan")).toBe(1);
    expect(nameScore("Green chilli", "chi")).toBe(2);
    expect(nameScore("Paneer", "nee")).toBe(3);
    expect(nameScore("Paneer", "paner")).toBe(4);
    expect(nameScore("Paneer", "xyz")).toBeNull();
    expect(nameScore("Paneer", "")).toBeNull();
  });
  it("matches aliases and says which", () => {
    const m = matchIngredients(rows, "palak");
    expect(m.map((x) => x.row.id)).toEqual(["1"]);
    expect(m[0].via).toBe("palak");
  });
  it("ranks the name match before a typo match", () => {
    expect(matchIngredients(rows, "tomat").map((x) => [x.row.id, x.via])).toEqual([["3", null]]);
    expect(matchIngredients(rows, "tamatr")[0].row.id).toBe("3");
  });
});

describe("prefs", () => {
  it("summarises only what is set", () => {
    expect(prefsSummary({ pack_min: 250, pack_max: 500, pack_unit: "g", price: "cheapest", never_auto_add: true })).toBe("250–500 g packs · cheapest · never auto-add");
    expect(prefsSummary({ price: "balanced" })).toBe("");
  });
  it("cleans unset fields", () => expect(cleanPrefs({ pack_min: null, brands_avoid: [], never_auto_add: false, price: "premium" })).toEqual({ price: "premium" }));
});

describe("ingredient form mapping", () => {
  const row: Ingredient = { id: "1", name: "Spinach", default_unit: "g", category: "vegetables", last_ordered_at: null, last_ordered_qty: null,
    aliases: '["palak"]', unit_conversions: '{"bunch":250}', shelf_life_days: 3, prefs: '{"price":"cheapest","brands_preferred":["Fresho"]}', notes: null };
  it("round-trips through the form", () => {
    const back = ingredientPatch(ingredientFormValues(row));
    expect(back).toEqual({ name: "Spinach", category: "vegetables", default_unit: "g", aliases: '["palak"]', unit_conversions: '{"bunch":250}',
      shelf_life_days: 3, notes: null, prefs: '{"price":"cheapest","brands_preferred":["Fresho"]}' });
  });
  it("writes null prefs when nothing is set", () => expect(ingredientPatch({ name: "X", price: "bogus" }).prefs).toBeNull());
});
