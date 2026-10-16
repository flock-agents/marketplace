import { describe, it, expect } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Hono } from "hono";
import { mountKit } from "@flock/app-kit";
import * as schema from "./schema";
import { inDays, sampleMetrics, sampleEvents, spreadSampleReadings } from "./seed";
import { KINDS } from "./constants";

describe("dashboard sample rows", () => {
  const from = new Date(2026, 9, 8);
  it("have several readings per label, oldest first, and store no delta", () => {
    const rows = sampleMetrics(from);
    const labels = [...new Set(rows.map((r) => r.label))];
    expect(labels.length).toBeGreaterThanOrEqual(3);
    expect(labels.length).toBeLessThanOrEqual(5);   // the StatStrip shows 2 to 5
    for (const l of labels) {
      const mine = rows.filter((r) => r.label === l);
      expect(mine.length).toBeGreaterThanOrEqual(5);
      for (const r of mine) expect(Object.keys(r)).not.toContain("delta");
      expect([...mine].sort((a, b) => a.created_at.localeCompare(b.created_at))).toEqual(mine);
    }
    const orders = rows.filter((r) => r.label === "Orders today");
    expect(orders[orders.length - 1].value).toBe(132);
  });
  it("are all stamped in the past, so a reading an agent posts later is the newest", () => {
    const now = new Date();
    for (const r of sampleMetrics(now)) expect(r.created_at <= now.toISOString()).toBe(true);
  });
  it("events use the kinds the page knows and are dated relative to today", () => {
    const ev = sampleEvents(from);
    expect(ev.length).toBeGreaterThanOrEqual(5);
    for (const e of ev) { expect(KINDS as readonly string[]).toContain(e.kind); expect(e.title.length).toBeGreaterThan(10); }
    expect(ev.every((e) => e.at.slice(0, 10) <= "2026-10-08")).toBe(true);
    expect(inDays(-1, from)).toBe("2026-10-07");
  });
});

describe("a plan's sample readings are spread over past weeks", () => {
  const boot = async (file: object) => {
    const dataDir = mkdtempSync(join(tmpdir(), "dash-spread-"));
    mkdirSync(join(dataDir, ".flock"), { recursive: true });
    writeFileSync(join(dataDir, ".flock", "import.json"), JSON.stringify(file));
    return mountKit({ hono: new Hono(), env: { appId: "t", dataDir, apiUrl: null, token: null, agent: null } }, { schema, dbFile: ":memory:", appName: "T" });
  };
  const stamps = (kit: any, label: string) => (kit.sqlite.query(`SELECT created_at FROM metrics WHERE label = ? ORDER BY rowid`).all(label) as { created_at: string }[]).map((r) => r.created_at);
  const DAY = 86_400_000;
  it("gives the readings of a label distinct past stamps, a week or so apart, oldest first", async () => {
    const m = (label: string, value: number, k: string) => ({ $key: k, label, value, unit: "₹" });
    const kit = await boot({ importId: "d1", by: "agent:pa", rows: {}, samples: { metrics: [m("Sales", 100, "a"), m("Sales", 120, "b"), m("Sales", 90, "c"), m("Sales", 140, "d"), m("Tiffins", 10, "e"), m("Tiffins", 12, "f")] } });
    const now = new Date();
    expect(new Set(stamps(kit, "Sales").map((x) => x.slice(0, 16))).size).toBe(1);   // the problem: one import, one minute
    expect(spreadSampleReadings(kit, now)).toBe(6);
    const s = stamps(kit, "Sales");
    expect(new Set(s).size).toBe(4);
    expect([...s].sort()).toEqual(s);
    expect(s.every((x) => x < now.toISOString())).toBe(true);
    const gaps = s.slice(1).map((x, i) => Date.parse(x) - Date.parse(s[i]));
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(6 * DAY);
    expect(Date.parse(s[0])).toBeGreaterThan(now.getTime() - 30 * DAY);
    expect(new Set(stamps(kit, "Tiffins")).size).toBe(2);
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
    const own = await boot({ importId: "d2", by: "agent:pa", rows: { metrics: [{ $key: "a", label: "Sales", value: 1 }, { $key: "b", label: "Sales", value: 2 }] } });
    expect(spreadSampleReadings(own, new Date())).toBe(0);
    expect(new Set(stamps(own, "Sales").map((x) => x.slice(0, 16))).size).toBe(1);
    own.sqlite.close();
  });
});
