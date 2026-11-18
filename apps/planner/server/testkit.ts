// Shared setup for the server tests: the real kit on a real database (in memory unless a file is given), an HTTP caller that
// is the owner, the agent's operations, and a raw read of any table.
import { mkdtempSync } from "fs";
import { join, relative } from "path";
import { tmpdir } from "os";
import { Hono } from "hono";
import { mountKit } from "@flock/app-kit";
import * as schema from "./db/schema";
import { OLD_TABLES, SETTINGS } from "./db/constants";
import { agentOps } from "./agentOps";

export async function boot(opts: { dbFile?: string; dataDir?: string } = {}) {
  const hono = new Hono();
  const dataDir = opts.dataDir ?? mkdtempSync(join(tmpdir(), "planner-test-"));
  // The kit opens its database inside dataDir, so a file given by its full path is named from there.
  const dbFile = opts.dbFile && opts.dbFile !== ":memory:" ? relative(dataDir, opts.dbFile) : ":memory:";
  const kit = await mountKit({ hono, env: { appId: "t", dataDir, apiUrl: null, token: null, agent: null } },
    { schema, settings: SETTINGS, keepTables: OLD_TABLES, dbFile, appName: "T" });
  /** A request as the owner. */
  const owner = async (method: string, path: string, body?: unknown) => {
    const r = await hono.request(path, { method, headers: { "Content-Type": "application/json", "X-Flock-User": "tester" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as any };
  };
  /** One of the agent's operations, called as Flock relays it. */
  const op = (name: string, payload: object = {}): Promise<any> =>
    Promise.resolve(agentOps(() => hono)[name](payload as Record<string, unknown>, { agentId: "meal-agent" } as any));
  /** Every row of a table, straight from the database. */
  const rows = (table: string): any[] => kit.sqlite.query(`SELECT * FROM "${table}"`).all() as any[];
  return { kit, hono, owner, op, rows };
}
