// The orders' pure side: needs into lines, days into orders, and which items a low-or-out answer names.
import { describe, it, expect } from "bun:test";
import { addDays } from "./dates";
import { groupNeeds, namedItems, planOrders, type Need } from "./orders";

const D = (n: number) => addDays("2026-11-22", n);   // D(0) = Sun 22, D(1) = Mon 23
const NOW = "2026-11-21T18:05";                       // Saturday evening

describe("planOrders", () => {
  it("pairs uncovered days; the first pair now, the rest the evening before", () => {
    expect(planOrders({ days: [D(0), D(1), D(2), D(3), D(4)], now: NOW, live: [] }).map((p) => [p.days, p.place_at])).toEqual([
      [[D(0), D(1)], NOW], [[D(2), D(3)], `${D(1)}T18:00`], [[D(4)], `${D(3)}T18:00`]]);
  });

  it("only the first order is the first, and no days make no orders", () => {
    expect(planOrders({ days: [D(0), D(1), D(2)], now: NOW, live: [] }).map((p) => p.first)).toEqual([true, false]);
    expect(planOrders({ days: [], now: NOW, live: [] })).toEqual([]);
  });

  it("pairs only days next to each other, so an order never spans a day another order covers", () => {
    expect(planOrders({ days: [D(1), D(3), D(4), D(6)], now: NOW, live: [] }).map((p) => p.days)).toEqual([[D(1)], [D(3), D(4)], [D(6)]]);
  });

  it("merges into a scheduled order on the same date; moves off a date with a placed order (Review Focus 2)", () => {
    const p = planOrders({ days: [D(1), D(2), D(3), D(4)], now: NOW, live: [{ id: "o1", date: D(2), status: "scheduled" }] });
    expect(p[1].merge_into).toBe("o1");
    expect(p[1].place_at).toBe(`${D(2)}T18:00`);
    const q = planOrders({ days: [D(1), D(2), D(3), D(4)], now: NOW, live: [{ id: "o2", date: D(2), status: "placed" }] });
    expect(q[1].place_at).toBe(`${D(3)}T08:00`); expect(q[1].merge_into).toBeUndefined();
  });

  it("a date whose order was paid or not paid is taken like a placed one", () => {
    for (const status of ["paid", "not_paid"] as const)
      expect(planOrders({ days: [D(1), D(2), D(3), D(4)], now: NOW, live: [{ id: "o", date: D(2), status }] })[1].place_at).toBe(`${D(3)}T08:00`);
  });

  it("the first pair joins a scheduled order placed today, and moves to its first morning when today's order went out", () => {
    const today = NOW.slice(0, 10);
    expect(planOrders({ days: [D(1), D(2)], now: NOW, live: [{ id: "o1", date: today, status: "scheduled" }] })[0]).toMatchObject({ merge_into: "o1", place_at: NOW });
    const moved = planOrders({ days: [D(1), D(2)], now: NOW, live: [{ id: "o1", date: today, status: "placed" }] })[0];
    expect(moved.place_at).toBe(`${D(1)}T08:00`); expect(moved.merge_into).toBeUndefined();
  });

  it("moved to the morning, it is checked once more: a scheduled order that morning takes it, a placed one does not move it again", () => {
    const live = [{ id: "eve", date: D(2), status: "placed" as const }];
    const joined = planOrders({ days: [D(1), D(2), D(3), D(4)], now: NOW, live: [...live, { id: "morning", date: D(3), status: "scheduled" }] })[1];
    expect(joined).toMatchObject({ place_at: `${D(3)}T08:00`, merge_into: "morning" });
    const stays = planOrders({ days: [D(1), D(2), D(3), D(4)], now: NOW, live: [...live, { id: "gone", date: D(3), status: "paid" }] })[1];
    expect(stays.place_at).toBe(`${D(3)}T08:00`); expect(stays.merge_into).toBeUndefined();
  });

  it("with a scheduled and a placed order on one date, the scheduled one takes the pair", () => {
    const p = planOrders({ days: [D(1), D(2), D(3), D(4)], now: NOW, live: [{ id: "gone", date: D(2), status: "placed" }, { id: "waiting", date: D(2), status: "scheduled" }] });
    expect(p[1]).toMatchObject({ place_at: `${D(2)}T18:00`, merge_into: "waiting" });
  });
});

describe("groupNeeds", () => {
  const need = (item: string, amount: number | null, unit: string | null, more: Partial<Need> = {}): Need =>
    ({ date: D(1), item, amount, unit, keeps: "fresh", source: "dish", source_id: `${item}-${unit}`, label: "x", ...more });

  it("never sums one item across units (Review Focus 1)", () => {
    const n = (amount: number, unit: string): Need => ({ date: D(1), item: "Onion", amount, unit, keeps: "fresh", source: "dish", source_id: unit, label: "x" });
    expect(groupNeeds([n(2, "pc"), n(200, "g"), n(1, "pc")]).map((g) => [g.unit, g.amount])).toEqual([["pc", 3], ["g", 200]]);
  });

  it("an item is one line whatever its capitals and spaces; kg and g are two units", () => {
    const g = groupNeeds([need("Toor dal", 200, "g"), need(" toor  DAL ", 100, "G"), need("toor dal", 1, "kg")]);
    expect(g.map((x) => [x.item, x.unit, x.amount])).toEqual([["Toor dal", "g", 300], ["toor dal", "kg", 1]]);
  });

  it("a null amount stays null, and a unit nobody gave is its own line", () => {
    const g = groupNeeds([need("salt", null, null), need("salt", null, null), need("salt", 5, "g"), need("oil", 100, "ml"), need("oil", null, "ml")]);
    expect(g.map((x) => [x.item, x.unit, x.amount])).toEqual([["salt", null, null], ["salt", "g", 5], ["oil", "ml", null]]);
  });

  it("adds decimals without drift", () => {
    expect(groupNeeds([need("milk", 0.1, "l"), need("milk", 0.2, "l")])[0].amount).toBe(0.3);
  });

  it("a line says what it is for, each dish or everyday item once, and keeps long when any need does", () => {
    const g = groupNeeds([
      need("rice", 400, "g", { source_id: "d1", label: "Mon 23 Nov lunch: Rice", keeps: "long" }),
      need("rice", 300, "g", { source_id: "d2", label: "Tue 24 Nov lunch: Rice" }),
      need("milk", 1, "l", { source: "regular", source_id: "r1", label: "Everyday: milk" }),
      need("milk", 1, "l", { source: "regular", source_id: "r1", label: "Everyday: milk", date: D(2) }),
    ]);
    expect(g[0]).toMatchObject({ amount: 700, keeps: "long", sources: [{ kind: "dish", id: "d1", label: "Mon 23 Nov lunch: Rice" }, { kind: "dish", id: "d2", label: "Tue 24 Nov lunch: Rice" }] });
    expect(g[1]).toMatchObject({ amount: 2, keeps: "fresh", sources: [{ kind: "regular", id: "r1", label: "Everyday: milk" }] });
  });
});

describe("namedItems (Review Focus 4)", () => {
  const asked = ["atta", "rice", "toor dal", "moong dal", "sunflower oil"];
  it("finds the items an answer names, by word, whatever the capitals and punctuation", () => {
    expect(namedItems(asked, ["ATTA is low"])).toEqual(["atta"]);
    expect(namedItems(asked, ["Rice, and Atta."])).toEqual(["atta", "rice"]);
    expect(namedItems(asked, ["we're out of oil"])).toEqual(["sunflower oil"]);
    expect(namedItems(asked, ["toor dal", "rice"])).toEqual(["rice", "toor dal", "moong dal"]);   // "dal" names every dal
  });
  it("a word names an item only as a whole word, and an unknown word names nothing", () => {
    expect(namedItems(asked, ["price of ghee and sandals"])).toEqual([]);
    expect(namedItems(asked, [""])).toEqual([]);
    expect(namedItems(asked, [])).toEqual([]);
    expect(namedItems(asked, ["nothing, all there"])).toEqual([]);
  });
});
