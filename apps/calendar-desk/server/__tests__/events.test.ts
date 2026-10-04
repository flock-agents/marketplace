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
    const { rows } = normalizeScrape([
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

describe("live-fix 6: spaceless agenda headers", () => {
  test("parseDateHeader accepts a missing space and every older shape", () => {
    expect(parseDateHeader("4Oct, Sun", 2026)).toBe("2026-10-04");
    expect(parseDateHeader("4Oct", 2026)).toBe("2026-10-04");
    expect(parseDateHeader("Oct4", 2026)).toBe("2026-10-04");
    expect(parseDateHeader("11Oct, Sun", 2026)).toBe("2026-10-11");
    expect(parseDateHeader("4 Oct", 2026)).toBe("2026-10-04");
    expect(parseDateHeader("Sun, 4 Oct", 2026)).toBe("2026-10-04");
    expect(parseDateHeader("4 October 2026", 2026)).toBe("2026-10-04");
    expect(parseDateHeader("October 4, 2026", 2026)).toBe("2026-10-04");
    expect(parseDateHeader("garbage text", 2026)).toBeNull();
  });
  test("a glued time is not a year; glued live headers", () => {
    expect(parseDateHeader("4Oct 1030am", 2026)).toBe("2026-10-04");
    expect(parseDateHeader("4Oct, Sun7 – 7:30pmDinner @ Prity's", 2026)).toBe("2026-10-04");
    expect(parseDateHeader("Sun4", 2026)).toBeNull();
    const { rows, skipped } = normalizeScrape([{ title: "X", date: "Sun4" }], { calendar: null, fallbackDate: d, now: new Date(2026, 9, 4) });
    expect(rows.length).toBe(0); expect(skipped).toBe(1);
  });
  test("parseTimeText accepts the normalised both-sides-meridiem form", () => {
    expect(parseTimeText("7pm – 7:30pm", d)).toEqual({ startAt: local(19), endAt: local(19, 30), allDay: false });
    expect(parseTimeText("1:15pm – 1:45pm", d)).toEqual({ startAt: local(13, 15), endAt: local(13, 45), allDay: false });
  });
  const opts = { calendar: null, fallbackDate: d, now: new Date(2026, 9, 4) };
  test("same-title events on adjacent days stay two rows", () => {
    const { rows } = normalizeScrape([
      { title: "Agastya School PTM", time: "All day", date: "4Oct, Sun" },
      { title: "Agastya School PTM", time: "All day", date: "5Oct, Mon" },
    ], opts);
    expect(rows.map((r) => r.localDate)).toEqual(["2026-10-04", "2026-10-05"]);
  });
  test("unparseable dated rows are skipped with one warning; empty date uses the fallback", () => {
    const warns: unknown[][] = [];
    const orig = console.warn;
    console.warn = (...a: unknown[]) => { warns.push(a); };
    try {
      const { rows, skipped } = normalizeScrape([
        { title: "Lost", time: "1pm", date: "garbage text" },
        { title: "Lost too", time: "2pm", date: "garbage text" },
        { title: "Nodate", time: "3pm", date: "" },
        { title: "Undef", time: "4pm" },
      ], opts);
      expect(rows.map((r) => r.title)).toEqual(["Nodate", "Undef"]);
      expect(rows.every((r) => r.localDate === d)).toBe(true);
      expect(skipped).toBe(2);
    } finally { console.warn = orig; }
    expect(warns.length).toBe(1);
    expect(String(warns[0]![0])).toContain("garbage text");
  });
  test("allDay flag wins over a time string; attendees and location are carried", () => {
    const { rows: [r] } = normalizeScrape([
      { title: "Offsite", time: "9am – 5pm", date: "4 October 2026", allDay: true, location: "Bangalore", attendees: "a@x.com, b@x.com" },
    ], opts);
    expect(r).toMatchObject({ allDay: true, startAt: null, endAt: null, location: "Bangalore", attendeesText: "a@x.com, b@x.com", rawTimeText: "9am – 5pm" });
  });
  describe("A16 filtering", () => {
    const d = "2026-10-04";
    const o = { calendar: "primary", fallbackDate: d, now: new Date(2026, 9, 4) };
    test("holiday calendar rows dropped, timed kept, all-day with attendees kept, creator-less all-day dropped", () => {
      const r = normalizeScrape([
        { title: "First Day of Sharad Navratri", date: "4 October 2026", allDay: true, calendar: "Holidays in India" },
        { title: "Dinner @ Prity's", date: "4 October 2026", time: "8 – 9pm", attendees: "Shiva Shankar" },
        { title: "Offsite", date: "4 October 2026", allDay: true, attendees: "a@x.com" },
        { title: "Random banner", date: "4 October 2026", allDay: true },
        { title: "Work thing", date: "4 October 2026", time: "9am", calendar: "Work" },
        { title: "Family day", date: "4 October 2026", allDay: true, calendar: "Family", attendees: "Mum" },
        { title: "Family banner", date: "4 October 2026", allDay: true, calendar: "Family" },
        { title: "Anu", date: "4 October 2026", allDay: true, calendar: "Birthdays", attendees: "x" },
      ], o);
      expect(r.rows.map((x) => x.title)).toEqual(["Dinner @ Prity's", "Offsite", "Work thing", "Family day"]);
      expect(r.filtered).toBe(4);
      expect(r.skipped).toBe(0);
    });
  });
});
