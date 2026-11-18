// Everyday items: which days a regular is needed on, what an order history suggests, and set_regular.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { addDays, weekDates } from "./dates";
import { regularNeeds, spreadDays, suggestRegulars } from "./regulars";

const wk = weekDates("2026-11-23");

describe("regularNeeds", () => {
  it("spreadDays spreads the times of a week evenly from Monday", () => {
    expect(spreadDays(1)).toEqual([0]);
    expect(spreadDays(2)).toEqual([0, 3]); expect(spreadDays(3)).toEqual([0, 2, 4]);
    expect(spreadDays(7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("a daily item is needed every date; a weekly one on its spread days; a weekdays one on those days", () => {
    expect(regularNeeds({ item: "milk", amount: 1, unit: "l", every: "day", active: 1 } as any, wk.slice(0, 2)))
      .toEqual([{ date: "2026-11-23", amount: 1 }, { date: "2026-11-24", amount: 1 }]);
    expect(regularNeeds({ item: "bread", amount: 1, unit: "pack", every: "week", times_per_week: 2, active: 1 } as any, wk).map((n) => n.date))
      .toEqual(["2026-11-23", "2026-11-26"]);
    expect(regularNeeds({ item: "bananas", amount: 6, unit: "pc", every: "week", active: 1 } as any, wk))
      .toEqual([{ date: "2026-11-23", amount: 6 }]);
    expect(regularNeeds({ item: "fruit", amount: 1, unit: "kg", every: "weekdays", weekdays: '["Tue","Sat"]', active: 1 } as any, wk).map((n) => n.date))
      .toEqual(["2026-11-24", "2026-11-28"]);
    // The spread follows the weekday, not the place in the list: an order covering Wed to Fri gets the Thursday bread.
    expect(regularNeeds({ item: "bread", amount: 1, unit: "pack", every: "week", times_per_week: 2, active: 1 } as any, wk.slice(2, 5)).map((n) => n.date))
      .toEqual(["2026-11-26"]);
  });

  // Review Focus 3
  it("a paused regular is left out up to and including paused_until and needed again after; an inactive one is never needed", () => {
    // paused through Tue → Mon/Tue left out, Wed on
    expect(regularNeeds({ item: "curd", amount: 500, unit: "g", every: "day", active: 1, paused_until: "2026-11-24" } as any, wk.slice(0, 4)).map((n) => n.date))
      .toEqual(["2026-11-25", "2026-11-26"]);
    expect(regularNeeds({ item: "curd", amount: 500, unit: "g", every: "day", active: 0 } as any, wk)).toEqual([]);
    // A pause that ended before the dates changes nothing; one past them leaves all out.
    expect(regularNeeds({ item: "curd", amount: 500, unit: "g", every: "day", active: 1, paused_until: "2026-11-22" } as any, wk)).toHaveLength(7);
    expect(regularNeeds({ item: "curd", amount: 500, unit: "g", every: "day", active: 1, paused_until: "2026-11-29" } as any, wk)).toEqual([]);
    // A weekly item whose day falls in the pause is skipped that time, and back on its next day.
    expect(regularNeeds({ item: "bread", amount: 1, unit: "pack", every: "week", times_per_week: 2, active: 1, paused_until: "2026-11-24" } as any, wk).map((n) => n.date))
      .toEqual(["2026-11-26"]);
  });
});

describe("suggestRegulars", () => {
  const days = (n: number, step: number) => Array.from({ length: n }, (_, i) => addDays("2026-10-01", Math.round(i * step)));

  it("suggests what is bought again and again, by how often, and drops what is rare", () => {
    const hist = [...days(10, 1).map((d) => ({ date: d, items: [{ item: "Amul Taaza Milk", qty: 2, pack: "500 ml" }] })),
                  ...days(4, 3.5).map((d) => ({ date: d, items: [{ item: "Bread", qty: 1, pack: "1 pack" }] })),
                  ...days(3, 30).map((d) => ({ date: d, items: [{ item: "Atta", qty: 1, pack: "5 kg" }] }))];
    const s = suggestRegulars(hist);
    expect(s.find((x) => x.item === "amul taaza milk")).toMatchObject({ every: "day", amount: 2, unit: "500 ml", orders_seen: 10 });
    expect(s.find((x) => x.item === "amul taaza milk")!.times_per_week).toBeUndefined();
    expect(s.find((x) => x.item === "bread")).toMatchObject({ every: "week", times_per_week: 2, orders_seen: 4 });
    expect(s.find((x) => x.item === "atta")).toBeUndefined();
  });

  it("needs three different dates, takes the usual quantity and pack, and reads one name however it is written", () => {
    // Twice on one day and once on another is two dates: not enough.
    expect(suggestRegulars([{ date: "2026-10-01", items: [{ item: "Eggs" }, { item: "eggs" }] }, { date: "2026-10-02", items: [{ item: "Eggs" }] }])).toEqual([]);
    const s = suggestRegulars([
      { date: "2026-10-01", items: [{ item: "Eggs", qty: 1, pack: "6 pc" }] },
      { date: "2026-10-08", items: [{ item: "  EGGS ", qty: 2, pack: "12 pc" }] },
      { date: "2026-10-15", items: [{ item: "eggs", qty: 2, pack: "6 pc" }] },
      { date: "2026-10-22", items: [{ item: "Eggs", pack: "6 pc" }] },
      { date: "2026-10-29", items: [{ item: "Eggs", qty: 5 }] }]);
    expect(s).toEqual([{ item: "eggs", amount: 2, unit: "6 pc", every: "week", times_per_week: 1, orders_seen: 5 }]);
    // No pack on any order: the unit is left for the family to say.
    expect(suggestRegulars(days(3, 2).map((date) => ({ date, items: [{ item: "Curd" }] })))[0])
      .toEqual({ item: "curd", amount: 1, unit: null, every: "week", times_per_week: 4, orders_seen: 3 });
    // Once a fortnight is still an everyday item; never more than six times a week.
    expect(suggestRegulars(days(3, 14).map((date) => ({ date, items: [{ item: "Ghee" }] })))[0]).toMatchObject({ every: "week", times_per_week: 1 });
    expect(suggestRegulars(["2026-10-01", "2026-10-02", "2026-10-04", "2026-10-06"].map((date) => ({ date, items: [{ item: "Paneer" }] })))[0])
      .toMatchObject({ every: "week", times_per_week: 4 });
  });
});

describe("set_regular", () => {
  it("adds an everyday item and changes it by its name, whatever its capitals, keeping what was not sent", async () => {
    const { op, rows } = await boot();
    const r = await op("set_regular", { item: "Milk", amount: 1, unit: "l", every: "day" });
    expect(r.regular).toMatchObject({ item: "Milk", amount: 1, unit: "l", every: "day", keeps: "fresh", active: 1, for_whom: null, paused_until: null, weekdays: [], updated_by: "agent:meal-agent" });
    const again = await op("set_regular", { item: "  milk ", amount: 2 });
    expect(again.regular).toMatchObject({ id: r.regular.id, item: "Milk", amount: 2, unit: "l", every: "day" });
    expect(rows("regulars")).toHaveLength(1);
  });

  it("the same item for one person is its own everyday item", async () => {
    const { op, rows } = await boot();
    await op("set_regular", { item: "milk", amount: 1, unit: "l", every: "day" });
    await op("set_regular", { item: "milk", amount: 2, unit: "glasses", every: "day", for_whom: "Agastya" });
    await op("set_regular", { item: "Milk", amount: 3, for_whom: "agastya" });
    expect(rows("regulars").map((x) => [x.for_whom, x.amount])).toEqual([[null, 1], ["Agastya", 3]]);
  });

  it("keeps how often: times a week, or named weekdays however they are written", async () => {
    const { op, rows } = await boot();
    expect((await op("set_regular", { item: "bread", amount: 1, unit: "pack", every: "week", times_per_week: 2, keeps: "long" })).regular)
      .toMatchObject({ every: "week", times_per_week: 2, keeps: "long" });
    expect((await op("set_regular", { item: "fruit", amount: 1, unit: "kg", every: "weekdays", weekdays: ["tuesday", "SAT"] })).regular.weekdays).toEqual(["Tue", "Sat"]);
    expect(regularNeeds(rows("regulars").find((x) => x.item === "fruit"), wk).map((n) => n.date)).toEqual(["2026-11-24", "2026-11-28"]);
    expect(regularNeeds(rows("regulars").find((x) => x.item === "bread"), wk).map((n) => n.date)).toEqual(["2026-11-23", "2026-11-26"]);
  });

  // Review Focus 3, through the operation: the stored row is what the orders read.
  it("a pause leaves it out of exactly the paused days and it is needed again after; active: false stops it until it is set active", async () => {
    const { op, rows } = await boot();
    await op("set_regular", { item: "curd", amount: 500, unit: "g", every: "day" });
    const curd = () => rows("regulars")[0];
    expect((await op("set_regular", { item: "curd", paused_until: "2026-11-24" })).regular.paused_until).toBe("2026-11-24");
    expect(regularNeeds(curd(), wk).map((n) => n.date)).toEqual(["2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
    await op("set_regular", { item: "curd", paused_until: null });
    expect(regularNeeds(curd(), wk)).toHaveLength(7);
    await op("set_regular", { item: "curd", active: false });
    expect(regularNeeds(curd(), wk)).toEqual([]);
    // Changing its amount does not bring a stopped item back.
    await op("set_regular", { item: "curd", amount: 400 });
    expect(regularNeeds(curd(), wk)).toEqual([]);
    await op("set_regular", { item: "curd", active: true });
    expect(regularNeeds(curd(), wk)).toHaveLength(7);
    expect(regularNeeds(curd(), wk)[0]).toEqual({ date: "2026-11-23", amount: 400 });
  });

  it("remove deletes it, and answers 404 for an item that is not there", async () => {
    const { op, rows } = await boot();
    await op("set_regular", { item: "curd", amount: 500, unit: "g", every: "day" });
    expect((await op("set_regular", { item: "paneer", remove: true })).status).toBe(404);
    expect((await op("set_regular", { item: "curd", for_whom: "Agastya", remove: true })).status).toBe(404);
    expect((await op("set_regular", { item: "Curd", remove: true })).removed.item).toBe("curd");
    expect(rows("regulars")).toEqual([]);
  });

  it("refuses what it cannot read, and writes nothing", async () => {
    const { op, rows } = await boot();
    const milk = { item: "milk", amount: 1, unit: "l", every: "day" };
    for (const bad of [{ ...milk, item: " " }, { ...milk, amount: undefined }, { ...milk, amount: "1" }, { ...milk, amount: 0 }, { ...milk, unit: undefined },
      { ...milk, every: undefined }, { ...milk, every: "daily" }, { ...milk, every: "week", times_per_week: 0 }, { ...milk, every: "week", times_per_week: 1.5 },
      { ...milk, every: "weekdays" }, { ...milk, every: "weekdays", weekdays: [] }, { ...milk, every: "weekdays", weekdays: ["Someday"] },
      { ...milk, keeps: "forever" }, { ...milk, active: "no" }, { ...milk, paused_until: "next week" }, { ...milk, paused_until: "2026-02-30" }, { ...milk, for_whom: 7 }])
      expect([bad, (await op("set_regular", bad)).code]).toEqual([bad, "APP_REFUSED"]);
    expect(rows("regulars")).toEqual([]);
    // An item already there cannot be made a weekdays one without its weekdays.
    await op("set_regular", milk);
    expect((await op("set_regular", { item: "milk", every: "weekdays" })).code).toBe("APP_REFUSED");
    expect(rows("regulars")[0].every).toBe("day");
  });

  it("every change tells the orders, a refusal does not; the owner's write is stamped as theirs", async () => {
    let changed = 0;
    const { op, owner, rows } = await boot({ regularHooks: { onChanged: () => { changed++; } } });
    await op("set_regular", { item: "milk", amount: 1, unit: "l", every: "day" });
    await op("set_regular", { item: "milk", paused_until: "2026-11-24" });
    expect(changed).toBe(2);
    await op("set_regular", { item: "milk", every: "hourly" });
    await op("set_regular", { item: "ghee", remove: true });
    expect(changed).toBe(2);
    const r = await owner("POST", "/api/regulars", { item: "milk", amount: 2 });
    expect(r.status).toBe(200); expect(rows("regulars")[0].updated_by).toBe("user:tester");
    await owner("POST", "/api/regulars", { item: "milk", remove: true });
    expect(changed).toBe(4);
  });
});
