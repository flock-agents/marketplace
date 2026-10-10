import { describe, it, expect } from "bun:test";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Hono } from "hono";
import { mountKit } from "@flock/app-kit";
import * as schema from "./db/schema";
import { changePct } from "./db/constants";
import { sampleHoldings, sampleTransactions } from "./db/seed";

const columns = async (table: string) => {
  const hono = new Hono();
  await mountKit({ hono, env: { appId: "t", dataDir: mkdtempSync(join(tmpdir(), "money-data-")), apiUrl: null, token: null, agent: null } }, { schema, dbFile: ":memory:", appName: "T" });
  const s = await (await hono.request("/api/_data/_schema")).json() as any;
  return (s.tables[table].columns as { name: string }[]).map((c) => c.name);
};

describe("money data", () => {
  it("transactions have no account", async () => {
    expect(await columns("transactions")).not.toContain("account");
    for (const t of sampleTransactions()) expect(Object.keys(t)).not.toContain("account");
    expect(Object.keys(schema)).not.toContain("ACCOUNTS");
  });
  it("holdings store worth and invested only; the change is worked out", async () => {
    expect(await columns("holdings")).not.toContain("change_pct");
    for (const h of sampleHoldings) expect(Object.keys(h)).not.toContain("change_pct");
    expect(changePct(1240000, 960000)).toBe(29.2);
    expect(changePct(800000, 800000)).toBe(0);
    expect(changePct(5, 0)).toBeNull();
  });
});
