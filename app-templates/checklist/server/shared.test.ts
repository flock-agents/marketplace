import { describe, it, expect } from "bun:test";
import { formatDue, orderTasks } from "../src/pages/shared";

describe("formatDue", () => {
  it("says nothing without a date", () => expect(formatDue(null, false, "2026-10-08")).toBe(""));
  it("says overdue for an open item past its date", () => expect(formatDue("2026-10-04", false, "2026-10-08")).toBe("overdue 4 Oct"));
  it("says due for an item that is done, today or ahead", () => {
    expect(formatDue("2026-10-04", true, "2026-10-08")).toBe("due 4 Oct");
    expect(formatDue("2026-10-08", false, "2026-10-08")).toBe("due 8 Oct");
    expect(formatDue("2026-11-07", false, "2026-10-08")).toBe("due 7 Nov");
  });
});

describe("orderTasks", () => {
  const t = (id: string, due: string | null, done = false) => ({ id, due, done } as any);
  it("puts open items first by due date, undated last, then done items the same way", () => {
    const rows = [t("a", null), t("b", "2026-11-20"), t("c", "2026-11-15", true), t("d", "2026-11-15"), t("e", null, true), t("f", "2026-12-01"), t("g", "2026-11-25")];
    expect(orderTasks(rows).map((r) => r.id)).toEqual(["d", "b", "g", "f", "a", "c", "e"]);
  });
  it("keeps the given order among equals and does not change the input", () => {
    const rows = [t("x", null), t("y", null)]; const copy = [...rows];
    expect(orderTasks(rows).map((r) => r.id)).toEqual(["x", "y"]); expect(rows).toEqual(copy);
  });
});
