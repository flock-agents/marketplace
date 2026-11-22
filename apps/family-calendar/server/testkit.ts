// Shared setup for the server tests of the agent's operations and the routines: the real kit on a real database in memory,
// with the app's routes, the agent's operations as Flock relays them, an HTTP caller that is the owner, a raw read, and a
// stand-in for Flock's to-do list (the SDK's tasks.publish / withdraw / list) that records every call.
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
import { ensureInternalTables, INTERNAL_TABLES, PRIVATE_TABLES } from "./calendar";

export type TaskRow = { sourceRef: string; status: "open" | "done" | "dismissed"; withdrawn?: true; title: string; due: number | null; dueTimed: boolean; showFrom: number | null; updatedAt: number };

/** Flock's side of the app's to-dos: what was published (each call, in order), withdrawn, and the rows as Flock holds them. */
export function fakePlatform() {
  const published: any[] = [], withdrawn: string[] = [], completed: { ref: string; by?: string }[] = [];
  /** How Flock answers tasks.complete: "ok", "settled" (409, done by someone else), "gone" (404: no open task, or an older
   *  Flock), "forbidden" (403: `by` is not someone the task is for) or "absent" (an SDK with no complete at all). */
  let completeMode: "ok" | "settled" | "gone" | "forbidden" | "absent" = "ok";
  const rows = new Map<string, TaskRow>();
  let down = false;
  const ok = <T,>(data: T) => ({ ok: true as const, data });
  const fail = () => ({ ok: false as const, reason: "Flock is not reachable" });
  const dayMs = (s?: string) => (s ? new Date(`${s}T00:00:00`).getTime() : null);
  const platform = {
    tasks: {
      publish: async (t: any) => {
        if (down) return fail();
        published.push(t);
        const had = rows.get(t.sourceRef);
        rows.set(t.sourceRef, { sourceRef: t.sourceRef, status: had && had.status !== "dismissed" ? had.status : "open", title: t.title, due: t.due ?? null, dueTimed: !!t.dueTimed, showFrom: dayMs(t.showFrom), updatedAt: Date.now() });
        return ok({});
      },
      withdraw: async (ref: string) => {
        if (down) return fail();
        withdrawn.push(ref);
        const r = rows.get(ref);
        if (r) { r.status = "dismissed"; r.withdrawn = true; }
        return ok({});
      },
      complete: async (ref: string, opts?: { by?: string }) => {
        if (down) return fail();
        if (completeMode === "settled") return { ok: false as const, status: 409, reason: "platform 409: Already done by Ravi." };
        if (completeMode === "gone") return { ok: false as const, status: 404, reason: "platform 404: Task not found" };
        if (completeMode === "forbidden" && opts?.by) return { ok: false as const, status: 403, reason: "platform 403: That person is not someone this task is for." };
        completed.push({ ref, ...(opts?.by ? { by: opts.by } : {}) });
        const r = rows.get(ref);
        if (r) r.status = "done";
        return ok({});
      },
      list: async (o: { prefix?: string } = {}) => (down ? fail() : ok({ tasks: [...rows.values()].filter((r) => r.sourceRef.startsWith(o.prefix ?? "")).map((r) => ({ ...r })) })),
      snooze: async () => ok({}),
      tie: async () => ok({ tied: 0 }),
    },
  };
  return {
    get platform() { if (completeMode === "absent") { const { complete: _gone, ...older } = platform.tasks; return { tasks: older } as any; } return platform as any; },
    published, withdrawn, completed, rows,
    completeAs: (m: typeof completeMode) => { completeMode = m; },
    /** The owner ticks or dismisses the to-do on their Home. */
    close: (ref: string, status: "done" | "dismissed") => { const r = rows.get(ref); if (r) r.status = status; },
    down: (v: boolean) => { down = v; },
  };
}

/** `seed`: start with the sample family, as a new install does. `now`: the app's clock. */
export async function boot(opts: { seed?: boolean; now?: () => Date } = {}) {
  const hono = new Hono();
  // Removed when the test file is done: nothing piles up in the system's temp folder.
  const dataDir = mkdtempSync(join(tmpdir(), "family-calendar-test-"));
  afterAll(() => rmSync(dataDir, { recursive: true, force: true }));
  const kit = await mountKit({ hono, env: { appId: "t", dataDir, apiUrl: null, token: null, agent: null } },
    { schema, ...(opts.seed ? { seed: sampleSeed } : {}), dbFile: ":memory:", appName: "T", keepTables: INTERNAL_TABLES, privateTables: PRIVATE_TABLES });
  ensureInternalTables(kit.sqlite);
  const tasks = fakePlatform();
  let clock = opts.now ?? (() => new Date());
  const now = () => clock();
  const cal = { kit, now, platform: () => tasks.platform };
  mountEventRoutes(hono, kit, { now, near: closest, platform: () => tasks.platform });
  /** A request as the owner. */
  const owner = async (method: string, path: string, body?: unknown) => {
    const r = await hono.request(path, { method, headers: { "Content-Type": "application/json", "X-Flock-User": "tester" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as any };
  };
  /** A request from a viewer as Flock's proxy sends it: X-Flock-User (the owner's username, or "user:<id>" for someone the
   *  owner shared with) and X-Flock-Role. */
  const viewer = async (user: string, role: string, method: string, path: string, body?: unknown) => {
    const r = await hono.request(path, { method, headers: { "Content-Type": "application/json", "X-Flock-User": user, "X-Flock-Role": role }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as any };
  };
  /** One of the agent's operations, called as Flock relays it. */
  const op = (name: string, payload: object = {}): Promise<any> =>
    Promise.resolve(agentOps(() => hono, () => cal)[name](payload as Record<string, unknown>, { agentId: "butler", platform: tasks.platform, pressToken: null } as any));
  /** Every row of a table, straight from the database. */
  const rows = (table: string): any[] => kit.sqlite.query(`SELECT * FROM "${table}" ORDER BY rowid`).all() as any[];
  /** Move the app's clock. */
  const setNow = (d: Date) => { clock = () => d; };
  return { kit, hono, owner, viewer, op, rows, tasks, now, setNow, cal };
}
