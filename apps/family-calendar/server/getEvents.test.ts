// get_events, as another app or agent reads the calendar to see who is home or away: repeating events once per day in the range,
// a trip once with its own days, cancelled events left out, deadlines with their kind, and a bad range refused with a clear word.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";
import { dueBetween } from "./routines";

// Monday 23 Nov 2026, 9 am.
const NOW = new Date(2026, 10, 23, 9, 0);
const start = () => boot({ now: () => NOW });
const days = (r: any, title: string) => r.events.filter((e: any) => e.title === title).map((e: any) => e.date);

describe("get_events", () => {
  it("a weekly event is an entry per day it falls on, each with the event's id, times and who", async () => {
    const k = await start();
    await k.op("add_events", { events: [{ title: "Skating", who: "Agastya", weekdays: ["Tue"], start_time: "16:00", end_time: "17:30", notes: "Lakshmi drops" }] });
    const r = await k.op("get_events", { from: "2026-11-23", to: "2026-12-06" });
    expect(r.events).toEqual([
      { id: expect.any(String), title: "Skating", date: "2026-11-24", repeat: "weekly", kind: "event", start_time: "16:00", end_time: "17:30", who: "Agastya", notes: "Lakshmi drops" },
      { id: r.events[0].id, title: "Skating", date: "2026-12-01", repeat: "weekly", kind: "event", start_time: "16:00", end_time: "17:30", who: "Agastya", notes: "Lakshmi drops" },
    ]);
  });

  it("monthly on a weekday of the month: the first Sunday and the last Friday, month by month", async () => {
    const k = await start();
    await k.op("add_events", { events: [
      { title: "Society committee", date: "2026-12-06", repeat: "monthly", monthly_by: "weekday", start_time: "11:00" },
      { title: "Dinner out", date: "2026-11-27", repeat: "monthly", monthly_by: "last_weekday", start_time: "20:00" }] });
    const r = await k.op("get_events", { from: "2026-12-01", to: "2027-01-31" });
    expect(days(r, "Society committee")).toEqual(["2026-12-06", "2027-01-03"]);
    expect(days(r, "Dinner out")).toEqual(["2026-12-25", "2027-01-29"]);
  });

  it("yearly: a 29 February birthday falls on the 28th in other years; an all-day entry carries no times or who", async () => {
    const k = await start();
    await k.op("add_events", { events: [{ title: "Leap birthday", date: "2024-02-29", repeat: "yearly" }] });
    const r = await k.op("get_events", { from: "2027-02-01", to: "2027-03-01" });
    expect(r.events).toEqual([{ id: expect.any(String), title: "Leap birthday", date: "2027-02-28", repeat: "yearly", kind: "event" }]);
    expect((await k.op("get_events", { from: "2028-02-01", to: "2028-03-01" })).events.map((e: any) => e.date)).toEqual(["2028-02-29"]);
  });

  it("a trip over several days is one entry with its own first and last day when any day is in the range", async () => {
    const k = await start();
    await k.op("add_events", { events: [{ title: "Goa trip", who: "Shiva", date: "2026-12-20", end_date: "2026-12-23" }] });
    const trip = { id: expect.any(String), title: "Goa trip", date: "2026-12-20", end_date: "2026-12-23", repeat: "none", kind: "event", who: "Shiva" };
    expect((await k.op("get_events", { from: "2026-12-22", to: "2026-12-31" })).events).toEqual([trip]);   // began before the range
    expect((await k.op("get_events", { from: "2026-12-01", to: "2026-12-20" })).events).toEqual([trip]);   // ends after it
    expect((await k.op("get_events", { from: "2026-12-23", to: "2026-12-23" })).events).toEqual([trip]);   // its last day only
    expect((await k.op("get_events", { from: "2026-12-24", to: "2026-12-31" })).events).toEqual([]);
    expect((await k.op("get_events", { from: "2026-12-01", to: "2026-12-19" })).events).toEqual([]);
  });

  it("a cancelled event is left out; a deadline comes with its kind; entries are by day, all-day first, then by time", async () => {
    const k = await start();
    await k.op("import_events", { source: "email:shiva", label: "Shiva's email", items: [
      { ref: "a", title: "Puppet show", date: "2026-11-28", start_time: "18:00" },
      { ref: "b", title: "Swimming gala", date: "2026-11-28", start_time: "10:00" }] });
    await k.op("import_events", { source: "email:shiva", items: [{ ref: "a", title: "Puppet show", date: "2026-11-28", cancelled: true }] });
    await k.op("add_events", { events: [{ title: "School fee", date: "2026-11-28", kind: "deadline" }, { title: "Dentist", date: "2026-11-27", start_time: "09:00" }] });
    const r = await k.op("get_events", { from: "2026-11-23", to: "2026-11-30" });
    expect(r.events.map((e: any) => [e.date, e.title, e.kind])).toEqual([
      ["2026-11-27", "Dentist", "event"], ["2026-11-28", "School fee", "deadline"], ["2026-11-28", "Swimming gala", "event"]]);
  });

  it("refuses a bad range, a missing day and a field it does not take, saying what is wrong; it writes nothing", async () => {
    const k = await start();
    const refused = async (p: object) => { const r = await k.op("get_events", p); expect(r).toMatchObject({ code: "APP_REFUSED", status: 400 }); return r.error as string; };
    expect(await refused({ from: "2026-12-01" })).toContain("get_events needs to.");
    expect(await refused({ from: "2026-12-01", to: "2026-12-05", day: "x" })).toContain("get_events does not take day");
    expect(await refused({ from: "2026-02-30", to: "2026-03-05" })).toContain("from must be a real date as YYYY-MM-DD");
    expect(await refused({ from: "2026-12-01", to: "1 Jan" })).toContain("to must be a real date as YYYY-MM-DD");
    expect(await refused({ from: "2026-12-05", to: "2026-12-01" })).toBe("from (2026-12-05) is after to (2026-12-01)");
    expect(await refused({ from: "2026-12-01", to: "2027-02-01" })).toContain("more than 62 days: ask for 2026-12-01 to 2027-01-31 at most");
    // 62 days counting both ends is taken.
    expect((await k.op("get_events", { from: "2026-12-01", to: "2027-01-31" })).events).toEqual([]);
    expect(k.rows("events")).toEqual([]);
  });
});

// Setup e2e, 27 Nov: a planner reading a new calendar got the sample family's "School run", "Dentist" and "Grandma's birthday"
// and asked a family with a toddler about them. The sample rows are the page's example, never what others read.
describe("the sample family is never read as the family's", () => {
  it("get_events, the brief and the due reminders leave the sample rows out; a real event is read", async () => {
    const k = await boot({ seed: true, now: () => NOW });
    expect((k.rows("events") as any[]).length).toBeGreaterThan(5);
    expect((await k.op("get_events", { from: "2026-11-23", to: "2026-12-06" })).events).toEqual([]);
    expect(dueBetween(k.kit.db, "2026-11-23T00:00", "2026-11-30T00:00")).toEqual([]);
    const brief = await k.op("brief", { kind: "morning" });
    expect(JSON.stringify(brief)).not.toContain("School run");
    await k.op("add_events", { events: [{ title: "Evaani's vaccination", date: "2026-11-25", start_time: "10:00" }] });
    expect((await k.op("get_events", { from: "2026-11-23", to: "2026-12-06" })).events.map((e: any) => e.title)).toEqual(["Evaani's vaccination"]);
  });
});
