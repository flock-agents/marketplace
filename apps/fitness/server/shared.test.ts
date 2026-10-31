import { describe, it, expect } from "bun:test";
import { deltaOf, headlineReadings, latestPerLabel, whenText, localDate, statValue, kindOf, type Metric } from "../src/pages/shared";

const m = (label: string, value: number, created_at: string, unit: string | null = null): Metric =>
  ({ id: `${label}${created_at}`, label, value, unit, created_at, updated_at: created_at, updated_by: null });

describe("latestPerLabel", () => {
  it("keeps the newest reading of each label, labels in the order they first appeared", () => {
    const rows = [m("Sleep", 3, "2026-10-08T10:00:00.000Z"), m("Steps", 9, "2026-10-08T10:00:00.000Z"), m("Sleep", 2, "2026-10-07T10:00:00.000Z"), m("Steps", 8, "2026-10-07T10:00:00.000Z")];   // newest first
    expect(latestPerLabel(rows).map((r) => [r.label, r.value])).toEqual([["Steps", 9], ["Sleep", 3]]);
  });
  it("is empty for no rows", () => expect(latestPerLabel([])).toEqual([]));
});

describe("headlineReadings", () => {
  it("puts pinned labels first, the rest in latestPerLabel order", () => {
    const rows = [m("PAI", 58, "2026-10-21T00:00:00.000Z"), m("Steps", 3452, "2026-10-20T18:29:00.000Z"), m("Weight", 72.5, "2026-08-20T03:00:00.000Z")];   // newest first
    expect(headlineReadings(rows, ["PAI"]).map((r) => r.label)).toEqual(["PAI", "Weight", "Steps"]);
  });
  it("leaves the order alone with nothing pinned", () => expect(headlineReadings([m("A", 1, "2026-10-21T00:00:00.000Z")], []).map((r) => r.label)).toEqual(["A"]));
});

describe("deltaOf", () => {
  const rows = [m("Steps", 132, "2026-10-08T10:00:00.000Z"), m("Sleep", 5, "2026-10-08T10:00:00.000Z"), m("Steps", 112, "2026-10-07T10:00:00.000Z"), m("Sleep", 0, "2026-10-07T10:00:00.000Z"), m("Solo", 4, "2026-10-08T10:00:00.000Z")];   // newest first
  it("is the percent change from the label's previous reading, to one decimal", () => expect(deltaOf(rows, "Steps")).toBe(17.9));
  it("is null with no previous reading, or a previous reading of zero", () => {
    expect(deltaOf(rows, "Solo")).toBeNull();
    expect(deltaOf(rows, "Sleep")).toBeNull();
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
  it("formats minutes and shares, and puts a unit after other numbers", () => {
    expect(kindOf("₹")).toBe("number");
    expect(statValue(m("Workout", 29, "x", "min"))).toEqual({ value: 29, kind: "minutes" });
    expect(statValue(m("Body fat", 64, "x", "%"))).toEqual({ value: 64, kind: "share" });
    expect(statValue(m("Weight", 72, "x", "kg"))).toEqual({ value: "72 kg" });
    expect(statValue(m("Steps", 8000, "x", "steps"))).toEqual({ value: 8000 });   // the label already says it
  });
});
