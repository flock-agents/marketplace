import { describe, it, expect } from "bun:test";
import { addDays, dayLabel, localStamp, nextMonday, todayStr, weekDates, weekdayOf } from "./dates";

describe("dates", () => {
  it("finds the Monday strictly after a date", () => {
    expect(nextMonday("2026-11-21")).toBe("2026-11-23");   // Saturday → the coming Monday
    expect(nextMonday("2026-11-23")).toBe("2026-11-30");   // a Monday → the next one
    expect(nextMonday("2026-11-22")).toBe("2026-11-23");   // Sunday → tomorrow
  });
  it("names the weekday and the day", () => {
    expect(weekdayOf("2026-11-24")).toBe("Tue");
    expect(weekdayOf("2026-11-22")).toBe("Sun");
    expect(dayLabel("2026-11-24")).toBe("Tue 24 Nov");
    expect(dayLabel("2026-12-01")).toBe("Tue 1 Dec");
  });
  it("adds days across months, years and leap days", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("lists a week's seven dates from its Monday", () => {
    expect(weekDates("2026-11-23")).toEqual(["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
  });
  it("reads today and now in local time, not UTC", () => {
    const lateEvening = new Date(2026, 10, 24, 23, 45);    // 23:45 local: still the 24th here, whatever UTC says
    expect(todayStr(lateEvening)).toBe("2026-11-24");
    expect(localStamp(lateEvening)).toBe("2026-11-24T23:45");
    const earlyMorning = new Date(2026, 0, 5, 0, 7);
    expect(todayStr(earlyMorning)).toBe("2026-01-05");
    expect(localStamp(earlyMorning)).toBe("2026-01-05T00:07");
  });
});
