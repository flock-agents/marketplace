// Shared setup for the server tests of the agent's operations and the routine: the real kit on a real database in memory,
// with the app's routes, the agent's operations as Flock relays them, an HTTP caller that is the owner, and a raw read.
import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Hono } from "hono";
import { mountKit } from "@flock/app-kit";
import * as schema from "./db/schema";
import { seed as sampleSeed } from "./db/seed";
import { agentOps, closest } from "./agentOps";
import { mountEventRoutes } from "./events";

/** `seed`: start with the sample family, as a new install does. `now`: the app's clock. */
export async function boot(opts: { seed?: boolean; now?: () => Date } = {}) {
  const hono = new Hono();
  // Removed when the test file is done: nothing piles up in the system's temp folder.
  const dataDir = mkdtempSync(join(tmpdir(), "family-calendar-test-"));
  afterAll(() => rmSync(dataDir, { recursive: true, force: true }));
  const kit = await mountKit({ hono, env: { appId: "t", dataDir, apiUrl: null, token: null, agent: null } },
    { schema, ...(opts.seed ? { seed: sampleSeed } : {}), dbFile: ":memory:", appName: "T" });
  mountEventRoutes(hono, kit, { now: opts.now, near: closest });
  /** A request as the owner. */
  const owner = async (method: string, path: string, body?: unknown) => {
    const r = await hono.request(path, { method, headers: { "Content-Type": "application/json", "X-Flock-User": "tester" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as any };
  };
  /** One of the agent's operations, called as Flock relays it. */
  const op = (name: string, payload: object = {}): Promise<any> =>
    Promise.resolve(agentOps(() => hono)[name](payload as Record<string, unknown>, { agentId: "butler" } as any));
  /** Every row of a table, straight from the database. */
  const rows = (table: string): any[] => kit.sqlite.query(`SELECT * FROM "${table}" ORDER BY rowid`).all() as any[];
  return { kit, hono, owner, op, rows };
}
