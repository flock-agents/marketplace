// Items: order histories recorded as purchases (every app, 3 months back, never twice), subscriptions, her answers to
// "still in stock?", purchases outside the apps, and the Pantry and item page reads. Today is pinned: Saturday 21 Nov 2026.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { dish_items, dishes, order_lines, orders, plan_meals } from "./db/schema";
import { pickAsks } from "./estimate";
import { itemStates, recordPurchase } from "./items";

const TODAY = "2026-11-21";
/** The agent the tests call as (testkit op), as the app stamps it. */
const ME = "agent:meal-agent";
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
    expect(r).toMatchObject({ duplicates: 0, skipped_old: 0, skipped_future: 0, needs_group: [], probably_out: [], read_until: "2026-11-01" });
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
    expect(JSON.parse(house(k).history_synced)).toEqual({ zepto: { [ME]: "2026-11-01" } });
    expect(r.read_until).toBe("2026-11-01");
    // An older history later does not move it back; another app has its own date.
    await k.op("import_order_history", { app: "zepto", orders: [{ date: "2026-10-01", items: [{ item: "salt", pack: "1 kg" }] }] });
    await k.op("import_order_history", { app: "Swiggy Instamart", orders: [{ date: "2026-11-19", items: [{ item: "salt", pack: "1 kg" }] }] });
    expect((await k.owner("GET", "/api/family")).body.house.history_synced).toEqual({ zepto: { [ME]: "2026-11-01" }, "swiggy-instamart": { [ME]: "2026-11-19" } });
    // A history of only old orders records nothing and leaves the date as it was.
    expect(await k.op("import_order_history", { app: "zepto", orders: [{ date: "2026-05-01", items: [{ item: "salt", pack: "1 kg" }] }] })).toMatchObject({ recorded: 0, skipped_old: 1 });
    expect(JSON.parse(house(k).history_synced).zepto[ME]).toBe("2026-11-01");
  });

  // Final review I4: history goes oldest first, and the mark never passes today, so an import cut short reads on from where it stopped.
  it("an order dated after today is skipped and counted, and history_synced never passes today", async () => {
    const k = await start();
    const r = await k.op("import_order_history", { app: "zepto", orders: [
      { date: "2026-11-10", items: [{ item: "salt", pack: "1 kg" }] },
      { date: "2026-12-01", items: [{ item: "sugar", pack: "1 kg" }] },
      { date: "2026-08-01", items: [{ item: "salt", pack: "1 kg" }] }] });
    expect(r).toMatchObject({ recorded: 1, skipped_old: 1, skipped_future: 1 });
    expect(k.rows("item_events").map((e) => e.date)).toEqual(["2026-11-10"]);
    expect(JSON.parse(house(k).history_synced)).toEqual({ zepto: { [ME]: "2026-11-10" } });
    // Only a future order: nothing recorded, the mark stays.
    expect(await k.op("import_order_history", { app: "zepto", orders: [{ date: "2027-01-05", items: [{ item: "salt", pack: "1 kg" }] }] }))
      .toMatchObject({ recorded: 0, skipped_old: 0, skipped_future: 1 });
    expect(JSON.parse(house(k).history_synced)).toEqual({ zepto: { [ME]: "2026-11-10" } });
    // Today's order is read.
    expect(await k.op("import_order_history", { app: "zepto", orders: [{ date: TODAY, items: [{ item: "salt", pack: "1 kg" }] }] })).toMatchObject({ recorded: 1, skipped_future: 0 });
    expect(JSON.parse(house(k).history_synced)).toEqual({ zepto: { [ME]: TODAY } });
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

  it("an import suggests no everyday items: the cycle is worked out, with nothing to confirm; probably_out names what has likely run out", async () => {
    const k = await start();
    const dates = ["2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"];
    const r = await k.op("import_order_history", { app: "zepto", orders: [
      ...dates.map((date) => ({ date, items: [{ item: "Milk", group: "daily", pack: "500 ml", count: 2 }, { item: "chips", group: "few_days", pack: "50 g" }] })),
      { date: "2026-09-24", items: [{ item: "ghee", group: "monthly", pack: "1 l" }] },
      { date: "2026-08-25", items: [{ item: "ghee", group: "monthly", pack: "1 l" }] },
      { date: "2026-10-01", items: [{ item: "toor dal", group: "monthly", pack: "1 kg" }] },
      { date: "2026-10-31", items: [{ item: "toor dal", group: "monthly", pack: "1 kg" }] }] });
    expect(r.suggestions).toBeUndefined();
    expect(item(k, "milk")).toMatchObject({ group: "daily", usual_amount: 1000, lasts_days: 1, confident: 1 });
    // Ghee: bought 24 Sep, lasts 30 days, ran out 24 Oct. Toor dal runs out 30 Nov. Milk is daily, and chips run out tomorrow.
    expect(r.probably_out).toEqual([{ item: "ghee", days_ago: 58 }]);
    // What the house buys most often, in a line the setup reads back: only what is bought within about ten days.
    expect(r.said).toBe("chips (50 g every day), Milk (1 l every day)");
  });

  // The owner, 21 Nov: more than one person orders for the house, each on their own account of the same app.
  it("two people's agents import their own accounts of one app: nothing is skipped or counted twice, and one cycle per item comes of both", async () => {
    const k = await start();
    const milk = (date: string, ref: string) => ({ date, order_ref: ref, items: [{ item: "milk", group: "daily", product: "Amul Taaza", product_id: "m1", pack: "500 ml", count: 2 }] });
    // Shiva's Zepto: milk on the odd days, and the eggs of the 8th. His agent reads up to the 20th.
    const shiva = await k.op("import_order_history", { app: "zepto", orders: [milk("2026-11-15", "S-15"), milk("2026-11-17", "S-17"), milk("2026-11-19", "S-19"),
      { date: "2026-11-08", order_ref: "S-08", items: [{ item: "eggs", group: "few_days", pack: "30 pc" }] },
      { date: "2026-11-20", order_ref: "S-20", items: [{ item: "bread", group: "few_days", pack: "400 g" }] }] }, "shiva-agent");
    expect(shiva).toMatchObject({ recorded: 5, duplicates: 0, read_until: "2026-11-20" });
    // By his orders alone the milk is bought every two days.
    expect(item(k, "milk")).toMatchObject({ lasts_days: 2, last_bought: "2026-11-19" });
    // Meera's Zepto, read later by her own agent: older orders than his newest, all of them hers. None is skipped for being
    // before what his agent read, and an order on the same day as one of his (the 15th, another ref) is its own purchase.
    const meera = await k.op("import_order_history", { app: "zepto", orders: [milk("2026-11-14", "M-14"), milk("2026-11-15", "M-15"), milk("2026-11-16", "M-16"), milk("2026-11-18", "M-18"),
      { date: "2026-11-15", order_ref: "M-15", items: [{ item: "eggs", group: "few_days", pack: "30 pc" }] }] }, "meera-agent");
    expect(meera).toMatchObject({ recorded: 5, duplicates: 0, skipped_old: 0, read_until: "2026-11-18" });
    // One estimate for the house from both accounts: milk on the 14th to the 19th, so every day; eggs every 7 days.
    expect(events(k, "milk").map((e) => e.date).sort()).toEqual(["2026-11-14", "2026-11-15", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19"]);
    expect(item(k, "milk")).toMatchObject({ lasts_days: 1, usual_amount: 1000, last_bought: "2026-11-19", run_out: "2026-11-20" });
    expect(item(k, "eggs")).toMatchObject({ lasts_days: 7, last_bought: "2026-11-15", run_out: "2026-11-22" });
    expect((await k.owner("GET", "/api/pantry")).body.rows.map((r: any) => [r.name, r.cycle])).toEqual([["bread", null], ["eggs", "30 pc about once a week"], ["milk", "1 l every day"]]);
    // Each agent's reading is its own: hers did not move his, and his did not make hers look read.
    expect(JSON.parse(house(k).history_synced)).toEqual({ zepto: { "agent:shiva-agent": "2026-11-20", "agent:meera-agent": "2026-11-18" } });
    // Either sending an order again (its own, or one the other already gave) records nothing twice.
    expect(await k.op("import_order_history", { app: "zepto", orders: [milk("2026-11-19", "S-19"), milk("2026-11-18", "M-18")] }, "meera-agent")).toMatchObject({ recorded: 0, duplicates: 2 });
    expect(events(k, "milk")).toHaveLength(7);
    // A date kept before readers were told apart reads as nobody's in particular.
    k.kit.sqlite.run(`UPDATE house SET history_synced = '{"zepto":"2026-11-10"}'`);
    expect((await k.owner("GET", "/api/family")).body.house.history_synced).toEqual({ zepto: { "*": "2026-11-10" } });
  });

  // 21 Nov: one agent (the family group's) holds two accounts of one app, "Zepto (Shiva)" and "Zepto (Ankita)".
  it("one agent reading two accounts of one app keeps each account's reading apart (an account not read yet starts 3 months back), and never merges two accounts' unreffed orders", async () => {
    const k = await start();
    const BUTLER = "agent:butler";
    const synced = () => JSON.parse(house(k).history_synced);
    const milk = (date: string, ref?: string) => ({ date, ...(ref ? { order_ref: ref } : {}), items: [{ item: "milk", group: "daily", product: "Amul Taaza", product_id: "m1", pack: "500 ml", count: 2 }] });
    const read = (account: string | undefined, orders: unknown[]) => k.op("import_order_history", { app: "zepto", ...(account ? { account } : {}), orders }, "butler");
    // Before accounts: the agent read Zepto (one account) up to the 12th, under the plain key.
    expect(await read(undefined, [milk("2026-11-10", "S-10"), milk("2026-11-12", "S-12")])).toMatchObject({ recorded: 2, read_until: "2026-11-12" });
    expect(synced()).toEqual({ zepto: { [BUTLER]: "2026-11-12" } });
    // Shiva's account, now named: it has no reading of its own (the plain one never stands in), so its orders are read
    // again from 3 months back; the ones already recorded are duplicates, not new purchases.
    expect(await read("Zepto (Shiva)", [milk("2026-11-10", "S-10"), milk("2026-11-12", "S-12")])).toMatchObject({ recorded: 0, duplicates: 2, read_until: "2026-11-12" });
    expect(synced()).toEqual({ zepto: { [BUTLER]: "2026-11-12" }, "zepto:Zepto (Shiva)": { [BUTLER]: "2026-11-12" } });
    // An older read does not move it back.
    expect(await read("Zepto (Shiva)", [milk("2026-11-10", "S-10")])).toMatchObject({ recorded: 0, duplicates: 1, read_until: "2026-11-12" });
    expect(await read("Zepto (Shiva)", [milk("2026-11-12", "S-12"), milk("2026-11-18", "S-18")])).toMatchObject({ recorded: 1, duplicates: 1, read_until: "2026-11-18" });
    // Ankita's account by the same agent: older dates than both Shiva's newest and the plain reading (the 12th), overlapping
    // his days. All of hers are recorded, and reading it never moves Shiva's.
    expect(await read("Zepto (Ankita)", [milk("2026-11-09", "A-09"), milk("2026-11-14", "A-14"), milk("2026-11-16", "A-16")])).toMatchObject({ recorded: 3, duplicates: 0, skipped_old: 0, read_until: "2026-11-16" });
    expect(synced()).toEqual({ zepto: { [BUTLER]: "2026-11-12" }, "zepto:Zepto (Shiva)": { [BUTLER]: "2026-11-18" }, "zepto:Zepto (Ankita)": { [BUTLER]: "2026-11-16" } });
    // Without an account the agent's plain reading is as it was.
    expect(await read(undefined, [milk("2026-11-12", "S-12")])).toMatchObject({ duplicates: 1, read_until: "2026-11-12" });
    // Re-sends of either account (and an order the other account gave, by its ref) are recorded once; read_until is per account.
    expect(await read("Zepto (Shiva)", [milk("2026-11-18", "S-18"), milk("2026-11-16", "A-16")])).toMatchObject({ recorded: 0, duplicates: 2, read_until: "2026-11-18" });
    expect(await read("  Zepto   (Ankita) ", [milk("2026-11-16", "A-16")])).toMatchObject({ recorded: 0, duplicates: 1, read_until: "2026-11-16" });
    // No order_ref: the same date and product on two accounts are two purchases; the same account sending it again is one.
    expect(await read("Zepto (Shiva)", [milk("2026-11-20")])).toMatchObject({ recorded: 1 });
    expect(await read("Zepto (Ankita)", [milk("2026-11-20")])).toMatchObject({ recorded: 1, duplicates: 0, read_until: "2026-11-20" });
    expect(await read("Zepto (Ankita)", [milk("2026-11-20")])).toMatchObject({ recorded: 0, duplicates: 1 });
    expect(await read("Zepto (Shiva)", [milk("2026-11-20")])).toMatchObject({ recorded: 0, duplicates: 1 });
    // ...and one with no account (from before accounts) still matches either.
    expect(await read(undefined, [milk("2026-11-20")])).toMatchObject({ recorded: 0, duplicates: 1 });
    expect(events(k, "milk").map((e) => [e.date, e.order_ref, e.account]).sort((x, y) => String(x).localeCompare(String(y)))).toEqual([
      ["2026-11-09", "A-09", "Zepto (Ankita)"], ["2026-11-10", "S-10", null], ["2026-11-12", "S-12", null], ["2026-11-14", "A-14", "Zepto (Ankita)"], ["2026-11-16", "A-16", "Zepto (Ankita)"],
      ["2026-11-18", "S-18", "Zepto (Shiva)"], ["2026-11-20", null, "Zepto (Ankita)"], ["2026-11-20", null, "Zepto (Shiva)"]]);
    // All of it is one item and one estimate for the house.
    expect(item(k, "milk")).toMatchObject({ last_bought: "2026-11-20" });
    expect(k.rows("items")).toHaveLength(1);
    // Another agent's reading of an account is its own.
    expect(await k.op("import_order_history", { app: "zepto", account: "Zepto (Ankita)", orders: [milk("2026-11-14", "A-14")] }, "ankita-agent")).toMatchObject({ duplicates: 1, read_until: "2026-11-14" });
    expect(synced()["zepto:Zepto (Ankita)"]).toEqual({ [BUTLER]: "2026-11-20", "agent:ankita-agent": "2026-11-14" });
    // An account that is not a short name is refused, and nothing is recorded.
    for (const account of ["", "   ", "x".repeat(81), { id: 1 }])
      expect([account, (await k.op("import_order_history", { app: "zepto", account, orders: [milk("2026-11-21", "X")] }, "butler")).code]).toEqual([account, "APP_REFUSED"]);
    expect(events(k, "milk")).toHaveLength(8);
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
      { app: "zepto", orders: [good, { date: "2026-10-02", items: [{ item: "Curd", group: "sometimes" }] }] },
      { app: "zepto", orders: [good, { date: "2026-10-02", items: [{ item: "Curd", pack_amount: 400 }] }] }])
      expect([bad, (await k.op("import_order_history", bad)).code]).toEqual([bad, "APP_REFUSED"]);
    for (const t of ["items", "item_events", "products"]) expect(k.rows(t)).toEqual([]);
    expect(await k.op("import_order_history", { app: "zepto", orders: [] })).toMatchObject({ recorded: 0, probably_out: [], read_until: null });
    const r = await k.op("import_order_history", { app: "Amazon Fresh", orders: [{ date: "2026-11-01", order_ref: "A1", items: [{ item: "ghee", product: "Amul Ghee 1 L", product_id: "B0X", pack: "1 l" }] }] });
    expect(r.recorded).toBe(1);
    expect(k.rows("item_events")[0]).toMatchObject({ app: "amazon", amount: 1000 });
    expect(k.rows("products")).toEqual([expect.objectContaining({ item: "ghee", app: "amazon", product_id: "B0X" })]);
  });
});

describe("subscriptions, answers, outside purchases", () => {
  it("set_subscription keeps the item in the Pantry as a Subscription and takes it off open carts; active false brings it back", async () => {
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
    // A subscription is the pantry item's setting: still listed, as "Subscription" with who delivers it, never low.
    expect((await k.owner("GET", "/api/pantry")).body).toMatchObject({ counts: { all: 1, in_stock: 0, low: 0, snoozed: 0, subscription: 1 },
      rows: [{ name: "milk", status: "Subscription", subscription: "Country Delight" }] });
    expect((await k.owner("GET", `/api/items/${milk.id}`)).body.item).toMatchObject({ status: "Subscription", subscription: "Country Delight" });
    // A new item is made, in the daily group.
    await k.op("set_subscription", { item: "Eggs", source: "the milkman", active: true });
    expect(item(k, "eggs")).toMatchObject({ name: "Eggs", group: "daily", subscription: "the milkman" });

    await k.op("set_subscription", { item: "milk", source: "Country Delight", active: false });
    expect(item(k, "milk").subscription).toBe(null);
    expect((await k.owner("GET", "/api/pantry")).body.rows.map((r: any) => [r.name, r.status === "Subscription", r.subscription])).toEqual([["Eggs", true, "the milkman"], ["milk", false, null]]);
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
  it("a group in other words is taken as the nearest one; one it cannot place is refused with what each means", async () => {
    const k = await start();
    expect((await k.op("set_item", { item: "bhindi", group: "weekly" })).item).toMatchObject({ group: "few_days" });
    expect((await k.op("set_item", { item: "milk", group: "Every Day" })).item).toMatchObject({ group: "daily" });
    expect((await k.op("set_item", { item: "shower gel", group: "household" })).item).toMatchObject({ group: "monthly" });
    expect((await k.op("set_item", { item: "atta", group: "sometimes" })).error).toContain("group must be one of: daily (bought every day or two: milk, curd), few_days");
  });

  it("sets the group, snooze, don't-ask and unit; the Pantry's Snooze goes through it", async () => {
    const k = await start();
    await atta(k);
    const r = await k.op("set_item", { item: "atta", group: "few_days", dont_ask: true });
    expect(r.item).toMatchObject({ item: "atta", group: "few_days", dont_ask: 1 });
    expect((await k.owner("POST", "/api/items", { item: "atta", snooze_days: 3 })).body.item).toMatchObject({ snoozed_until: "2026-11-24", updated_by: "user:tester" });
    expect((await k.op("set_item", { item: "atta", snooze_days: null })).item.snoozed_until).toBe(null);
    // A new item is made; a unit is kept as its base unit.
    expect((await k.op("set_item", { item: "Oil", group: "monthly", unit: "l" })).item).toMatchObject({ name: "Oil", group: "monthly", unit: "ml" });
    for (const bad of [{ item: "atta", group: "sometimes" }, { item: "atta", unit: "pack" }, { item: "atta", snooze_days: -1 }, { item: "atta", dont_ask: "yes" }, { group: "daily" }])
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
  it("the Pantry lists each item with its cycle and status, never the app; its counts add up", async () => {
    const k = await start();
    await atta(k);                                                                            // runs out 25 Nov: in stock
    await buys(k, "toor dal", "monthly", "1 kg", ["2026-09-01", "2026-10-01"]);              // ran out 31 Oct: low
    await buys(k, "bhindi", "few_days", "500 g", ["2026-11-14", "2026-11-18"]);              // snoozed below
    await buys(k, "eggs", "daily", "12 pc", ["2026-11-15", "2026-11-19"]);                   // on a cart as low
    await buys(k, "milk", "daily", "1 l", ["2026-11-19", "2026-11-20"]);                     // subscribed: listed as such
    await k.op("set_item", { item: "bhindi", snooze_days: 2 });
    await k.op("set_subscription", { item: "milk", source: "Country Delight", active: true });
    const cart = k.kit.db.insert(orders).values({ app: "zepto", status: "open" }).returning().get();
    k.kit.db.insert(order_lines).values({ order_id: cart.id, item_id: item(k, "eggs").id, item: "eggs", qty: 0, source: "low" }).run();

    const pantry = (await k.owner("GET", "/api/pantry")).body;
    expect(pantry.rows.map((r: any) => [r.name, r.quantity, r.status])).toEqual([
      ["atta", "10 kg", "In stock"], ["bhindi", "500 g", "Snoozed"], ["eggs", "12 pc", "Low"], ["milk", "1 l", "Subscription"], ["toor dal", "1 kg", "Low"]]);
    expect(pantry.rows.filter((r: any) => r.name !== "milk").map((r: any) => r.cycle)).toEqual(["10 kg about every 3 weeks", "500 g about every 4 days", "12 pc about every 4 days", "1 kg about once a month"]);
    expect(pantry.rows[0]).toEqual({ id: item(k, "atta").id, name: "atta", quantity: "10 kg", cycle: "10 kg about every 3 weeks", status: "In stock", subscription: null, image: null });
    expect(pantry.counts).toEqual({ all: 5, in_stock: 1, low: 2, snoozed: 1, subscription: 1 });
    expect(pantry.counts.in_stock + pantry.counts.low + pantry.counts.snoozed + pantry.counts.subscription).toBe(pantry.counts.all);
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
