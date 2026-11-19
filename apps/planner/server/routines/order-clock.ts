// The order clock: every run, each scheduled order whose time has come is handed to the agent to place, once. The agent
// places the first order of a week itself, right after planning it; the clock places every later one, and any the agent missed.
import { and, asc, eq, isNull, lt, lte, or, sql } from "drizzle-orm";
import { orders } from "../db/schema";
import { APP_NAMES, type GroceryApp } from "../db/constants";
import { clockText, dayLabel, localStamp, todayStr } from "../dates";
import { REWAKE_AFTER_MIN, startPlacing, type PlacePayload } from "../orders";
import { familyKnown } from "../gate";
import { fitsWake, wake, type RoutineCtx } from "./ctx";

const PLACE_PROMPT = (app: string): string => [
  `An order is due on ${app}: it is in the data below. \`lines\` are its lines; needs_product and needs_qty name the items whose line still needs a product, or its number of packs. Do not call place_order for it. Only when the data has no \`lines\` (the order was too long to send): call place_order { order_id } once and work from its answer. If you were already handed this order_id, act once.`,
  "1. Send the family `message` first, word for word.",
  `2. Find a product on ${app}, through its connection or skill, for each item in needs_product and save it with add_to_order { order_id, item, product_id, name_on_app, pack, price, qty }. Work out the packs of each item in needs_qty and save them with add_to_order { order_id, item, qty }.`,
  "3. Place the order without waiting for a yes, then record_order { order_id, placed: true } at once; if it could not be placed, record_order { order_id, placed: false, note }.",
  `4. The payment step asks the person. When they pay, record_order { order_id, paid: true }. If they do not pay, or say cancel, record_order { order_id, paid: false }. Cancel nothing on ${app}: the items move to the next order.`,
].join("\n");

/** What the wake carries of an order to place: place_order's answer, cut down to what placing needs, so that it fits in a
 *  wake. An order still too long goes by its id and message alone, and the agent reads the rest with place_order. */
function placeData(p: PlacePayload): object {
  const whole = {
    order_id: p.order.id, app: p.order.app, message: p.message,
    lines: p.order.lines.map((l) => ({ item: l.item, unit: l.unit, amount: l.amount, qty: l.qty, qty_checked: l.qty_checked,
      product_id: l.product_id, name_on_app: l.name_on_app, pack: l.pack, price: l.price })),
    needs_product: p.needs_product.map((l) => l.item), needs_qty: p.needs_qty.map((l) => l.item),
  };
  return fitsWake(whole) ? whole : { order_id: p.order.id, message: p.message };
}

/** Said first when an order is handed over a second time: the first hand-over may have got as far as the grocery app. */
const HANDED_BEFORE = (stamp: string): string => {
  const [date, time] = stamp.split("T");
  return `This order was handed to you before at ${clockText(time)} on ${dayLabel(date)} and never recorded. First check the grocery app: if it is already in the cart or placed, do not place it again; record it.\n`;
};

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
      // A planned order whose days are over buys nothing anyone still needs: it is closed, not placed. An order for added
      // items has no days of its own, and is placed whenever its turn comes.
      if (o.week_start && o.covers_to < todayStr(now)) {
        db.update(orders).set({ status: "cancelled", note: "its days had passed", wake_sent_at: null, updated_at: new Date().toISOString(), updated_by: "app" }).where(eq(orders.id, o.id)).run();
        emit("orders", o.id, "update", "app");
        continue;
      }
      // Handed over before and never recorded. Back among the orders that follow the plan first, so placing brings it up to
      // what changed since.
      if (o.wake_sent_at) unmark(o.id);
      const placing = startPlacing(db, emit, o.id, now, "app");
      // Nothing on it: nothing to place. It is looked at again on the next run.
      if (!placing) continue;
      marked = true;
      await wake(ctx, (o.wake_sent_at ? HANDED_BEFORE(o.wake_sent_at) : "") + PLACE_PROMPT(APP_NAMES[o.app as GroceryApp] ?? o.app), placeData(placing));
    } catch (e: any) {
      // Nobody is placing it: it follows the plan again, and the next run hands it over.
      if (marked) unmark(o.id);
      failures.push(`${o.id}: ${String(e?.message ?? e)}`);
    }
  }
  // A failed run in the routine's history, once every due order had its turn.
  if (failures.length) throw new Error(`${failures.length} of ${due.length} due orders not handed to the agent (${failures.join("; ")})`);
}
