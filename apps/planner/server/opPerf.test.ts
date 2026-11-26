// How many model calls an operation makes (perf, 27 Nov: a Butler turn of 231 s after "breakfast too carb heavy", set_rule
// 19 s and make_plan 6 to 12 s a call, each with several model calls). Each answer says it in `timing`. A typical house: three
// people, veg, a child's peanut allergy, breakfast, lunch and dinner, a few breakfast dishes of theirs.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import type { ModelRequest, ModelResult } from "./model";

const calls: string[] = [];
const model = async (req: ModelRequest): Promise<ModelResult> => {
  calls.push(req.purpose ?? "");
  const u = JSON.parse(req.user), p = req.purpose ?? "";
  if (p.includes("carefully")) return { ok: true, model: "f", json: { dishes: u.dishes.map((d: string) => ({ dish: d, has: [] })) } };
  if (p.includes("ingredients")) return { ok: true, model: "f", json: { dishes: u.dishes.map((d: any) => ({ slot: d.slot, name: d.name, ingredients: [{ item: "x", amount: 2, unit: "pc", tags: [] }] })) } };
  if (p.includes("contain")) return { ok: true, model: "f", json: {} };   // nothing read: the catalog's contents stand
  return { ok: true, model: "f", json: {} };
};

async function house() {
  const k = await boot({ now: () => new Date(2026, 10, 27, 11, 0), model });
  for (const [name, group] of [["Meera", "adult"], ["Rohan", "adult"], ["Kabir", "child"]]) await k.op("set_person", { name, group, diet: "veg" });
  await k.op("set_rule", { hard: true, what: "veg", quote: "All vegetarian" });
  await k.op("set_rule", { hard: true, what: "avoid", who: "Kabir", items: ["peanut"], quote: "Kabir is allergic to peanuts" });
  for (const name of ["Breakfast", "Lunch", "Dinner"]) await k.op("set_slot", { name, kind: "main" });
  for (const name of ["Kanda poha", "Rava upma", "Idli"]) await k.op("add_dish", { name, slot: "Breakfast" });
  return k;
}

describe("model calls per operation", () => {
  it("make_plan for 3 days makes at most 2, and says so in timing; a rule change makes none and names the meals to plan again", async () => {
    const k = await house();
    calls.length = 0;
    const plan = await k.op("make_plan", { from: "2026-11-27", days: 3 });
    expect(plan.ok).toBe(true);
    expect(plan.timing.model_calls).toBe(calls.length);
    expect(calls.length).toBeLessThanOrEqual(2);
    // Every dish still has its ingredients, a day's share of them.
    for (const d of (k.rows("slot_dishes") as any[])) expect((k.rows("dish_ingredients") as any[]).some((i) => i.slot_dish_id === d.id), d.dish).toBe(true);

    calls.length = 0;
    const note = await k.op("set_rule", { hard: false, what: "note", quote: "breakfast too carb heavy" });
    const avoid = await k.op("set_rule", { hard: true, what: "avoid", who: "Rohan", items: ["white_rice"], slots: ["Breakfast"], quote: "less rice for Rohan in the morning" });
    expect(calls).toEqual([]);
    expect(note.timing.model_calls).toBe(0);
    expect(avoid.ok).toBe(true);
    expect(avoid.stale.length).toBeGreaterThan(0);
    expect(avoid.replan).toContain("make_plan");

    calls.length = 0;
    const again = await k.op("make_plan", { from: "2026-11-27", days: 3 });
    expect(again.ok).toBe(true);
    expect(calls.length).toBeLessThanOrEqual(2);

    calls.length = 0;
    expect((await k.op("make_plan", { week_start: "2026-11-30" })).ok).toBe(true);
    expect(calls.length).toBeLessThanOrEqual(3);
  });
});
