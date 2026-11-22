// The schedule widget Flock reads for "Your Schedule" (contract addendum 2026-11-22): Calendar Desk's wire format (template
// "schedule", ScheduleItemWire items of kind "event"), from the requested day through the next 7, repeating events on each day
// they fall on, cancelled ones left out, no link of their own (Flock gives every item the app agent's chat).
import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { boot } from "./testkit";

// Sunday 22 Nov 2026, 10 am.
const NOW = () => new Date(2026, 10, 22, 10, 0);
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();

async function start() {
  const k = await boot({ now: NOW });
  await k.op("add_events", { events: [
    { title: "Skating class", who: "Agastya", weekdays: ["Tue"], start_time: "16:00", end_time: "17:30", location: "Rink" },
    { title: "Grandma's birthday", date: "1950-11-28", repeat: "yearly" },
    { title: "Dentist", date: "2026-11-23", start_time: "11:00" }] });
  await k.op("import_events", { source: "email:shiva", label: "Shiva's email", items: [
    { ref: "a", title: "PTM", date: "2026-11-27", start_time: "09:00" }, { ref: "b", title: "Swimming gala", date: "2026-11-26" }, { ref: "c", title: "Annual Day", date: "2026-12-12" }] });
  await k.op("import_events", { source: "email:shiva", label: "Shiva's email", items: [{ ref: "b", title: "Swimming gala", date: "2026-11-26", cancelled: true }] });
  const get = async (q = "") => { const r = await k.hono.request(`/api/widget/schedule${q}`); return { status: r.status, body: (await r.json()) as any }; };
  return Object.assign(k, { get });
}

describe("the schedule widget", () => {
  it("answers today through the next 7 days in Calendar Desk's wire format, repeating events on their days, cancelled ones out", async () => {
    const k = await start();
    const r = await k.get();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ template: "schedule", date: "2026-11-22", connected: true, fault: null, connector: "ok" });
    expect(r.body.items.map((i: any) => [i.date, i.title])).toEqual([
      ["2026-11-23", "Dentist"], ["2026-11-24", "Skating class"], ["2026-11-27", "PTM"], ["2026-11-28", "Grandma's birthday"]]);
    const dentist = k.rows("events").find((e) => e.title === "Dentist");
    expect(r.body.items[0]).toEqual({ id: dentist.id, kind: "event", title: "Dentist", date: "2026-11-23", startAt: at(2026, 11, 23, 11), endAt: null, allDay: false });
    const skating = k.rows("events").find((e) => e.title === "Skating class");
    // A repeating event is an item per day it falls on, each with an id of its own; who it is for is its tag.
    expect(r.body.items[1]).toEqual({ id: `${skating.id}@2026-11-24`, kind: "event", title: "Skating class", date: "2026-11-24", startAt: at(2026, 11, 24, 16),
      endAt: at(2026, 11, 24, 17, 30), allDay: false, location: "Rink", calendar: "Agastya" });
    expect(r.body.items[3]).toMatchObject({ title: "Grandma's birthday", allDay: true, startAt: null });
    for (const i of r.body.items) expect(i.link).toBeUndefined();
  });

  it("starts on the day asked for (`from`, or `date`)", async () => {
    const k = await start();
    const r = await k.get("?from=2026-12-08");
    expect(r.body.date).toBe("2026-12-08");
    expect(r.body.items.map((i: any) => [i.date, i.title])).toEqual([["2026-12-08", "Skating class"], ["2026-12-12", "Annual Day"], ["2026-12-15", "Skating class"]]);
    expect((await k.get("?date=2026-12-12")).body.items.map((i: any) => i.title)).toEqual(["Annual Day", "Skating class"]);
    expect((await k.get("?from=12-12-2026")).status).toBe(400);
  });

  it("is declared in the manifest as a schedule widget that plans its own events", () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "flock.app.json"), "utf8"));
    expect(manifest.widgets).toEqual([{ id: "schedule", kind: "schedule", plansEvents: true, dataUrl: "/api/widget/schedule", title: "Family Calendar" }]);
  });
});
