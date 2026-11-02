import { describe, it, expect } from "bun:test";
import { applyShow, draftKeyOf, filterGroceries, groupBySlot, lineKeyOf, mergeItems, sortItems, type GroceryFilter } from "./groceryGroups";
import type { Cart, Grocery } from "./shared";

const row = (over: Partial<Grocery>): Grocery => ({
  id: "x", item: "Item", aisle: null, done: false, for_dish: null, category: null, needed_by: null, buy_at: null,
  qty: null, source: null, added_by: null, status: "pending", service: null, price: null, cart_id: null, in_stock_until: null,
  ...over,
});
const cart = (over: Partial<Cart>): Cart => ({
  id: "c", buy_at: "2026-10-29T06:30", categories: null, status: "draft", checkin_sent_at: null, owner_notes: null,
  estimate: null, chosen_service: null, items_total: null, fees: null, grand_total: null, quotes: null, delivery_eta: null,
  confirmed_by: null, order_ref: null, ordered_at: null, updated_at: "2026-10-28T00:00",
  ...over,
});

describe("sortItems", () => {
  it("sorts by needed-by date ascending, undated last, then by name", () => {
    const rows = [
      row({ id: "a", item: "Zucchini", needed_by: "2026-10-30" }),
      row({ id: "b", item: "Apples", needed_by: null }),
      row({ id: "c", item: "Milk", needed_by: "2026-10-29" }),
      row({ id: "d", item: "Bread", needed_by: null }),
    ];
    expect(sortItems(rows).map((r) => r.id)).toEqual(["c", "a", "b", "d"]);
  });
});

describe("groupBySlot", () => {
  const meals = [{ id: "m1", date: "2026-10-30", slot: "Dinner" }, { id: "m2", date: "2026-10-30", slot: "Lunch" }];
  const label = (m: { date: string; slot: string }) => `${m.date} ${m.slot}`;
  it("groups by cart, earliest order first, with the meals each covers in meal order", () => {
    const c1 = cart({ id: "c1", buy_at: "2026-10-29T17:30" }), c0 = cart({ id: "c0", buy_at: "2026-10-29T06:30" });
    const rows = [
      { ...row({ id: "a", item: "Palak", cart_id: "c1" }), meal_id: "m1" },
      { ...row({ id: "b", item: "Atta", cart_id: "c1" }), meal_id: "m2" },
      { ...row({ id: "c", item: "Milk", cart_id: "c0" }), meal_id: null },
    ];
    const groups = groupBySlot(rows, [c1, c0], meals, label);
    expect(groups.map((g) => g.key)).toEqual(["c0", "c1"]);
    expect(groups[1].covers).toEqual(["2026-10-30 Lunch", "2026-10-30 Dinner"]);
    expect(groups[0].covers).toEqual([]);
  });
  it("puts rows with no cart under 'unscheduled'", () => {
    const groups = groupBySlot([row({ id: "a", cart_id: null })], [], [], label);
    expect(groups.map((g) => g.key)).toEqual(["unscheduled"]);
  });
});

describe("applyShow", () => {
  it("a category shows that category's open items only", () => {
    const rows = [row({ id: "d", category: "dairy" }), row({ id: "v", category: "vegetables" }), row({ id: "o", category: "dairy", status: "ordered" })];
    expect(applyShow(rows, "cat:dairy", "2026-10-28").map((r) => r.id)).toEqual(["d"]);
  });
});

describe("filterGroceries", () => {
  const today = "2026-10-28";
  const rows = [
    row({ id: "pending", status: "pending" }),
    row({ id: "confirmed", status: "confirmed" }),
    row({ id: "ordered", status: "ordered" }),
    row({ id: "skipped", status: "skipped" }),
    row({ id: "snoozed", status: "pending", in_stock_until: "2026-11-01" }),
    row({ id: "snoozed-past", status: "pending", in_stock_until: "2026-10-01" }),   // the date has passed: back in play
  ];
  const ids = (f: GroceryFilter) => filterGroceries(rows, f, today).map((r) => r.id);

  it("'need' is open items (pending or confirmed), excluding anything snoozed", () => {
    expect(ids("need").sort()).toEqual(["confirmed", "pending", "snoozed-past"]);
  });
  it("'not_in_cart' is pending only, excluding snoozed", () => {
    expect(ids("not_in_cart").sort()).toEqual(["pending", "snoozed-past"]);
  });
  it("'in_cart' is confirmed only", () => {
    expect(ids("in_cart")).toEqual(["confirmed"]);
  });
  it("'all' adds ordered, skipped and snoozed items too", () => {
    expect(ids("all").sort()).toEqual(["confirmed", "ordered", "pending", "skipped", "snoozed", "snoozed-past"]);
  });
});

describe("mergeItems", () => {
  const onion = (id: string, meal: string, min: number) => ({ ...row({ id, item: "Onion", cart_id: "c" }), ingredient_id: "onion", meal_id: meal, qty_min: min, qty_max: 250, qty_unit: "g" });
  it("shows one line per ingredient, with the server's pack-rounded range", () => {
    const lines = mergeItems([onion("a", "m1", 60), onion("b", "m2", 90), { ...onion("t", "", 0), item: "Tomato", ingredient_id: "tomato", meal_id: null, qty_min: null, qty_max: null, qty_unit: null }],
      (id) => (id === "a" || id === "b" ? { qty_min: 150, qty_max: 250, qty_unit: "g" } : undefined));
    expect(lines.map((l) => [l.row.item, l.ids, l.mealIds, l.row.qty_min, l.row.qty_max])).toEqual([
      ["Onion", ["a", "b"], ["m1", "m2"], 150, 250], ["Tomato", ["t"], [], null, null],
    ]);
  });
  it("without a server line, sums the need instead of adding up each row's pack rounding", () => {
    const [line] = mergeItems([onion("a", "m1", 60), onion("b", "m2", 90), onion("c", "m3", 60)], () => undefined);
    expect([line.row.qty_min, line.row.qty_max, line.row.qty_unit]).toEqual([210, 250, "g"]);
  });
  it("keeps rows in different states apart (an in-cart line never hides one still to buy)", () => {
    expect(mergeItems([onion("a", "m1", 60), { ...onion("b", "m2", 90), status: "confirmed" }], () => undefined)).toHaveLength(2);
  });
});

describe("draftKeyOf / lineKeyOf", () => {
  it("a draft line is its ingredient, else its item name (the server's key); a page line adds the status", () => {
    expect(draftKeyOf({ ingredient_id: "onion", item: "Onion" })).toBe("onion");
    expect(draftKeyOf({ ingredient_id: null, item: " Paper Towels " })).toBe("item:paper towels");
    expect(lineKeyOf({ ingredient_id: null, item: "Curd", status: "skipped" } as any)).toBe("item:curd|skipped");
  });
});
