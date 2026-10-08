import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs"; import { tmpdir } from "os"; import { join } from "path";
import { ok, type PlatformContext } from "@flock/app-sdk";
process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "calendar-desk-facts-"));
const S = await import("../store");
const F = await import("../facts");
beforeEach(() => { for (const t of ["events", "event_notes", "preps", "cursors", "init_state"]) S._db.exec(`DELETE FROM ${t}`); });
const NOW = new Date(2026, 9, 5, 9, 0);
const fact = (over: any = {}) => ({ id: 1, content: "Flight 6E-512 BLR to MAA departs 06:10.", kind: "event", dateRole: "travel", when: null, validFrom: null, validUntil: null, salience: 0.8, domain: null, sourceLink: null, entityIds: [], recordedAt: "2026-10-04T00:00:00.000Z", eventDate: "2026-10-08", eventTime: null, accountId: null, ...over });
function platform(answer: () => any): PlatformContext {
  return { appId: "calendar-desk", configured: true, memory: { eventFacts: async () => answer() } } as unknown as PlatformContext;
}
const google = (title: string, localDate: string, startAt: number | null) =>
  S.upsertEvents("acct", [{ eventKey: `g-${title}`, calendar: "primary", title, startAt, endAt: null, allDay: startAt == null, localDate, attendeesText: null, location: null, rawTimeText: null }], 1);

describe("factTitle / significantWords", () => {
  test("title is the fact text, one line, no trailing period, <=120", () => {
    expect(F.factTitle("  Dentist   appointment.  ")).toBe("Dentist appointment");
    expect(Array.from(F.factTitle("x".repeat(300))).length).toBe(120);
  });
  test("significant words drop stop-words, generic event nouns and tokens under 3 chars", () => {
    expect([...F.significantWords("Call with Dr. Rao at 10 for the MRI")].sort()).toEqual(["mri", "rao"]);
  });
});

describe("syncFactEvents", () => {
  test("creates, updates and withdraws against the snapshot", async () => {
    let facts = [fact({ id: 1 }), fact({ id: 2, content: "Asha's birthday.", eventDate: "2026-10-11" })];
    const p = platform(() => ok({ facts, snapshot: true }));
    expect(await F.syncFactEvents(p, NOW)).toMatchObject({ ok: true, created: 2, updated: 0, withdrawn: 0 });
    facts = [fact({ id: 1, eventDate: "2026-10-09" })];
    expect(await F.syncFactEvents(p, NOW)).toMatchObject({ ok: true, created: 0, updated: 1, withdrawn: 1 });
    expect(S.listFactEvents().map((e) => [e.eventKey, e.localDate])).toEqual([["fact:1", "2026-10-09"]]);
  });
  test("a timed fact gets a process-local start; the account comes from the fact", async () => {
    const p = platform(() => ok({ facts: [fact({ eventTime: "06:10", accountId: "acc-home", sourceLink: "https://mail.google.com/mail/?authuser=a%40b.c#all/x" })], snapshot: true }));
    await F.syncFactEvents(p, NOW);
    const [e] = S.listFactEvents();
    expect(e).toMatchObject({ accountId: "acc-home", startAt: new Date(2026, 9, 8, 6, 10).getTime(), allDay: false, sourceLink: "https://mail.google.com/mail/?authuser=a%40b.c#all/x" });
  });
  test("503 / any error leaves fact events untouched", async () => {
    await F.syncFactEvents(platform(() => ok({ facts: [fact()], snapshot: true })), NOW);
    const r = await F.syncFactEvents(platform(() => ({ ok: false, reason: "memory unavailable" })), NOW);
    expect(r.ok).toBe(false);
    expect(S.listFactEvents()).toHaveLength(1);
  });
  test("older platform without eventFacts: no-op, untouched", async () => {
    await F.syncFactEvents(platform(() => ok({ facts: [fact()], snapshot: true })), NOW);
    const old = { appId: "calendar-desk", configured: true, memory: { factsSince: async () => ok({ facts: [], nextSince: "" }) } } as unknown as PlatformContext;
    expect(await F.syncFactEvents(old, NOW)).toMatchObject({ ok: false, reason: "eventFacts unsupported" });
    expect(S.listFactEvents()).toHaveLength(1);
  });
});

describe("duplicates against Google events", () => {
  test("same day + shared significant word -> suppressed (not stored)", async () => {
    google("Flight to Chennai 6E-512", "2026-10-08", null);
    const r = await F.syncFactEvents(platform(() => ok({ facts: [fact()], snapshot: true })), NOW);
    expect(r).toMatchObject({ suppressed: 1, created: 0 });
    expect(S.listFactEvents()).toEqual([]);
  });
  test("same day + starts within 60 min -> suppressed", async () => {
    google("Team sync", "2026-10-08", new Date(2026, 9, 8, 6, 40).getTime());
    await F.syncFactEvents(platform(() => ok({ facts: [fact({ content: "Pickup at airport.", eventTime: "06:10" })], snapshot: true })), NOW);
    expect(S.listFactEvents()).toEqual([]);
  });
  test("a different day is never a duplicate", async () => {
    google("Flight to Chennai", "2026-10-09", null);
    await F.syncFactEvents(platform(() => ok({ facts: [fact()], snapshot: true })), NOW);
    expect(S.listFactEvents()).toHaveLength(1);
  });
  test("Google adds the meeting later -> the stored fact event disappears on the next sync", async () => {
    const p = platform(() => ok({ facts: [fact({ content: "Design review with Alex Example.", eventDate: "2026-10-08" })], snapshot: true }));
    await F.syncFactEvents(p, NOW);
    expect(S.listFactEvents()).toHaveLength(1);
    google("Design review", "2026-10-08", new Date(2026, 9, 8, 15, 0).getTime());
    expect(await F.syncFactEvents(p, NOW)).toMatchObject({ suppressed: 1, withdrawn: 1 });
    expect(S.listFactEvents()).toEqual([]);
  });
});
