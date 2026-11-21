// Everyday items are no longer a list of their own: each is its item's cycle. set_regular, the older operation, still states
// one; and an installed copy's rows in the retired `regulars` table become item cycles once, at boot. Today is Mon 23 Nov 2026.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { cycleDays, moveRegulars } from "./regulars";

const NOW = new Date(2026, 10, 23, 12);
const start = () => boot({ now: () => NOW });
type K = Awaited<ReturnType<typeof start>>;
const item = (k: K, name: string) => k.rows("items").find((i) => i.item === name);

describe("set_regular, the older way to state an item's cycle", () => {
  it("how often becomes a cycle in days", () => {
    expect([cycleDays("day", null, []), cycleDays("week", null, []), cycleDays("week", 2, []), cycleDays("weekdays", null, ["Mon", "Wed", "Fri", "Sun"])]).toEqual([1, 7, 3.5, 1.75]);
  });

  it("states the item's cycle, the same as set_item: no separate list is kept", async () => {
    const k = await start();
    const r = await k.op("set_regular", { item: "Milk", amount: 1, unit: "l", every: "day" });
    expect(r.item).toMatchObject({ item: "milk", name: "Milk", group: "daily", unit: "ml", stated_amount: 1000, stated_days: 1, usual_amount: 1000, lasts_days: 1 });
    await k.op("set_regular", { item: "eggs", amount: 30, unit: "pc", every: "week", for_whom: "Agastya" });
    await k.op("set_regular", { item: "bread", amount: 1, unit: "pack", every: "weekdays", weekdays: ["tue", "Friday"] });
    expect(item(k, "eggs")).toMatchObject({ group: "few_days", stated_amount: 30, stated_days: 7 });
    // "1 pack" cannot be added up: how often is kept, the amount is not.
    expect(item(k, "bread")).toMatchObject({ group: "few_days", stated_amount: null, stated_days: 3.5, unit: null });
    expect((await k.owner("GET", "/api/pantry")).body.rows.map((p: any) => [p.name, p.cycle])).toEqual([["bread", "Twice a week"], ["eggs", "30 pc once a week"], ["Milk", "1 l every day"]]);
    // set_item says the same thing, and changes it.
    expect((await k.op("set_item", { item: "milk", usual_amount: 500, unit: "ml", every_days: 2 })).item).toMatchObject({ stated_amount: 500, stated_days: 2, group: "daily" });
  });

  it("a pause snoozes the item, and switching it off or removing it takes the stated cycle away", async () => {
    const k = await start();
    await k.op("set_regular", { item: "milk", amount: 1, unit: "l", every: "day" });
    expect((await k.op("set_regular", { item: "milk", paused_until: "2026-11-29" })).item).toMatchObject({ snoozed_until: "2026-11-29", stated_days: 1 });
    expect((await k.op("set_regular", { item: "milk", active: false })).item).toMatchObject({ stated_days: null, stated_amount: null, lasts_days: null, confident: 0 });
    await k.op("set_regular", { item: "milk", amount: 1, unit: "l", every: "day" });
    expect((await k.op("set_regular", { item: "milk", remove: true })).item.stated_days).toBeNull();
    expect((await k.op("set_regular", { item: "ghee", remove: true })).status).toBe(404);
  });

  it("refuses what it cannot read, and a new item without how often", async () => {
    const k = await start();
    const milk = { item: "milk", amount: 1, unit: "l", every: "day" };
    for (const bad of [{ ...milk, item: " " }, { ...milk, amount: 0 }, { ...milk, every: "hourly" }, { ...milk, every: "week", times_per_week: 9 },
      { ...milk, every: "weekdays" }, { ...milk, every: "weekdays", weekdays: ["someday"] }, { item: "milk", amount: 1, unit: "l" }, { ...milk, paused_until: "next week" }, { ...milk, colour: "white" }])
      expect([bad, (await k.op("set_regular", bad)).code]).toEqual([bad, "APP_REFUSED"]);
    expect(k.rows("items")).toEqual([]);
  });
});

describe("set_item states a cycle", () => {
  it("usual_amount with its unit and every_days are kept on the item; null clears; the unit of an item already bought stays", async () => {
    const k = await start();
    expect((await k.op("set_item", { item: "eggs", group: "few_days", usual_amount: 30, unit: "pc", every_days: 7 })).item).toMatchObject({ stated_amount: 30, stated_days: 7, unit: "pc" });
    expect((await k.op("set_item", { item: "eggs", usual_amount: 12 })).item).toMatchObject({ stated_amount: 12, stated_days: 7 });
    expect((await k.op("set_item", { item: "eggs", usual_amount: null, every_days: null })).item).toMatchObject({ stated_amount: null, stated_days: null, lasts_days: null, usual_amount: null });
    for (const bad of [{ item: "ghee", usual_amount: 1 }, { item: "ghee", usual_amount: 1, unit: "jar" }, { item: "ghee", every_days: 0 }, { item: "ghee", usual_amount: -1, unit: "l" }])
      expect([bad, (await k.op("set_item", bad)).code]).toEqual([bad, "APP_REFUSED"]);
    await k.op("import_order_history", { app: "zepto", orders: [{ date: "2026-11-20", items: [{ item: "atta", group: "monthly", pack: "5 kg" }] }] });
    expect((await k.op("set_item", { item: "atta", usual_amount: 10, unit: "pc" })).code).toBe("APP_REFUSED");
    expect((await k.op("set_item", { item: "atta", usual_amount: 10, unit: "kg", every_days: 30 })).item).toMatchObject({ stated_amount: 10000, usual_amount: 10000, lasts_days: 30, run_out: "2026-12-05" });
  });
});

describe("an installed copy's everyday items become item cycles", () => {
  /** Rows of the retired table, as an installed copy has them. */
  const oldRows = async (k: K, rows: [string, number | null, string | null, string, number | null, string | null, string | null, number, string | null][]) => {
    for (const [item, amount, unit, every, times_per_week, weekdays, for_whom, active, paused_until] of rows)
      expect((await k.owner("POST", "/api/_data/regulars", { item, amount, unit, every, times_per_week, weekdays, for_whom, active, paused_until })).status).toBe(201);
  };

  it("nothing to move on a fresh install", async () => {
    const k = await start();
    expect(moveRegulars(k.kit.sqlite, k.kit.db, NOW)).toBe("none");
    expect(k.rows("items")).toEqual([]);
  });

  it("each active one states its item's cycle, once; the old rows stay as they were", async () => {
    const k = await start();
    // Eggs already have purchases of their own (a 30 tray every 7 days), and curd already has a group.
    await k.op("import_order_history", { app: "zepto", orders: ["2026-11-08", "2026-11-15"].map((date) => ({ date, items: [{ item: "eggs", group: "few_days", pack: "30 pc" }] })) });
    await k.op("set_item", { item: "curd", group: "few_days" });
    await oldRows(k, [
      ["Milk", 500, "ml", "day", null, null, null, 1, null],
      ["milk", 250, "ml", "weekdays", null, '["Mon","Wed"]', "Agastya", 1, "2026-11-25"],
      ["eggs", 2, "pc", "weekdays", null, '["Mon","Tue","Wed","Thu","Fri"]', null, 1, null],
      ["curd", 400, "g", "week", 2, null, null, 1, "2026-11-01"],
      ["bread", 1, "pack", "week", null, null, null, 1, null],
      ["butter", 100, "g", "day", null, null, null, 0, null]]);
    expect(moveRegulars(k.kit.sqlite, k.kit.db, NOW)).toBe("moved");
    // Milk: 500 ml a day for the house and 250 ml twice a week for Agastya add up over a day; his pause, still running, snoozes it.
    expect(item(k, "milk")).toMatchObject({ name: "Milk", group: "daily", unit: "ml", stated_days: 1, stated_amount: 571.429, snoozed_until: "2026-11-25", lasts_days: 1 });
    // Eggs keep the cycle their purchases show; what was stated is kept beside it.
    expect(item(k, "eggs")).toMatchObject({ group: "few_days", stated_days: 1.4, stated_amount: 2, lasts_days: 7, usual_amount: 30 });
    // Curd keeps its group, and a pause that is over is not carried. Bread's "1 pack" states how often only. Butter was off.
    expect(item(k, "curd")).toMatchObject({ group: "few_days", stated_days: 3.5, stated_amount: 400, snoozed_until: null });
    expect(item(k, "bread")).toMatchObject({ group: "few_days", stated_days: 7, stated_amount: null });
    expect(item(k, "butter")).toBeUndefined();
    expect((await k.owner("GET", "/api/pantry")).body.rows.map((p: any) => [p.name, p.cycle]))
      .toEqual([["bread", "Once a week"], ["curd", "400 g twice a week"], ["eggs", "30 pc about once a week"], ["Milk", "571 ml every day"]]);
    expect(k.rows("regulars")).toHaveLength(6);
    // A second boot moves nothing again: a cycle the family has since cleared stays cleared.
    await k.op("set_item", { item: "bread", every_days: null });
    expect(moveRegulars(k.kit.sqlite, k.kit.db, NOW)).toBe("already");
    expect(item(k, "bread").stated_days).toBeNull();
    // The reminder now puts the daily one on the cart once its snooze is over, as the everyday item was.
    expect((await k.op("get_reminder", { which: "evening" })).added).toEqual([]);
  });
});
