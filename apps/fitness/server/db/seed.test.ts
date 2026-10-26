import { describe, it, expect } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Hono } from "hono";
import { mountKit } from "@flock/app-kit";
import * as schema from "./schema";
import { spreadSampleReadings } from "./seed";

describe("a fresh install", () => {
  it("has no sample rows in any table", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "fit-fresh-"));
    const kit = await mountKit({ hono: new Hono(), env: { appId: "t", dataDir, apiUrl: null, token: null, agent: null } } as any, { schema, dbFile: ":memory:", appName: "T" });
    for (const t of ["metrics", "events", "plan_items", "meal_plan_items", "water_logs", "pace_samples", "pace_nudges"])
      expect((kit.sqlite.query(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n).toBe(0);
    kit.sqlite.close();
  });
});

describe("a plan's sample readings are spread over past weeks", () => {
  const boot = async (file: object) => {
    const dataDir = mkdtempSync(join(tmpdir(), "fit-spread-"));
    mkdirSync(join(dataDir, ".flock"), { recursive: true });
    writeFileSync(join(dataDir, ".flock", "import.json"), JSON.stringify(file));
    return mountKit({ hono: new Hono(), env: { appId: "t", dataDir, apiUrl: null, token: null, agent: null } }, { schema, dbFile: ":memory:", appName: "T" });
  };
  const stamps = (kit: any, label: string) => (kit.sqlite.query(`SELECT created_at FROM metrics WHERE label = ? ORDER BY rowid`).all(label) as { created_at: string }[]).map((r) => r.created_at);
  const DAY = 86_400_000;
  it("gives the readings of a label distinct past stamps, a week or so apart, oldest first", async () => {
    const m = (label: string, value: number, k: string) => ({ $key: k, label, value, unit: "kg" });
    const kit = await boot({ importId: "d1", by: "agent:pa", rows: {}, samples: { metrics: [m("Weight", 100, "a"), m("Weight", 120, "b"), m("Weight", 90, "c"), m("Weight", 140, "d"), m("Steps", 10, "e"), m("Steps", 12, "f")] } });
    const now = new Date();
    expect(new Set(stamps(kit, "Weight").map((x) => x.slice(0, 16))).size).toBe(1);   // the problem: one import, one minute
    expect(spreadSampleReadings(kit, now)).toBe(6);
    const s = stamps(kit, "Weight");
    expect(new Set(s).size).toBe(4);
    expect([...s].sort()).toEqual(s);
    expect(s.every((x) => x < now.toISOString())).toBe(true);
    const gaps = s.slice(1).map((x, i) => Date.parse(x) - Date.parse(s[i]));
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(6 * DAY);
    expect(Date.parse(s[0])).toBeGreaterThan(now.getTime() - 30 * DAY);
    expect(new Set(stamps(kit, "Steps")).size).toBe(2);
    expect(spreadSampleReadings(kit, now)).toBe(0);   // already spread: nothing to do
    kit.sqlite.close();
  });
  it("is skipped, never fatal, unless the kit is writable and ok", () => {
    const boom = new Proxy({}, { get() { throw new Error("must not be touched"); } }) as any;
    expect(spreadSampleReadings({ sqlite: boom, status: { state: "blocked" }, importState: { state: "none" }, flagSamples: boom })).toBe(0);
    expect(spreadSampleReadings({ sqlite: boom, status: { state: "ok" }, importState: { state: "failed" }, flagSamples: boom })).toBe(0);
    process.env.FLOCK_KIT_SCHEMA = "check";
    try { expect(spreadSampleReadings({ sqlite: boom, status: { state: "ok" }, importState: { state: "done" }, flagSamples: boom })).toBe(0); }
    finally { delete process.env.FLOCK_KIT_SCHEMA; }
    expect(spreadSampleReadings({ sqlite: boom, status: { state: "ok" }, importState: { state: "done" }, flagSamples: boom })).toBe(0);   // a throw inside is logged
  });
  it("leaves the owner's readings and the default seed alone", async () => {
    const own = await boot({ importId: "d2", by: "agent:pa", rows: { metrics: [{ $key: "a", label: "Weight", value: 1 }, { $key: "b", label: "Weight", value: 2 }] } });
    expect(spreadSampleReadings(own, new Date())).toBe(0);
    expect(new Set(stamps(own, "Weight").map((x) => x.slice(0, 16))).size).toBe(1);
    own.sqlite.close();
  });
});
