import { describe, it, expect } from "bun:test";
import { corrections, dayWord, sureLine } from "./PantryPage";

const today = "2026-10-28";   // a Wednesday

describe("dayWord", () => {
  it("today, yesterday, a weekday within the week, a date before that", () => {
    expect(dayWord("2026-10-28", today)).toBe("today");
    expect(dayWord("2026-10-27", today)).toBe("yesterday");
    expect(dayWord("2026-10-24", today)).toBe("Sat");
    expect(dayWord("2026-10-12", today)).toBe("Oct 12");
  });
});

describe("sureLine", () => {
  it("says what the app's belief rests on", () => {
    expect(sureLine({ status: "bought", since: "2026-10-27" }, today)).toBe("bought yesterday");
    expect(sureLine({ status: "have", since: "2026-10-26" }, today)).toBe("you have it (said Mon)");
    expect(sureLine({ status: "checked", since: "2026-10-25" }, today)).toBe("checked 3 days ago");
    expect(sureLine({ status: "checked", since: "2026-10-28" }, today)).toBe("checked today");
    expect(sureLine({ status: "assumed", since: null }, today)).toBe("assumed");
    expect(sureLine({ status: "low", since: "2026-10-28" }, today)).toBe("running low");
    expect(sureLine({ status: "out", since: "2026-10-28" }, today)).toBe("out");
  });
});

describe("corrections", () => {
  it("offers the likeliest correction first and never the current answer", () => {
    expect(corrections("bought")).toEqual(["low", "out", "yes"]);
    expect(corrections("assumed")).toEqual(["low", "out", "yes"]);
    expect(corrections("low")).toEqual(["yes", "out"]);
    expect(corrections("out")).toEqual(["yes", "low"]);
  });
});
