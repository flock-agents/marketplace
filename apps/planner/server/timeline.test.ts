import { describe, it, expect } from "bun:test";
import { addDaysStr, bucketOrders, cookTimeFor, dateTime, isLiveDraft, latestBuyAt, staplesDue, todayStr, type StapleCadence } from "./timeline";

const SETTINGS = { cookMorning: "07:30", cookEvening: "19:00", deliveryLeadMin: 60, earliestOrder: "06:30", preferredOrderTime: "18:00", freshWindowDays: { dairy: 1, vegetables: 2, pantry: 7, spices: 14 } };

describe("latestBuyAt", () => {
  it("prefers the evening before, when there's still time to buy it then", () => {
    expect(latestBuyAt("2026-10-29", SETTINGS)).toBe("2026-10-28T18:00");
  });
  it("with no `now` given, the evening-before preference still applies to an already-overdue needed-by", () => {
    expect(latestBuyAt("2026-10-01", SETTINGS)).toBe("2026-09-30T18:00");
  });
  it("leaves a genuinely future needed-by on its own evening-before slot — the floor only ever pulls an overdue one forward", () => {
    const now = new Date(2026, 9, 28, 9, 0);
    expect(latestBuyAt("2026-11-05", SETTINGS, now)).toBe("2026-11-04T18:00");
  });

  describe("once the preferred evening slot has already passed", () => {
    it("falls back to the cook time minus the delivery lead", () => {
      const now = new Date(2026, 9, 28, 21, 0);   // Oct 28, 9pm — past today's 18:00 preferred slot
      expect(latestBuyAt("2026-10-29", SETTINGS, now)).toBe("2026-10-29T06:30");
    });
    it("never goes earlier than the earliest order, even with a long lead", () => {
      const now = new Date(2026, 9, 28, 21, 0);
      expect(latestBuyAt("2026-10-29", { ...SETTINGS, deliveryLeadMin: 480 }, now)).toBe("2026-10-29T06:30");
    });
    it("still clamps to the earliest order on the needed-by date, even when that rolls the raw time back a day", () => {
      // Without the clamp, 00:30 cook minus a 60-minute lead would be 23:30 the night before; earliest_order keeps it same-day.
      const now = new Date(2026, 9, 28, 21, 0);
      expect(latestBuyAt("2026-10-29", { ...SETTINGS, cookMorning: "00:30", deliveryLeadMin: 60, earliestOrder: "00:00" }, now)).toBe("2026-10-29T00:00");
    });
    it("floors an overdue needed-by to right now, so a respawned cart is never dead on arrival", () => {
      const now = new Date(2026, 9, 28, 9, 0);   // Oct 28, 9:00am — needed-by Oct 1 is long gone, its own evening slot long past
      expect(latestBuyAt("2026-10-01", SETTINGS, now)).toBe("2026-10-28T09:00");
    });
    it("floors to today's own earliest-order cutoff, not literally now, when now is earlier than that", () => {
      const now = new Date(2026, 9, 28, 3, 0);   // 3am — before the 06:30 earliest-order cutoff
      expect(latestBuyAt("2026-10-01", SETTINGS, now)).toBe("2026-10-28T06:30");
    });
  });
});

describe("bucketOrders", () => {
  it("groups items due on the same day into one order", () => {
    const items = [
      { id: "a", category: "vegetables", latestBuy: "2026-10-29T06:30" },
      { id: "b", category: "dairy", latestBuy: "2026-10-29T06:30" },
    ];
    const groups = bucketOrders(items, SETTINGS.freshWindowDays);
    expect(groups).toHaveLength(1);
    expect(groups[0].itemIds.sort()).toEqual(["a", "b"]);
    expect(groups[0].categories.sort()).toEqual(["dairy", "vegetables"]);
  });
  it("absorbs a vegetable item up to 2 days ahead into the same order", () => {
    const items = [
      { id: "a", category: "vegetables", latestBuy: "2026-10-29T06:30" },
      { id: "b", category: "vegetables", latestBuy: "2026-10-31T06:30" },
    ];
    expect(bucketOrders(items, SETTINGS.freshWindowDays)).toHaveLength(1);
  });
  it("splits into a new order once an item falls outside the window", () => {
    const items = [
      { id: "a", category: "dairy", latestBuy: "2026-10-29T06:30" },   // dairy window is 1 day
      { id: "b", category: "dairy", latestBuy: "2026-10-31T06:30" },
    ];
    const groups = bucketOrders(items, SETTINGS.freshWindowDays);
    expect(groups).toHaveLength(2);
    expect(groups[0].itemIds).toEqual(["a"]);
    expect(groups[1].itemIds).toEqual(["b"]);
  });
  it("takes the earliest item's deadline as the order's buy_at", () => {
    const items = [
      { id: "a", category: "pantry", latestBuy: "2026-10-29T06:30" },
      { id: "b", category: "pantry", latestBuy: "2026-10-30T06:30" },
    ];
    expect(bucketOrders(items, SETTINGS.freshWindowDays)[0].buyAt).toBe("2026-10-29T06:30");
  });
  it("never lets a wide pantry window sweep up an unrelated dairy item just because it is sorted first", () => {
    const items = [
      { id: "dairy", category: "dairy", latestBuy: "2026-10-29T06:30" },            // dairy's own window is 1 day
      { id: "pantry", category: "pantry", latestBuy: "2026-10-31T06:30" },
    ];
    const groups = bucketOrders(items, SETTINGS.freshWindowDays);
    // Both would satisfy pantry's 7-day window measured from the dairy item, but they must stay in separate orders.
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.itemIds.includes("dairy"))!.itemIds).toEqual(["dairy"]);
    expect(groups.find((g) => g.itemIds.includes("pantry"))!.itemIds).toEqual(["pantry"]);
  });
  it("still merges same-day items from different categories into one order", () => {
    const items = [
      { id: "a", category: "dairy", latestBuy: "2026-10-29T06:30" },
      { id: "b", category: "pantry", latestBuy: "2026-10-29T06:30" },
    ];
    const groups = bucketOrders(items, SETTINGS.freshWindowDays);
    expect(groups).toHaveLength(1);
    expect(groups[0].itemIds.sort()).toEqual(["a", "b"]);
    expect(groups[0].categories.sort()).toEqual(["dairy", "pantry"]);
  });
});

describe("staplesDue", () => {
  const now = new Date(2026, 9, 29);   // Oct 29 2026
  const dairy = (over: Partial<StapleCadence>): StapleCadence => ({ id: "s1", item: "Buffalo milk", category: "dairy", every_min_days: 1, every_max_days: 3, last_ordered_at: null, last_checked_at: null, active: true, ...over });
  it("a never-ordered staple is due today", () => {
    const due = staplesDue([dairy({})], addDaysStr(todayStr(now), 7), now);
    expect(due).toHaveLength(1);
    expect(due[0].due).toBe(todayStr(now));
  });
  it("is due again every_min_days after the last order", () => {
    const due = staplesDue([dairy({ last_ordered_at: "2026-10-28T06:30:00.000Z" })], addDaysStr(todayStr(now), 7), now);
    expect(due[0].due).toBe("2026-10-29");
  });
  it("a pantry staple is due 7 days after its last check, not its cadence", () => {
    const pantry = dairy({ category: "pantry", every_min_days: 1, last_checked_at: "2026-10-25T00:00:00.000Z" });
    const due = staplesDue([pantry], addDaysStr(todayStr(now), 7), now);
    expect(due[0].due).toBe("2026-11-01");
  });
  it("an inactive staple is never due", () => {
    expect(staplesDue([dairy({ active: false })], addDaysStr(todayStr(now), 30), now)).toHaveLength(0);
  });
  it("nothing due past the horizon", () => {
    const due = staplesDue([dairy({ last_ordered_at: "2026-10-29T00:00:00.000Z", every_min_days: 30 })], addDaysStr(todayStr(now), 7), now);
    expect(due).toHaveLength(0);
  });
});

describe("isLiveDraft", () => {
  it("a draft is re-planned until a yes or an owner move; orders and let-go drafts never", () => {
    expect(isLiveDraft({ status: "draft", yes_at: null, moved_at: null })).toBe(true);
    expect(isLiveDraft({ status: "draft", yes_at: "2026-10-28T10:00:00.000Z", moved_at: null })).toBe(false);
    expect(isLiveDraft({ status: "draft", yes_at: null, moved_at: "2026-10-28T10:00:00.000Z" })).toBe(false);
    expect(isLiveDraft({ status: "ordered", yes_at: null, moved_at: null })).toBe(false);
    expect(isLiveDraft({ status: "let_go", yes_at: null, moved_at: null })).toBe(false);
  });
});

describe("addDaysStr / dateTime", () => {
  it("rolls across a month end", () => { expect(addDaysStr("2026-10-30", 3)).toBe("2026-11-02"); });
  it("combines a date and a time", () => { expect(dateTime("2026-10-29", "06:30")).toBe("2026-10-29T06:30"); });
});

describe("meal-time-aware deadlines (v2)", () => {
  it("cookTimeFor: a meal's own time wins, dinner uses cook.evening, breakfast/lunch cook.morning", () => {
    expect(cookTimeFor("Dinner", "20:15", SETTINGS)).toBe("20:15");
    expect(cookTimeFor("Dinner", null, SETTINGS)).toBe("19:00");
    expect(cookTimeFor("Lunch", null, SETTINGS)).toBe("07:30");
    expect(cookTimeFor(null, null, SETTINGS)).toBe("07:30");
  });
  it("a dinner item can be bought the same afternoon once the evening-before slot has passed", () => {
    const now = new Date(2026, 9, 29, 9, 0);
    expect(latestBuyAt("2026-10-29", SETTINGS, now, "19:00")).toBe("2026-10-29T18:00");
    expect(latestBuyAt("2026-10-29", SETTINGS, now)).toBe("2026-10-29T09:00");
  });
  it("shelf life keeps an item out of an order that would buy it too early; unknown categories get the shortest window", () => {
    const items = [
      { id: "a", category: "vegetables", latestBuy: "2026-10-29T18:00" },
      { id: "b", category: "vegetables", latestBuy: "2026-10-30T18:00", shelfLifeDays: 0.5 },
    ];
    expect(bucketOrders(items, SETTINGS.freshWindowDays)).toHaveLength(2);
    const unknown = [{ id: "x", category: "fruits", latestBuy: "2026-10-29T18:00" }, { id: "y", category: "fruits", latestBuy: "2026-11-01T18:00" }];
    expect(bucketOrders(unknown, SETTINGS.freshWindowDays)).toHaveLength(2);
  });
});
