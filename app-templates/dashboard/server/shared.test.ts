import { describe, it, expect } from "bun:test";
import { deltaOf, latestPerLabel, whenText, localDate, statValue, kindOf, type Metric } from "../src/pages/shared";

const m = (label: string, value: number, created_at: string, unit: string | null = null): Metric =>
  ({ id: `${label}${created_at}`, label, value, unit, created_at, updated_at: created_at, updated_by: null });

describe("latestPerLabel", () => {
  it("keeps the newest reading of each label, labels in the order they first appeared", () => {
    const rows = [m("Revenue", 3, "2026-10-08T10:00:00.000Z"), m("Orders", 9, "2026-10-08T10:00:00.000Z"), m("Revenue", 2, "2026-10-07T10:00:00.000Z"), m("Orders", 8, "2026-10-07T10:00:00.000Z")];   // newest first
    expect(latestPerLabel(rows).map((r) => [r.label, r.value])).toEqual([["Orders", 9], ["Revenue", 3]]);
  });
  it("is empty for no rows", () => expect(latestPerLabel([])).toEqual([]));
});

describe("deltaOf", () => {
  const rows = [m("Orders", 132, "2026-10-08T10:00:00.000Z"), m("Revenue", 5, "2026-10-08T10:00:00.000Z"), m("Orders", 112, "2026-10-07T10:00:00.000Z"), m("Revenue", 0, "2026-10-07T10:00:00.000Z"), m("Solo", 4, "2026-10-08T10:00:00.000Z")];   // newest first
  it("is the percent change from the label's previous reading, to one decimal", () => expect(deltaOf(rows, "Orders")).toBe(17.9));
  it("is null with no previous reading, or a previous reading of zero", () => {
    expect(deltaOf(rows, "Solo")).toBeNull();
    expect(deltaOf(rows, "Revenue")).toBeNull();
    expect(deltaOf(rows, "Missing")).toBeNull();
  });
});

describe("whenText", () => {
  it("shows a bare date as a day and month", () => expect(whenText("2026-10-08")).toBe("8 Oct"));
  it("shows a local date-time with am/pm", () => {
    expect(whenText("2026-10-08T14:30")).toBe("8 Oct, 2:30 pm");
    expect(whenText("2026-10-08T00:05")).toBe("8 Oct, 12:05 am");
    expect(whenText("2026-10-08T14:30", false)).toBe("8 Oct");
  });
  it("converts a UTC timestamp to the viewer's local time rather than slicing it", () => {
    const at = "2026-10-08T18:30:00.000Z", t = new Date(at);
    expect(localDate(at)).toBe(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`);
    expect(whenText(at)).toContain(`${t.getDate()} `);
  });
});

describe("statValue", () => {
  it("formats money and minutes, and puts a unit after other numbers", () => {
    expect(kindOf("₹")).toBe("money");
    expect(statValue(m("Revenue", 5, "x", "₹"))).toEqual({ value: 5, kind: "money" });
    expect(statValue(m("Delivery", 29, "x", "min"))).toEqual({ value: 29, kind: "minutes" });
    expect(statValue(m("Repeat", 64, "x", "%"))).toEqual({ value: 64, kind: "share" });
    expect(statValue(m("Stock", 12, "x", "kg"))).toEqual({ value: "12 kg" });
    expect(statValue(m("Orders today", 132, "x", "orders"))).toEqual({ value: 132 });   // the label already says it
  });
});
