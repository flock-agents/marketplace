import { describe, it, expect } from "bun:test";
import { groupMeals, newDish, otherDishes, slotKey } from "../src/pages/slots";

const row = (id: string, date: string, slot: string, dish: string, created_at?: string, _sample?: boolean) =>
  ({ id, date, slot, dish, recipe_id: null, ...(created_at ? { created_at } : {}), ...(_sample ? { _sample } : {}) });

describe("groupMeals: one line per date and slot", () => {
  const rows = [
    row("a", "2026-10-12", "Lunch", "Sambar", "2026-10-01T10:00:02Z"),
    row("b", "2026-10-12", "Lunch", "Rice", "2026-10-01T10:00:01Z"),
    row("c", "2026-10-12", "Dinner", "Chapati", "2026-10-01T10:00:03Z"),
    row("d", "2026-10-13", "Lunch", "Curd rice", "2026-10-01T10:00:04Z"),
    row("e", "2026-10-12", "Lunch", "Bhindi", "2026-10-01T10:00:05Z"),
  ];
  const g = groupMeals(rows);
  it("puts every dish of a meal on one line, in the order they were added", () => {
    expect(g.map((x) => x.id)).toEqual(["2026-10-12|Lunch", "2026-10-12|Dinner", "2026-10-13|Lunch"]);
    expect(g[0].dishes.map((d) => d.dish)).toEqual(["Rice", "Sambar", "Bhindi"]);
    expect(g[0]).toMatchObject({ date: "2026-10-12", slot: "Lunch" });
  });
  it("keeps the same slot on another day apart", () => {
    expect(g[2].dishes.map((d) => d.id)).toEqual(["d"]);
  });
  it("puts a dish added this session (no created_at yet) last", () => {
    const more = groupMeals([...rows, row("f", "2026-10-12", "Lunch", "Salad")]);
    expect(more[0].dishes.map((d) => d.dish)).toEqual(["Rice", "Sambar", "Bhindi", "Salad"]);
  });
  it("is a sample only when every dish is", () => {
    const s = groupMeals([row("x", "2026-10-12", "Lunch", "Rice", undefined, true), row("y", "2026-10-12", "Lunch", "Dal", undefined, true), row("z", "2026-10-12", "Dinner", "Roti", undefined, true)]);
    expect(s.every((x) => x._sample === true)).toBe(true);
    const mixed = groupMeals([row("x", "2026-10-12", "Lunch", "Rice", undefined, true), row("y", "2026-10-12", "Lunch", "Dal")]);
    expect(mixed[0]._sample).toBeUndefined();
  });
  it("is empty for no rows", () => expect(groupMeals([])).toEqual([]));
});

describe("adding to a meal that already has dishes", () => {
  const rows = [row("a", "2026-10-12", "Lunch", "Rice"), row("b", "2026-10-12", "Lunch", "Sambar")];
  it("writes one more row on the same date and slot", () => {
    const made = newDish({ date: "2026-10-12", slot: "Lunch" }, { dish: "Bhindi", recipe_id: null });
    expect(made).toEqual({ date: "2026-10-12", slot: "Lunch", dish: "Bhindi", recipe_id: null });
    const after = groupMeals([...rows, { id: "c", ...made }]);
    expect(after).toHaveLength(1);
    expect(after[0].dishes.map((d) => d.dish)).toEqual(["Rice", "Sambar", "Bhindi"]);
  });
});

describe("editing or removing one dish", () => {
  const rows = [row("a", "2026-10-12", "Lunch", "Rice", "1"), row("b", "2026-10-12", "Lunch", "Sambar", "2"), row("c", "2026-10-12", "Dinner", "Roti", "3")];
  it("the editor knows the meal's other dishes, not other meals'", () => {
    expect(otherDishes(rows, rows[0]).map((d) => d.id)).toEqual(["b"]);
    expect(otherDishes(rows, rows[2])).toEqual([]);
    expect(slotKey(rows[0])).toBe("2026-10-12|Lunch");
  });
  it("renaming one dish leaves the others on the line", () => {
    const g = groupMeals(rows.map((r) => (r.id === "b" ? { ...r, dish: "Rasam" } : r)));
    expect(g[0].dishes.map((d) => d.dish)).toEqual(["Rice", "Rasam"]);
  });
  it("removing one dish keeps the meal; removing the last one drops the line", () => {
    expect(groupMeals(rows.filter((r) => r.id !== "a"))[0].dishes.map((d) => d.dish)).toEqual(["Sambar"]);
    expect(groupMeals(rows.filter((r) => r.id !== "c")).map((x) => x.slot)).toEqual(["Lunch"]);
  });
});
