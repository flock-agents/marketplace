// The order clock, every 15 minutes, for the two orders that would otherwise wait for ever: (a) a placed order nobody paid for
// within UNPAID_AFTER_HOURS is closed as not paid (cart.ts rollUnpaid: its purchases stop counting, its items go back on the
// app's open cart) and the family is told in one line, once (a wake that did not go is tried again on the next run); (b) a
// cart left `ordering` for ORDERING_STALE_MIN with nothing recorded is open again (cart.ts reopenCart, which folds in an
// open cart made meanwhile), with no wake: nothing was bought, and her next yes orders it. The clock places nothing.
import { and, asc, eq, lte, sql } from "drizzle-orm";
import { orders } from "../db/schema";
import { APP_NAMES, ORDERING_STALE_MIN, UNPAID_AFTER_HOURS, type GroceryApp } from "../db/constants";
import { todayStr, weekdayLong } from "../dates";
import { type Db } from "../family";
import { familyKnown } from "../gate";
import { emitAll, reopenCart, rollUnpaid, type Change, type OrderRow } from "../cart";
import { unpaidText } from "../messages";
import { wake, type RoutineCtx } from "./ctx";

const UNPAID_PROMPT = `An order placed ${UNPAID_AFTER_HOURS} hours ago was never paid: the app has closed it as not paid and put its items back on the app's open cart. Send the family \`message\`, word for word, and nothing more. Cancel nothing on the shopping app, and do not call record_order or cancel_order for it; only if they pay it after all, record_order { order_id, paid: true }.`;

/** The note on a cart the clock opened again. */
export const NOT_ORDERED_NOTE = "couldn't order yet";

export async function orderClock(ctx: RoutineCtx, now: Date = new Date()): Promise<void> {
  const { db, sqlite, emitChange: emit } = ctx.kit;
  if (!familyKnown(sqlite)) return;
  const failed: string[] = [];
  /** One order's change in its own transaction, told to the pages once committed; one that fails does not stop the others. */
  const each = (o: OrderRow, work: (tx: Db, changes: Change[]) => void) => {
    const changes: Change[] = [];
    try {
      db.transaction((tx) => work(tx as unknown as Db, changes));
      emitAll(emit, changes);
    } catch (e: any) { failed.push(`${o.id}: ${String(e?.message ?? e)}`); }
  };
  const byAge = (status: string, column: typeof orders.placed_at | typeof orders.ordering_at, before: Date) => db.select().from(orders)
    .where(and(eq(orders.status, status), lte(column, before.toISOString()))).orderBy(asc(column), sql`rowid`).all();

  // (a) Placed and not paid within the day: closed as not paid, once.
  for (const o of byAge("placed", orders.placed_at, new Date(now.getTime() - UNPAID_AFTER_HOURS * 3_600_000)))
    each(o, (tx, changes) => rollUnpaid(tx, o, "app", { changes, at: now }));
  // Then the line about each, said once: one whose wake did not go stays pending and is said on the next run. One paid
  // meanwhile is no longer not paid, and is not spoken of.
  for (const o of db.select().from(orders).where(and(eq(orders.status, "not_paid"), eq(orders.unpaid_notice, "pending"))).orderBy(asc(orders.placed_at), sql`rowid`).all()) {
    try {
      const placedDay = weekdayLong(todayStr(new Date(o.placed_at ?? o.updated_at)));
      await wake(ctx, UNPAID_PROMPT, { order_id: o.id, message: unpaidText(APP_NAMES[o.app as GroceryApp] ?? o.app, placedDay) });
      db.update(orders).set({ unpaid_notice: "sent", updated_at: new Date().toISOString() }).where(eq(orders.id, o.id)).run();
      emit("orders", o.id, "update", "app");
    } catch (e: any) { failed.push(`${o.id}: ${String(e?.message ?? e)}`); }
  }

  // (b) Being ordered for an hour with nothing recorded: open again, as her cart, with why.
  for (const o of byAge("ordering", orders.ordering_at, new Date(now.getTime() - ORDERING_STALE_MIN * 60_000)))
    each(o, (tx, changes) => reopenCart(tx, o, "app", { changes, at: now, note: NOT_ORDERED_NOTE }));

  // A failed run in the routine's history, once every order had its turn.
  if (failed.length) throw new Error(`${failed.length} orders not handled, tried again on the next run (${failed.join("; ")})`);
}
