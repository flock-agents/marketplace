import { describe, it, expect } from "bun:test";
import { mondayOf, sampleDates, sampleEvents, sampleMembers, staggered } from "./seed";
import { COLOURS, KINDS, REPEATS } from "./schema";
import { occurrences } from "../../src/pages/dates";

const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;

describe("family-calendar sample rows", () => {
  const from = new Date(2026, 9, 8);   // a Thursday
  const names = sampleMembers().map((m) => m.name);
  const events = sampleEvents(from);
  it("finds the Monday of the current week, across month ends too", () => {
    expect(mondayOf(from)).toBe("2026-10-05");
    expect(mondayOf(new Date(2026, 9, 11))).toBe("2026-10-05");   // Sunday
    expect(mondayOf(new Date(2026, 10, 1))).toBe("2026-10-26");   // Sunday 1 November
  });
  it("is a small family, each with a theme tone and an emoji", () => {
    expect(names.length).toBe(4);
    for (const m of sampleMembers()) { expect(COLOURS as readonly string[]).toContain(m.colour); expect(m.emoji).toBeString(); }
    expect(new Set(sampleMembers().map((m) => m.colour)).size).toBe(4);
  });
  it("fills two weeks from Monday with the school run, football and the dentist", () => {
    const dates = [...new Set(events.map((e) => e.date))].sort();
    expect(dates[0]).toBe("2026-10-05");
    expect(dates.at(-1)! <= "2026-10-18").toBe(true);
    expect(events.filter((e) => e.title === "School run").length).toBe(10);
    for (const t of ["Football practice", "Dentist"]) expect(events.some((e) => e.title === t), t).toBe(true);
    expect(events.filter((e) => e.title === "Dentist").length).toBe(1);   // a one-off
    expect(events.filter((e) => e.title === "Football practice").length).toBe(2);   // weekly
  });
  it("always has today and tomorrow filled, whatever day it is made on", () => {
    for (let d = 0; d < 7; d++) {
      const day = new Date(2026, 9, 5 + d);
      const dates = new Set(sampleEvents(day).map((e) => e.date));
      const tomorrow = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
      expect(dates.has(iso(day)) || dates.has(iso(tomorrow)), `around ${iso(day)}`).toBe(true);
    }
  });
  it("an event is a date with optional times, and names a member of the family or nobody", () => {
    for (const e of events) {
      expect(Object.keys(e).sort()).toEqual(["date", "end_time", "location", "notes", "reminder_minutes", "start_time", "title", "who"]);
      if (e.start_time) expect(e.start_time).toMatch(/^\d{2}:\d{2}$/);
      if (e.end_time) expect(e.end_time! > e.start_time!).toBe(true);
      if (e.who) expect(names).toContain(e.who);
      expect(e.title.toLowerCase()).not.toContain("lorem");
    }
    expect([...events, ...sampleDates(from)].some((e) => e.start_time === null), "an all-day event").toBe(true);
    expect(events.some((e) => e.reminder_minutes), "an event with a reminder").toBe(true);
  });
  it("has grandma's birthday every year on this week's Saturday, and the school fees due on the 1st of each month", () => {
    const [birthday, fees] = sampleDates(from);
    expect(birthday).toMatchObject({ repeat: "yearly", kind: "event", start_time: null });
    expect(occurrences(birthday, "2026-10-05", "2026-10-11")).toEqual(["2026-10-10"]);
    expect(fees).toMatchObject({ repeat: "monthly", kind: "deadline", date: "2026-11-01", who: "Vikram" });
    for (const x of sampleDates(from)) { expect(REPEATS as readonly string[]).toContain(x.repeat); expect(KINDS as readonly string[]).toContain(x.kind); }
  });
  it("have distinct created_at stamps, in order and in the past", () => {
    const now = new Date();
    const at = staggered(events, now).map((r) => r.created_at);
    expect(new Set(at).size).toBe(at.length);
    expect([...at].sort()).toEqual(at);
    expect(at.every((t) => t <= now.toISOString())).toBe(true);
  });
});
