import { describe, it, expect } from "bun:test";
import { Hono } from "hono";
import { eventProblem, loggingGuard, metricProblem, waterProblem } from "./logging";
import { breakdown } from "../nutrition/testing";

const FULL = breakdown(2);

describe("eventProblem", () => {
  it("takes a meal with its three numbers and its full breakdown, whatever the kind's case", () => {
    expect(eventProblem({ title: "Besan chilla + chai", kind: "meal", kcal: 155, protein_g: 9, fiber_g: 3, ...FULL })).toBeNull();
  });
  it("refuses a new meal without its full breakdown and names every nutrient missing; takes 0 for none", () => {
    const { iron_mg: _, ...noIron } = FULL;
    const found = eventProblem({ title: "Besan chilla + chai", kind: "Meal", kcal: 155, protein_g: 9, fiber_g: 3, ...noIron, vitamin_d_mcg: null });
    expect(found?.field).toBe("vitamin_d_mcg");
    expect(found?.message).toContain("vitamin_d_mcg, iron_mg");
    expect(eventProblem({ title: "Besan chilla + chai", kind: "Meal", kcal: 155, protein_g: 9, fiber_g: 3, ...breakdown(0) })).toBeNull();
  });
  it("lets an older meal from before the full breakdown be edited", () => {
    expect(eventProblem({ title: "Besan chilla + chai", kind: "Meal", kcal: 155, protein_g: 9, fiber_g: 3 }, false)).toBeNull();
  });
  it("refuses a meal without its calories, protein or fiber", () => {
    expect(eventProblem({ title: "Besan chilla + chai", kind: "Meal" })?.field).toBe("kcal");
    expect(eventProblem({ title: "Besan chilla + chai", kind: "Meal", kcal: 155 })?.field).toBe("protein_g");
    expect(eventProblem({ title: "Besan chilla + chai", kind: "Meal", kcal: 155, protein_g: 9 })?.field).toBe("fiber_g");
  });
  it("refuses a meal logged as a note, with the numbers only in its title", () => {
    expect(eventProblem({ title: "Breakfast: 1 besan chilla, chai, about 330 kcal", kind: "Note" })?.field).toBe("kind");
  });
  it("refuses a workout without its minutes, takes one with them", () => {
    expect(eventProblem({ title: "Workout: elliptical intervals", kind: "Note" })?.field).toBe("title");
    expect(eventProblem({ title: "Workout: Elliptical intervals · 20 min", kind: "Note" })).toBeNull();
  });
  it("leaves other events alone", () => {
    expect(eventProblem({ title: "Back felt stiff after squats", kind: "Alert" })).toBeNull();
  });
});

describe("waterProblem", () => {
  it("takes a glass in millilitres, refuses one with no amount", () => {
    expect(waterProblem({ at: "2026-10-21T10:30", ml: 250 })).toBeNull();
    expect(waterProblem({ at: "2026-10-21T10:30", ml: 0 })?.field).toBe("ml");
    expect(waterProblem({ at: "2026-10-21T10:30" })?.field).toBe("ml");
  });
});

describe("metricProblem", () => {
  it("refuses a near-miss of a counted label, takes the exact one and any other", () => {
    expect(metricProblem({ label: "calories in", value: 300 })?.message).toContain(`"Calories in"`);
    expect(metricProblem({ label: "Protein Target", value: 90 })?.field).toBe("label");
    expect(metricProblem({ label: "Calorie target", value: 1400 })).toBeNull();
    expect(metricProblem({ label: "Waist", value: 81 })).toBeNull();
  });
});

describe("loggingGuard", () => {
  const stored: Record<string, Record<string, unknown>> = { e1: { title: "Lunch", kind: "Meal", kcal: 450, protein_g: 18, fiber_g: 9 } };
  const app = new Hono();
  app.use("/api/_data/*", loggingGuard((_t, id) => stored[id] ?? null));
  app.post("/api/_data/:table", async (c) => c.json({ stored: await c.req.json() }, 201));   // the kit reads the body again
  app.patch("/api/_data/:table/:id", async (c) => c.json({ row: await c.req.json() }));
  const send = (method: string, path: string, body: unknown) =>
    app.request(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it("refuses with 400 and passes a good write through with its body intact", async () => {
    const bad = await send("POST", "/api/_data/events", { title: "Besan chilla", at: "2026-10-21T11:00", kind: "meal" });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("not_counted");
    const good = await send("POST", "/api/_data/events", { title: "Besan chilla", at: "2026-10-21T11:00", kind: "Meal", kcal: 155, protein_g: 9, fiber_g: 3, ...FULL });
    expect(good.status).toBe(201);
    expect((await good.json()).stored.kcal).toBe(155);
  });
  it("checks a PATCH as the row it would leave", async () => {
    expect((await send("PATCH", "/api/_data/events/e1", { at: "2026-10-21T13:30" })).status).toBe(200);
    expect((await send("PATCH", "/api/_data/events/e1", { kcal: null })).status).toBe(400);
  });
});
