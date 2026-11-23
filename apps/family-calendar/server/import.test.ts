// import_events as Flock's harvest calls it: items from a source become events, the same thing from two sources becomes one
// event with two source rows, a re-send changes nothing, a cancellation withdraws the event's to-dos, and one bad item is
// refused alone. The matching rules are the contract's (docs/specs/2026-11-22-family-calendar-3-contract.md), one test each.
import { describe, it, expect } from "bun:test";
import { boot } from "./testkit";

// Sunday 22 Nov 2026, 10 am.
const NOW = () => new Date(2026, 10, 22, 10, 0);
const SHIVA = { source: "email:shiva", label: "Shiva's email" };
const ANKITA = { source: "email:ankita", label: "Ankita's email" };
const fee = { ref: "<m1@school>#school-fee-due", match: ["<m1@school>", "INV-2291"], kind: "deadline", title: "School fee due", date: "2026-12-10",
  start_time: "09:00", end_time: "10:00", who: "Agastya", location: "Greenwood High", notes: "Term 3, Rs 42,000",
  todos: [{ title: "Pay the school fee", due: "2026-12-10", show_from: "2026-12-03" }] };
const importOf = (k: Awaited<ReturnType<typeof boot>>, from: { source: string; label: string }, ...items: object[]) => k.op("import_events", { ...from, items });
const ms = (date: string) => new Date(`${date}T00:00:00`).getTime();

describe("import_events: a new item", () => {
  it("becomes an imported event with its source, its member and its to-do on the family's list", async () => {
    const k = await boot({ now: NOW });
    const r = await importOf(k, SHIVA, fee);
    expect(r.error).toBeUndefined();
    const [e] = k.rows("events");
    expect(r).toEqual({ results: [{ ref: fee.ref, id: e.id, result: "added" }], members_added: ["Agastya"] });
    expect(e).toMatchObject({ title: "School fee due", date: "2026-12-10", start_time: "09:00", end_time: "10:00", who: "Agastya", location: "Greenwood High",
      notes: "Term 3, Rs 42,000", kind: "deadline", status: "active", added_by: null, imported: 1, planned_at: null, plan_basis: null, repeat: "none",
      reminder_minutes: 30 });   // a timed import is nudged half an hour before
    const [s] = k.rows("event_sources");
    expect(s).toMatchObject({ event_id: e.id, source: "email:shiva", ref: fee.ref, label: "Shiva's email", first_seen_at: NOW().getTime(), last_seen_at: NOW().getTime() });
    expect(JSON.parse(s.match)).toEqual(["<m1@school>", "INV-2291"]);
    expect(k.rows("todos").map((t) => [t.event_id, t.key, t.title, t.due, t.show_from, t.status])).toEqual([[e.id, "pay-the-school-fee", "Pay the school fee", "2026-12-10", "2026-12-03", "open"]]);
    expect(k.tasks.published).toHaveLength(1);
    expect(k.tasks.published[0]).toMatchObject({ sourceRef: `event:${e.id}:pay-the-school-fee`, title: "Pay the school fee", due: ms("2026-12-10"), dueTimed: false, showFrom: "2026-12-03" });
    expect(k.rows("members").map((m) => m.name)).toEqual(["Agastya"]);
  });

  it("an all-day item gets no nudge; kind defaults to event; a to-do's show-from defaults to 3 days before it is due", async () => {
    const k = await boot({ now: NOW });
    await importOf(k, SHIVA, { ref: "m2#annual-day", title: "Annual Day", date: "2026-12-12", todos: [{ title: "Buy the costume", due: "2026-12-08" }] });
    expect(k.rows("events")[0]).toMatchObject({ kind: "event", reminder_minutes: null, who: null, start_time: null });
    expect(k.rows("todos")[0]).toMatchObject({ due: "2026-12-08", show_from: "2026-12-05" });
  });

  it("the same call twice answers unchanged and makes no new rows or to-dos", async () => {
    const k = await boot({ now: NOW });
    await importOf(k, SHIVA, fee);
    const before = { events: k.rows("events"), sources: k.rows("event_sources").length, todos: k.rows("todos"), published: k.tasks.published.length };
    const r = await importOf(k, SHIVA, fee);
    expect(r.results.map((x: any) => x.result)).toEqual(["unchanged"]);
    expect(r.members_added).toEqual([]);
    expect(k.rows("events")).toEqual(before.events);
    expect(k.rows("event_sources")).toHaveLength(before.sources);
    expect(k.rows("todos")).toEqual(before.todos);
    expect(k.tasks.published).toHaveLength(before.published);
  });
});

describe("import_events: matching", () => {
  it("rule 1: the same source and ref is the same item; a new date from it is a move that keeps plan_basis", async () => {
    const k = await boot({ now: NOW });
    await importOf(k, SHIVA, fee);
    const id = k.rows("events")[0].id;
    k.kit.sqlite.run("UPDATE events SET planned_at = 1, plan_basis = '2026-12-10T09:00' WHERE id = ?", [id]);
    const r = await importOf(k, SHIVA, { ...fee, date: "2026-12-08", todos: undefined });
    expect(r.results).toEqual([{ ref: fee.ref, id, result: "moved" }]);
    expect(k.rows("events")).toHaveLength(1);
    expect(k.rows("events")[0]).toMatchObject({ date: "2026-12-08", plan_basis: "2026-12-10T09:00" });
    // Its open to-do, due after the new day, comes back to that day.
    expect(k.rows("todos")[0]).toMatchObject({ due: "2026-12-08", show_from: "2026-12-03" });
    expect(k.tasks.published.at(-1)).toMatchObject({ sourceRef: `event:${id}:pay-the-school-fee`, due: ms("2026-12-08") });
  });

  it("rule 1: a change of a field from the event's own source updates it", async () => {
    const k = await boot({ now: NOW });
    await importOf(k, SHIVA, fee);
    const r = await importOf(k, SHIVA, { ...fee, location: "Greenwood High, Sarjapur campus" });
    expect(r.results[0].result).toBe("updated");
    expect(k.rows("events")[0].location).toBe("Greenwood High, Sarjapur campus");
  });

  it("rule 2: another source sharing an identifier on the same date merges into one event with two source rows", async () => {
    const k = await boot({ now: NOW });
    await importOf(k, SHIVA, { ...fee, location: undefined });
    const r = await importOf(k, ANKITA, { ref: "<m1@school>#fee-reminder", match: ["inv-2291"], title: "Fee payment reminder", date: "2026-12-10", location: "Greenwood High", notes: "Pay online" });
    const [e] = k.rows("events");
    expect(r.results).toEqual([{ ref: "<m1@school>#fee-reminder", id: e.id, result: "merged" }]);
    expect(k.rows("events")).toHaveLength(1);
    // Another source fills a field that was empty and changes none that was set.
    expect(e).toMatchObject({ title: "School fee due", location: "Greenwood High", notes: "Term 3, Rs 42,000" });
    expect(k.rows("event_sources").map((s) => [s.source, s.label])).toEqual([["email:shiva", "Shiva's email"], ["email:ankita", "Ankita's email"]]);
  });

  it("rule 2: a shared identifier on another date is not the same event: both are kept", async () => {
    const k = await boot({ now: NOW });
    await importOf(k, SHIVA, fee);
    const r = await importOf(k, ANKITA, { ref: "x#late-fee", match: ["INV-2291"], title: "Late fee charged", date: "2026-12-20" });
    expect(r.results[0].result).toBe("added");
    expect(k.rows("events")).toHaveLength(2);
  });

  it("rule 3: the same date, titles naming the same thing (one contains the other) and times within an hour", async () => {
    const k = await boot({ now: NOW });
    await importOf(k, SHIVA, { ref: "a#ptm", title: "PTM", date: "2026-12-05", start_time: "10:00" });
    const r = await importOf(k, ANKITA, { ref: "b#ptm", title: "Agastya's PTM", date: "2026-12-05", start_time: "10:30" });
    expect(r.results[0].result).toBe("merged");
    expect(k.rows("events")).toHaveLength(1);
  });

  it("rule 3: word sets alike by Jaccard 0.5 or more match; one side without a time matches any time", async () => {
    const k = await boot({ now: NOW });
    await importOf(k, SHIVA, { ref: "a#expo", title: "Science exhibition at school", date: "2026-12-09", start_time: "11:00" });
    const r = await importOf(k, ANKITA, { ref: "b#fair", title: "School science fair", date: "2026-12-09" });
    expect(r.results[0].result).toBe("merged");
  });

  it("rule 3: times more than an hour apart, or titles that are not alike, are two events", async () => {
    const k = await boot({ now: NOW });
    await importOf(k, SHIVA, { ref: "a#ptm", title: "PTM", date: "2026-12-05", start_time: "10:00" });
    expect((await importOf(k, ANKITA, { ref: "b#ptm", title: "PTM", date: "2026-12-05", start_time: "11:30" })).results[0].result).toBe("added");
    expect((await importOf(k, ANKITA, { ref: "c#swim", title: "Swimming gala", date: "2026-12-05", start_time: "10:00" })).results[0].result).toBe("added");
    expect(k.rows("events")).toHaveLength(3);
  });

  it("when unsure, keeps both: two events could be the one meant, or the same title for two different people", async () => {
    const k = await boot({ now: NOW });
    await importOf(k, SHIVA, { ref: "a#ptm", title: "PTM", date: "2026-12-05", who: "Agastya" }, { ref: "b#ptm", title: "PTM", date: "2026-12-05", who: "Meera" });
    const other = await importOf(k, ANKITA, { ref: "d#ptm", title: "Class PTM", date: "2026-12-05", who: "Kabir" });
    expect(other.results[0].result).toBe("added");   // for another child: not the same PTM
    const two = await importOf(k, ANKITA, { ref: "c#ptm", title: "PTM", date: "2026-12-05", who: "Agastya" , location: "Room 4" });
    expect(two.results[0].result).toBe("merged");     // Agastya's: only one could be meant
    const three = await importOf(k, ANKITA, { ref: "e#ptm", title: "PTM", date: "2026-12-05" });
    expect(three.results[0].result).toBe("added");    // for no one in particular: three could be meant
    expect(k.rows("events")).toHaveLength(4);
  });

  it("an event that repeats is never matched by an import", async () => {
    const k = await boot({ now: NOW });
    await k.op("add_events", { events: [{ title: "Swimming", who: "Agastya", weekdays: ["Sat"], start_time: "09:00" }] });
    const r = await importOf(k, SHIVA, { ref: "a#swim", title: "Swimming", date: "2026-11-28", start_time: "09:00", who: "Agastya" });
    expect(r.results[0].result).toBe("added");
  });

  it("a typed-in event matched by an import takes the source row, keeps its own fields and is still not imported", async () => {
    const k = await boot({ now: NOW });
    await k.op("add_events", { events: [{ title: "Annual Day", who: "Agastya", date: "2026-12-12", start_time: "10:00" }], added_by: "Shiva" });
    const r = await importOf(k, SHIVA, { ref: "a#annual", title: "Annual Day function", date: "2026-12-12", start_time: "09:30", who: "Agastya", location: "School hall" });
    expect(r.results[0].result).toBe("merged");
    expect(k.rows("events")[0]).toMatchObject({ title: "Annual Day", start_time: "10:00", location: "School hall", added_by: "Shiva", imported: 0 });
  });
});

describe("import_events: cancellations", () => {
  it("cancels the matched event and withdraws its open to-dos; again is unchanged; with no match it is ignored", async () => {
    const k = await boot({ now: NOW });
    await importOf(k, SHIVA, fee);
    const id = k.rows("events")[0].id;
    const r = await importOf(k, SHIVA, { ref: fee.ref, title: fee.title, date: fee.date, cancelled: true });
    expect(r.results).toEqual([{ ref: fee.ref, id, result: "cancelled" }]);
    expect(k.rows("events")[0].status).toBe("cancelled");
    expect(k.rows("todos")[0].status).toBe("withdrawn");
    expect(k.tasks.withdrawn).toEqual([`event:${id}:pay-the-school-fee`]);
    expect((await importOf(k, SHIVA, { ref: fee.ref, title: fee.title, date: fee.date, cancelled: true })).results[0].result).toBe("unchanged");
    const none = await importOf(k, SHIVA, { ref: "z#trip", title: "School trip", date: "2026-12-15", cancelled: true });
    expect(none.results[0]).toMatchObject({ ref: "z#trip", result: "ignored" });
    expect(none.results[0].reason).toBeString();
    expect(k.rows("events")).toHaveLength(1);
  });

  it("another source's cancellation of the same thing cancels it too; a re-send of the first item does not bring it back", async () => {
    const k = await boot({ now: NOW });
    await importOf(k, SHIVA, { ref: "a#ptm", title: "PTM", date: "2026-12-05", start_time: "10:00" });
    expect((await importOf(k, ANKITA, { ref: "b#ptm-off", title: "PTM", date: "2026-12-05", cancelled: true })).results[0].result).toBe("cancelled");
    expect((await importOf(k, SHIVA, { ref: "a#ptm", title: "PTM", date: "2026-12-05", start_time: "10:00" })).results[0].result).toBe("unchanged");
    expect(k.rows("events")[0].status).toBe("cancelled");
  });
});

describe("import_events: what is refused", () => {
  it("one bad item is refused alone, with why; the rest go in", async () => {
    const k = await boot({ now: NOW });
    const r = await importOf(k, SHIVA,
      { ref: "a", title: "Good one", date: "2026-12-01" },
      { ref: "b", title: "Bad date", date: "2026-02-30" },
      { ref: "c", date: "2026-12-01" },
      { ref: "d", title: "To-do after", date: "2026-12-01", todos: [{ title: "Late", due: "2026-12-02" }] },
      { ref: "e", title: "Bad kind", date: "2026-12-01", kind: "holiday" },
      { title: "No ref", date: "2026-12-01" });
    expect(r.results.map((x: any) => x.result)).toEqual(["added", "refused", "refused", "refused", "refused", "refused"]);
    for (const x of r.results.slice(1)) expect(x.reason, x.ref).toBeString();
    expect(k.rows("events").map((e) => e.title)).toEqual(["Good one"]);
  });

  it("a call without a source, with more than 50 items or over 32 KB is refused whole", async () => {
    const k = await boot({ now: NOW });
    expect((await k.op("import_events", { items: [{ ref: "a", title: "A", date: "2026-12-01" }] })).error).toContain("source");
    const many = Array.from({ length: 51 }, (_, i) => ({ ref: `r${i}`, title: `Item ${i}`, date: "2026-12-01" }));
    expect((await importOf(k, SHIVA, ...many)).error).toContain("50");
    const big = [{ ref: "big", title: "Big", date: "2026-12-01", notes: "x".repeat(33 * 1024) }];
    expect((await importOf(k, SHIVA, ...big)).error).toContain("32 KB");
    expect(k.rows("events")).toEqual([]);
  });
});

describe("import_events: an item over several days (end_date)", () => {
  const trip = { ref: "<m9@travel>#goa", match: ["PNR-X1"], title: "Goa trip", date: "2026-12-20", end_date: "2026-12-23" };
  it("keeps its last day; a re-send changes nothing; the source that made it moves the last day", async () => {
    const k = await boot({ now: NOW });
    const r = await importOf(k, SHIVA, trip);
    expect(r.results[0].result).toBe("added");
    expect(k.rows("events")[0]).toMatchObject({ date: "2026-12-20", end_date: "2026-12-23", imported: 1 });
    expect((await importOf(k, SHIVA, trip)).results[0].result).toBe("unchanged");
    expect((await importOf(k, SHIVA, { ...trip, end_date: "2026-12-24" })).results[0].result).toBe("updated");
    expect(k.rows("events")[0].end_date).toBe("2026-12-24");
  });

  it("another source fills an empty last day, never changes one; a move keeps the trip's length", async () => {
    const k = await boot({ now: NOW });
    await importOf(k, SHIVA, { ...trip, end_date: undefined });
    expect(k.rows("events")[0].end_date).toBeNull();
    expect((await importOf(k, ANKITA, { ...trip, ref: "<m10@travel>#goa" })).results[0].result).toBe("merged");
    expect(k.rows("events")[0].end_date).toBe("2026-12-23");
    await importOf(k, ANKITA, { ...trip, ref: "<m10@travel>#goa", end_date: "2026-12-27" });
    expect(k.rows("events")[0].end_date).toBe("2026-12-23");
    // Its own source moves it two days on without saying the last day: the trip keeps its four days.
    expect((await importOf(k, SHIVA, { ref: trip.ref, title: "Goa trip", date: "2026-12-22" })).results[0].result).toBe("moved");
    expect(k.rows("events")[0]).toMatchObject({ date: "2026-12-22", end_date: "2026-12-25" });
  });

  it("refuses alone an end_date on or before its date, or on a deadline", async () => {
    const k = await boot({ now: NOW });
    const r = await importOf(k, SHIVA, { ...trip, ref: "a", end_date: "2026-12-20" }, { ...trip, ref: "b", kind: "deadline" }, { ...trip, ref: "c" });
    expect(r.results.map((x: any) => [x.ref, x.result])).toEqual([["a", "refused"], ["b", "refused"], ["c", "added"]]);
    expect(r.results[0].reason).toContain("end_date (2026-12-20) must be after date (2026-12-20)");
    expect(r.results[1].reason).toContain("end_date is not for a deadline");
  });
});

