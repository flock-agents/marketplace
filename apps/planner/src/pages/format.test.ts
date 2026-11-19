import { describe, expect, it } from "bun:test";
import { dishNote, forText, lineFor, orderHeading, orderMoney, pausedNow, recipeSourceLabel, regularText, textList } from "./format";

describe("regularText", () => {
  it("says how much and how often", () => {
    expect(regularText({ amount: 1, unit: "l", every: "day" } as any)).toBe("1 l a day");
    expect(regularText({ amount: 1, unit: "pack", every: "week", times_per_week: 2 } as any)).toBe("1 pack twice a week");
    expect(regularText({ amount: 6, unit: null, every: "week", times_per_week: 1 } as any)).toBe("6 a week");
    expect(regularText({ amount: 2, unit: "pc", every: "week", times_per_week: 3 } as any)).toBe("2 pc 3 times a week");
    expect(regularText({ amount: 1, unit: "pack", every: "week" } as any)).toBe("1 pack a week");
  });

  it("names the weekdays, and the day a pause ends", () => {
    expect(regularText({ amount: 500, unit: "g", every: "weekdays", weekdays: '["Mon","Wed","Fri"]', paused_until: "2026-11-29" } as any)).toBe("500 g on Mon, Wed, Fri · paused until Sun 29 Nov");
    expect(regularText({ amount: 500, unit: "g", every: "weekdays", weekdays: ["Mon"] } as any)).toBe("500 g on Mon");
  });

  it("leaves out a pause that is over", () => {
    const r = { amount: 1, unit: "l", every: "day", paused_until: "2026-11-29" } as any;
    expect(regularText(r, "2026-11-29")).toBe("1 l a day · paused until Sun 29 Nov");
    expect(regularText(r, "2026-11-30")).toBe("1 l a day");
    expect(pausedNow(r, "2026-11-29")).toBe(true);
    expect(pausedNow(r, "2026-11-30")).toBe(false);
    expect(pausedNow({ paused_until: null }, "2026-11-30")).toBe(false);
  });
});

describe("orderHeading", () => {
  it("says when the order is placed, where it went and how it stands", () => {
    expect(orderHeading({ place_at: "2026-11-21T18:00", app: "zepto", status: "placed" } as any)).toBe("Sat 21 Nov, 6 pm · Zepto · placed, waiting for payment");
    expect(orderHeading({ place_at: "2026-11-21T18:00", app: "zomato-blinkit", status: "paid" } as any)).toBe("Sat 21 Nov, 6 pm · Blinkit · paid");
    expect(orderHeading({ place_at: "2026-11-21T07:30", app: "bigbasket", status: "not_paid" } as any)).toBe("Sat 21 Nov, 7:30 am · BigBasket · not paid");
  });

  it("names no grocery app on an order that never went to one", () => {
    expect(orderHeading({ place_at: "2026-11-24T18:00", app: "zepto", status: "scheduled" } as any)).toBe("Tue 24 Nov, 6 pm · scheduled");
    expect(orderHeading({ place_at: "2026-11-24T18:00", app: "zepto", status: "cancelled" } as any)).toBe("Tue 24 Nov, 6 pm · cancelled");
  });
});

describe("orderMoney", () => {
  it("is the amount recorded when there is one, else the estimate from the lines", () => {
    expect(orderMoney({ total: 480, recorded_total: 512 })).toEqual({ amount: 512, estimate: false });
    expect(orderMoney({ total: 480, recorded_total: null })).toEqual({ amount: 480, estimate: true });
    expect(orderMoney({ total: 480, recorded_total: 0 })).toEqual({ amount: 0, estimate: false });
    expect(orderMoney({ total: 0, recorded_total: null })).toBeNull();
  });
});

describe("recipeSourceLabel", () => {
  it("names where a recipe is from", () => {
    expect(recipeSourceLabel({ source: "instagram" })).toBe("Instagram");
    expect(recipeSourceLabel({ source: "youtube" })).toBe("YouTube");
    expect(recipeSourceLabel({ source: "other" })).toBe("Link");
    expect(recipeSourceLabel({ source: null })).toBe("Link");
  });
});

describe("lineFor", () => {
  it("says what an order line is for", () => {
    expect(lineFor({ sources: '[{"kind":"dish","id":"d1","label":"Mon 23 Nov lunch: Aloo gobi"},{"kind":"regular","id":"r1","label":"Everyday: milk"}]' })).toBe("Mon 23 Nov lunch: Aloo gobi · Everyday: milk");
    expect(lineFor({ sources: null })).toBe("");
    expect(lineFor({ sources: "not json" })).toBe("");
  });
});

describe("textList", () => {
  it("reads a list kept as text, or already read", () => {
    expect(textList('["a","b"]')).toEqual(["a", "b"]);
    expect(textList(["a"])).toEqual(["a"]);
    expect(textList(null)).toEqual([]);
    expect(textList("{")).toEqual([]);
  });
});

describe("forText", () => {
  it("is the server's own line for a dish", () => {
    expect(forText({ name: "Parathas", for_people: ["Dad"], portion_note: null })).toBe("Parathas (for Dad)");
    expect(forText({ name: "Boiled eggs", for_people: null, portion_note: "4 for me, 1 for wife" })).toBe("Boiled eggs (4 for me, 1 for wife)");
  });

  it("dishNote is what follows the name in it", () => {
    expect(dishNote({ name: "Parathas", for_people: ["Dad"], portion_note: null })).toBe("(for Dad)");
    expect(dishNote({ name: "Boiled eggs", for_people: ["me"], portion_note: "4 for me, 1 for wife" })).toBe("(4 for me, 1 for wife)");
    expect(dishNote({ name: "Rice", for_people: null, portion_note: null })).toBe("");
  });
});
