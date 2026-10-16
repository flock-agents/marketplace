import { describe, it, expect } from "bun:test";
import { addMonths, eventOrder, mondayOf, nextDue, normaliseEvent, normaliseReminder, ordinal, parseClock, repeatText, splitDue } from "../src/pages/dates";

const REPEATS = ["none", "daily", "weekly", "monthly"];

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

describe("nextDue: when a reminder next comes round", () => {
  const now = "2026-10-16T08:05";
  it("a one-off is due once, then done", () => {
    expect(nextDue({ due: "2026-10-16T19:00", repeat: "none" }, now)).toBe("2026-10-16T19:00");
    expect(nextDue({ due: "2026-10-15T19:00", repeat: "none" }, now)).toBeNull();
  });
  it("daily: today at that time if still ahead, else tomorrow", () => {
    expect(nextDue({ due: "2026-10-05T18:00", repeat: "daily" }, now)).toBe("2026-10-16T18:00");
    expect(nextDue({ due: "2026-10-05T07:30", repeat: "daily" }, now)).toBe("2026-10-17T07:30");
    expect(nextDue({ due: "2026-10-20T07:30", repeat: "daily" }, now)).toBe("2026-10-20T07:30");   // not started yet
  });
  it("weekly: the next same weekday, counting from the first due date", () => {
    expect(nextDue({ due: "2026-10-05T07:30", repeat: "weekly" }, now)).toBe("2026-10-19T07:30");   // a Monday; Friday now
    expect(nextDue({ due: "2026-10-02T07:30", repeat: "weekly" }, now)).toBe("2026-10-23T07:30");   // 07:30 today is gone: next Friday
    expect(nextDue({ due: "2026-10-02T09:00", repeat: "weekly" }, now)).toBe("2026-10-16T09:00");   // later today
  });
  it("monthly: the same day each month, a 31st on the last day of a short month and back to the 31st after", () => {
    expect(nextDue({ due: "2026-10-01T09:00", repeat: "monthly" }, now)).toBe("2026-11-01T09:00");
    expect(nextDue({ due: "2026-08-31T09:00", repeat: "monthly" }, now)).toBe("2026-10-31T09:00");
    expect(nextDue({ due: "2026-08-31T09:00", repeat: "monthly" }, "2026-11-01T00:00")).toBe("2026-11-30T09:00");
    expect(nextDue({ due: "2026-08-31T09:00", repeat: "monthly" }, "2026-12-01T00:00")).toBe("2026-12-31T09:00");
  });
  it("says how it repeats", () => {
    expect(repeatText({ due: "2026-10-05T07:30", repeat: "weekly" })).toBe("Weekly on Mondays");
    expect(repeatText({ due: "2026-10-01T09:00", repeat: "monthly" })).toBe("Monthly on the 1st");
    expect(repeatText({ due: "2026-10-01T09:00", repeat: "daily" })).toBe("Daily");
    expect(repeatText({ due: "2026-10-01T09:00", repeat: "none" })).toBe("Once");
    expect(splitDue("2026-10-01T09:00")).toEqual({ date: "2026-10-01", time: "09:00" });
  });
});

describe("the event form's values as a row", () => {
  it("normalises the times and blanks, keeps a whole number of minutes", () => {
    const r = normaliseEvent({ title: " Dentist ", date: "2026-10-16", start_time: "4:30 pm", end_time: "5pm", who: "", location: "Smile Dental", notes: undefined, reminder_minutes: 60 });
    expect(r).toEqual({ ok: true, row: { title: "Dentist", date: "2026-10-16", start_time: "16:30", end_time: "17:00", who: null, location: "Smile Dental", notes: null, reminder_minutes: 60 } });
    expect(normaliseEvent({ title: "Birthday", date: "2026-10-17" })).toEqual({ ok: true, row: { title: "Birthday", date: "2026-10-17", start_time: null, end_time: null, who: null, location: null, notes: null, reminder_minutes: null } });
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

describe("the reminder form's values as a row", () => {
  it("joins the date and time into due", () => {
    expect(normaliseReminder({ title: "PE kit", date: "2026-10-12", time: "7:30 am", repeat: "weekly", who: "Aarav" }, REPEATS))
      .toEqual({ ok: true, row: { title: "PE kit", due: "2026-10-12T07:30", repeat: "weekly", who: "Aarav" } });
    expect(normaliseReminder({ title: "Fees", date: "2026-11-01", time: "09:00" }, REPEATS)).toEqual({ ok: true, row: { title: "Fees", due: "2026-11-01T09:00", repeat: "none", who: null } });
  });
  it("needs a title, a date and a time, and a known repeat", () => {
    const r = normaliseReminder({ title: "", date: "", time: "sometime", repeat: "yearly" }, REPEATS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["date", "repeat", "time", "title"]);
  });
});
