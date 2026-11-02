import { describe, it, expect } from "bun:test";
import { bestOf, mealTime, otherQuotes, togglePin, windowLabel, type OrderWindow, orderStatus, parseQuotes, parseSnapshot, quoteSnapshot, rangeText, readinessOf, readinessText, slotTitle, spanLabel, type CartV2, type GroceryV2 } from "./shopping";
import type { Cart } from "./shared";

const row = (over: Partial<GroceryV2>): GroceryV2 => ({
  id: "x", item: "Item", aisle: null, done: false, for_dish: null, category: null, needed_by: null, buy_at: null,
  qty: null, source: null, added_by: null, status: "pending", service: null, price: null, cart_id: null, in_stock_until: null, ...over,
});
const cart = (over: Partial<CartV2>): CartV2 => ({
  id: "c", buy_at: "2026-10-29T17:30", categories: null, status: "draft", checkin_sent_at: null, owner_notes: null,
  estimate: null, chosen_service: null, items_total: null, fees: null, grand_total: null, quotes: null, delivery_eta: null,
  confirmed_by: null, order_ref: null, ordered_at: null, updated_at: "2026-10-28T00:00", ...over,
});
const NOW = "2026-10-29T12:00";
const QUOTES = JSON.stringify([{ service: "zepto", total: 250, lines: [{ name: "Onion 500 g", price: 40 }], screenshot_url: "https://x/z.png" }, { service: "bigbasket", total: 240 }, { service: "zomato-blinkit", total: 262.4 }]);

describe("mealTime / rangeText", () => {
  it("uses the meal's own time, else the slot default", () => {
    expect(mealTime({ slot: "Dinner", time: "20:15" })).toBe("20:15");
    expect(mealTime({ slot: "Lunch" })).toBe("13:00");
  });
  it("shows a range, a single amount, or the v1 qty", () => {
    expect(rangeText({ qty_min: 200, qty_max: 250, qty_unit: "g", qty: null })).toBe("200–250 g");
    expect(rangeText({ qty_min: 2, qty_max: 2, qty_unit: "pc", qty: null })).toBe("2 pc");
    expect(rangeText({ qty_min: null, qty_max: null, qty_unit: null, qty: "1 kg" })).toBe("1 kg");
  });
});

describe("readinessOf", () => {
  const carts = new Map<string, Cart>([["a", cart({ id: "a" })], ["l", cart({ id: "l", status: "let_go" })]]);
  it("ready when everything is bought or in stock", () => {
    expect(readinessOf([row({ status: "ordered" }), row({ in_stock_until: "2026-11-01" })], carts, "2026-10-29")).toBe("ready");
  });
  it("ordering when the rest is on a draft", () => {
    expect(readinessOf([row({ status: "ordered" }), row({ cart_id: "a" })], carts, "2026-10-29")).toBe("ordering");
  });
  it("missing when an open row has no draft behind it", () => {
    expect(readinessOf([row({ cart_id: "a" }), row({ cart_id: "l" })], carts, "2026-10-29")).toBe("missing");
  });
  it("none without rows", () => { expect(readinessOf([], carts, "2026-10-29")).toBe("none"); });
});

describe("orderStatus", () => {
  it("a draft adds nothing before its order time (the heading says when), then says it waits for a yes", () => {
    expect(orderStatus(cart({}), NOW)).toEqual({ text: "", tone: "neutral", done: false });
    expect(orderStatus(cart({ buy_at: "2026-10-29T09:00" }), NOW)).toMatchObject({ text: "Waiting for a yes", tone: "info" });
  });
  it("a quoted draft leads with the best service and its total", () => {
    expect(orderStatus(cart({ quotes: QUOTES, chosen_service: "zepto" }), NOW).text).toBe("Best: Zepto ₹250");
  });
  it("after a yes, it is being ordered", () => {
    expect(orderStatus(cart({ yes_at: "2026-10-29T11:00:00.000Z", chosen_service: "zepto" }), NOW)).toMatchObject({ text: "Ordering on Zepto…", done: false });
  });
  it("ordered names service, total and eta; let go is done", () => {
    expect(orderStatus(cart({ status: "ordered", chosen_service: "zepto", grand_total: 440, delivery_eta: "9:40pm" }), NOW))
      .toEqual({ text: "Ordered on Zepto · ₹440 · arriving 9:40pm", tone: "success", done: true });
    expect(orderStatus(cart({ status: "let_go" }), NOW)).toMatchObject({ text: "Let go", done: true });
  });
  it("no cart", () => { expect(orderStatus(null, NOW).text).toBe("Not on an order yet"); });
});

describe("quotes", () => {
  it("parses, finds the app's pick, and lists the others cheapest first", () => {
    const c = cart({ quotes: QUOTES, chosen_service: "zepto" });
    expect(parseQuotes(QUOTES)).toHaveLength(3);
    expect(parseQuotes("{bad")).toEqual([]);
    expect(bestOf(c)?.total).toBe(250);
    expect(bestOf(cart({ quotes: QUOTES }))).toBeNull();
    expect(otherQuotes(c)).toBe("BigBasket ₹240 · Blinkit ₹262");
  });
  it("draws a quote as a cart snapshot", () => {
    expect(quoteSnapshot(parseQuotes(QUOTES)[0])).toEqual({ service: "zepto", lines: [{ name: "Onion 500 g", qty: 1, price: 40 }], fees: null, total: 250, screenshot_url: "https://x/z.png" });
  });
});

describe("usual ordering times", () => {
  const w = (over: Partial<OrderWindow>): OrderWindow => ({ days: [0, 1, 2, 3, 4, 5, 6], from: "18:00", to: "19:00", source: "learned", confidence: 0.8, sample_count: 5, ...over });
  it("labels windows", () => {
    expect(windowLabel(w({}))).toMatch(/^Every day 6(:00)? PM · seen 5 times$/);
    expect(windowLabel(w({ days: [3, 1], from: "10:00", source: "pinned" }))).toMatch(/^Mon, Wed 10(:00)? AM · pinned$/);
  });
  it("pin adds a pinned copy; unpin removes it", () => {
    const learned = w({});
    const pinned = togglePin([learned], learned);
    expect(pinned).toEqual([{ ...learned, source: "pinned" }]);
    expect(togglePin([...pinned, learned], pinned[0])).toEqual([]);
  });
});

describe("slotTitle", () => {
  it("says when it orders and the meals it spans", () => {
    expect(slotTitle(cart({}), ["Thu dinner", "Fri lunch", "Sat dinner"], "2026-10-29")).toBe("Order today 5:30 PM · Thu dinner → Sat dinner");
    expect(slotTitle(cart({}), ["Thu dinner"], "2026-10-29")).toBe("Order today 5:30 PM · Thu dinner");
    expect(slotTitle(null, [], "2026-10-29")).toBe("Not scheduled yet");
    expect(spanLabel([])).toBe("");
  });
});

describe("snapshot", () => {
  const raw = JSON.stringify({ service: "zepto", lines: [{ name: "Milk 1L", qty: 2, price: 60 }, { name: "Palak", qty: 1, price: 30 }, { bad: 1 }], fees: { delivery: 20 } });
  it("parses and drops broken lines", () => {
    expect(parseSnapshot(raw)!.lines.map((l) => l.name)).toEqual(["Milk 1L", "Palak"]);
    expect(parseSnapshot("not json")).toBeNull();
    expect(parseSnapshot({ lines: "x" })).toBeNull();
  });
});

describe("readinessText", () => {
  const row = (over: Partial<GroceryV2>): GroceryV2 => ({ id: Math.random().toString(), item: "Onion", status: "pending", cart_id: null, in_stock_until: null, ...over } as GroceryV2);
  const carts = new Map([["c", { id: "c", status: "draft", buy_at: "2026-11-01T18:00" } as any]]);
  it("says nothing when everything is in hand or there is nothing to buy", () => {
    expect(readinessText("ready", [row({ status: "ordered" })], carts, "2026-10-30")).toBeNull();
    expect(readinessText("none", [], carts, "2026-10-30")).toBeNull();
  });
  it("names what still needs buying", () => {
    const t = readinessText("missing", [row({ item: "Coriander" }), row({ item: "Onion", status: "ordered" }), row({ item: "Mint" }), row({ item: "Curd" })], carts, "2026-10-30");
    expect(t).toMatchObject({ text: "Need Coriander, Mint +1", tone: "warning" });
    expect(t!.ids).toHaveLength(3);
  });
  it("says which list the items are on, not that they are ordered", () => {
    expect(readinessText("ordering", [row({ cart_id: "c" })], carts, "2026-10-30")!.text).toBe("On Sun 6:00 PM list");
  });
});
