// Items: order histories recorded as purchases (every app, 3 months back, never twice), subscriptions, her answers to
// "still in stock?", purchases outside the apps, and the Pantry and item page reads. Today is pinned: Saturday 21 Nov 2026.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { dish_items, dishes, order_lines, orders, plan_meals } from "./db/schema";
import { pickAsks } from "./estimate";
import { itemStates, recordPurchase } from "./items";

const TODAY = "2026-11-21";
const start = () => boot({ now: () => new Date(2026, 10, 21, 12) });
type K = Awaited<ReturnType<typeof start>>;

const item = (k: K, name: string) => k.rows("items").find((i) => i.item === name);
const events = (k: K, name: string) => k.rows("item_events").filter((e) => e.item_id === item(k, name)?.id);
const house = (k: K) => k.rows("house")[0];

/** Atta on Zepto: 10 kg on 8 Oct and 1 Nov (lasts 24 days, runs out 25 Nov). */
const atta = (k: K) => k.op("import_order_history", { app: "Zepto", orders: [
  { date: "2026-10-08", order_ref: "Z1", items: [{ item: "atta", group: "monthly", product: "Aashirvaad Select", product_id: "p1", pack: "5 kg", count: 2, price: 520 }] },
  { date: "2026-11-01", order_ref: "Z2", items: [{ item: "atta", product: "Aashirvaad Select", product_id: "p1", pack: "5 kg", count: 2 }] }] });
/** One purchase a date of an item, with a pack. */
const buys = (k: K, it: string, group: string | undefined, pack: string, dates: string[], app = "zepto") =>
  k.op("import_order_history", { app, orders: dates.map((date) => ({ date, items: [{ item: it, ...(group ? { group } : {}), pack }] })) });

describe("import_order_history", () => {
  it("import_order_history records each purchase with brand, pack × count, date and app", async () => {
    const k = await start();
    const r = await atta(k);
    expect(r.recorded).toBe(2);
    expect(k.rows("item_events").map((e) => [e.date, e.app, e.amount, e.count])).toEqual([["2026-10-08", "zepto", 10000, 2], ["2026-11-01", "zepto", 10000, 2]]);
    expect(k.rows("item_events").map((e) => [e.kind, e.product, e.product_id, e.order_ref, e.price, e.tag])).toEqual([
      ["purchase", "Aashirvaad Select", "p1", "Z1", 520, "counted"], ["purchase", "Aashirvaad Select", "p1", "Z2", null, "counted"]]);
    expect(k.rows("items")[0]).toMatchObject({ item: "atta", usual_amount: 10000, lasts_days: 24, last_bought: "2026-11-01", confident: 1 });
    expect(k.rows("items")[0]).toMatchObject({ name: "atta", group: "monthly", unit: "g", product: "Aashirvaad Select", app: "zepto", run_out: "2026-11-25" });
    // An item with its product id is remembered as that app's product, under the family's word for it.
    expect(k.rows("products")).toEqual([expect.objectContaining({ item: "atta", app: "zepto", product_id: "p1", name_on_app: "Aashirvaad Select", pack: "5 kg", pack_amount: 5, pack_unit: "kg" })]);
    expect(r).toMatchObject({ duplicates: 0, skipped_old: 0, needs_group: [], suggestions: [], probably_out: [] });
  });

  it("the same order imported twice is recorded once (order_ref; else date and product)", async () => {
    const k = await start();
    await atta(k);
    expect(await atta(k)).toMatchObject({ recorded: 0, duplicates: 2 });
    expect(k.rows("item_events")).toHaveLength(2);
    // Without an order_ref: the same app, date and product id (or product name) is the same purchase.
    const noRef = { app: "zepto", orders: [{ date: "2026-11-10", items: [{ item: "toor dal", product_id: "d1", pack: "1 kg" }, { item: "ghee", product: "Amul Ghee", pack: "1 l" }] }] };
    expect(await k.op("import_order_history", noRef)).toMatchObject({ recorded: 2, duplicates: 0 });
    expect(await k.op("import_order_history", noRef)).toMatchObject({ recorded: 0, duplicates: 2 });
    // Another product the same day, or the same order on another app, is another purchase.
    expect(await k.op("import_order_history", { app: "zepto", orders: [{ date: "2026-11-10", items: [{ item: "toor dal", product_id: "d2", pack: "1 kg" }] }] })).toMatchObject({ recorded: 1 });
    expect(await k.op("import_order_history", { app: "blinkit", orders: [{ date: "2026-11-01", order_ref: "Z2", items: [{ item: "atta", pack: "5 kg" }] }] })).toMatchObject({ recorded: 1 });
    // One item twice in one order (two packs) is one purchase of both.
    const two = { app: "zepto", orders: [{ date: "2026-11-15", order_ref: "Z3", items: [{ item: "rice", pack: "5 kg" }, { item: "Rice", pack: "1 kg", count: 2 }] }] };
    expect(await k.op("import_order_history", two)).toMatchObject({ recorded: 1, duplicates: 0 });
    expect(events(k, "rice").map((e) => [e.amount, e.count])).toEqual([[7000, 3]]);
    expect(await k.op("import_order_history", two)).toMatchObject({ recorded: 0, duplicates: 1 });
    expect(k.rows("item_events")).toHaveLength(7);
  });

  // Review Focus 1: the same purchase arrives twice, in either order, with and without its ref.
  it("a purchase recorded without its ref and then imported with it (or the other way round) is one purchase; the ref is learned", async () => {
    const k = await start();
    const db = k.kit.db;
    const zepto = { item: "atta", date: "2026-11-10", app: "zepto" as const, product: "Aashirvaad Select", product_id: "p1", amount: 10, unit: "kg" };
    // Ref-less first (an order recorded as placed), then the history with its ref.
    expect("event_id" in recordPurchase(db, zepto)).toBe(true);
    expect(await k.op("import_order_history", { app: "zepto", orders: [{ date: "2026-11-10", order_ref: "Z9", items: [{ item: "atta", product: "Aashirvaad Select", product_id: "p1", pack: "10 kg" }] }] }))
      .toMatchObject({ recorded: 0, duplicates: 1 });
    expect(events(k, "atta").map((e) => e.order_ref)).toEqual(["Z9"]);
    // Learned: the same ref is caught by ref now, even on another date.
    expect(recordPurchase(db, { ...zepto, date: "2026-11-11", order_ref: "Z9" })).toEqual({ duplicate: true });
    // A different ref the same day is another order.
    expect("event_id" in recordPurchase(db, { ...zepto, order_ref: "Z10" })).toBe(true);
    // Ref first, then ref-less: the same date and product.
    await k.op("import_order_history", { app: "zepto", orders: [{ date: "2026-11-12", order_ref: "Z11", items: [{ item: "dal", product: "Tata Sampann Toor Dal", product_id: "d1", pack: "1 kg" }] }] });
    expect(recordPurchase(db, { item: "dal", date: "2026-11-12", app: "zepto", product_id: "d1", amount: 1, unit: "kg" })).toEqual({ duplicate: true });
    // product_id against a name: an event with a product_id is matched by a line with the product's name only (any capitals).
    expect(await k.op("import_order_history", { app: "zepto", orders: [{ date: "2026-11-12", items: [{ item: "dal", product: "tata sampann toor dal", pack: "1 kg" }] }] }))
      .toMatchObject({ recorded: 0, duplicates: 1 });
    // Two product ids that differ are two products, whatever the names.
    expect("event_id" in recordPurchase(db, { item: "dal", date: "2026-11-12", app: "zepto", product: "Tata Sampann Toor Dal", product_id: "d2", amount: 1, unit: "kg" })).toBe(true);
    expect(k.rows("item_events")).toHaveLength(4);
  });

  it("orders older than 3 months are skipped, and history_synced moves to the newest order", async () => {
    const k = await start();
    // 3 months back is 21 Aug: an order that day is read, one the day before is not.
    const r = await k.op("import_order_history", { app: "zepto", orders: [
      { date: "2026-08-20", items: [{ item: "sugar", pack: "1 kg" }] },
      { date: "2026-08-21", items: [{ item: "sugar", pack: "1 kg" }] },
      { date: "2026-11-01", items: [{ item: "salt", pack: "1 kg" }] }] });
    expect(r).toMatchObject({ recorded: 2, skipped_old: 1 });
    expect(k.rows("item_events").map((e) => e.date)).toEqual(["2026-08-21", "2026-11-01"]);
    expect(JSON.parse(house(k).history_synced)).toEqual({ zepto: "2026-11-01" });
    // An older history later does not move it back; another app has its own date.
    await k.op("import_order_history", { app: "zepto", orders: [{ date: "2026-10-01", items: [{ item: "salt", pack: "1 kg" }] }] });
    await k.op("import_order_history", { app: "Swiggy Instamart", orders: [{ date: "2026-11-19", items: [{ item: "salt", pack: "1 kg" }] }] });
    expect((await k.owner("GET", "/api/family")).body.house.history_synced).toEqual({ zepto: "2026-11-01", "swiggy-instamart": "2026-11-19" });
    // A history of only old orders records nothing and leaves the date as it was.
    expect(await k.op("import_order_history", { app: "zepto", orders: [{ date: "2026-05-01", items: [{ item: "salt", pack: "1 kg" }] }] })).toMatchObject({ recorded: 0, skipped_old: 1 });
    expect(JSON.parse(house(k).history_synced).zepto).toBe("2026-11-01");
  });

  it("an item new to the app without a group is saved and listed in needs_group; it is never asked about", async () => {
    const k = await start();
    const r = await buys(k, "Coriander", undefined, "100 g", ["2026-10-20", "2026-10-25", "2026-10-30"]);
    expect(r.needs_group).toEqual(["Coriander"]);
    expect(item(k, "coriander")).toMatchObject({ name: "Coriander", group: null, confident: 1, run_out: "2026-11-04" });
    // Past its run-out and confident, yet not asked, and not raised as probably out.
    expect(r.probably_out).toEqual([]);
    expect(pickAsks(itemStates(k.kit.db, TODAY), TODAY)).toEqual([]);
    // A group given later in a history does not ask again; one set on the item makes it an item like any other.
    expect((await buys(k, "coriander", "few_days", "100 g", ["2026-11-04"])).needs_group).toEqual([]);
    expect(item(k, "coriander").group).toBe("few_days");
    expect(pickAsks(itemStates(k.kit.db, TODAY), TODAY).map((i) => i.name)).toEqual(["Coriander"]);
    // An item that has its group is never listed.
    expect((await buys(k, "coriander", undefined, "100 g", ["2026-11-09"])).needs_group).toEqual([]);
  });

  it("a 'pack' that has no size is kept as a purchase with no amount", async () => {
    const k = await start();
    const r = await k.op("import_order_history", { app: "bigbasket", orders: [
      { date: "2026-11-10", items: [{ item: "bread", group: "daily", pack: "1 pack" }] },
      { date: "2026-11-13", items: [{ item: "bread", count: 2 }] },
      { date: "2026-11-16", items: [{ item: "bread", pack_amount: 400, pack_unit: "g", count: 2 }] }] });
    expect(r.recorded).toBe(3);
    expect(events(k, "bread").map((e) => [e.kind, e.amount, e.count])).toEqual([["purchase", null, 1], ["purchase", null, 2], ["purchase", 800, 2]]);
    // Gaps alone make its pattern until a sized purchase comes.
    expect(item(k, "bread")).toMatchObject({ unit: "g", last_bought: "2026-11-16", lasts_days: 3, confident: 1 });
  });

  // Review Focus 3: one item in mixed units.
  it("an amount that cannot be put in the item's unit is kept as a one-off with its words, never a cycle; kg and g compare", async () => {
    const k = await start();
    await k.op("import_order_history", { app: "zepto", orders: [
      { date: "2026-10-01", items: [{ item: "eggs", group: "few_days", pack: "12 pc" }] },
      { date: "2026-10-08", items: [{ item: "eggs", pack: "500 g" }] },
      { date: "2026-10-15", items: [{ item: "eggs", pack: "6 pcs", count: 2 }] },
      { date: "2026-10-01", items: [{ item: "atta", group: "monthly", pack: "10 kg" }] },
      { date: "2026-10-25", items: [{ item: "atta", pack_amount: 5000, pack_unit: "g", count: 2 }] }] });
    expect(events(k, "eggs").map((e) => [e.amount, e.note, e.tag, e.cycle_days])).toEqual([[12, null, "counted", null], [null, "500 g", "one_off", null], [12, null, "counted", 7]]);
    expect(item(k, "eggs")).toMatchObject({ unit: "pc", usual_amount: 12, lasts_days: 7 });
    expect(item(k, "atta")).toMatchObject({ unit: "g", usual_amount: 10000, lasts_days: 24 });
    // Its unit stays once it has amounts in it.
    expect((await k.op("set_item", { item: "eggs", unit: "g" })).code).toBe("APP_REFUSED");
    expect((await k.op("set_item", { item: "eggs", unit: "pcs" })).item.unit).toBe("pc");
  });

  it("suggests everyday items from the daily items of the call only; probably_out names what has likely run out", async () => {
    const k = await start();
    const dates = ["2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"];
    const r = await k.op("import_order_history", { app: "zepto", orders: [
      ...dates.map((date) => ({ date, items: [{ item: "Milk", group: "daily", pack: "500 ml", count: 2 }, { item: "chips", group: "few_days", pack: "50 g" }] })),
      { date: "2026-09-24", items: [{ item: "ghee", group: "monthly", pack: "1 l" }] },
      { date: "2026-08-25", items: [{ item: "ghee", group: "monthly", pack: "1 l" }] },
      { date: "2026-10-01", items: [{ item: "toor dal", group: "monthly", pack: "1 kg" }] },
      { date: "2026-10-31", items: [{ item: "toor dal", group: "monthly", pack: "1 kg" }] }] });
    expect(r.suggestions).toEqual([{ item: "milk", amount: 2, unit: "500 ml", every: "day", orders_seen: 4 }]);
    // Ghee: bought 24 Sep, lasts 30 days, ran out 24 Oct. Toor dal runs out 30 Nov. Milk is daily, and chips run out tomorrow.
    expect(r.probably_out).toEqual([{ item: "ghee", days_ago: 58 }]);
    expect(k.rows("regulars")).toEqual([]);
  });

  it("the newest order's product is the one remembered for an item, whatever the order the history came in", async () => {
    const k = await start();
    await k.op("import_order_history", { app: "zepto", orders: [
      { date: "2026-11-05", items: [{ item: "Milk", product: "Amul Taaza", product_id: "z-new", pack: "500 ml", price: 29 }] },
      { date: "2026-10-05", items: [{ item: "milk", product: "Amul Gold", product_id: "z-old", pack: "1 l", image: "https://img.example/old.jpg" }] },
      { date: "2026-11-06", items: [{ item: "coriander" }] }] });
    expect(k.rows("products")).toEqual([expect.objectContaining({ item: "milk", product_id: "z-new", name_on_app: "Amul Taaza", pack: "500 ml", pack_amount: 500, pack_unit: "ml", price: 29, image: null })]);
  });

  it("refuses a history it cannot read, and records none of it; Amazon's history is taken", async () => {
    const k = await start();
    const good = { date: "2026-10-01", items: [{ item: "Milk", product_id: "z-1" }] };
    for (const bad of [{ app: "walmart", orders: [good] }, { orders: [good] }, { app: "zepto" }, { app: "zepto", orders: [{ ...good, date: "last week" }] },
      { app: "zepto", orders: [good, { date: "2026-10-02" }] }, { app: "zepto", orders: [good, { date: "2026-10-02", items: [{ count: 1 }] }] },
      { app: "zepto", orders: [good, { date: "2026-10-02", items: [{ item: "Curd", count: "two" }] }] },
      { app: "zepto", orders: [good, { date: "2026-10-02", items: [{ item: "Curd", count: 0 }] }] },
      { app: "zepto", orders: [good, { date: "2026-10-02", items: [{ item: "Curd", product_id: "z-2", price: "40" }] }] },
      { app: "zepto", orders: [good, { date: "2026-10-02", items: [{ item: "Curd", group: "weekly" }] }] },
      { app: "zepto", orders: [good, { date: "2026-10-02", items: [{ item: "Curd", pack_amount: 400 }] }] }])
      expect([bad, (await k.op("import_order_history", bad)).code]).toEqual([bad, "APP_REFUSED"]);
    for (const t of ["items", "item_events", "products"]) expect(k.rows(t)).toEqual([]);
    expect(await k.op("import_order_history", { app: "zepto", orders: [] })).toMatchObject({ recorded: 0, suggestions: [] });
    const r = await k.op("import_order_history", { app: "Amazon Fresh", orders: [{ date: "2026-11-01", order_ref: "A1", items: [{ item: "ghee", product: "Amul Ghee 1 L", product_id: "B0X", pack: "1 l" }] }] });
    expect(r.recorded).toBe(1);
    expect(k.rows("item_events")[0]).toMatchObject({ app: "amazon", amount: 1000 });
    expect(k.rows("products")).toEqual([expect.objectContaining({ item: "ghee", app: "amazon", product_id: "B0X" })]);
  });
});

describe("subscriptions, answers, outside purchases", () => {
  it("set_subscription leaves the item out of the Pantry and off open carts; active false brings it back", async () => {
    const k = await start();
    await buys(k, "milk", "daily", "500 ml", ["2026-11-19", "2026-11-20"]);
    const milk = item(k, "milk");
    const cart = (status: string) => k.kit.db.insert(orders).values({ app: "zepto", status }).returning().get();
    const open = cart("open"), ordering = cart("ordering");
    for (const o of [open, ordering]) k.kit.db.insert(order_lines).values({ order_id: o.id, item_id: milk.id, item: "milk", qty: 2, source: "everyday" }).run();
    k.kit.db.insert(order_lines).values({ order_id: open.id, item: "bread", qty: 1, source: "added" }).run();
    expect((await k.owner("GET", "/api/pantry")).body.rows.map((r: any) => r.name)).toEqual(["milk"]);

    const r = await k.op("set_subscription", { item: "Milk", source: "Country Delight", active: true });
    expect(r.item).toMatchObject({ item: "milk", subscription: "Country Delight" });
    expect(item(k, "milk").subscription).toBe("Country Delight");
    // Off the open cart; the cart already being ordered is left as it is, and so is the rest of the open cart.
    expect(k.rows("order_lines").map((l) => [l.order_id === open.id ? "open" : "ordering", l.item])).toEqual([["ordering", "milk"], ["open", "bread"]]);
    expect((await k.owner("GET", "/api/pantry")).body).toMatchObject({ counts: { all: 0 }, rows: [] });
    // A new item is made, in the daily group.
    await k.op("set_subscription", { item: "Eggs", source: "the milkman", active: true });
    expect(item(k, "eggs")).toMatchObject({ name: "Eggs", group: "daily", subscription: "the milkman" });

    await k.op("set_subscription", { item: "milk", source: "Country Delight", active: false });
    expect(item(k, "milk").subscription).toBe(null);
    expect((await k.owner("GET", "/api/pantry")).body.rows.map((r: any) => r.name)).toEqual(["milk"]);
    // Refused: no source to start one, a yes/no that is not one; ending one that is not there is a 404.
    for (const bad of [{ item: "curd", active: true }, { item: "curd", source: "Amul", active: "yes" }, { source: "Amul", active: true }])
      expect([bad, (await k.op("set_subscription", bad)).code]).toEqual([bad, "APP_REFUSED"]);
    expect((await k.op("set_subscription", { item: "paneer", source: "x", active: false })).status).toBe(404);
    expect(item(k, "curd")).toBeUndefined();
  });

  it("answer_running_low: low resets and counts confirmed; 'fine for a week' snoozes 7 days and is one cycle; 'still have it' snoozes the group default and counts a miss", async () => {
    const k = await start();
    await atta(k);
    await buys(k, "toor dal", "monthly", "1 kg", ["2026-10-01", "2026-10-31"]);
    await buys(k, "bhindi", "few_days", "500 g", ["2026-11-14", "2026-11-18"]);
    await buys(k, "ghee", "monthly", "1 l", ["2026-09-24", "2026-10-24"]);
    k.kit.sqlite.run("UPDATE items SET asks_unanswered = 1");
    k.kit.sqlite.run("UPDATE items SET misses_in_row = 1, wait_factor = 1.25 WHERE item = 'ghee'");

    const r = await k.op("answer_running_low", { answers: [
      { item: "Atta", answer: "in_stock" }, { item: "bhindi", answer: "in_stock" },
      { item: "toor dal", answer: "in_stock", days: 7 }, { item: "ghee", answer: "low" }] });
    expect(r.to_cart).toEqual(["ghee"]);

    // Monthly: 5 days; a miss; the pattern is unchanged (an answer without days is no cycle).
    expect(item(k, "atta")).toMatchObject({ snoozed_until: "2026-11-26", misses_in_row: 1, lasts_days: 24, asks_unanswered: 0 });
    expect(events(k, "atta").at(-1)).toMatchObject({ kind: "answer", date: TODAY, days: null, tag: "not_counted" });
    // Few days: 1 day.
    expect(item(k, "bhindi")).toMatchObject({ snoozed_until: "2026-11-22", misses_in_row: 1 });
    // Fine for a week: snoozed 7 days, and one cycle of 21 + 7 = 28 days beside the 30 bought.
    expect(item(k, "toor dal")).toMatchObject({ snoozed_until: "2026-11-28", misses_in_row: 0, lasts_days: 29, asks_unanswered: 0 });
    expect(events(k, "toor dal").at(-1)).toMatchObject({ kind: "answer", days: 7, tag: "your_answer", cycle_days: 28 });
    // Low: misses and wait back to the start, asks reset, no event.
    expect(item(k, "ghee")).toMatchObject({ misses_in_row: 0, wait_factor: 1, asks_unanswered: 0, snoozed_until: null });
    expect(events(k, "ghee").map((e) => e.kind)).toEqual(["purchase", "purchase"]);
    expect(house(k)).toMatchObject({ asks_confirmed: 1, asks_still_have: 3 });

    // Refused whole, nothing written: an item not there, an answer not one of the two, days that are not a number above 0.
    for (const bad of [{ answers: [{ item: "paneer", answer: "low" }] }, { answers: [{ item: "atta", answer: "finished" }] },
      { answers: [{ item: "ghee", answer: "low" }, { item: "atta", answer: "in_stock", days: 0 }] }, { answers: [] }, {}])
      expect([bad, (await k.op("answer_running_low", bad)).code]).toEqual([bad, "APP_REFUSED"]);
    expect(house(k)).toMatchObject({ asks_confirmed: 1, asks_still_have: 3 });
  });

  it("two 'still have it' in a row make the next ask wait longer (wait factor 1.25)", async () => {
    const k = await start();
    await atta(k);
    const still = () => k.op("answer_running_low", { answers: [{ item: "atta", answer: "in_stock" }] });
    await still();
    expect(item(k, "atta")).toMatchObject({ misses_in_row: 1, wait_factor: 1, run_out: "2026-11-25" });
    await still();
    // 24 days × 1.25 = 30 from 1 Nov.
    expect(item(k, "atta")).toMatchObject({ misses_in_row: 0, wait_factor: 1.25, run_out: "2026-12-01" });
    for (let i = 0; i < 6; i++) await still();
    expect(item(k, "atta").wait_factor).toBe(2);
    // A "fine for N days" is no miss and breaks the run.
    await still();
    await k.op("answer_running_low", { answers: [{ item: "atta", answer: "in_stock", days: 3 }] });
    expect(item(k, "atta").misses_in_row).toBe(0);
    expect(house(k).asks_still_have).toBe(10);
  });

  it("record_bought_outside is a purchase of the usual amount from outside", async () => {
    const k = await start();
    await atta(k);
    const r = await k.op("record_bought_outside", { item: "Atta" });
    expect(r.event_id).toBeString();
    expect(events(k, "atta").at(-1)).toMatchObject({ kind: "purchase", app: "outside", date: TODAY, amount: 10000, product: null, tag: "early_buy" });
    // It restarts the item: bought today, its run-out from today.
    expect(item(k, "atta")).toMatchObject({ last_bought: TODAY, app: "zepto", asks_unanswered: 0 });
    // The same day again is the same purchase.
    expect((await k.op("record_bought_outside", { item: "atta", date: TODAY })).duplicate).toBe(true);
    // An item the app has never seen is made, with no amount; a date is taken.
    await k.op("record_bought_outside", { item: "coriander", date: "2026-11-20" });
    expect(events(k, "coriander")).toEqual([expect.objectContaining({ app: "outside", date: "2026-11-20", amount: null })]);
    for (const bad of [{}, { item: "atta", date: "yesterday" }]) expect((await k.op("record_bought_outside", bad)).code).toBe("APP_REFUSED");
  });
});

describe("set_item", () => {
  it("sets the group, snooze, don't-ask and unit; the Pantry's Snooze goes through it", async () => {
    const k = await start();
    await atta(k);
    const r = await k.op("set_item", { item: "atta", group: "few_days", dont_ask: true });
    expect(r.item).toMatchObject({ item: "atta", group: "few_days", dont_ask: 1 });
    expect((await k.owner("POST", "/api/items", { item: "atta", snooze_days: 3 })).body.item).toMatchObject({ snoozed_until: "2026-11-24", updated_by: "user:tester" });
    expect((await k.op("set_item", { item: "atta", snooze_days: null })).item.snoozed_until).toBe(null);
    // A new item is made; a unit is kept as its base unit.
    expect((await k.op("set_item", { item: "Oil", group: "monthly", unit: "l" })).item).toMatchObject({ name: "Oil", group: "monthly", unit: "ml" });
    for (const bad of [{ item: "atta", group: "weekly" }, { item: "atta", unit: "pack" }, { item: "atta", snooze_days: -1 }, { item: "atta", dont_ask: "yes" }, { group: "daily" }])
      expect([bad, (await k.op("set_item", bad)).code]).toEqual([bad, "APP_REFUSED"]);
  });

  it("an item that follows the plan runs out when the final plan's amounts use up what was bought", async () => {
    const k = await start();
    await buys(k, "paneer", "few_days", "500 g", ["2026-11-18"]);
    expect(item(k, "paneer").run_out).toBe(null);
    const dish = (date: string, status: string, amount: number, unit: string) => {
      const meal = k.kit.db.insert(plan_meals).values({ date, slot: "Dinner", status }).returning().get();
      const d = k.kit.db.insert(dishes).values({ meal_id: meal.id, name: "palak paneer" }).returning().get();
      k.kit.db.insert(dish_items).values({ dish_id: d.id, item: "Paneer", amount, unit }).run();
    };
    dish("2026-11-22", "final", 300, "g");
    dish("2026-11-23", "draft", 300, "g");
    dish("2026-11-24", "final", 0.3, "kg");
    await k.op("set_item", { item: "paneer", follows_plan: true });
    expect(item(k, "paneer")).toMatchObject({ follows_plan: 1, run_out: "2026-11-24" });
    await k.op("set_item", { item: "paneer", follows_plan: false });
    expect(item(k, "paneer").run_out).toBe(null);
  });
});

describe("the Pantry and the item page", () => {
  it("the Pantry lists each item with its usual quantity and status, never the app; its counts add up", async () => {
    const k = await start();
    await atta(k);                                                                            // runs out 25 Nov: in stock
    await buys(k, "toor dal", "monthly", "1 kg", ["2026-09-01", "2026-10-01"]);              // ran out 31 Oct: low
    await buys(k, "bhindi", "few_days", "500 g", ["2026-11-14", "2026-11-18"]);              // snoozed below
    await buys(k, "eggs", "daily", "12 pc", ["2026-11-15", "2026-11-19"]);                   // on a cart as low
    await buys(k, "milk", "daily", "1 l", ["2026-11-19", "2026-11-20"]);                     // subscribed: not listed
    await k.op("set_item", { item: "bhindi", snooze_days: 2 });
    await k.op("set_subscription", { item: "milk", source: "Country Delight", active: true });
    const cart = k.kit.db.insert(orders).values({ app: "zepto", status: "open" }).returning().get();
    k.kit.db.insert(order_lines).values({ order_id: cart.id, item_id: item(k, "eggs").id, item: "eggs", qty: 0, source: "low" }).run();

    const pantry = (await k.owner("GET", "/api/pantry")).body;
    expect(pantry.rows.map((r: any) => [r.name, r.quantity, r.status])).toEqual([
      ["atta", "10 kg", "In stock"], ["bhindi", "500 g", "Snoozed"], ["eggs", "12 pc", "Low"], ["toor dal", "1 kg", "Low"]]);
    expect(pantry.rows[0]).toEqual({ id: item(k, "atta").id, name: "atta", quantity: "10 kg", status: "In stock" });
    expect(pantry.counts).toEqual({ all: 4, in_stock: 1, low: 2, snoozed: 1 });
    expect(pantry.counts.in_stock + pantry.counts.low + pantry.counts.snoozed).toBe(pantry.counts.all);
    expect(JSON.stringify(pantry)).not.toMatch(/zepto|Zepto/);
  });

  it("an item's page shows its pattern and what it was learned from, tagged", async () => {
    const k = await start();
    const buy = (date: string, kg: number, ref: string) => ({ date, order_ref: ref, items: [{ item: "atta", group: "monthly", product: "Aashirvaad Select", product_id: "p1", pack_amount: kg, pack_unit: "kg", price: kg * 52 }] });
    await k.op("import_order_history", { app: "zepto", orders: [buy("2026-08-25", 10, "a"), buy("2026-09-18", 10, "b"), buy("2026-10-10", 10, "c"), buy("2026-10-20", 2, "d")] });
    await k.op("answer_running_low", { answers: [{ item: "atta", answer: "in_stock", days: 7 }] });
    const id = item(k, "atta").id;
    const page = (await k.owner("GET", `/api/items/${id}`)).body;
    // Cycles 24 (counted), 22 (early buy), 42 + 7 (her answer): about 24 days, 10 kg / 24 = 0.4 kg a day. The price is the
    // last usual purchase's, not the 2 kg one-off's.
    expect(page.item).toMatchObject({ name: "atta", group: "monthly", product: "Aashirvaad Select", usual: "10 kg", lasts_days: 24, uses: "0.4 kg a day",
      price: 520, status: "Snoozed", snoozed_until: "2026-11-28", follows_plan: false });
    expect(page.events.map((e: any) => [e.when, e.tag])).toEqual([
      [TODAY, "your answer"], ["2026-10-20", "one-off, not counted"], ["2026-10-10", "early buy"], ["2026-09-18", "counted"], ["2026-08-25", "counted"]]);
    expect(page.events.map((e: any) => e.what)).toEqual(["Fine for 7 more days", "Aashirvaad Select, 2 kg", "Aashirvaad Select, 10 kg", "Aashirvaad Select, 10 kg", "Aashirvaad Select, 10 kg"]);
    expect(JSON.stringify(page)).not.toMatch(/zepto|Zepto|app/);
    expect((await k.owner("GET", "/api/items/nope")).status).toBe(404);
  });
});
