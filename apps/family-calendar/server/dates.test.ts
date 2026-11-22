import { describe, it, expect } from "bun:test";
import { addMonths, clock12, deadlineNoticeAt, eveningBeforeMinutes, eventOrder, eventRemindersDue, minutesBefore, monthlyByProblem, mondayOf, nextOccurrence, normaliseEvent, occurrences, ordinal, parseClock, repeatText } from "../src/pages/dates";

describe("parseClock: what people type as a time", () => {
  it("reads 24-hour, 12-hour and loose forms", () => {
    expect(parseClock("16:30")).toBe("16:30");
    expect(parseClock("4:30 pm")).toBe("16:30");
    expect(parseClock("4:30PM")).toBe("16:30");
    expect(parseClock("4pm")).toBe("16:00");
    expect(parseClock("12 am")).toBe("00:00");
    expect(parseClock("12:15 pm")).toBe("12:15");
    expect(parseClock("16.30")).toBe("16:30");
    expect(parseClock("0930")).toBe("09:30");
    expect(parseClock(" 8 ")).toBe("08:00");
  });
  it("refuses what is not a time", () => {
    for (const bad of ["", "noon", "25:00", "16:60", "13 pm", "0 am", null, undefined, 1630]) expect(parseClock(bad), String(bad)).toBeNull();
  });
});

describe("dates", () => {
  it("addMonths clamps to the shorter month", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-10-31", 1)).toBe("2026-11-30");
    expect(addMonths("2026-11-30", 2)).toBe("2027-01-30");
  });
  it("mondayOf and ordinal", () => {
    expect(mondayOf("2026-10-08")).toBe("2026-10-05");
    expect(mondayOf("2026-10-05")).toBe("2026-10-05");
    expect(mondayOf("2026-11-01")).toBe("2026-10-26");
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "31st"]);
  });
  it("orders events by date, all-day first, then by time", () => {
    const rows = [
      { title: "Football", date: "2026-10-13", start_time: "17:00" },
      { title: "Birthday", date: "2026-10-13", start_time: null },
      { title: "School run", date: "2026-10-12", start_time: "08:00" },
      { title: "Piano", date: "2026-10-13", start_time: "16:00" },
    ];
    expect([...rows].sort(eventOrder).map((r) => r.title)).toEqual(["School run", "Birthday", "Piano", "Football"]);
  });
});

describe("how an event repeats, in words", () => {
  it("names the weekday, the day of the month or the day of the year", () => {
    expect(repeatText("2026-10-05", "weekly")).toBe("Weekly on Mondays");
    expect(repeatText("2026-10-01", "monthly")).toBe("Monthly on the 1st");
    expect(repeatText("2026-10-01", "daily")).toBe("Daily");
    expect(repeatText("2020-11-28", "yearly")).toBe("Yearly on Nov 28");
    expect(repeatText("2026-10-01", "none")).toBe("Once");
  });
});

describe("the event form's values as a row", () => {
  it("normalises the times and blanks, keeps a whole number of minutes", () => {
    const r = normaliseEvent({ title: " Dentist ", date: "2026-10-16", start_time: "4:30 pm", end_time: "5pm", who: "", location: "Smile Dental", notes: undefined, reminder_minutes: 60 });
    expect(r).toEqual({ ok: true, row: { title: "Dentist", date: "2026-10-16", repeat: "none", monthly_by: null, start_time: "16:30", end_time: "17:00", who: null, location: "Smile Dental", notes: null, reminder_minutes: 60 } });
    expect(normaliseEvent({ title: "Birthday", date: "2026-10-17" })).toEqual({ ok: true, row: { title: "Birthday", date: "2026-10-17", repeat: "none", monthly_by: null, start_time: null, end_time: null, who: null, location: null, notes: null, reminder_minutes: null } });
  });
  it("names each field that is wrong", () => {
    const r = normaliseEvent({ title: "", date: "16/10/2026", start_time: "half four", end_time: "17:00", reminder_minutes: -5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["date", "reminder_minutes", "start_time", "title"]);
    const order = normaliseEvent({ title: "X", date: "2026-10-16", start_time: "17:00", end_time: "16:00" });
    if (!order.ok) expect(order.errors).toEqual({ end_time: "Must be after the start" });
    const noStart = normaliseEvent({ title: "X", date: "2026-10-16", end_time: "16:00" });
    if (!noStart.ok) expect(Object.keys(noStart.errors)).toEqual(["start_time"]);
  });
});

describe("an event that repeats", () => {
  const skating = { date: "2026-11-24", repeat: "weekly" };   // a Tuesday
  it("falls on its weekday in every week from its first day on, and a one-off only on its date", () => {
    expect(occurrences(skating, "2026-11-20", "2026-11-26")).toEqual(["2026-11-24"]);
    expect(occurrences(skating, "2026-11-27", "2026-12-03")).toEqual(["2026-12-01"]);
    expect(occurrences(skating, "2027-03-01", "2027-03-14")).toEqual(["2027-03-02", "2027-03-09"]);
    expect(occurrences(skating, "2026-11-24", "2026-11-24")).toEqual(["2026-11-24"]);
    expect(occurrences(skating, "2026-11-13", "2026-11-19")).toEqual([]);   // before it began
    expect(occurrences({ date: "2026-11-24", repeat: "none" }, "2026-11-20", "2026-11-26")).toEqual(["2026-11-24"]);
    expect(occurrences({ date: "2026-11-24" }, "2026-11-27", "2026-12-03")).toEqual([]);
  });
  it("every day from its first; every month on its day, the last day of a shorter month", () => {
    expect(occurrences({ date: "2026-11-22", repeat: "daily" }, "2026-11-20", "2026-11-24")).toEqual(["2026-11-22", "2026-11-23", "2026-11-24"]);
    const rent = { date: "2026-10-31", repeat: "monthly" };
    expect(occurrences(rent, "2026-11-01", "2027-03-31")).toEqual(["2026-11-30", "2026-12-31", "2027-01-31", "2027-02-28", "2027-03-31"]);
    expect(occurrences(rent, "2026-11-20", "2026-11-26")).toEqual([]);
    expect(nextOccurrence(rent, "2026-12-01")).toBe("2026-12-31");
    expect(nextOccurrence({ date: "2026-11-22", repeat: "daily" }, "2026-12-01")).toBe("2026-12-01");
  });
  it("is listed at the next day it falls on", () => {
    expect(nextOccurrence(skating, "2026-11-20")).toBe("2026-11-24");
    expect(nextOccurrence(skating, "2026-11-24")).toBe("2026-11-24");
    expect(nextOccurrence(skating, "2026-11-25")).toBe("2026-12-01");
    expect(nextOccurrence(skating, "2026-10-01")).toBe("2026-11-24");   // not begun yet
    expect(nextOccurrence({ date: "2026-11-24", repeat: "none" }, "2026-11-25")).toBeNull();
  });
  it("the form keeps how it repeats, yearly too, and names a repeat it does not know", () => {
    expect(normaliseEvent({ title: "Skating", date: "2026-11-24", repeat: "weekly" })).toMatchObject({ ok: true, row: { repeat: "weekly" } });
    expect(normaliseEvent({ title: "Grandma's birthday", date: "1950-11-28", repeat: "yearly" })).toMatchObject({ ok: true, row: { repeat: "yearly" } });
    const bad = normaliseEvent({ title: "Skating", date: "2026-11-24", repeat: "fortnightly" });
    if (!bad.ok) expect(Object.keys(bad.errors)).toEqual(["repeat"]); else throw new Error("fortnightly was taken");
  });
});

describe("an event that comes round every year", () => {
  const birthday = { date: "1950-11-28", repeat: "yearly" };
  it("falls on its day each year from its first", () => {
    expect(occurrences(birthday, "2026-11-20", "2026-11-30")).toEqual(["2026-11-28"]);
    expect(occurrences(birthday, "2026-11-29", "2027-11-27")).toEqual([]);
    expect(occurrences(birthday, "2026-01-01", "2028-12-31")).toEqual(["2026-11-28", "2027-11-28", "2028-11-28"]);
    expect(occurrences({ date: "2027-03-10", repeat: "yearly" }, "2026-01-01", "2027-12-31")).toEqual(["2027-03-10"]);   // not before it began
  });
  it("a 29 February falls on 28 February in the years without one, and on the 29th in a leap year", () => {
    const leap = { date: "2024-02-29", repeat: "yearly" };
    expect(occurrences(leap, "2025-01-01", "2028-12-31")).toEqual(["2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"]);
    expect(occurrences(leap, "2026-02-28", "2026-02-28")).toEqual(["2026-02-28"]);
    expect(occurrences(leap, "2026-03-01", "2026-03-01")).toEqual([]);
  });
  it("is listed at its next day, even when that is most of a year away", () => {
    expect(nextOccurrence(birthday, "2026-11-28")).toBe("2026-11-28");
    expect(nextOccurrence(birthday, "2026-11-29")).toBe("2027-11-28");
    expect(nextOccurrence({ date: "2024-02-29", repeat: "yearly" }, "2026-03-01")).toBe("2027-02-28");
  });
  it("its reminder comes due each year", () => {
    const e = { date: "1950-11-28", repeat: "yearly", start_time: null, reminder_minutes: 60 };
    expect(eventRemindersDue(e, "2026-11-27T22:45", "2026-11-27T23:00")).toEqual([{ date: "2026-11-28", at: "2026-11-27T23:00" }]);
  });
});

describe("an event's own reminder", () => {
  it("a due date is spoken of a week before, at 9 in the morning", () => {
    expect(deadlineNoticeAt("2026-12-10")).toBe("2026-12-03T09:00");
  });
  it("is due its minutes before the start; the old evening before was 7 pm the day before", () => {
    expect(minutesBefore("2026-11-24", "16:00", 60)).toBe("2026-11-24T15:00");
    expect(minutesBefore("2026-11-24", "00:30", 60)).toBe("2026-11-23T23:30");
    expect(eveningBeforeMinutes("16:00")).toBe(21 * 60);
    expect(minutesBefore("2026-11-24", "16:00", eveningBeforeMinutes("16:00"))).toBe("2026-11-23T19:00");
    expect(minutesBefore("2026-11-24", "00:00", eveningBeforeMinutes(null))).toBe("2026-11-23T19:00");   // an all-day event
    expect(clock12("16:30")).toBe("4:30 pm");
    expect(clock12("06:00")).toBe("6 am");
  });
  it("comes due once per day of the event, after the window's start and up to its end", () => {
    const skating = { date: "2026-11-24", repeat: "weekly", start_time: "16:00", reminder_minutes: eveningBeforeMinutes("16:00") };
    expect(eventRemindersDue(skating, "2026-11-23T18:45", "2026-11-23T19:00")).toEqual([{ date: "2026-11-24", at: "2026-11-23T19:00" }]);
    expect(eventRemindersDue(skating, "2026-11-23T19:00", "2026-11-23T19:15")).toEqual([]);   // said in the run before
    expect(eventRemindersDue(skating, "2026-11-30T18:45", "2026-11-30T19:00")).toEqual([{ date: "2026-12-01", at: "2026-11-30T19:00" }]);   // and every week
    expect(eventRemindersDue({ ...skating, reminder_minutes: null }, "2026-11-23T18:45", "2026-11-23T19:00")).toEqual([]);
    const dentist = { date: "2026-11-27", repeat: "none", start_time: "11:00", reminder_minutes: 60 };
    expect(eventRemindersDue(dentist, "2026-11-27T09:45", "2026-11-27T10:00")).toEqual([{ date: "2026-11-27", at: "2026-11-27T10:00" }]);
    expect(eventRemindersDue(dentist, "2026-12-04T09:45", "2026-12-04T10:00")).toEqual([]);
  });
});

describe("a monthly event on a weekday of the month (monthly_by)", () => {
  // The society committee meets on the first Sunday of every month: 6 Dec 2026 is the first Sunday of December.
  const society = { date: "2026-12-06", repeat: "monthly", monthly_by: "weekday" };
  it("the 1st Sunday: every month's first Sunday, across the new year", () => {
    expect(occurrences(society, "2026-12-01", "2027-06-30")).toEqual(["2026-12-06", "2027-01-03", "2027-02-07", "2027-03-07", "2027-04-04", "2027-05-02", "2027-06-06"]);
    expect(occurrences(society, "2027-01-04", "2027-01-31")).toEqual([]);   // not the 6th, as a monthly-by-date one would be
    expect(occurrences(society, "2026-11-01", "2026-11-30")).toEqual([]);   // not before it began
  });
  it("the 2nd Tuesday", () => {
    expect(occurrences({ date: "2026-11-10", repeat: "monthly", monthly_by: "weekday" }, "2026-11-01", "2027-02-28")).toEqual(["2026-11-10", "2026-12-08", "2027-01-12", "2027-02-09"]);
  });
  it("the last Friday, and the last Tuesday of a leap year's February (its 5th)", () => {
    expect(occurrences({ date: "2026-11-27", repeat: "monthly", monthly_by: "last_weekday" }, "2026-11-01", "2027-02-28")).toEqual(["2026-11-27", "2026-12-25", "2027-01-29", "2027-02-26"]);
    expect(occurrences({ date: "2028-01-25", repeat: "monthly", monthly_by: "last_weekday" }, "2028-02-01", "2028-03-31")).toEqual(["2028-02-29", "2028-03-28"]);
    // The 1st Tuesday of February 2028 is the 1st, and of a non-leap February too.
    expect(occurrences({ date: "2028-01-04", repeat: "monthly", monthly_by: "weekday" }, "2028-02-01", "2028-02-29")).toEqual(["2028-02-01"]);
    expect(occurrences({ date: "2027-01-31", repeat: "monthly", monthly_by: "last_weekday" }, "2027-02-01", "2027-02-28")).toEqual(["2027-02-28"]);
  });
  it("a 5th weekday that came in through the page falls only in the months that have one", () => {
    expect(occurrences({ date: "2026-12-29", repeat: "monthly", monthly_by: "weekday" }, "2027-01-01", "2027-03-31")).toEqual(["2027-03-30"]);
  });
  it("monthly_by is read only for a monthly event; an old row without it is by date, as before", () => {
    expect(occurrences({ date: "2026-12-06", repeat: "monthly", monthly_by: null }, "2027-01-01", "2027-01-31")).toEqual(["2027-01-06"]);
    expect(occurrences({ date: "2026-12-06", repeat: "monthly", monthly_by: "date" }, "2027-01-01", "2027-01-31")).toEqual(["2027-01-06"]);
    expect(occurrences({ date: "2026-12-06", repeat: "weekly", monthly_by: "weekday" }, "2026-12-07", "2026-12-13")).toEqual(["2026-12-13"]);
  });
  it("is listed at its next day, and nudged before that day", () => {
    expect(nextOccurrence(society, "2027-01-04")).toBe("2027-02-07");
    expect(nextOccurrence({ date: "2026-12-29", repeat: "monthly", monthly_by: "weekday" }, "2026-12-30")).toBe("2027-03-30");
    const e = { ...society, start_time: "11:00", reminder_minutes: 30 };
    expect(eventRemindersDue(e, "2027-01-03T10:15", "2027-01-03T10:30")).toEqual([{ date: "2027-01-03", at: "2027-01-03T10:30" }]);
    expect(eventRemindersDue(e, "2027-01-06T10:15", "2027-01-06T10:30")).toEqual([]);
  });
  it("in words", () => {
    expect(repeatText("2026-12-06", "monthly", "weekday")).toBe("Monthly on the 1st Sunday");
    expect(repeatText("2026-11-10", "monthly", "weekday")).toBe("Monthly on the 2nd Tuesday");
    expect(repeatText("2026-11-27", "monthly", "last_weekday")).toBe("Monthly on the last Friday");
    expect(repeatText("2026-12-06", "monthly", null)).toBe("Monthly on the 6th");
    expect(repeatText("2026-12-06", "weekly", "weekday")).toBe("Weekly on Sundays");
  });
  it("says why a start date cannot be read that way", () => {
    expect(monthlyByProblem("2026-12-06", "weekday")).toBeNull();
    expect(monthlyByProblem("2026-11-27", "last_weekday")).toBeNull();
    expect(monthlyByProblem("2026-12-29", "weekday")).toBe('2026-12-29 is the 5th Tuesday of its month, and most months have no 5th: for "the last Tuesday of every month" use monthly_by "last_weekday"');
    expect(monthlyByProblem("2026-11-20", "last_weekday")).toBe("2026-11-20 is not the last Friday of its month (that is 2026-11-27): give the date of a last Friday");
    expect(monthlyByProblem("2026-11-20", "date")).toBeNull();
  });
  it("the form takes it for a monthly event only, and names a start date that does not fit", () => {
    expect(normaliseEvent({ title: "Society meeting", date: "2026-12-06", repeat: "monthly", monthly_by: "weekday" })).toMatchObject({ ok: true, row: { repeat: "monthly", monthly_by: "weekday" } });
    expect(normaliseEvent({ title: "Society meeting", date: "2026-12-06", repeat: "monthly", monthly_by: "date" })).toMatchObject({ ok: true, row: { monthly_by: null } });
    expect(normaliseEvent({ title: "Skating", date: "2026-12-06", repeat: "weekly", monthly_by: "weekday" })).toMatchObject({ ok: true, row: { monthly_by: null } });
    const fifth = normaliseEvent({ title: "X", date: "2026-12-29", repeat: "monthly", monthly_by: "weekday" });
    if (!fifth.ok) expect(Object.keys(fifth.errors)).toEqual(["monthly_by"]); else throw new Error("a 5th Tuesday was taken");
    const notLast = normaliseEvent({ title: "X", date: "2026-11-20", repeat: "monthly", monthly_by: "last_weekday" });
    if (!notLast.ok) expect(Object.keys(notLast.errors)).toEqual(["monthly_by"]); else throw new Error("a Friday that is not the last was taken");
    const unknown = normaliseEvent({ title: "X", date: "2026-11-20", repeat: "monthly", monthly_by: "second" });
    if (unknown.ok) throw new Error("an unknown monthly_by was taken");
  });
});
