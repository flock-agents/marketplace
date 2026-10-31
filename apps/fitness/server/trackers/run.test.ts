import { describe, it, expect } from "bun:test";
import { NO_TRACKER, runTrackers, type ConnectorState } from "./run";
import type { SyncReport, Tracker, TrackerContext } from "./types";
import type { SyncStore } from "./store";

const ok = (message: string, todayAsOf: string | null = null): SyncReport => ({ ok: true, added: 1, updated: 0, failed: [], message, newest: null, todayAsOf });
const tracker = (id: string, sync: Tracker["sync"]): Tracker => ({ id, name: id.toUpperCase(), skillId: `skill-${id}`, metrics: ["Steps"], sync });
const state = (id: string, granted = true, ready = true): ConnectorState => ({ skillId: `skill-${id}`, optional: true, granted, ready });
const context = (): TrackerContext => ({ call: async () => ({ ok: true, data: {} }), store: {} as SyncStore, now: new Date() });

describe("runTrackers", () => {
  it("does nothing, without error, when no tracker is connected", async () => {
    let ran = false;
    const report = await runTrackers([tracker("a", async () => { ran = true; return ok("a"); })], async () => [], context, 7);
    expect(report).toEqual({ ok: true, trackers: [], message: NO_TRACKER, newest: null, todayAsOf: null });
    expect(ran).toBe(false);
  });
  it("runs only trackers whose connector is granted and ready", async () => {
    const ran: string[] = [];
    const t = (id: string) => tracker(id, async () => { ran.push(id); return ok(id); });
    await runTrackers([t("a"), t("b"), t("c")], async () => [state("a"), state("b", false), state("c", true, false)], context, 7);
    expect(ran).toEqual(["a"]);
  });
  it("keeps going when one tracker throws or fails, and names the failure", async () => {
    const report = await runTrackers([
      tracker("a", async () => { throw new Error("signed out"); }),
      tracker("b", async () => ({ ...ok("b"), ok: false, message: "all calls failed" })),
      tracker("c", async () => ok("Synced C", "2026-10-21T07:00:00.000Z")),
    ], async () => [state("a"), state("b"), state("c")], context, 7);
    expect(report.ok).toBe(true);
    expect(report.trackers).toEqual([
      { id: "a", name: "A", ok: false, message: "sync failed: signed out" },
      { id: "b", name: "B", ok: false, message: "all calls failed" },
      { id: "c", name: "C", ok: true, message: "Synced C" },
    ]);
    expect(report.todayAsOf).toBe("2026-10-21T07:00:00.000Z");
  });
  it("is failed only when every tracker that ran failed; a failing listing reads as none connected", async () => {
    const bad = await runTrackers([tracker("a", async () => { throw new Error("x"); })], async () => [state("a")], context, 7);
    expect(bad.ok).toBe(false);
    const listing = await runTrackers([tracker("a", async () => ok("a"))], async () => { throw new Error("old Flock"); }, context, 7);
    expect(listing.trackers).toEqual([]);
  });
});
