import { describe, it, expect } from "bun:test";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Hono } from "hono";
import { mountKit } from "@flock/app-kit";
import * as schema from "./db/schema";
import { seed, sampleBookings, samplePlan } from "./db/seed";
import { getTableConfig } from "drizzle-orm/sqlite-core";

const boot = async () => {
  const hono = new Hono();
  await mountKit({ hono, env: { appId: "t", dataDir: mkdtempSync(join(tmpdir(), "itinerary-schema-")), apiUrl: null, token: null, agent: null } }, { schema, seed, dbFile: ":memory:", appName: "T" });
  return hono;
};

describe("itinerary data", () => {
  it("is the plan, bookings, packing and budget, with no votes and no booked-by", async () => {
    const hono = await boot();
    const s = await (await hono.request("/api/_data/_schema")).json() as any;
    expect(Object.keys(s.tables).sort()).toEqual(["bookings", "packing", "plan", "trip_budget"]);
    expect((s.tables.bookings.columns as { name: string }[]).map((c) => c.name)).not.toContain("by");
    expect(Object.keys(schema)).not.toContain("plan_votes");
  });
  it("has no vote routes", async () => {
    const hono = await boot();
    expect((await hono.request("/api/plan-votes")).status).toBe(404);
  });
  it("seeds plan items and bookings without votes or a booker", () => {
    for (const p of samplePlan()) expect(Object.keys(p)).not.toContain("votes");
    for (const b of sampleBookings()) expect(Object.keys(b)).not.toContain("by");
  });
  it("declares bookings.plan_id as a link to plan.id (metadata only: import $refs and Clear samples)", () => {
    const links = getTableConfig(schema.bookings).foreignKeys.map((fk) => fk.reference())
      .map((r) => [r.columns.map((c) => c.name), getTableConfig(r.foreignTable).name, r.foreignColumns.map((c) => c.name)]);
    expect(links).toEqual([[["plan_id"], "plan", ["id"]]]);
  });
  it("seeds the bookings that belong to a plan item linked to it", async () => {
    const hono = await boot();
    const plan = (await (await hono.request("/api/_data/plan?limit=100")).json() as any).rows as { id: string; title: string }[];
    const books = (await (await hono.request("/api/_data/bookings?limit=100")).json() as any).rows as { what: string; plan_id: string | null }[];
    const titleOf = (b: { plan_id: string | null }) => plan.find((p) => p.id === b.plan_id)?.title ?? null;
    expect(Object.fromEntries(books.map((b) => [b.what, titleOf(b)]))).toEqual({
      "Flights, BLR to GOX and back": "IndiGo 6E 531 to Goa",
      "Villa Azul, 3 nights": "Check in at Villa Azul",
      "Thalassa dinner": "Dinner at Thalassa",
      "Gunpowder dinner": "Dinner at Gunpowder, Assagao",
      "Kayaking at Chapora": "Kayaking at Chapora",
      "Airport cab": null,
    });
  });
  it("Clear samples keeps a sample plan item that the owner's own booking points at", async () => {
    const hono = await boot();
    const plan = (await (await hono.request("/api/_data/plan?limit=100")).json() as any).rows as { id: string; title: string }[];
    const fort = plan.find((p) => p.title === "Sunset at Chapora Fort")!;
    const made = await hono.request("/api/_data/bookings", { method: "POST", headers: { "Content-Type": "application/json", "X-Flock-User": "owner" },
      body: JSON.stringify({ what: "Fort guide", status: "Pending", plan_id: fort.id }) });
    expect(made.status).toBe(201);
    const cleared = await (await hono.request("/api/_data/_samples/clear", { method: "POST", headers: { "X-Flock-User": "owner" } })).json() as any;
    expect(cleared.kept).toEqual([expect.objectContaining({ table: "plan", count: 1 })]);
    const left = (await (await hono.request("/api/_data/plan?limit=100")).json() as any).rows as { id: string }[];
    expect(left.map((p) => p.id)).toEqual([fort.id]);
  });
});
