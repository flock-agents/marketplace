// The reminder at 15:00 (tonight's dinner) and 19:00 (tomorrow's meals): the ingredients to check, the daily items due put on
// the cart, the items that may be running low asked together, and the texts the agent sends. Today is Monday 23 Nov 2026; the
// family has a final week, curd and bread bought every day (their stated cycles), and atta and toor dal bought a while ago.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { buildReminder } from "./reminder";
import { STOCK_OPTIONS, stockBlock } from "./messages";

const MON = "2026-11-23", TUE = "2026-11-24";

const EVENING_SAMPLE = `Tomorrow: poha · rajma chawal, bhindi
Do you have rajma and bhindi?

I've added curd and bread to your cart.
A few things were bought a while ago:
1. Atta, 31 days ago
2. Toor dal, 26 days ago
Still in stock? If yes, when should I remind you?
₹35 short of free delivery on Zepto.

How was today's food: dal and methi thepla? Good, okay or didn't work, and anything that went well or didn't?`;

const AFTERNOON_SAMPLE = `Tonight: methi thepla, curd. Anything to change?
Do you have methi?

I've added curd and bread to your cart.
A few things were bought a while ago:
1. Atta, 31 days ago
2. Toor dal, 26 days ago
Still in stock? If yes, when should I remind you?`;

const at = (day: number, hour: number) => new Date(2026, 10, day, hour).getTime();

type Dish = { name: string; for?: string[]; ingredients?: { item: string; amount?: number; unit?: string }[] };
const tuesdayLunch: Dish[] = [
  { name: "rajma chawal", for: ["everyone"], ingredients: [{ item: "rajma", amount: 250, unit: "g" }, { item: "rice", amount: 300, unit: "g" }] },
  { name: "bhindi", for: ["everyone"], ingredients: [{ item: "bhindi", amount: 500, unit: "g" }, { item: "oil", amount: 30, unit: "ml" }] }];

/** The family. `lunch` is Tuesday's lunch; `regulars: false` leaves out the everyday items; `history: false` the purchases. */
const start = async (o: { lunch?: Dish[]; regulars?: boolean; history?: boolean; plan?: boolean } = {}) => {
  let t = at(23, 19);
  const k = await boot({ now: () => new Date(t) });
  await k.op("set_shopping_apps", { main: "zepto", fallback: null, connected: ["zepto"] });
  await k.op("remember_product", { item: "curd", app: "zepto", product_id: "z-curd", name_on_app: "Mother Dairy curd", pack: "400 g", price: 50 });
  await k.op("remember_product", { item: "bread", app: "zepto", product_id: "z-bread", name_on_app: "Harvest Gold bread", pack: "400 g", price: 45 });
  if (o.regulars !== false) {
    await k.op("set_item", { item: "curd", group: "daily", usual_amount: 400, unit: "g", every_days: 1 });
    await k.op("set_item", { item: "bread", group: "daily", usual_amount: 1, unit: "pc", every_days: 1 });
  }
  if (o.history !== false) {
    // Atta: 10 kg every 24 days, last 23 Oct (runs out 16 Nov). Toor dal: every 20 days, last 28 Oct (runs out 17 Nov).
    await k.op("import_order_history", { app: "zepto", orders: [
      { date: "2026-09-29", order_ref: "A1", items: [{ item: "atta", group: "monthly", product: "Aashirvaad", pack: "10 kg" }] },
      { date: "2026-10-08", order_ref: "A2", items: [{ item: "toor dal", group: "monthly", pack: "1 kg" }] },
      { date: "2026-10-23", order_ref: "A3", items: [{ item: "atta", product: "Aashirvaad", pack: "10 kg" }] },
      { date: "2026-10-28", order_ref: "A4", items: [{ item: "toor dal", pack: "1 kg" }] }] });
  }
  for (const it of ["poha", "rice", "oil", "atta"]) await k.op("set_item", { item: it, group: "monthly" });
  if (o.plan !== false) {
    k.plan([
      { date: MON, slot: "Lunch", dishes: [{ name: "dal", for: ["everyone"], ingredients: [{ item: "toor dal", amount: 150, unit: "g" }] }] },
      { date: MON, slot: "Dinner", dishes: [
        { name: "methi thepla", for: ["everyone"], ingredients: [{ item: "methi", amount: 1, unit: "pc" }, { item: "atta", amount: 300, unit: "g" }] },
        { name: "curd", for: ["everyone"], ingredients: [{ item: "curd", amount: 400, unit: "g" }] }] },
      { date: TUE, slot: "Breakfast", dishes: [{ name: "poha", for: ["everyone"], ingredients: [{ item: "poha", amount: 200, unit: "g" }] }] },
      { date: TUE, slot: "Lunch", dishes: o.lunch ?? tuesdayLunch }]);
  }
  /** Set the clock to a day of November 2026 and an hour. */
  const clock = (day: number, hour: number) => { t = at(day, hour); };
  const reminder = (which: "afternoon" | "evening") => k.op("get_reminder", { which });
  return Object.assign(k, { clock, reminder });
};
type K = Awaited<ReturnType<typeof start>>;

const item = (k: K, name: string) => k.rows("items").find((i) => i.item === name);
const events = (k: K, name: string, kind: string) => k.rows("item_events").filter((e) => e.item_id === item(k, name)?.id && e.kind === kind);
const openCarts = (k: K) => k.rows("orders").filter((o) => o.status === "open");
const linesOn = (k: K, orderId: string) => k.rows("order_lines").filter((l) => l.order_id === orderId);
/** Zepto's open cart, as the app last copied it: ₹35 short of free delivery. */
const gap = async (k: K, rupees: number) => {
  await k.op("set_cart_line", { item: "salt", qty: 1 });
  await k.op("set_cart_line", { item: "salt", qty: 0 });
  const id = openCarts(k)[0].id;
  expect((await k.op("sync_cart", { order_id: id, lines: [], delivery_gap: rupees })).cart.delivery_gap).toBe(rupees);
};

describe("the reminder", () => {
  it("the evening reminder: tomorrow's meals, the ingredients to check, everyday items added, running-low batched", async () => {
    const k = await start();
    await gap(k, 35);
    const r = await k.reminder("evening");
    expect(r.text).toBe(EVENING_SAMPLE);
    expect(k.rows("order_lines").filter((l) => l.source === "everyday").map((l) => l.item).sort()).toEqual(["bread", "curd"]);
    expect(r).toMatchObject({ which: "evening", date: TUE, ask_ingredients: ["rajma", "bhindi"], cart_items: ["curd", "bread"], empty: false, ordered: [],
      added: [{ app: "zepto", item: "curd" }, { app: "zepto", item: "bread" }], asks: [{ item: "atta", days_ago: 31 }, { item: "toor dal", days_ago: 26 }],
      delivery_gap: { app: "Zepto", rupees: 35 } });
    expect(r.meals.map((m: any) => m.slot)).toEqual(["Breakfast", "Lunch"]);
    // The everyday items are for tomorrow, as many packs as the remembered product needs; the asked items wait on the cart at 0.
    const lines = linesOn(k, openCarts(k)[0].id);
    expect(lines.map((l) => [l.item, l.qty, l.source, l.for_date, l.for_note])).toEqual([
      ["curd", 1, "everyday", TUE, null], ["bread", 1, "everyday", TUE, null],
      ["atta", 0, "low", null, "might be running low"], ["toor dal", 0, "low", null, "might be running low"]]);
    expect(lines[0]).toMatchObject({ product_id: "z-curd", price: 50 });
    // The app chat gets the same text without the numbered lines, and the stock check as a block.
    expect(r.app_text).toBe(EVENING_SAMPLE.replace("1. Atta, 31 days ago\n2. Toor dal, 26 days ago\n", ""));
    expect(r.block).toMatchObject({ type: "Questions", id: "stock-2026-11-24-evening" });
    // The cart changed, so the agent copies it to Zepto.
    expect(r.carts).toEqual([expect.objectContaining({ order_id: openCarts(k)[0].id, app: "zepto", sync: true })]);
    expect(r.carts[0].lines).toHaveLength(4);
  });

  it("the afternoon reminder is about tonight's dinner only", async () => {
    const k = await start();
    k.clock(23, 15);
    const r = await k.reminder("afternoon");
    expect(r.text).toBe(AFTERNOON_SAMPLE);
    expect(r).toMatchObject({ which: "afternoon", date: MON, ask_ingredients: ["methi"], block: { id: "stock-2026-11-23-afternoon" } });
    expect(r.meals.map((m: any) => [m.date, m.slot])).toEqual([[MON, "Dinner"]]);
    // The everyday items are tomorrow's, whichever reminder puts them on.
    expect(k.rows("order_lines").filter((l) => l.source === "everyday").map((l) => l.for_date)).toEqual([TUE, TUE]);
    // A dinner ordered in has no meal lines; the 19:00 reminder that follows says the cart is already filled.
    k.plan([{ date: MON, slot: "Dinner", ordered_in: true }]);
    const again = await k.reminder("afternoon");
    expect(again.meals).toEqual([]);
    expect(again.text.split("\n")[0]).toBe("Your cart: curd and bread.");
    k.clock(23, 19);
    const evening = await k.reminder("evening");
    expect(evening.added).toEqual([]);
    expect(evening.text.split("\n").slice(0, 4)).toEqual(["Tomorrow: poha · rajma chawal, bhindi", "Do you have rajma and bhindi?", "", "Your cart: curd and bread."]);
  });

  it("monthly and everyday items are never asked as ingredients; subscribed items never anywhere", async () => {
    const k = await start({ lunch: [...tuesdayLunch,
      { name: "paneer bhurji", for: ["everyone"], ingredients: [{ item: "paneer", amount: 200, unit: "g" }, { item: "Curd", amount: 100, unit: "g" }, { item: "milk", amount: 200, unit: "ml" }] }] });
    // Paneer comes from the dairy: it is due by its history but never asked, never on a cart. Milk is an everyday item from Country Delight.
    await k.op("import_order_history", { app: "zepto", orders: ["2026-11-01", "2026-11-05", "2026-11-09"].map((date) => ({ date, items: [{ item: "paneer", group: "few_days", pack: "200 g" }] })) });
    expect(item(k, "paneer")).toMatchObject({ confident: 1, run_out: "2026-11-13" });
    await k.op("set_subscription", { item: "paneer", source: "the dairy", active: true });
    await k.op("set_regular", { item: "milk", amount: 1, unit: "l", every: "day" });
    await k.op("set_subscription", { item: "milk", source: "Country Delight", active: true });
    // Bhindi is already on the cart: not asked either.
    await k.op("set_cart_line", { item: "bhindi", qty: 1 });
    const r = await k.reminder("evening");
    expect(r.ask_ingredients).toEqual(["rajma"]);
    expect(r.asks.map((a: any) => a.item)).toEqual(["atta", "toor dal"]);
    expect(k.rows("order_lines").map((l) => l.item)).not.toContain("paneer");
    expect(k.rows("order_lines").map((l) => l.item)).not.toContain("milk");
    expect(r.text).toContain("Do you have rajma?");
    expect(r.text).not.toContain("milk");
  });

  it("at most 5 running-low items, the ones running out first; the rest wait for the next reminder", async () => {
    const k = await start();
    // Seven spices bought every 20 days, the last one 10 to 16 Oct: each runs out before atta and toor dal.
    const spices = ["cumin", "turmeric", "chilli powder", "coriander powder", "garam masala", "mustard seeds", "hing"];
    await k.op("import_order_history", { app: "zepto", orders: spices.flatMap((s, n) => [
      { date: `2026-09-${20 + n}`, items: [{ item: s, group: "monthly", pack: "100 g" }] },
      { date: `2026-10-${10 + n}`, items: [{ item: s, pack: "100 g" }] }]) });
    const r = await k.reminder("evening");
    expect(r.asks.map((a: any) => a.item)).toEqual(spices.slice(0, 5));
    expect(r.asks[0]).toEqual({ item: "cumin", days_ago: 44 });
    expect(r.text).toContain("1. Cumin, 44 days ago\n2. Turmeric, 43 days ago\n3. Chilli powder, 42 days ago\n4. Coriander powder, 41 days ago\n5. Garam masala, 40 days ago\nStill in stock?");
    expect(r.block.children).toHaveLength(5);
    // The rest were not asked, so not counted.
    for (const s of ["mustard seeds", "hing", "atta"]) expect(item(k, s).asks_unanswered).toBe(0);
    // She answers two of them: the next reminder asks the three left and the next two.
    await k.op("answer_running_low", { answers: [{ item: "cumin", answer: "in_stock", days: 7 }, { item: "turmeric", answer: "in_stock", days: 14 }] });
    k.clock(24, 15);
    const next = await k.reminder("afternoon");
    expect(next.asks.map((a: any) => a.item)).toEqual(["chilli powder", "coriander powder", "garam masala", "mustard seeds", "hing"]);
  });

  // Review Focus 2: an agent retry of the same reminder counts once; 15:00 and then 19:00 count two; the third snoozes.
  it("asking again for the same reminder counts once; 15:00 then 19:00 count two; a third reminder snoozes and does not count", async () => {
    const k = await start();
    k.clock(23, 15);
    expect((await k.reminder("afternoon")).asks.map((a: any) => a.item)).toEqual(["atta", "toor dal"]);
    expect(item(k, "atta")).toMatchObject({ asks_unanswered: 1, last_ask_key: "2026-11-23:afternoon" });
    expect(events(k, "atta", "ask")).toHaveLength(1);
    // The agent calls it again (a retry): still asked, not counted again.
    expect((await k.reminder("afternoon")).asks.map((a: any) => a.item)).toEqual(["atta", "toor dal"]);
    expect(item(k, "atta").asks_unanswered).toBe(1);
    expect(events(k, "atta", "ask")).toHaveLength(1);
    // 19:00 asks again what 15:00 left open: the second ask.
    k.clock(23, 19);
    expect((await k.reminder("evening")).asks.map((a: any) => a.item)).toEqual(["atta", "toor dal"]);
    await k.reminder("evening");
    expect(item(k, "atta")).toMatchObject({ asks_unanswered: 2, last_ask_key: "2026-11-24:evening" });
    expect(events(k, "atta", "ask")).toHaveLength(2);
    // The third reminder: two asks went unanswered, so the item is snoozed for its group's default (monthly: 5 days), not asked
    // and not counted; its waiting line leaves the cart.
    k.clock(24, 15);
    const third = await k.reminder("afternoon");
    expect(third.asks).toEqual([]);
    expect(third.text).not.toContain("Atta");
    expect(item(k, "atta")).toMatchObject({ asks_unanswered: 0, snoozed_until: "2026-11-29" });
    expect(events(k, "atta", "ask")).toHaveLength(2);
    expect(events(k, "atta", "unanswered").map((e) => [e.date, e.tag])).toEqual([["2026-11-24", "not_counted"]]);
    expect(k.rows("order_lines").filter((l) => l.item === "atta")).toEqual([]);
    // A retry of that reminder does not snooze twice, and the snooze holds at 19:00.
    await k.reminder("afternoon");
    expect(events(k, "atta", "unanswered")).toHaveLength(1);
    k.clock(24, 19);
    expect((await k.reminder("evening")).asks).toEqual([]);
  });

  // Review Focus 5: a reminder filling the cart of an app whose cart is being ordered.
  it("lines go on a new open cart while the app's cart is being ordered", async () => {
    const k = await start();
    await k.op("set_cart_line", { item: "rice", qty: 1 });
    const ordering = openCarts(k)[0].id;
    expect((await k.op("order_cart", { app: "zepto" })).order_id).toBe(ordering);
    const r = await k.reminder("evening");
    // The cart being ordered is as she said yes to it.
    expect(linesOn(k, ordering).map((l) => [l.item, l.qty])).toEqual([["rice", 1]]);
    expect(k.rows("orders").find((o) => o.id === ordering).status).toBe("ordering");
    // Everything the reminder put on went to a new open Zepto cart.
    const open = openCarts(k);
    expect(open.map((o) => o.app)).toEqual(["zepto"]);
    expect(open[0].id).not.toBe(ordering);
    expect(linesOn(k, open[0].id).map((l) => [l.item, l.qty])).toEqual([["curd", 1], ["bread", 1], ["atta", 0], ["toor dal", 0]]);
    expect(r.added.map((a: any) => a.item)).toEqual(["curd", "bread"]);
    expect(r.carts.map((c: any) => [c.order_id, c.sync])).toEqual([[ordering, false], [open[0].id, true]]);
    // She orders that one too; the same reminder again puts nothing on twice: tomorrow's curd and bread are being ordered.
    await k.op("record_order", { order_id: ordering, placed: true });
    await k.op("order_cart", { app: "zepto" });
    const again = await k.reminder("evening");
    expect(again.added).toEqual([]);
    expect(openCarts(k).flatMap((o) => linesOn(k, o.id)).filter((l) => (l.qty ?? 0) > 0)).toEqual([]);
  });

  it("an item ordered or bought since the last reminder is not asked again", async () => {
    const k = await start();
    k.clock(23, 15);
    expect((await k.reminder("afternoon")).asks.map((a: any) => a.item)).toEqual(["atta", "toor dal"]);
    // She bought atta at the kirana, and said yes to toor dal on the cart.
    await k.op("record_bought_outside", { item: "atta" });
    await k.op("answer_running_low", { answers: [{ item: "toor dal", answer: "low" }] });
    await k.op("order_cart", { app: "zepto" });
    k.clock(23, 19);
    const r = await k.reminder("evening");
    expect(r.asks).toEqual([]);
    expect(r.text).not.toContain("bought a while ago");
    expect(r.block).toBeNull();
    // Placed, toor dal's cycle restarts: still not asked the next day.
    await k.op("record_order", { order_id: k.rows("orders").find((o) => o.status === "ordering").id, placed: true });
    k.clock(24, 15);
    expect((await k.reminder("afternoon")).asks).toEqual([]);
  });

  it("a Saturday with Sunday off has no meal lines, only the cart and running-low", async () => {
    const k = await start();
    k.clock(28, 19);
    const r = await k.reminder("evening");
    expect(r.meals).toEqual([]);
    expect(r.text).toBe([
      "I've added curd and bread to your cart.",
      "A few things were bought a while ago:",
      "1. Atta, 36 days ago",
      "2. Toor dal, 31 days ago",
      "Still in stock? If yes, when should I remind you?"].join("\n"));
  });

  it("order without asking: the cart goes to ordering with confident running-low items, and the text says so", async () => {
    const k = await start();
    expect((await k.owner("PATCH", "/api/_app/settings", { order_without_asking: true })).status).toBe(200);
    const r = await k.reminder("evening");
    const cart = k.rows("orders");
    expect(cart.map((o) => [o.app, o.status])).toEqual([["zepto", "ordering"]]);
    expect(linesOn(k, cart[0].id).map((l) => [l.item, l.qty, l.source])).toEqual([["curd", 1, "everyday"], ["bread", 1, "everyday"], ["atta", 1, "low"], ["toor dal", 1, "low"]]);
    expect(r.asks).toEqual([]);
    expect(r.block).toBeNull();
    expect(r.ordered).toEqual([{ order_id: cart[0].id, app: "zepto",
      message: "Ordering this now: Mother Dairy curd, Harvest Gold bread, atta, toor dal on Zepto" }]);
    // Nothing was asked, so nothing counted.
    expect(item(k, "atta").asks_unanswered).toBe(0);
    expect(r.text).toBe([
      "Tomorrow: poha · rajma chawal, bhindi",
      "Do you have rajma and bhindi?",
      "",
      "I've ordered curd, bread, atta and toor dal on Zepto.",
      "",
      "How was today's food: dal and methi thepla? Good, okay or didn't work, and anything that went well or didn't?"].join("\n"));
  });

  it("an app the family has not signed in to: its cart is filled but not marked to copy, and never ordered without asking", async () => {
    const k = await start();
    await k.op("set_shopping_apps", { main: "zepto", fallback: null, connected: [] });
    const r = await k.reminder("evening");
    expect(r.carts).toEqual([expect.objectContaining({ app: "zepto", status: "open", sync: false })]);
    await k.owner("PATCH", "/api/_app/settings", { order_without_asking: true });
    const again = await k.reminder("evening");
    expect(again.ordered).toEqual([]);
    expect(k.rows("orders").map((o) => [o.app, o.status])).toEqual([["zepto", "open"]]);
  });

  it("a daily item goes on the cart by its cycle from the purchases, with nothing confirmed, and is not also asked about", async () => {
    const k = await start();
    // Milk: two 500 ml packs every day, last bought on Sunday: it runs out today, so tomorrow's is put on. Nobody stated a cycle.
    await k.op("remember_product", { item: "milk", app: "zepto", product_id: "z-milk", name_on_app: "Amul Taaza", pack: "500 ml" });
    await k.op("import_order_history", { app: "zepto", orders: ["2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"].map((date) => ({ date, items: [{ item: "milk", group: "daily", pack: "500 ml", count: 2 }] })) });
    expect(item(k, "milk")).toMatchObject({ confident: 1, lasts_days: 1, usual_amount: 1000, run_out: MON, stated_days: null });
    const r = await k.reminder("evening");
    expect(r.added.map((a: any) => a.item)).toEqual(["curd", "bread", "milk"]);
    expect(k.rows("order_lines").find((l) => l.item === "milk")).toMatchObject({ qty: 2, source: "everyday", for_date: TUE });
    expect(r.asks.map((a: any) => a.item)).toEqual(["atta", "toor dal"]);
    expect(item(k, "milk").asks_unanswered).toBe(0);
    expect(events(k, "milk", "ask")).toEqual([]);
  });

  it("a daily item bought today that lasts two days waits; one snoozed or left alone is not put on; one no longer bought stops", async () => {
    const k = await start({ regulars: false, history: false, plan: false });
    // Paneer every two days, bought today: it lasts till Wednesday.
    await k.op("import_order_history", { app: "zepto", orders: ["2026-11-19", "2026-11-21", "2026-11-23"].map((date) => ({ date, items: [{ item: "paneer", group: "daily", pack: "200 g" }] })) });
    // Lassi was bought every day in October and never since: its cycle was only learned, and the family stopped.
    await k.op("import_order_history", { app: "zepto", orders: ["2026-10-01", "2026-10-02", "2026-10-03"].map((date) => ({ date, items: [{ item: "lassi", group: "daily", pack: "200 ml" }] })) });
    await k.op("set_item", { item: "curd", group: "daily", usual_amount: 400, unit: "g", every_days: 1, snooze_days: 3 });
    await k.op("set_item", { item: "bread", group: "daily", every_days: 1, dont_ask: true });
    expect((await k.reminder("evening")).empty).toBe(true);
    expect(k.rows("order_lines")).toEqual([]);
    // Two days on the paneer is due; the curd's snooze ran to Thursday, so Friday's is put on that evening.
    k.clock(24, 19);
    expect((await k.reminder("evening")).added.map((a: any) => a.item)).toEqual(["paneer"]);
    k.clock(26, 19);
    expect((await k.reminder("evening")).added.map((a: any) => a.item)).toEqual(["paneer", "curd"]);
  });

  it("a cycle the family stated makes an item asked about once it was bought, until the purchases show their own", async () => {
    const k = await start({ regulars: false, history: false, plan: false });
    // "A tray of 30 eggs once a week", with one purchase, 8 days ago: no cycle to learn from yet.
    await k.op("set_item", { item: "eggs", group: "few_days", usual_amount: 30, unit: "pc", every_days: 7 });
    expect(item(k, "eggs")).toMatchObject({ lasts_days: 7, usual_amount: 30, run_out: null, confident: 1 });
    await k.op("import_order_history", { app: "zepto", orders: [{ date: "2026-11-15", items: [{ item: "eggs", pack: "30 pc" }] }] });
    expect(item(k, "eggs")).toMatchObject({ lasts_days: 7, run_out: "2026-11-22", confident: 1 });
    const r = await k.reminder("evening");
    expect(r.asks).toEqual([{ item: "eggs", days_ago: 8 }]);
    // Two more purchases ten days apart: the estimate goes by them now, and the stated cycle stays on the item.
    await k.op("import_order_history", { app: "zepto", orders: [{ date: "2026-11-05", items: [{ item: "eggs", pack: "30 pc" }] }] });
    expect(item(k, "eggs")).toMatchObject({ lasts_days: 10, stated_days: 7, run_out: "2026-11-25" });
  });

  it("order without asking keeps one order at a time per app: a cart already being ordered leaves the open one open", async () => {
    const k = await start();
    await k.op("set_cart_line", { item: "rice", qty: 1 });
    const first = (await k.op("order_cart", { app: "zepto" })).order_id;
    await k.owner("PATCH", "/api/_app/settings", { order_without_asking: true });
    const r = await k.reminder("evening");
    expect(k.rows("orders").filter((o) => o.status === "ordering").map((o) => o.id)).toEqual([first]);
    expect(r.ordered).toEqual([]);
    const open = openCarts(k);
    expect(open).toHaveLength(1);
    expect(linesOn(k, open[0].id).map((l) => [l.item, l.qty])).toEqual([["curd", 1], ["bread", 1], ["atta", 1], ["toor dal", 1]]);
    expect(r.carts.map((c: any) => [c.order_id, c.status])).toEqual([[first, "ordering"], [open[0].id, "open"]]);
    expect(r.text).toContain("I've added curd, bread, atta and toor dal to your cart.");
    // order_cart still answers the order being placed, through the same function.
    expect(await k.op("order_cart", { app: "zepto" })).toMatchObject({ order_id: first, already: true });
  });

  it("a retry of the reminder that ordered without asking lists the same orders to check out", async () => {
    const k = await start();
    await k.owner("PATCH", "/api/_app/settings", { order_without_asking: true });
    const r = await k.reminder("evening");
    expect(r.ordered).toHaveLength(1);
    expect(r.carts.map((c: any) => [c.order_id, c.status])).toEqual([[r.ordered[0].order_id, "ordering"]]);
    const again = await k.reminder("evening");
    expect(again.ordered).toEqual(r.ordered);
    expect(again.text).toBe(r.text);
    expect(k.rows("orders").map((o) => o.status)).toEqual(["ordering"]);
    // Another reminder does not claim it.
    k.clock(24, 15);
    expect((await k.reminder("afternoon")).ordered).toEqual([]);
  });

  it("dry run changes nothing", async () => {
    const k = await start();
    const tables = ["orders", "order_lines", "items", "item_events"];
    const snap = () => JSON.stringify(tables.map((t) => k.rows(t)));
    const before = snap();
    const dry = buildReminder(k.kit.db as any, "evening", new Date(at(23, 19)), { dryRun: true });
    expect(snap()).toBe(before);
    expect(dry).toMatchObject({ empty: false, added: [{ item: "curd" }, { item: "bread" }], asks: [{ item: "atta" }, { item: "toor dal" }] });
    // The same reminder for real says the same.
    const real = await k.reminder("evening");
    expect(real.text).toBe(dry.text);
    expect(snap()).not.toBe(before);
  });

  it("a dry run that would snooze an item changes nothing", async () => {
    const k = await start();
    k.clock(23, 15); await k.reminder("afternoon");
    k.clock(23, 19); await k.reminder("evening");
    expect(item(k, "atta").asks_unanswered).toBe(2);
    const snap = () => JSON.stringify(["orders", "order_lines", "items", "item_events"].map((t) => k.rows(t)));
    const before = snap();
    const dry = buildReminder(k.kit.db as any, "afternoon", new Date(at(24, 15)), { dryRun: true });
    expect(dry.asks).toEqual([]);
    expect(snap()).toBe(before);
    expect(item(k, "atta")).toMatchObject({ asks_unanswered: 2, snoozed_until: null });
  });

  it("a dry run with order without asking on changes nothing", async () => {
    const k = await start();
    await k.owner("PATCH", "/api/_app/settings", { order_without_asking: true });
    const snap = () => JSON.stringify(["orders", "order_lines", "items", "item_events"].map((t) => k.rows(t)));
    const before = snap();
    const dry = buildReminder(k.kit.db as any, "evening", new Date(at(23, 19)), { dryRun: true });
    expect(dry.ordered).toHaveLength(1);
    expect(snap()).toBe(before);
    expect(k.rows("orders").filter((o) => o.status === "ordering")).toEqual([]);
  });

  // Final review I3: a final plan moves a follows-plan item's run-out, though nothing else recomputed it.
  it("a follows-plan item's run-out moves with a final plan when a reminder is built; a dry run asks the same and keeps nothing", async () => {
    const k = await start();
    // Paneer: 500 g every 10 days, last 20 Nov (runs out 30 Nov).
    await k.op("import_order_history", { app: "zepto", orders: ["2026-11-10", "2026-11-20"].map((date) => ({ date, items: [{ item: "paneer", group: "few_days", pack: "500 g" }] })) });
    await k.op("set_item", { item: "paneer", follows_plan: true });
    expect(item(k, "paneer").run_out).toBe("2026-11-30");
    // Wednesday's dinner uses all of it: it runs out on 25 Nov, so it is due tomorrow.
    k.plan([{ date: "2026-11-25", slot: "Dinner", dishes: [{ name: "palak paneer", for: ["everyone"], ingredients: [{ item: "paneer", amount: 500, unit: "g" }] }] }]);
    const snap = () => JSON.stringify(["orders", "order_lines", "items", "item_events"].map((t) => k.rows(t)));
    const before = snap();
    const dry = buildReminder(k.kit.db as any, "evening", new Date(at(23, 19)), { dryRun: true });
    expect(dry.asks.map((a) => a.item)).toEqual(["atta", "toor dal", "paneer"]);
    expect(snap()).toBe(before);
    const real = await k.reminder("evening");
    expect(real.asks.map((a: any) => a.item)).toEqual(["atta", "toor dal", "paneer"]);
    expect(item(k, "paneer").run_out).toBe("2026-11-25");
  });

  it("the stock-check block is a Choice for one item and a Questions of 2 to 5 Choice tabs, each with the five options", () => {
    expect(STOCK_OPTIONS).toEqual(["Low, add it", "Fine for 3 days", "Fine for a week", "Fine for 2 weeks", "Fine, not sure how long"]);
    expect(stockBlock([], "stock-x")).toBeNull();
    expect(stockBlock([{ item: "atta", days_ago: 31 }], "stock-2026-11-24-evening")).toEqual(
      { type: "Choice", id: "stock-2026-11-24-evening", props: { question: "Atta, 31 days ago. Still in stock?", options: STOCK_OPTIONS } });
    const five = ["atta", "toor dal", "ghee", "rice", "oil"].map((item, n) => ({ item, days_ago: 30 - n }));
    const b = stockBlock(five, "stock-2026-11-23-afternoon") as any;
    expect(b).toMatchObject({ type: "Questions", id: "stock-2026-11-23-afternoon", props: { title: "Still in stock?", submitLabel: "Send" } });
    expect(b.children).toHaveLength(5);
    expect(b.children[1]).toEqual({ type: "Choice", props: { tab: "Toor dal", question: "Toor dal, 29 days ago", options: STOCK_OPTIONS } });
    expect(stockBlock(five.slice(0, 2), "s")).toMatchObject({ type: "Questions", children: [{ props: { tab: "Atta" } }, { props: { tab: "Toor dal" } }] });
  });

  it("nothing to say is empty", async () => {
    const k = await start({ regulars: false, history: false, plan: false });
    const r = await k.reminder("evening");
    expect(r).toMatchObject({ empty: true, text: "", app_text: "", block: null, meals: [], asks: [], added: [], cart_items: [], ordered: [] });
    // A cart with something on it is something to say.
    await k.op("set_cart_line", { item: "rice", qty: 1 });
    const cart = await k.reminder("evening");
    expect(cart).toMatchObject({ empty: false, text: "Your cart: rice." });
    // An unknown reminder is refused.
    expect((await k.op("get_reminder", { which: "night" })).code).toBe("APP_REFUSED");
  });
});
