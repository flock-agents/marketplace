// The brief operation, as Family Butler's 8 am and 9 pm briefs call it: the day's events (repeating ones on their days, cancelled
// ones struck), the to-dos that need doing, and what imports added, moved or cancelled since the last brief of either kind.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";

// Sunday 22 Nov 2026, 8 am.
const NOW = new Date(2026, 10, 22, 8, 0);
const SRC = { source: "email:shiva", label: "Shiva's email" };

async function start() {
  const k = await boot({ now: () => NOW });
  const imp = (...items: object[]) => k.op("import_events", { ...SRC, items });
  return Object.assign(k, { imp });
}

describe("brief", () => {
  it("an empty day answers empty lists", async () => {
    const k = await start();
    const b = await k.op("brief", { kind: "morning" });
    expect(b).toEqual({ day: "2026-11-22", timezone: expect.any(String), events: [], changed: [], new: [], todos_due: [] });
  });

  it("morning: today's events with their sources, who added them and their open to-dos; the to-dos already showing, soonest first", async () => {
    const k = await start();
    await k.op("add_events", { events: [{ title: "Skating", who: "Agastya", weekdays: ["Sun"], start_time: "16:00", end_time: "17:30", notes: "Lakshmi drops" }], added_by: "Shiva" });
    await k.imp(
      { ref: "a", title: "Swimming gala", date: "2026-11-22", start_time: "10:00", todos: [{ title: "Pack the swim kit", due: "2026-11-22" }] },
      { ref: "b", title: "School trip", date: "2026-11-27", todos: [{ title: "Sign the trip form", due: "2026-11-24", show_from: "2026-11-20" }] },
      { ref: "c", title: "Fee due", date: "2026-12-10", kind: "deadline", todos: [{ title: "Pay the fee", due: "2026-12-10" }] },   // shows from Dec 7
      { ref: "d", title: "Puppet show", date: "2026-11-22", start_time: "18:00" });
    await k.imp({ ref: "d", title: "Puppet show", date: "2026-11-22", cancelled: true });
    const b = await k.op("brief", { kind: "morning" });
    expect(b.day).toBe("2026-11-22");
    expect(b.events.map((e: any) => [e.title, e.status])).toEqual([["Swimming gala", "active"], ["Skating", "active"], ["Puppet show", "cancelled"]]);
    expect(b.events[1]).toEqual({ id: expect.any(String), title: "Skating", start_time: "16:00", end_time: "17:30", who: "Agastya", location: null, notes: "Lakshmi drops",
      kind: "event", status: "active", sources: [], added_by: "Shiva", todos: { open: 0, titles: [] } });
    expect(b.events[0]).toMatchObject({ sources: ["Shiva's email"], added_by: null, todos: { open: 1, titles: ["Pack the swim kit"] } });
    expect(b.todos_due).toEqual([{ title: "Pack the swim kit", due: "2026-11-22", event: "Swimming gala" }, { title: "Sign the trip form", due: "2026-11-24", event: "School trip" }]);
  });

  it("evening: tomorrow's events and the to-dos due tomorrow", async () => {
    const k = await start();
    await k.imp({ ref: "a", title: "PTM", date: "2026-11-23", start_time: "09:00", todos: [{ title: "Bring the report card", due: "2026-11-23" }] },
      { ref: "b", title: "Science fair", date: "2026-11-25", todos: [{ title: "Finish the model", due: "2026-11-24" }] });
    const b = await k.op("brief", { kind: "evening" });
    expect(b.day).toBe("2026-11-23");
    expect(b.events.map((e: any) => e.title)).toEqual(["PTM"]);
    expect(b.todos_due).toEqual([{ title: "Bring the report card", due: "2026-11-23", event: "PTM" }]);
  });

  it("new and changed: imports added, moved or cancelled since the last brief of either kind; the call moves that mark", async () => {
    const k = await start();
    await k.imp({ ref: "a", title: "Annual Day", date: "2026-12-12" }, { ref: "b", title: "PTM", date: "2026-12-05" }, { ref: "c", title: "Book fair", date: "2026-12-01" });
    await k.op("add_events", { events: [{ title: "Dentist", date: "2026-11-30" }] });   // typed in: not news
    const first = await k.op("brief", { kind: "morning" });
    expect(first.new.map((n: any) => [n.title, n.date, n.sources])).toEqual([["Annual Day", "2026-12-12", ["Shiva's email"]], ["PTM", "2026-12-05", ["Shiva's email"]], ["Book fair", "2026-12-01", ["Shiva's email"]]]);
    expect(first.changed).toEqual([]);
    k.setNow(new Date(2026, 10, 22, 12, 0));
    await k.imp({ ref: "b", title: "PTM", date: "2026-12-06" }, { ref: "c", title: "Book fair", date: "2026-12-01", cancelled: true });
    k.setNow(new Date(2026, 10, 22, 21, 0));
    const evening = await k.op("brief", { kind: "evening" });
    expect(evening.new).toEqual([]);
    expect(evening.changed).toEqual([
      { id: expect.any(String), title: "PTM", date: "2026-12-06", status: "moved", was: "2026-12-05" },
      { id: expect.any(String), title: "Book fair", date: "2026-12-01", status: "cancelled" }]);
    k.setNow(new Date(2026, 10, 23, 8, 0));
    const next = await k.op("brief", { kind: "morning" });
    expect(next.new).toEqual([]);
    expect(next.changed).toEqual([]);
  });

  it("a monthly event on the 1st Sunday is in the brief on that Sunday, not on its date's day of the month", async () => {
    const k = await start();
    await k.op("add_events", { events: [{ title: "Society committee meeting", date: "2026-12-06", repeat: "monthly", monthly_by: "weekday", start_time: "11:00" }] });
    k.setNow(new Date(2027, 0, 3, 8, 0));   // Sunday 3 Jan 2027
    expect((await k.op("brief", { kind: "morning" })).events.map((e: any) => e.title)).toEqual(["Society committee meeting"]);
    k.setNow(new Date(2027, 0, 5, 21, 0));   // the evening before Wednesday the 6th
    expect((await k.op("brief", { kind: "evening" })).events).toEqual([]);
  });

  it("refuses a kind it does not know", async () => {
    const k = await start();
    expect((await k.op("brief", { kind: "noon" })).error).toContain("morning");
    expect((await k.op("brief", {})).error).toContain("kind");
  });
});
