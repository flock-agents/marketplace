import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs"; import { tmpdir } from "os"; import { join } from "path";
process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "calendar-desk-store-"));
const S = await import("../store");

function wipe() { for (const t of ["events", "event_notes", "preps", "cursors", "init_state"]) S._db.exec(`DELETE FROM ${t}`); }
beforeEach(wipe);

type Row = Parameters<typeof S.upsertEvents>[1][number];
function row(over: Partial<Row> = {}): Row {
  return { eventKey: "k1", calendar: "primary", title: "Standup", startAt: null, endAt: null, allDay: false, localDate: "2026-10-06",
    attendeesText: null, location: null, rawTimeText: null, googleEventId: null, ...over };
}

describe("events", () => {
  test("upsert is keyed by (account, eventKey); a re-seen event keeps first_seen and clears missing", () => {
    const row = { eventKey: "k1", calendar: "primary", title: "Standup", startAt: 1, endAt: 2, allDay: false, localDate: "2026-10-05", attendeesText: null, location: null, rawTimeText: "9:30am" };
    expect(S.upsertEvents("acct", [row], 100)).toEqual({ inserted: 1, updated: 0 });
    expect(S.markMissingEvents("acct", ["2026-10-05"], [], 200)).toBe(1);
    expect(S.getEvent("acct", "k1")!.missingSince).toBe(200);
    expect(S.upsertEvents("acct", [row], 300)).toEqual({ inserted: 0, updated: 1 });
    const e = S.getEvent("acct", "k1")!;
    expect(e.firstSeenAt).toBe(100); expect(e.lastSeenAt).toBe(300); expect(e.missingSince).toBeNull();
  });
  test("listEvents hides missing rows unless asked and honours the date window", () => {
    S.upsertEvents("acct", [{ eventKey: "a", calendar: null, title: "A", startAt: null, endAt: null, allDay: true, localDate: "2026-10-05", attendeesText: null, location: null, rawTimeText: null },
                            { eventKey: "b", calendar: null, title: "B", startAt: null, endAt: null, allDay: true, localDate: "2026-10-20", attendeesText: null, location: null, rawTimeText: null }], 1);
    S.markMissingEvents("acct", ["2026-10-05"], [], 2);
    expect(S.listEvents({ fromDate: "2026-10-01", toDate: "2026-10-31" }).map((e) => e.eventKey)).toEqual(["b"]);
    expect(S.listEvents({ fromDate: "2026-10-01", toDate: "2026-10-31", includeMissing: true }).length).toBe(2);
  });
  test("a note survives the event vanishing", () => {
    S.setEventNote("acct", "k9", "ask about the discount", "user");
    expect(S.getEventNote("acct", "k9")!.note).toBe("ask about the discount");
  });
});

describe("fact events", () => {
  const g = (k: string) => ({ eventKey: k, calendar: "primary", title: "Standup", startAt: null, endAt: null, allDay: true, localDate: "2026-10-06", attendeesText: null, location: null, rawTimeText: null });
  test("migration adds source, fact_id, source_link; existing rows are google", () => {
    const cols = (S._db.query("PRAGMA table_info(events)").all() as { name: string }[]);
    expect(cols.map((c) => c.name)).toEqual(expect.arrayContaining(["source", "fact_id", "source_link"]));
    S.upsertEvents("acct", [g("k1")], 1);
    expect(S.getEvent("acct", "k1")!.source).toBe("google");
  });
  test("insert, unchanged, update, delete; no account stored as ''", () => {
    const r = { accountId: "", factId: 12, title: "Flight 6E-512 BLR to MAA", localDate: "2026-10-08", startAt: null, sourceLink: null };
    expect(S.upsertFactEvent(r, 1)).toBe("inserted");
    expect(S.upsertFactEvent(r, 2)).toBe("unchanged");
    expect(S.upsertFactEvent({ ...r, localDate: "2026-10-09" }, 3)).toBe("updated");
    const [row] = S.listFactEvents();
    expect(row).toMatchObject({ accountId: "", eventKey: "fact:12", source: "fact", factId: 12, localDate: "2026-10-09", calendar: null });
    S.deleteFactEvent("", "fact:12");
    expect(S.listFactEvents()).toEqual([]);
  });
  test("a fact whose account changes moves: old row gone, one row left", () => {
    const r = { accountId: "a", factId: 5, title: "Dentist", localDate: "2026-10-06", startAt: null, sourceLink: null };
    S.upsertFactEvent(r, 1);
    expect(S.upsertFactEvent({ ...r, accountId: "b" }, 2)).toBe("inserted");
    expect(S.listFactEvents().map((e) => e.accountId)).toEqual(["b"]);
  });
  test("a clean Google scrape never marks a fact event under the same account missing", () => {
    S.upsertFactEvent({ accountId: "acct", factId: 7, title: "Dentist", localDate: "2026-10-06", startAt: null, sourceLink: null }, 1);
    expect(S.markMissingEvents("acct", ["2026-10-06"], [], 5)).toBe(0);
    expect(S.listFactEvents()[0].missingSince).toBeNull();
  });
  test("listEvents filters by source", () => {
    S.upsertEvents("acct", [g("g1")], 1);
    S.upsertFactEvent({ accountId: "acct", factId: 7, title: "Dentist", localDate: "2026-10-06", startAt: null, sourceLink: null }, 1);
    expect(S.listEvents({ fromDate: "2026-10-06", toDate: "2026-10-06", source: "google" }).map((e) => e.eventKey)).toEqual(["g1"]);
    expect(S.listEvents({ fromDate: "2026-10-06", toDate: "2026-10-06" })).toHaveLength(2);
  });
});

describe("event details", () => {
  test("details: saved, kept across a re-scrape of the same key, location taken from the popover", () => {
    S.upsertEvents("acc", [row({ eventKey: "k1", googleEventId: "g1", location: null })], 1000);
    S.saveEventDetails("acc", "k1", { guests: [{ email: "yogesh@crafo.ai" }], location: "HSR Layout", description: "agenda", meetLink: "https://meet.google.com/abc-defg-hij" }, 2000);
    S.upsertEvents("acc", [row({ eventKey: "k1", googleEventId: "g1", location: null })], 3000);
    const e = S.listEvents({ fromDate: "2026-10-01", toDate: "2026-10-31", accountId: "acc" })[0]!;
    expect([e.guests, e.location, e.description, e.meetLink, e.detailsAt, e.googleEventId])
      .toEqual([[{ email: "yogesh@crafo.ai" }], "HSR Layout", "agenda", "https://meet.google.com/abc-defg-hij", 2000, "g1"]);
  });
  test("before details are read, the agenda's location follows the re-scrape; guests stay null", () => {
    S.upsertEvents("acc", [row({ location: "Old" })], 1);
    S.upsertEvents("acc", [row({ location: "New" })], 2);
    const e = S.getEvent("acc", "k1")!;
    expect([e.location, e.guests, e.detailsAt, e.googleEventId]).toEqual(["New", null, null, null]);
  });
  test("a popover without a location keeps this scrape's agenda location; with one, the popover wins", () => {
    S.upsertEvents("acc", [row({ googleEventId: "g1", location: "Agenda place" })], 1);
    S.saveEventDetails("acc", "k1", { guests: [], location: "HSR Layout" }, 2, "Agenda place");
    expect(S.getEvent("acc", "k1")!.location).toBe("HSR Layout");
    S.saveEventDetails("acc", "k1", { guests: [] }, 3, "Agenda place");
    expect(S.getEvent("acc", "k1")!.location).toBe("Agenda place");
    S.saveEventDetails("acc", "k1", { guests: [] }, 4, null);
    expect(S.getEvent("acc", "k1")!.location).toBeNull();
  });
  test("details with unknown guests (no guests field) store guests as null, not []", () => {
    S.upsertEvents("acc", [row({ googleEventId: "g1" })], 1);
    S.saveEventDetails("acc", "k1", { guestSummary: "3 guests", meetLink: "https://meet.google.com/abc-defg-hij" }, 2);
    const e = S.getEvent("acc", "k1")!;
    expect([e.guests, e.guestSummary, e.detailsAt]).toEqual([null, "3 guests", 2]);
  });
  test("detailPlan: first read 60; then 15, skipping fresh and far-off details", () => {
    const now = new Date("2026-10-06T08:00:00+05:30");
    expect(S.detailPlan("acc", now)).toEqual({ max: 60, skipIds: [] });
    S.upsertEvents("acc", [
      row({ eventKey: "fresh", googleEventId: "gF", startAt: now.getTime() + 3600e3 }),
      row({ eventKey: "stale", googleEventId: "gS", startAt: now.getTime() + 3600e3 }),
      row({ eventKey: "far", googleEventId: "gR", startAt: now.getTime() + 72 * 3600e3 }),
    ], now.getTime());
    S.saveEventDetails("acc", "fresh", { guests: [] }, now.getTime() - 3600e3);
    S.saveEventDetails("acc", "stale", { guests: [] }, now.getTime() - 30 * 3600e3);
    S.saveEventDetails("acc", "far", { guests: [] }, now.getTime() - 30 * 3600e3);
    expect(S.detailPlan("acc", now)).toEqual({ max: 15, skipIds: ["gF", "gR"] });
  });
  test("detailPlan: forceIds are read even when fresh; events already over today are skipped", () => {
    const now = new Date("2026-10-06T12:00:00+05:30");
    S.upsertEvents("acc", [
      row({ eventKey: "fresh", googleEventId: "gF", startAt: now.getTime() + 1800e3, endAt: now.getTime() + 3600e3 }),
      row({ eventKey: "over", googleEventId: "gO", startAt: now.getTime() - 3 * 3600e3, endAt: now.getTime() - 2 * 3600e3 }),
      row({ eventKey: "overNoEnd", googleEventId: "gN", startAt: now.getTime() - 3600e3 }),
      row({ eventKey: "running", googleEventId: "gU", startAt: now.getTime() - 600e3, endAt: now.getTime() + 600e3 }),
    ], now.getTime());
    S.saveEventDetails("acc", "fresh", { guests: [] }, now.getTime() - 3600e3);
    expect(S.detailPlan("acc", now).skipIds.sort()).toEqual(["gF", "gN", "gO"]);
    expect(S.detailPlan("acc", now, { forceIds: ["gF"] }).skipIds.sort()).toEqual(["gN", "gO"]);
  });
  test("detailPlan: more than 15 upcoming timed rows without details is a first read again", () => {
    const now = new Date(2026, 9, 6, 8, 0);
    const day = (i: number) => `2026-10-${String(6 + (i % 7)).padStart(2, "0")}`;
    S.upsertEvents("acc", [row({ eventKey: "done", googleEventId: "g0", startAt: now.getTime() + 3600e3 })], 1);
    S.saveEventDetails("acc", "done", { guests: [] }, now.getTime());
    S.upsertEvents("acc", Array.from({ length: 15 }, (_, i) => row({ eventKey: `n${i}`, localDate: day(i), startAt: now.getTime() + (i + 2) * 3600e3 })), 1);
    expect(S.detailPlan("acc", now).max).toBe(15);
    S.upsertEvents("acc", [row({ eventKey: "n15", startAt: now.getTime() + 20 * 3600e3 })], 1);
    expect(S.detailPlan("acc", now).max).toBe(60);
  });
});

describe("schema and cursors", () => {
  test("the reminders and fires tables are dropped", () => {
    const names = (S._db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
    expect(names).not.toContain("reminders"); expect(names).not.toContain("fires");
    expect(names).toEqual(expect.arrayContaining(["events", "event_notes", "preps", "cursors", "init_state"]));
  });
  test("cursors and init records", () => {
    expect(S.getCursor("some_cursor")).toBeNull();
    S.setCursor("some_cursor", "2026-10-05T00:00:00Z");
    expect(S.getCursor("some_cursor")).toBe("2026-10-05T00:00:00Z");
    S.markInitStarted("acct", "Reading your calendar");
    expect(S.listInit()[0].finishedAt).toBeNull();
    S.markInitFinished("acct", "done", "Calendar is set up");
    expect(S.listInit()[0].outcome).toBe("done");
  });
});
