import { describe, it, expect } from "bun:test";
import { groceryChanges, ingredientLines, linkFor, mealGroceryChanges, suggestRecipes } from "../src/pages/recipes";

const recipe = (id: string, name: string) => ({ id, name });

describe("ingredientLines", () => {
  it("is one ingredient per line, trimmed, blanks and bullets dropped", () => {
    expect(ingredientLines("Rajma, 1 cup\n\n  Onion, 2 \r\n- Ginger, 1 inch\n• Salt")).toEqual(["Rajma, 1 cup", "Onion, 2", "Ginger, 1 inch", "Salt"]);
  });
  it("is empty for no text", () => {
    expect(ingredientLines(null)).toEqual([]);
    expect(ingredientLines("   ")).toEqual([]);
  });
});

describe("groceryChanges", () => {
  const list = [
    { id: "g1", item: "Rajma, 1 kg", done: false },
    { id: "g2", item: "Onions, 1 kg", done: true },
    { id: "g3", item: "tomatoes", done: false },
  ];
  it("adds what is missing, skips what is on the list and not bought, puts back what was bought", () => {
    const c = groceryChanges(["Rajma, 1 cup", "Tomatoes, 3", "Onions, 2", "Ginger, 1 inch"], list);
    expect(c.add).toEqual(["Ginger, 1 inch"]);
    expect(c.reopen).toEqual(["g2"]);
    expect(c.skipped).toEqual(["Rajma, 1 cup", "Tomatoes, 3"]);
  });
  it("matches on the name before the comma or bracket, whatever the case", () => {
    expect(groceryChanges(["RAJMA (soaked overnight)"], list).skipped).toEqual(["RAJMA (soaked overnight)"]);
  });
  it("adds a line once even when the recipe lists it twice", () => {
    expect(groceryChanges(["Salt", "salt, to taste"], []).add).toEqual(["Salt"]);
  });
});

describe("suggestRecipes", () => {
  const recipes = [recipe("r1", "Rajma chawal"), recipe("r2", "Poha"), recipe("r3", "Palak paneer"), recipe("r4", "Chole")];
  const meals = [
    { date: "2026-10-10", dish: "Rajma chawal", recipe_id: "r1" },   // today
    { date: "2026-09-20", dish: "Poha", recipe_id: "r2" },
    { date: "2026-10-13", dish: "Poha", recipe_id: "r2" },           // already on the plan in three days
    { date: "2026-10-04", dish: "palak paneer", recipe_id: null },   // typed, not linked: still counts
  ];
  const day = "2026-10-10", today = "2026-10-10";
  it("puts never-planned recipes first, then the ones planned furthest from the day being planned", () => {
    expect(suggestRecipes(recipes, meals, "", day, today).map((s) => s.recipe.id)).toEqual(["r4", "r3", "r2", "r1"]);
  });
  it("measures from the day being planned, not from today", () => {
    expect(suggestRecipes(recipes, meals, "", "2026-10-03", today).map((s) => s.recipe.id)).toEqual(["r4", "r2", "r1", "r3"]);
  });
  it("names the nearest plan: had it on a past day, or on the plan ahead", () => {
    const s = suggestRecipes(recipes, meals, "", day, today);
    const say = (id: string) => s.find((x) => x.recipe.id === id)!.said;
    expect(say("r3")).toEqual({ had: true, date: "2026-10-04" });
    expect(say("r2")).toEqual({ had: false, date: "2026-10-13" });
    expect(say("r1")).toEqual({ had: false, date: "2026-10-10" });      // today is on the plan, not had
    expect(say("r4")).toBeNull();
  });
  it("filters by what is typed and keeps at most the limit", () => {
    expect(suggestRecipes(recipes, meals, "pa", day, today).map((s) => s.recipe.name)).toEqual(["Palak paneer"]);
    expect(suggestRecipes(recipes, meals, "", day, today, 2)).toHaveLength(2);
  });
});

describe("linkFor", () => {
  const recipes = [recipe("r1", "Rajma chawal"), recipe("r2", "Poha")];
  it("links a dish named like a recipe", () => expect(linkFor(" rajma Chawal ", recipes)).toBe("r1"));
  it("leaves a new dish unlinked", () => expect(linkFor("Masala dosa", recipes)).toBeNull());
  it("keeps an unchanged dish's link even after its recipe was renamed", () => {
    expect(linkFor("Poha with peanuts", recipes, { dish: "Poha with peanuts", recipe_id: "r2" })).toBe("r2");
    expect(linkFor("Upma", recipes, { dish: "Poha with peanuts", recipe_id: "r2" })).toBeNull();
  });
  it("drops the link of a meal whose recipe was deleted", () => {
    expect(linkFor("Masala dosa", recipes, { dish: "Masala dosa", recipe_id: "gone" })).toBeNull();
  });
});

describe("mealGroceryChanges: add all for this meal", () => {
  const rice = { name: "Rice", ingredients: "Sona masoori, 1 cup" };
  const sambar = { name: "Sambar", ingredients: "Toor dal, 1/2 cup\nDrumsticks, 2\nTamarind" };
  const bhindi = { name: "Bhindi fry", ingredients: "Bhindi, 250 g\nTamarind" };
  it("adds each dish's missing items once, under the first dish that needs them", () => {
    const c = mealGroceryChanges([rice, sambar, bhindi], [{ id: "g1", item: "Toor dal, 1 kg", done: false }, { id: "g2", item: "Bhindi", done: true }]);
    expect(c.add).toEqual([
      { item: "Sona masoori, 1 cup", for_dish: "Rice" },
      { item: "Drumsticks, 2", for_dish: "Sambar" },
      { item: "Tamarind", for_dish: "Sambar" },
    ]);
    expect(c.reopen).toEqual([{ id: "g2", for_dish: "Bhindi fry" }]);
    expect(c.skipped).toBe(2);   // toor dal on the list; tamarind already added for the sambar
    expect(c.bare).toEqual([]);
  });
  it("names the recipes with no ingredients yet", () => {
    expect(mealGroceryChanges([{ name: "Salad", ingredients: null }, rice], []).bare).toEqual(["Salad"]);
  });
});
