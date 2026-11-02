// The pure parts of server/stock.ts: the chronological walk, shelf life, check cadence, status and due rules.
import { describe, it, expect } from "bun:test";
import { checkCadenceDays, isCheckDue, kitchenStatus, parseQtyText, shelfLifeDays, walkStock, type Lot, type StockEvent } from "./stock";
import type { IngredientRow } from "./mealGroceries";

const lot = (over: Partial<Lot> = {}): Lot => ({ ingredient_id: "i", qty: 500, unit: "g", bought: "2026-10-27T10:00", use_by: "2026-11-02", source: "order", ...over });
const need = (at: string, qty: number | null, key = at): StockEvent => ({ at, kind: "need", qty, unit: "g", key });
const draw = (at: string, qty: number): StockEvent => ({ at, kind: "draw", qty, unit: "g" });

describe("walkStock", () => {
  it("covers needs in time order while the stock holds, whatever order they come in", () => {
    const { covered, remaining } = walkStock([lot()], [need("2026-10-30T19:00", 200, "c"), need("2026-10-28T19:00", 200, "a"), need("2026-10-29T19:00", 200, "b")]);
    expect([...covered]).toEqual(["a", "b"]);
    expect(remaining[0].qty).toBe(100);
  });

  it("stops at the first need it can't cover: a smaller later one is not picked off", () => {
    const { covered } = walkStock([lot({ qty: 300 })], [need("2026-10-28T08:00", 400, "big"), need("2026-10-29T08:00", 100, "small")]);
    expect(covered.size).toBe(0);
  });

  it("an unknown amount (no qty) stops the walk unless stock of unknown amount is there", () => {
    expect(walkStock([lot()], [need("2026-10-28T08:00", null, "x")]).covered.size).toBe(0);
    expect([...walkStock([lot({ qty: null })], [need("2026-10-28T08:00", null, "x")]).covered]).toEqual(["x"]);
  });

  it("an expired lot covers nothing on a later day", () => {
    expect(walkStock([lot({ use_by: "2026-10-28" })], [need("2026-10-29T08:00", 100)]).covered.size).toBe(0);
  });

  it("draws drain the soonest use-by first, and only lots bought by then", () => {
    const older = lot({ qty: 100, use_by: "2026-10-29", bought: "2026-10-26T10:00" });
    const newer = lot({ qty: 500, use_by: "2026-11-02", bought: "2026-10-28T18:00" });
    const { remaining } = walkStock([newer, older], [draw("2026-10-28T08:00", 150)]);
    expect(remaining.map((l) => l.qty)).toEqual([500]);   // 100 g from the older lot; the newer one wasn't bought yet
  });

  it("converts between a lot's unit and a need's unit through the ingredient's conversions", () => {
    const pcs = lot({ qty: 4, unit: "pc" });
    expect(walkStock([pcs], [need("2026-10-28T08:00", 300)], { pc: 100 }).covered.size).toBe(1);
    expect(walkStock([pcs], [need("2026-10-28T08:00", 300)], {}).covered.size).toBe(0);   // no bridge: not sure
  });

  it("a stamped purchase with no unit counts in the need's own unit", () => {
    expect(walkStock([lot({ unit: null, qty: 1000 })], [need("2026-10-28T08:00", 300)]).covered.size).toBe(1);
  });
});

describe("shelf life and check cadence", () => {
  it("falls back to the category default, then a short unknown default", () => {
    expect(shelfLifeDays(10, "dairy")).toBe(10);
    expect(shelfLifeDays(null, "spices")).toBe(365);
    expect(shelfLifeDays(null, null)).toBe(3);
  });
  it("fresh every few days, staples every week or two, spices every few weeks", () => {
    expect(checkCadenceDays(2, "vegetables")).toBe(3);
    expect(checkCadenceDays(5, "vegetables")).toBe(3);
    expect(checkCadenceDays(90, "pantry")).toBe(11);
    expect(checkCadenceDays(365, "pantry")).toBe(14);
    expect(checkCadenceDays(365, "spices")).toBe(23);
    expect(checkCadenceDays(1095, "spices")).toBe(28);
  });
});

describe("parseQtyText", () => {
  it("reads a leading amount and unit", () => {
    expect(parseQtyText("570 g")).toEqual({ qty: 570, unit: "g" });
    expect(parseQtyText("1 pc")).toEqual({ qty: 1, unit: "pc" });
    expect(parseQtyText("about a kilo")).toBeNull();
  });
});

describe("kitchenStatus", () => {
  const ing = (over: Partial<IngredientRow> = {}): IngredientRow => ({
    id: "i", name: "X", category: "vegetables", default_unit: "g", unit_conversions: null, prefs: null, aliases: null, shelf_life_days: 5,
    last_ordered_at: null, last_ordered_qty: null, level: null, last_checked_at: null, ...over,
  });
  const today = "2026-10-28";
  const at = (local: string) => new Date(local).toISOString();

  it("bought, or 'have' when someone said so", () => {
    expect(kitchenStatus(ing(), [lot()], false, today)).toEqual({ status: "bought", since: "2026-10-27" });
    expect(kitchenStatus(ing(), [lot({ source: "owner" })], false, today)).toEqual({ status: "have", since: "2026-10-27" });
  });
  it("a later answer wins over the purchase", () => {
    expect(kitchenStatus(ing({ last_checked_at: at("2026-10-28T09:00") }), [lot()], false, today)).toEqual({ status: "checked", since: "2026-10-28" });
    expect(kitchenStatus(ing({ level: "low", last_checked_at: at("2026-10-28T09:00") }), [], false, today)).toEqual({ status: "low", since: "2026-10-28" });
  });
  it("a purchase after an 'out' answer is bought again", () => {
    expect(kitchenStatus(ing({ level: "out", last_checked_at: at("2026-10-26T09:00") }), [lot()], false, today)?.status).toBe("bought");
  });
  it("long-shelf-life items the plan or a staple uses are assumed; fresh ones with nothing known aren't there", () => {
    expect(kitchenStatus(ing({ category: "spices" }), [], true, today)).toEqual({ status: "assumed", since: null });
    expect(kitchenStatus(ing({ category: "spices" }), [], false, today)).toBeNull();
    expect(kitchenStatus(ing(), [], true, today)).toBeNull();
  });
  it("a fresh item said to be there counts only while it would keep", () => {
    expect(kitchenStatus(ing({ last_checked_at: at("2026-10-25T09:00"), level: "plenty" }), [], false, today)?.status).toBe("checked");
    expect(kitchenStatus(ing({ last_checked_at: at("2026-10-20T09:00"), level: "plenty" }), [], false, today)).toBeNull();
  });
});

describe("isCheckDue", () => {
  const today = "2026-10-28";
  it("never-known items are due; others once their cadence has passed; low/out never (already on the list)", () => {
    expect(isCheckDue({ status: "assumed", since: null, shelf_life_days: 365, category: "spices" }, today)).toBe(true);
    expect(isCheckDue({ status: "checked", since: "2026-10-20", shelf_life_days: 365, category: "spices" }, today)).toBe(false);
    expect(isCheckDue({ status: "checked", since: "2026-10-01", shelf_life_days: 365, category: "spices" }, today)).toBe(true);
    expect(isCheckDue({ status: "bought", since: "2026-10-25", shelf_life_days: 4, category: "vegetables" }, today)).toBe(true);
    expect(isCheckDue({ status: "out", since: null, shelf_life_days: 4, category: "vegetables" }, today)).toBe(false);
  });
});
