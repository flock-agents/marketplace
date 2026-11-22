// add_events as the agent calls it: a family's week in one call, weekly events kept once per weekday, members made as they
// are named, each event's own nudge (30 minutes before a timed one unless it says), a birthday every year, a due date as a
// deadline, who added it, and a refusal that names every bad field and writes nothing.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { occurrences } from "../src/pages/dates";

// Friday 20 Nov 2026, 5:30 pm: the day of the live run this operation was written after.
const NOW = () => new Date(2026, 10, 20, 17, 30);
const drops = "Gowri Shankar drops and picks up";
/** The child's classes of that run: four classes, seven weekly days. */
const CLASSES = [
  { title: "Skating class", who: "Agastya", weekdays: ["Tue", "Thu"], start_time: "16:00", end_time: "17:30", notes: drops },
  { title: "Art class", who: "Agastya", weekdays: ["Fri"], start_time: "5 pm", notes: drops },
  { title: "Chess class", who: "Agastya", weekdays: ["Sat", "Sun"], start_time: "10:00", end_time: "11:00", notes: "Goes alone, in the society" },
  { title: "Keyboard class", who: "Agastya", weekdays: ["saturday", "SUN"], start_time: "16:00", end_time: "17:00", notes: "Shiva drops and picks up", reminder: 60 },
];

describe("add_events", () => {
  it("takes a week of classes in one call: one weekly event per weekday, on the calendar every week", async () => {
    const k = await boot({ now: NOW });
    const r = await k.op("add_events", { events: CLASSES });
    expect(r.error).toBeUndefined();
    expect(r).toMatchObject({ added: 7, updated: 0, members_added: ["Agastya"], samples_cleared: 0 });
    // Each begins on the first such day from today (Fri 20 Nov): Art today, Chess and Keyboard tomorrow.
    expect(r.events.map((e: any) => [e.title, e.date, e.repeat, e.start_time, e.end_time])).toEqual([
      ["Skating class", "2026-11-24", "weekly", "16:00", "17:30"], ["Skating class", "2026-11-26", "weekly", "16:00", "17:30"],
      ["Art class", "2026-11-20", "weekly", "17:00", null],
      ["Chess class", "2026-11-21", "weekly", "10:00", "11:00"], ["Chess class", "2026-11-22", "weekly", "10:00", "11:00"],
      ["Keyboard class", "2026-11-21", "weekly", "16:00", "17:00"], ["Keyboard class", "2026-11-22", "weekly", "16:00", "17:00"]]);
    // They are events, stamped as the agent's; the nudge is the event's own.
    const events = k.rows("events");
    expect(events).toHaveLength(7);
    expect(events.every((e) => e.who === "Agastya" && e.updated_by === "agent:butler")).toBe(true);
    expect(events[0]).toMatchObject({ notes: drops, reminder_minutes: 30, kind: "event", status: "active", added_by: null, imported: 0 });   // half an hour before, unless it says
    expect(events[5].reminder_minutes).toBe(60);
    expect(events[2].reminder_minutes).toBe(30);
    expect(k.rows("members").map((m) => [m.name, m.colour])).toEqual([["Agastya", "accent"]]);
    // What the Week page reads for 20 to 26 Nov, and for a week next March: every class on its days.
    const weekly = (await k.owner("GET", "/api/_data/events?repeat[ne]=none&date[lte]=2026-11-26&limit=500")).body.rows;
    const on = (from: string, to: string) => weekly.flatMap((e: any) => occurrences(e, from, to).map((d) => `${d} ${e.title}`)).sort();
    expect(on("2026-11-20", "2026-11-26")).toEqual(["2026-11-20 Art class", "2026-11-21 Chess class", "2026-11-21 Keyboard class",
      "2026-11-22 Chess class", "2026-11-22 Keyboard class", "2026-11-24 Skating class", "2026-11-26 Skating class"]);
    const later = (await k.owner("GET", "/api/_data/events?repeat[ne]=none&date[lte]=2027-03-07&limit=500")).body.rows;
    expect(later.flatMap((e: any) => occurrences(e, "2027-03-01", "2027-03-07"))).toHaveLength(7);
  });

  it("a one-day event has its date; a weekly one may start on a date; members come with the call", async () => {
    const k = await boot({ now: NOW });
    const r = await k.op("add_events", {
      events: [
        { title: "Dentist", who: "ankita", date: "2026-11-27", start_time: "11:00", location: "Smile Dental", reminder: 60 },
        { title: "Grandma's birthday", date: "1950-12-05", repeat: "yearly" },
        { title: "Swimming", who: "Agastya", weekdays: ["Mon"], date: "2027-01-04", start_time: "07:00" },
        { title: "School run", who: "Shiva", date: "2026-11-23", repeat: "weekly", start_time: "08:00" },
        { title: "Society maintenance", date: "2026-12-05", repeat: "monthly", kind: "deadline", added_by: "Ankita" }],
      members: [{ name: "Ankita", emoji: "👩", colour: "info" }, { name: "Gowri Shankar", emoji: "👴" }], added_by: "Shiva" });
    expect(r.error).toBeUndefined();
    expect(r).toMatchObject({ added: 5, members_added: ["Ankita", "Gowri Shankar", "Agastya", "Shiva"] });
    // `who` is written as the member is named, whatever capitals the call used; a new member takes the next colour.
    expect(k.rows("events").map((e) => [e.title, e.who, e.date, e.repeat, e.reminder_minutes, e.kind, e.added_by])).toEqual([
      ["Dentist", "Ankita", "2026-11-27", "none", 60, "event", "Shiva"], ["Grandma's birthday", null, "1950-12-05", "yearly", null, "event", "Shiva"],
      ["Swimming", "Agastya", "2027-01-04", "weekly", 30, "event", "Shiva"], ["School run", "Shiva", "2026-11-23", "weekly", 30, "event", "Shiva"],
      ["Society maintenance", null, "2026-12-05", "monthly", null, "deadline", "Ankita"]]);
    // A yearly one sent again is the same event (its day of the year), whatever year the call names.
    expect((await k.op("add_events", { events: [{ title: "Grandma's birthday", date: "2026-12-05", repeat: "yearly", notes: "Cake" }] })).updated).toBe(1);
    expect(k.rows("members").map((m) => [m.name, m.colour, m.emoji])).toEqual([["Ankita", "info", "👩"], ["Gowri Shankar", "info", "👴"], ["Agastya", "success", null], ["Shiva", "warning", null]]);
    // A member named again is changed, not doubled.
    await k.op("add_events", { events: [{ title: "Walk", who: "Gowri Shankar", weekdays: ["Mon"] }], members: [{ name: "gowri shankar", colour: "danger" }] });
    expect(k.rows("members").filter((m) => m.name === "Gowri Shankar")).toMatchObject([{ colour: "danger", emoji: "👴" }]);
  });

  it("the same event sent again changes the one there; a weekly one keeps the day it began", async () => {
    let now = NOW();
    const k = await boot({ now: () => now });
    await k.op("add_events", { events: CLASSES });
    now = new Date(2026, 10, 30, 9);   // ten days on, the call is repeated with one change
    const r = await k.op("add_events", { events: [{ ...CLASSES[0], end_time: "17:00", reminder: null }, CLASSES[1]] });
    expect(r).toMatchObject({ added: 0, updated: 3, members_added: [] });
    const events = k.rows("events");
    expect(events).toHaveLength(7);
    expect(events.filter((e) => e.title === "Skating class").map((e) => [e.date, e.end_time, e.reminder_minutes])).toEqual([["2026-11-24", "17:00", null], ["2026-11-26", "17:00", null]]);
    // Another time of day is another event.
    expect((await k.op("add_events", { events: [{ ...CLASSES[1], start_time: "18:00" }] })).added).toBe(1);
  });

  it("refuses the whole call, naming each event and field, and writes nothing", async () => {
    const k = await boot({ now: NOW });
    const r = await k.op("add_events", { events: [
      CLASSES[0],
      { title: "Art class", who: "Agastya", weekdays: ["Fryday"], start: "17:00" },
      { who: "Agastya", date: "27/11/2026", start_time: "half four", end_time: "17:00" },
      { title: "Chess", weekdays: ["Sat"], start_time: "11:00", end_time: "10:00", reminder: "the night before" },
      { title: "Picnic" },
      { title: "Swim", date: "2026-12-01", start_time: "07:00", reminder: "evening before", kind: "holiday" }] });
    expect(r.code).toBe("APP_REFUSED");
    expect(r.status).toBe(400);
    expect(r.error).toStartWith("Nothing was added. ");
    for (const said of [
      "events[1] (Art class): start is not a field of an event (did you mean start_time?); the fields: title, who, date, weekdays, repeat, monthly_by, start_time, end_time, location, notes, reminder, kind, added_by",
      'events[1] (Art class): weekdays: "Fryday" is not a weekday (Mon, Tue, Wed, Thu, Fri, Sat, Sun)',
      "events[2]: title is required", 'events[2]: date must be a real date as YYYY-MM-DD ("27/11/2026" is not)',
      'events[2]: start_time must be a time like "16:30" or "4:30 pm" ("half four" is not)',
      "events[3] (Chess): end_time (10:00) must be after start_time (11:00)",
      'events[3] (Chess): reminder must be whole minutes before the start, like 60, or null for none ("the night before" is not)',
      "events[4] (Picnic): give a date (YYYY-MM-DD) for an event on one day, or weekdays for one that happens every week",
      'events[5] (Swim): reminder "evening before" is gone: the 9 pm brief already tells the family about tomorrow',
      "events[5] (Swim): kind must be one of: event, deadline"])
      expect(r.error).toContain(said);
    expect(r.error).not.toContain("events[0]");
    expect(k.rows("events")).toEqual([]);
    expect(k.rows("members")).toEqual([]);
  });

  it("refuses a call that is not a list of events, a field it does not take, and a bad member", async () => {
    const k = await boot({ now: NOW });
    expect((await k.op("add_events", {})).error).toBe("add_events needs events. Its fields: events, members, added_by. Send it again with those only.");
    expect((await k.op("add_events", { events: [] })).code).toBe("APP_REFUSED");
    expect((await k.op("add_events", { events: CLASSES, event: CLASSES[0] })).error).toContain("add_events does not take event (did you mean events?)");
    expect((await k.op("add_events", { events: [CLASSES[0]], members: [{ name: "Agastya", colour: "#ff0000" }, { emoji: "🧒" }] })).error)
      .toContain("members[0]: colour must be one of: accent, info, success, warning, danger. members[1]: name is required");
    expect((await k.op("add_events", { events: [{ title: "X", weekdays: ["Mon"], repeat: "none" }] })).code).toBe("APP_REFUSED");
    expect((await k.op("add_events", { events: [{ title: "X", repeat: "monthly" }] })).error).toContain("a monthly event needs the date of its first day");
    expect((await k.op("add_events", { events: [{ title: "X", date: "2026-12-01", repeat: "fortnightly" }] })).error).toContain("repeat must be one of: none, daily, weekly, monthly, yearly");
    expect((await k.op("add_events", { events: [{ title: "X", repeat: "yearly" }] })).error).toContain("a yearly event needs the date of its first day (a birthday's date, any year)");
    expect((await k.op("add_events", { events: [{ title: "X", date: "2026-02-30" }] })).error).toContain("date must be a real date");
    expect(k.rows("events")).toEqual([]);
  });

  it("a new install's sample family and week give way to the first real events; a refused call clears nothing", async () => {
    const k = await boot({ seed: true, now: NOW });
    const samples = k.rows("events").length;
    expect(samples).toBeGreaterThan(0);
    expect((await k.op("add_events", { events: [{ title: "Picnic" }] })).code).toBe("APP_REFUSED");
    expect(k.rows("events")).toHaveLength(samples);
    const r = await k.op("add_events", { events: [CLASSES[1]] });
    expect(r.samples_cleared).toBeGreaterThan(samples);   // the sample members too
    expect(k.rows("events").map((e) => e.title)).toEqual(["Art class"]);
    expect(k.rows("members").map((m) => m.name)).toEqual(["Agastya"]);
  });

  it("the page's own route takes the same call, stamped as the person's", async () => {
    const k = await boot({ now: NOW });
    const r = await k.owner("POST", "/api/events/add", { events: [CLASSES[1]] });
    expect(r.status).toBe(200);
    expect(k.rows("events")[0].updated_by).toBe("user:tester");
    expect((await k.owner("POST", "/api/events/add", { events: "Art class" })).status).toBe(400);
  });
});

describe("add_events: a monthly event on a weekday of the month", () => {
  it("the first Sunday of every month: date = the first such Sunday, repeat monthly, monthly_by weekday", async () => {
    const k = await boot({ now: NOW });
    const r = await k.op("add_events", { events: [
      { title: "Society committee meeting", date: "2026-12-06", repeat: "monthly", monthly_by: "weekday", start_time: "11:00" },
      { title: "Book club", date: "2026-11-27", repeat: "monthly", monthly_by: "last_weekday", start_time: "19:00" },
      { title: "Society maintenance", date: "2026-12-05", repeat: "monthly", kind: "deadline" }] });
    expect(r.error).toBeUndefined();
    expect(r.events.map((e: any) => [e.title, e.date, e.repeat, e.monthly_by])).toEqual([
      ["Society committee meeting", "2026-12-06", "monthly", "weekday"], ["Book club", "2026-11-27", "monthly", "last_weekday"], ["Society maintenance", "2026-12-05", "monthly", "date"]]);
    const rows = k.rows("events");
    expect(rows.map((e) => e.monthly_by)).toEqual(["weekday", "last_weekday", null]);   // by date is kept as before: empty
    // The Week page's reading: the meeting is on 3 Jan 2027 (a Sunday), never on the 6th.
    const repeating = (await k.owner("GET", "/api/_data/events?repeat[ne]=none&limit=500")).body.rows;
    const on = (from: string, to: string) => repeating.flatMap((e: any) => occurrences(e, from, to).map((d) => `${d} ${e.title}`)).sort();
    expect(on("2027-01-01", "2027-01-31")).toEqual(["2027-01-03 Society committee meeting", "2027-01-05 Society maintenance", "2027-01-29 Book club"]);
  });

  it("refuses monthly_by on an event that is not monthly, an unknown value, a 5th weekday and a weekday that is not the last", async () => {
    const k = await boot({ now: NOW });
    const r = await k.op("add_events", { events: [
      { title: "A", date: "2026-12-06", repeat: "weekly", monthly_by: "weekday" },
      { title: "B", date: "2026-12-06", monthly_by: "weekday" },
      { title: "C", date: "2026-12-06", repeat: "monthly", monthly_by: "first" },
      { title: "D", date: "2026-12-29", repeat: "monthly", monthly_by: "weekday" },
      { title: "E", date: "2026-11-20", repeat: "monthly", monthly_by: "last_weekday" }] });
    expect(r.code).toBe("APP_REFUSED");
    for (const said of [
      'events[0] (A): monthly_by is only for repeat "monthly"',
      'events[1] (B): monthly_by is only for repeat "monthly"',
      "events[2] (C): monthly_by must be one of: date, weekday, last_weekday",
      'events[3] (D): 2026-12-29 is the 5th Tuesday of its month, and most months have no 5th: for "the last Tuesday of every month" use monthly_by "last_weekday"',
      "events[4] (E): 2026-11-20 is not the last Friday of its month (that is 2026-11-27): give the date of a last Friday"])
      expect(r.error).toContain(said);
    expect(k.rows("events")).toEqual([]);
  });

  it("a monthly event first kept by date, sent again with monthly_by, is changed, not doubled", async () => {
    const k = await boot({ now: NOW });
    await k.op("add_events", { events: [{ title: "Society committee meeting", date: "2026-12-06", repeat: "monthly", start_time: "11:00" }] });
    const r = await k.op("add_events", { events: [{ title: "Society committee meeting", date: "2026-12-06", repeat: "monthly", monthly_by: "weekday", start_time: "11:00" }] });
    expect(r).toMatchObject({ added: 0, updated: 1 });
    expect(k.rows("events").map((e) => [e.date, e.monthly_by])).toEqual([["2026-12-06", "weekday"]]);
    // Sent again later with another first Sunday: the same meeting.
    expect((await k.op("add_events", { events: [{ title: "Society committee meeting", date: "2027-01-03", repeat: "monthly", monthly_by: "weekday", start_time: "11:00" }] })).updated).toBe(1);
    expect(k.rows("events")).toHaveLength(1);
  });
});
