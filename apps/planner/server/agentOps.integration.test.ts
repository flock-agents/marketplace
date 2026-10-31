// The app's operations for its agent: declared in flock.app.json, each served, each forwarding to the app's own route as
// the agent.
import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import * as schema from "./db/schema";
import { agentOps, OPERATION_NAMES } from "./agentOps";
import { bootKit } from "./stock.testkit";
import { mountJobRoutes } from "./jobRoutes";
import { mountMealRoutes } from "./mealRoutes";

const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "flock.app.json"), "utf-8"));
const ctx = { platform: {} as any, agentId: "meal-agent", pressToken: null } as any;

describe("agentInterface", () => {
  it("declares at most 20 operations (all Flock shows), guide first, each with a handler; instructions fit 2,000 characters", () => {
    const declared = manifest.agentInterface.operations.map((o: { name: string }) => o.name);
    expect(declared.length).toBeLessThanOrEqual(20);
    expect(declared[0]).toBe("guide");
    expect([...declared].sort()).toEqual([...OPERATION_NAMES].sort());
    expect(manifest.agentInterface.instructions.length).toBeLessThanOrEqual(2000);
    expect(manifest.minFlockVersion).toBe("0.22.0");
  });
});

describe("agentOps", () => {
  it("guide returns the full guide", async () => {
    const { hono } = await bootKit();
    const out = await agentOps(() => hono).guide({}, ctx) as { guide: string };
    expect(out.guide).toContain("# Meal Planner");
    expect(out.guide).toContain("answer_job");
  });

  it("writes as the agent, through the app's own routes (its hooks see an agent write)", async () => {
    const { kit, hono, all } = await bootKit();
    mountMealRoutes(hono, kit.db);
    const ops = agentOps(() => hono);
    const meal = await ops.save_meal({ date: "2026-11-02", slot: "Lunch", dish: "Rajma" }, ctx) as { row: { id: string } };
    expect(all(schema.meals)[0]).toMatchObject({ dish: "Rajma", updated_by: "agent:meal-agent" });
    const recipe = await ops.write_recipe({ name: "Rajma", lines: [] }, ctx) as { recipe_id: string };
    expect((await ops.set_meal_recipes({ meal_id: meal.row.id, recipes: [{ recipe_id: recipe.recipe_id }] }, ctx) as { ok: boolean }).ok).toBe(true);
    expect(all(schema.meal_recipes)).toHaveLength(1);
    expect(all(schema.meals)[0].recipe_id).toBe(recipe.recipe_id);
  });

  it("passes the app's refusals on as operation errors, and checks its own required fields", async () => {
    const { kit, hono } = await bootKit();
    mountJobRoutes(hono, kit.db);
    const ops = agentOps(() => hono);
    expect(await ops.answer_job({}, ctx)).toMatchObject({ code: "BAD_INPUT", status: 400 });
    expect(await ops.answer_job({ job_id: "nope", answer: {} }, ctx)).toMatchObject({ code: "APP_REFUSED", status: 404 });
  });
});
