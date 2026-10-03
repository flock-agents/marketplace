import { describe, test, expect } from "bun:test";
import { parseTimeText, parseDateHeader, eventKey, normalizeScrape } from "../events";

const d = "2026-10-05";
const local = (h: number, m = 0) => new Date(2026, 9, 5, h, m).getTime();

describe("parseTimeText (owner tz = process TZ)", () => {
  test("ranges, 12h and 24h, with and without am/pm on the start", () => {
    expect(parseTimeText("9:30 – 10am", d)).toEqual({ startAt: local(9, 30), endAt: local(10), allDay: false });
    expect(parseTimeText("3 – 3:30pm", d)).toEqual({ startAt: local(15), endAt: local(15, 30), allDay: false });
    expect(parseTimeText("14:00 – 15:00", d)).toEqual({ startAt: local(14), endAt: local(15), allDay: false });
    expect(parseTimeText("11:30pm – 12:30am", d).endAt).toBe(new Date(2026, 9, 6, 0, 30).getTime());
  });
  test("meridiem inheritance: prefer start < end", () => {
    expect(parseTimeText("11:30 – 12pm", d)).toEqual({ startAt: local(11, 30), endAt: local(12), allDay: false });
    expect(parseTimeText("10 – 1pm", d)).toEqual({ startAt: local(10), endAt: local(13), allDay: false });
    expect(parseTimeText("12 – 1pm", d)).toEqual({ startAt: local(12), endAt: local(13), allDay: false });
    expect(parseTimeText("11 – 12pm", d)).toEqual({ startAt: local(11), endAt: local(12), allDay: false });
  });
  test("a lone start time, all-day, and garbage", () => {
    expect(parseTimeText("6:40am", d)).toEqual({ startAt: local(6, 40), endAt: null, allDay: false });
    expect(parseTimeText("All day", d)).toEqual({ startAt: null, endAt: null, allDay: true });
    expect(parseTimeText(undefined, d).allDay).toBe(true);
    expect(parseTimeText("tbd", d)).toEqual({ startAt: null, endAt: null, allDay: true });
  });
});

describe("parseDateHeader", () => {
  test("agenda header shapes", () => {
    expect(parseDateHeader("Mon, 5 Oct", 2026)).toBe("2026-10-05");
    expect(parseDateHeader("Monday, October 5, 2026", 2026)).toBe("2026-10-05");
    expect(parseDateHeader("5 Oct 2026", 2026)).toBe("2026-10-05");
    expect(parseDateHeader("Today", 2026)).toBeNull();
  });
});

describe("eventKey", () => {
  test("stable for the same thing, different for a moved, renamed or re-timed one; case/space-insensitive on title", () => {
    const a = eventKey({ calendar: "primary", localDate: d, startAt: local(9), title: "Pricing review" });
    expect(eventKey({ calendar: "primary", localDate: d, startAt: local(9), title: "  pricing   REVIEW " })).toBe(a);
    expect(eventKey({ calendar: "primary", localDate: d, startAt: local(10), title: "Pricing review" })).not.toBe(a);
    expect(eventKey({ calendar: "primary", localDate: "2026-10-06", startAt: local(9), title: "Pricing review" })).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("normalizeScrape", () => {
  test("maps rows, carries the raw time text, dedupes identical rows", () => {
    const rows = normalizeScrape([
      { title: "Standup", time: "9:30 – 10am", date: "Mon, 5 Oct" },
      { title: "Standup", time: "9:30 – 10am", date: "Mon, 5 Oct" },
      { title: "Diwali", time: "All day", date: "Tue, 20 Oct" },
      { title: "", time: "1pm" },
    ], { calendar: "primary", fallbackDate: d, now: new Date(2026, 9, 5) });
    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({ title: "Standup", localDate: "2026-10-05", allDay: false, rawTimeText: "9:30 – 10am" });
    expect(rows[1]).toMatchObject({ title: "Diwali", localDate: "2026-10-20", allDay: true });
  });
});
