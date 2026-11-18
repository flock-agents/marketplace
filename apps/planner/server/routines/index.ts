// The app's four routines, by the handler each one is named with in flock.app.json. Flock decides when a run is due; the
// handler decides whether there is anything to say, and wakes the agent only then.
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type { Database } from "bun:sqlite";
import { gateRoutines } from "../gate";
import type { Emit } from "../family";
import { dinnerCheck, tomorrowCheck } from "./check-ins";
import { orderClock } from "./order-clock";
import { weeklyPlan } from "./weekly-plan";

/** What a routine uses of its run: the SDK's RoutineContext (the routine as Flock sent it, the wake of the agent) and the
 *  kit's own addition, this app's database (`ctx.kit`: mountKit hands every handler `{ db, sqlite, emitChange }`). */
export type RoutineCtx = {
  kit: { db: BunSQLiteDatabase<any>; sqlite: Database; emitChange: Emit };
  routine?: { trigger?: unknown };
  wakeAgent(message: string, data?: unknown): Promise<unknown>;
};

/** The weekly run and the order clock do nothing until the family is known (gate.ts). The check-ins are not behind that
 *  gate: each has something to do on every run, family or not (it records when it runs), and checks the family itself. */
export const routines: Record<string, (ctx: RoutineCtx) => void | Promise<void>> = {
  ...gateRoutines<RoutineCtx>({ "weekly-plan": (ctx) => weeklyPlan(ctx), "order-clock": (ctx) => orderClock(ctx) }),
  "dinner-check": (ctx) => dinnerCheck(ctx),
  "tomorrow-check": (ctx) => tomorrowCheck(ctx),
};
