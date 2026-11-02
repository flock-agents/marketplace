// Nothing runs until the family has told the app about themselves: rows alone, however many, don't count.
import { describe, it, expect } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Hono } from "hono";
import { mountKit } from "@flock/app-kit";
import * as schema from "./db/schema";
import { SETTINGS } from "./db/constants";
import { seed } from "./db/seed";
import { clearSamplesAs, gateRoutines, householdKnown, PROFILE_KEY, settleExistingInstall } from "./setupGate";
import { bootKit } from "./stock.testkit";

const PROFILE = { people: "2 adults, 1 child", food: "Vegetarian", meals: ["Breakfast", "Dinner"], shops: ["Zepto"] };

async function bootTemplate(importFile?: Record<string, unknown>) {
  const hono = new Hono();
  const dataDir = mkdtempSync(join(tmpdir(), "planner-gate-"));
  if (importFile) { mkdirSync(join(dataDir, ".flock"), { recursive: true }); writeFileSync(join(dataDir, ".flock", "import.json"), JSON.stringify(importFile)); }
  const kit = await mountKit({ hono, env: { appId: "t", dataDir, apiUrl: null, token: null, agent: null } },
    { schema, seed, dbFile: ":memory:", appName: "T", settings: SETTINGS, privateTables: { prep_reminders: "server-only" } });
  const as = (who: Record<string, string>) => async (method: string, path: string, body?: unknown) => {
    const r = await hono.request(path, { method, headers: { "Content-Type": "application/json", ...who }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as any };
  };
  const tables = [...(kit.ctx.allTables ?? kit.ctx.tables).keys()];
  return { kit, hono, dataDir, tables, owner: as({ "X-Flock-User": "tester" }), agent: as({ "X-Flock-Agent": "meal-agent" }) };
}
const sampleCount = (kit: { sqlite: any }) => (kit.sqlite.query("SELECT count(*) n FROM _samples").get() as { n: number }).n;
const isSample = (kit: { sqlite: any }, table: string, id: string) => !!kit.sqlite.query("SELECT 1 FROM _samples WHERE table_name = ? AND row_id = ?").get(table, id);

describe("householdKnown", () => {
  it("is false on a fresh template install", async () => {
    const { kit } = await bootTemplate();
    expect(householdKnown(kit.sqlite)).toBe(false);
  });

  it("stays false whatever rows the owner or the agent add: only the profile counts", async () => {
    const { kit, owner, agent } = await bootTemplate();
    await owner("POST", "/api/_data/diners", { name: "Asha" });
    await agent("POST", "/api/_data/meals", { date: "2026-11-05", slot: "Lunch", dish: "Rajma" });
    expect(householdKnown(kit.sqlite)).toBe(false);
  });

  it("is true once the profile is set, by the owner or by the agent on the family's word", async () => {
    for (const who of ["owner", "agent"] as const) {
      const t = await bootTemplate();
      expect((await t[who]("PATCH", "/api/_app/settings", { [PROFILE_KEY]: PROFILE })).status).toBe(200);
      expect(householdKnown(t.kit.sqlite)).toBe(true);
    }
  });
});

describe("gateRoutines", () => {
  it("runs no routine until the profile is set, then runs them", async () => {
    const { kit, owner } = await bootTemplate();
    const ran: string[] = [];
    const routines = gateRoutines({ a: () => { ran.push("a"); }, b: () => { ran.push("b"); } });
    const ctx = { kit: { sqlite: kit.sqlite } };
    routines.a(ctx); routines.b(ctx);
    expect(ran).toEqual([]);
    await owner("PATCH", "/api/_app/settings", { [PROFILE_KEY]: PROFILE });
    routines.a(ctx);
    expect(ran).toEqual(["a"]);
  });
});

describe("settleExistingInstall", () => {
  it("an install with no profile: what the app and its agent generated becomes a sample; the owner's own rows stay theirs", async () => {
    const { kit, dataDir, tables, owner, agent } = await bootTemplate();
    const made = (await agent("POST", "/api/_data/meals", { date: "2026-11-05", slot: "Lunch", dish: "Random dal" })).body.row;
    const mine = (await owner("POST", "/api/_data/meals", { date: "2026-11-06", slot: "Dinner", dish: "Our pasta" })).body.row;
    expect(settleExistingInstall(kit.sqlite, tables, dataDir)).toBe("marked");
    expect(isSample(kit, "meals", made.id)).toBe(true);
    expect(isSample(kit, "meals", mine.id)).toBe(false);
    expect(householdKnown(kit.sqlite)).toBe(false);
  });

  it("an install the owner already set up (own diners, no samples) keeps running", async () => {
    const { kit, family } = await bootKit();
    family();
    const dataDir = mkdtempSync(join(tmpdir(), "planner-gate-"));
    expect(settleExistingInstall(kit.sqlite, ["diners", "meals"], dataDir)).toBe("known");
    expect(householdKnown(kit.sqlite)).toBe(true);
    expect(sampleCount(kit)).toBe(0);
  });

  it("an install Flock made with the family's diners (its import) keeps running", async () => {
    const { kit, dataDir, tables } = await bootTemplate({ importId: "import-one-1", by: "flock-helper", rows: { diners: [{ $key: "asha", name: "Asha" }] } });
    expect(settleExistingInstall(kit.sqlite, tables, dataDir)).toBe("known");
    expect(householdKnown(kit.sqlite)).toBe(true);
  });

  it("an import's other rows are the owner's details, never samples", async () => {
    const { kit, dataDir, tables } = await bootTemplate({ importId: "import-two-2", by: "flock-helper", rows: { staples: [{ $key: "milk", item: "Milk" }] } });
    expect(settleExistingInstall(kit.sqlite, tables, dataDir)).toBe("marked");
    const [milk] = kit.db.select().from(schema.staples).all() as { id: string }[];
    expect(isSample(kit, "staples", milk.id)).toBe(false);
  });

  it("runs once per install", async () => {
    const { kit, dataDir, tables, agent } = await bootTemplate();
    settleExistingInstall(kit.sqlite, tables, dataDir);
    expect(existsSync(join(dataDir, ".flock", "household-check.json"))).toBe(true);
    const later = (await agent("POST", "/api/_data/meals", { date: "2026-11-07", slot: "Lunch", dish: "Later" })).body.row;
    expect(settleExistingInstall(kit.sqlite, tables, dataDir)).toBe("already");
    expect(isSample(kit, "meals", later.id)).toBe(false);
  });
});

describe("clearSamplesAs", () => {
  it("once the profile arrives, every sample (and everything generated before) goes; the owner's rows stay", async () => {
    const { kit, hono, dataDir, tables, owner, agent } = await bootTemplate();
    await agent("POST", "/api/_data/meals", { date: "2026-11-05", slot: "Lunch", dish: "Random dal" });
    await owner("POST", "/api/_data/meals", { date: "2026-11-06", slot: "Dinner", dish: "Our pasta" });
    settleExistingInstall(kit.sqlite, tables, dataDir);
    await clearSamplesAs(hono, "user:tester");
    expect(sampleCount(kit)).toBe(0);
    expect((kit.db.select().from(schema.meals).all() as { dish: string }[]).map((m) => m.dish)).toEqual(["Our pasta"]);
  });

  it("leaves the app's own writes alone; clears for an agent", async () => {
    const { kit, hono } = await bootTemplate();
    const before = sampleCount(kit);
    await clearSamplesAs(hono, "app");
    expect(sampleCount(kit)).toBe(before);
    await clearSamplesAs(hono, "agent:meal-agent");
    expect(sampleCount(kit)).toBe(0);
  });
});
