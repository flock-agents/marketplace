// The setup e2e of 27 Nov ("a fast answerer"): a veg Maharashtrian and South Indian house, a 6-year-old allergic to peanuts,
// no onion and garlic for one adult on Tuesdays, lunch and dinner, a first plan of 3 days. Nearly every dish came out "not for
// Kabir" and he had nothing at 5 of 6 meals: the careful allergy read (wary, or not answered) excluded catalog dishes that
// list no peanut at all. Now a catalog item says by its ingredients: a main peanut keeps it from him, one it can be made
// without, or one only the read suspects, is a "make without peanuts" note; and every eater has food at every meal.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { catalogIngredients } from "./kinds";
import { listSlotDays } from "./slotStore";
import type { ModelRequest, ModelResult } from "./model";

const now = () => new Date(2026, 10, 27, 11, 0);   // a Friday
const FRI = "2026-11-27";

/** A model whose careful read says every dish may have every allergy tag (the wariest answer); ingredients one per dish. */
const wary = async (req: ModelRequest): Promise<ModelResult> => {
  const u = JSON.parse(req.user);
  const p = req.purpose ?? "";
  if (p.includes("carefully")) return { ok: true, model: "f", json: { dishes: u.dishes.map((d: string) => ({ dish: d, has: u.tags })) } };
  if (p.includes("ingredients")) return { ok: true, model: "f", json: { dishes: u.dishes.map((d: any) => ({ slot: d.slot, name: d.name, ingredients: [{ item: "x", amount: 1, unit: "pc", tags: [] }] })) } };
  return { ok: true, model: "f", json: { dishes: [], changes: [], rules: [] } };
};

async function meeraHome(model?: (r: ModelRequest) => Promise<ModelResult>) {
  const k = await boot({ now, ...(model ? { model } : {}) });
  for (const [name, group] of [["Meera", "adult"], ["Rohan", "adult"], ["Kabir", "child"]]) await k.op("set_person", { name, group, diet: "veg" });
  await k.op("set_rule", { hard: true, what: "veg", quote: "All vegetarian" });
  await k.op("set_rule", { hard: true, what: "avoid", who: "Kabir", items: ["peanut"], quote: "Kabir is allergic to peanuts" });
  await k.op("set_rule", { hard: true, what: "avoid", who: "Rohan", items: ["onion_garlic"], days: ["Tue"], quote: "Rohan skips onion and garlic on Tuesdays" });
  await k.op("set_cuisine", { cuisine: ["Maharashtrian", "South Indian"] });
  await k.op("set_slot", { name: "Lunch", kind: "main" });
  await k.op("set_slot", { name: "Dinner", kind: "main" });
  const r = await k.op("make_plan", { from: FRI, days: 3 });
  const meals = listSlotDays(k.kit.db, { from: FRI, to: "2026-11-29" });
  return { ...k, r, meals };
}
const mainPeanut = (dish: string) => (catalogIngredients(dish) ?? []).some((x) => x.main && /peanut/.test(x.name));

for (const [label, model] of [["a wary careful read", wary], ["no model at all", undefined]] as const) {
  describe(`a peanut allergy in a Maharashtrian house, ${label}`, () => {
    it("Kabir has food at every meal, only a dish with peanuts at its heart is kept from him", async () => {
      const { r, meals } = await meeraHome(model);
      expect(r.ok).toBe(true);
      expect(meals).toHaveLength(6);
      expect(r.message).not.toContain("has nothing to eat");
      for (const m of meals) {
        const his = m.dishes.filter((d) => !d.not_for.includes("Kabir"));
        expect(his.filter((d) => !["Phulka", "Steamed rice"].includes(d.dish)).length, `${m.date} ${m.slot}: ${m.dishes.map((d) => d.dish).join(", ")}`).toBeGreaterThan(0);
        for (const d of m.dishes) if (d.not_for.includes("Kabir")) expect(mainPeanut(d.dish), `${d.dish} kept from Kabir`).toBe(true);
      }
      // Most dishes are his; the ones a read was wary of carry the note to make his without peanuts.
      const all = meals.flatMap((m) => m.dishes);
      expect(all.filter((d) => d.not_for.includes("Kabir")).length).toBeLessThanOrEqual(1);
      if (model) expect(all.some((d) => d.note?.includes("make without peanuts for Kabir"))).toBe(true);
    });
  });
}

describe("the first plan's message", () => {
  it("says once that the dishes are suggestions, instead of listing every new one", async () => {
    const { r } = await meeraHome();
    expect(r.message).not.toContain("New this week:");
    expect(r.message).toContain("These are suggestions for now");
    expect(r.message.split("Here's the plan").length).toBe(2);
    expect(r.instructions).toContain("nothing of your own before it");
  });
});
