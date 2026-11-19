// What a routine uses of its run, and the wake of the agent as the routines make it.
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type { Database } from "bun:sqlite";
import type { Emit } from "../family";

/** The SDK's RoutineContext (the routine as Flock sent it, the wake of the agent) and the kit's own addition, this app's
 *  database (`ctx.kit`: mountKit hands every handler `{ db, sqlite, emitChange }`). */
export type RoutineCtx = {
  kit: { db: BunSQLiteDatabase<any>; sqlite: Database; emitChange: Emit };
  routine?: { trigger?: unknown };
  /** The SDK's Result: `ok: false` with a reason when the agent was not woken. A wake held for later is `ok`. */
  wakeAgent(message: string, data?: unknown): Promise<{ ok: boolean; reason?: string }>;
};

/** Flock carries at most 20,000 characters of a wake's data, counted as JSON with two-space indents (its
 *  WAKE_DATA_MAX_CHARS), and refuses the wake above that. What a routine sends stays under this, with room to spare. */
export const WAKE_DATA_BUDGET = 18_000;
export const fitsWake = (data: unknown): boolean => JSON.stringify(data, null, 2).length <= WAKE_DATA_BUDGET;

/** Wake the agent, or throw: a wake that did not go is a failed run in the routine's history, never a message silently lost. */
export async function wake(ctx: RoutineCtx, message: string, data: unknown): Promise<void> {
  const r = await ctx.wakeAgent(message, data);
  if (!r?.ok) throw new Error(`the agent was not woken: ${r?.reason ?? "no answer"}`);
}
