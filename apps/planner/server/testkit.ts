// Shared setup for the server tests: the real kit on a real database (in memory unless a file is given), an HTTP caller that
// is the owner, the agent's operations, and a raw read of any table.
import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join, relative } from "path";
import { tmpdir } from "os";
import { Hono } from "hono";
import { mountKit } from "@flock/app-kit";
import * as schema from "./db/schema";
import { OLD_TABLES, SETTINGS } from "./db/constants";
import { agentOps } from "./agentOps";
import { mountFamilyRoutes } from "./family";
import { mountMealRoutes } from "./meals";
import { mountRegularRoutes } from "./regulars";
import { mountProductRoutes } from "./products";
import { mountRecipeRoutes } from "./recipes";
import { mountDishBookRoutes } from "./dishBook";
import { mountItemRoutes } from "./items";
import { mountCartRoutes } from "./cartRoutes";
import { mountReminderRoutes } from "./reminder";
import { mountMakePlanRoute } from "./makePlan";
import { NO_MODEL, type ModelCall } from "./model";
import { mountSetupRoute } from "./setup";
import { commit, saveSlotDay, type SlotDay } from "./slotStore";

/** A slot-day as a test writes it: `ordered_in` is skip "ordered_in"; a dish's `portion_note` is its note. */
export type TestMeal = { date: string; slot: string; ordered_in?: boolean; note?: string; status?: "planned" | "confirmed";
  dishes?: { name: string; for?: string[]; portion_note?: string; new?: boolean; ingredients?: { item: string; amount?: number; unit?: string }[] }[] };

/** A fresh temp directory for a test, removed when its test file is done: nothing piles up in the system's temp folder.
 *  The removal is registered here, per directory: this module loads once for the whole run, so a hook at its top level would
 *  serve the first test file only. */
export function tempDir(prefix = "planner-test-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The app on a real kit. `basePath` is the app's own path (as Flock gives it, APP_BASE_PATH). `askAgent` stands in for the
 *  platform's intent call: every call is recorded in `k.asked` as `{ intent, payload }`, and its answer is the function's.
 *  `schedule` stands in for the app's per-key timer (a debounce): it holds the latest `run` for each key until the test calls
 *  `k.settle(key?)`; the routes that need it (carts, the week) take `basePath`, `askAgent` and `schedule` from `k.deps`.
 *  `now` is the app's clock (the real one unless a test pins it): the routes that need today take it from `k.deps.now`. */
export async function boot(opts: { dbFile?: string; dataDir?: string; token?: string;
  basePath?: string; askAgent?: (intent: string, payload: object) => Promise<unknown>; now?: () => Date; model?: ModelCall; setupBudgetMs?: number } = {}) {
  const now = opts.now ?? (() => new Date());
  const hono = new Hono();
  const dataDir = opts.dataDir ?? tempDir();
  // The kit opens its database inside dataDir, so a file given by its full path is named from there.
  const dbFile = opts.dbFile && opts.dbFile !== ":memory:" ? relative(dataDir, opts.dbFile) : ":memory:";
  const kit = await mountKit({ hono, env: { appId: "t", dataDir, apiUrl: null, token: opts.token ?? null, agent: null } },
    { schema, settings: SETTINGS, keepTables: OLD_TABLES, dbFile, appName: "T" });
  mountFamilyRoutes(hono, kit.db, kit.emitChange, { appToken: opts.token ?? null });
  mountMealRoutes(hono, kit.db, kit.emitChange, { basePath: opts.basePath ?? "/a/t", now });
  mountRegularRoutes(hono, kit.db, kit.emitChange, { now });
  mountProductRoutes(hono, kit.db, kit.emitChange);
  mountRecipeRoutes(hono, kit.db, kit.emitChange);
  mountDishBookRoutes(hono, kit.db, kit.emitChange, { now });
  mountMakePlanRoute(hono, kit.db, kit.emitChange, { basePath: opts.basePath ?? "/a/t", model: opts.model ?? NO_MODEL, now });
  mountSetupRoute(hono, kit.db, kit.emitChange, { model: opts.model ?? NO_MODEL, budgetMs: opts.setupBudgetMs });
  /** A request as the owner. */
  const owner = async (method: string, path: string, body?: unknown) => {
    const r = await hono.request(path, { method, headers: { "Content-Type": "application/json", "X-Flock-User": "tester" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as any };
  };
  /** One of the agent's operations, called as Flock relays it. `agentId`: the agent calling (another person's, for a house
   *  where more than one person's agent works the app). */
  const op = (name: string, payload: object = {}, agentId = "meal-agent"): Promise<any> =>
    Promise.resolve(agentOps(() => hono)[name](payload as Record<string, unknown>, { agentId } as any));
  /** Every row of a table, straight from the database. */
  const rows = (table: string): any[] => kit.sqlite.query(`SELECT * FROM "${table}"`).all() as any[];
  /** The agent calls the app asked for, in order. */
  const asked: { intent: string; payload: object }[] = [];
  const askAgent = async (intent: string, payload: object): Promise<unknown> => { asked.push({ intent, payload }); return opts.askAgent?.(intent, payload); };
  /** The timers waiting, by key: only the latest run for a key is kept; a null run only clears the key. */
  const timers = new Map<string, () => void>();
  const schedule = (key: string, run: (() => void) | null, _ms: number): void => { if (run) timers.set(key, run); else timers.delete(key); };
  /** Is a run waiting for this key (or any key)? */
  const pending = (key?: string): boolean => (key === undefined ? timers.size > 0 : timers.has(key));
  /** Run what is waiting for this key, or for every key, once. */
  const settle = (key?: string): void => {
    const keys = key === undefined ? [...timers.keys()] : timers.has(key) ? [key] : [];
    for (const k of keys) { const run = timers.get(k)!; timers.delete(k); run(); }
  };
  const deps = { basePath: opts.basePath ?? "/a/t", askAgent, schedule, now };
  /** Write slot-days straight to the store (what make_plan saves), each in place of the one at its date and slot. */
  const plan = (meals: TestMeal[], by = "app"): SlotDay[] => commit(kit.db, kit.emitChange, (tx, ch) => meals.map((m) => saveSlotDay(tx, {
    date: m.date, slot: m.slot, skip: m.ordered_in ? "ordered_in" : null, note: m.note ?? null, ...(m.status ? { status: m.status } : {}),
    dishes: (m.dishes ?? []).map((d) => ({ dish: d.name, note: d.portion_note ?? null, new: d.new,
      ingredients: (d.ingredients ?? []).map((i) => ({ item: i.item, amount: i.amount ?? null, unit: i.unit ?? null })) })) }, by, ch)));
  mountItemRoutes(hono, kit.db, kit.emitChange, { now });
  mountCartRoutes(hono, kit.db, kit.emitChange, deps);
  mountReminderRoutes(hono, kit.db, kit.emitChange, deps);
  return { kit, hono, owner, op, rows, asked, pending, settle, deps, plan };
}
