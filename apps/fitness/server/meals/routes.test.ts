import { describe, it, expect } from "bun:test";
import { eatenAt, mealPlanRoutes, type PlannedMeal } from "./routes";
import type { EatenMeal, MealPlanStore } from "./store";
import type { MealPlanRow } from "./plan";
import { breakdown } from "../nutrition/testing";

const NOW = new Date("2026-10-21T07:30:00.000Z");   // 1:00 pm in Kolkata
const FULL = breakdown(3);
const ROTI = { id: "p1", slot: "Lunch", name: "2 roti, bhindi", kcal: 380, protein_g: 11, fiber_g: 8, ...FULL, done: 0, position: 0 };
const HEADLINE_ONLY = { ...ROTI, id: "p3", ...Object.fromEntries(Object.keys(FULL).map((k) => [k, null])) };
const UNESTIMATED = { id: "p2", slot: "Dinner", name: "Chana masala + roti", kcal: null, protein_g: null, fiber_g: null, done: 0, position: 1 };

function setup(own: MealPlanRow[] = []) {
  const logged: EatenMeal[] = [];
  const woken: PlannedMeal[] = [];
  const store: MealPlanStore = {
    rows: () => own,
    logged: () => logged.map((m) => ({ ...m, kind: "Meal" })),
    replace: async () => {},
    logMeal: async (m) => { logged.push(m); return "e1"; },
  };
  const app = mealPlanRoutes(store, async (m) => { woken.push(m); return { ok: true }; }, () => NOW);
  const eat = (id: string, date = "2026-10-21") => app.request("/meal-plan/eaten", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, id }) });
  return { app, eat, logged, woken };
}

describe("GET /meal-plan", () => {
  it("adds up what is planned for the day", async () => {
    const plan = await (await setup([ROTI, UNESTIMATED]).app.request("/meal-plan?date=2026-10-21")).json();
    expect(plan.planned).toEqual({ kcal: 380, protein_g: 11, fiber_g: 8 });
    expect(plan.items.map((i: { name: string }) => i.name)).toEqual(["2 roti, bhindi", "Chana masala + roti"]);
  });
});

describe("POST /meal-plan/eaten", () => {
  it("logs a planned meal with its numbers as eaten, now, and ticks it", async () => {
    const { app, eat, logged } = setup([ROTI]);
    expect((await eat("p1")).status).toBe(201);
    expect(logged).toEqual([{ title: "Lunch: 2 roti, bhindi", at: "2026-10-21T13:00", kcal: 380, protein_g: 11, fiber_g: 8, ...FULL }]);
    const plan = await (await app.request("/meal-plan?date=2026-10-21")).json();
    expect(plan.items[0]).toMatchObject({ done: true, actual: { kcal: 380, protein_g: 11, fiber_g: 8 } });
    expect((await eat("p1")).status).toBe(409);   // already eaten
  });
  it("wakes the coach once for a planned meal with no numbers yet", async () => {
    const { eat, logged, woken } = setup([UNESTIMATED]);
    expect((await eat("p2")).status).toBe(202);
    expect((await eat("p2")).status).toBe(202);
    expect(logged).toEqual([]);
    expect(woken).toEqual([{ date: "2026-10-21", slot: "Dinner", name: "Chana masala + roti", at: "2026-10-21T13:00" }]);
  });
  it("wakes the coach for a planned meal with its headline numbers but no full breakdown", async () => {
    const { eat, logged, woken } = setup([HEADLINE_ONLY]);
    expect((await eat("p3")).status).toBe(202);
    expect(logged).toEqual([]);
    expect(woken).toHaveLength(1);
  });
  it("refuses a day ahead and an unknown meal", async () => {
    const { eat } = setup([ROTI]);
    expect((await eat("p1", "2026-10-22")).status).toBe(400);
    expect((await eat("nope")).status).toBe(404);
  });
});

describe("eatenAt", () => {
  it("files today's meal now and an earlier day's at its slot's usual time", () => {
    expect(eatenAt("2026-10-21", "Lunch", NOW)).toBe("2026-10-21T13:00");
    expect(eatenAt("2026-10-20", "Dinner", NOW)).toBe("2026-10-20T20:30");
    expect(eatenAt("2026-10-20", null, NOW)).toBe("2026-10-20T13:00");
  });
});
