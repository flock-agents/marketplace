// The order clock: every run, each scheduled order whose time has come is handed to the agent to place, once. The agent
// places the first order of a week itself, right after planning it; the clock places every later one, and any the agent missed.
import { and, asc, eq, isNull, lt, lte, or, sql } from "drizzle-orm";
import { orders } from "../db/schema";
import { APP_NAMES, type GroceryApp } from "../db/constants";
import { localStamp } from "../dates";
import { startPlacing } from "../orders";
import { familyKnown } from "../gate";
import { wake, type RoutineCtx } from "./ctx";

/** An order still scheduled this long after the agent was woken for it was not placed and not recorded: it is handed over again. */
export const REWAKE_AFTER_MIN = 60;

const PLACE_PROMPT = (app: string): string => [
  `An order is due on ${app}: it is in the data below, as place_order answers (do not call place_order for it again).`,
  "1. Send the family `message` first, word for word.",
  `2. Find a product on ${app}, through its connection or skill, for each line in needs_product, and set the packs of each line in needs_qty.`,
  "3. Place the order without waiting for a yes, then record_order { order_id, placed: true } at once; if it could not be placed, record_order { order_id, placed: false, note }.",
  `4. The payment step asks the person. When they pay, record_order { order_id, paid: true }. If they do not pay, or say cancel, record_order { order_id, paid: false }. Cancel nothing on ${app}: the items move to the next order.`,
].join("\n");

export async function orderClock(ctx: RoutineCtx, now: Date = new Date()): Promise<void> {
  const { db, sqlite, emitChange: emit } = ctx.kit;
  // No order goes out for a family the app does not know yet.
  if (!familyKnown(sqlite)) return;
  const unmark = (id: string) => {
    db.update(orders).set({ wake_sent_at: null, updated_at: new Date().toISOString() }).where(eq(orders.id, id)).run();
    emit("orders", id, "update", "app");
  };
  const failures: string[] = [];
  const longAgo = localStamp(new Date(now.getTime() - REWAKE_AFTER_MIN * 60_000));
  const due = db.select().from(orders)
    .where(and(eq(orders.status, "scheduled"), lte(orders.place_at, localStamp(now)), or(isNull(orders.wake_sent_at), lt(orders.wake_sent_at, longAgo))))
    .orderBy(asc(orders.place_at), sql`rowid`).all();
  for (const o of due) {
    // One order that fails does not stop the others.
    let marked = false;
    try {
      // Handed over before and never recorded. Back among the orders that follow the plan first, so placing brings it up to
      // what changed since.
      if (o.wake_sent_at) unmark(o.id);
      const placing = startPlacing(db, emit, o.id, now, "app");
      // Nothing on it: nothing to place. It is looked at again on the next run.
      if (!placing) continue;
      marked = true;
      await wake(ctx, PLACE_PROMPT(APP_NAMES[o.app as GroceryApp] ?? o.app), placing);
    } catch (e: any) {
      // Nobody is placing it: it follows the plan again, and the next run hands it over.
      if (marked) unmark(o.id);
      failures.push(`${o.id}: ${String(e?.message ?? e)}`);
    }
  }
  // A failed run in the routine's history, once every due order had its turn.
  if (failures.length) throw new Error(`${failures.length} of ${due.length} due orders not handed to the agent (${failures.join("; ")})`);
}
