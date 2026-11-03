import { describe, it, expect } from "bun:test";
import type { SyncStatus } from "../../server/trackers/sync-now";
import { connectPath, connectToast, failedTrackers, noneConnected, outcomeToast, toConnect } from "./tracker-sync";

const zepp = { id: "zepp", name: "Zepp", skillId: "zepp" };
const finished = (ok: boolean, trackers = [{ ...zepp, ok, message: ok ? "Synced" : "spawn python3 ENOENT" }]): SyncStatus =>
  ({ running: false, last: { at: "2026-11-02T08:00:00.000Z", ok, message: ok ? "Synced with Zepp" : "Zepp: spawn python3 ENOENT", newest: null, todayAsOf: null, trackers } });

describe("the Sync button's state", () => {
  it("offers Connect only once the page knows no tracker is ready", () => {
    expect(noneConnected(null)).toBe(false);
    expect(noneConnected([{ ...zepp, ready: false }])).toBe(true);
    expect(noneConnected([{ ...zepp, ready: true }])).toBe(false);
  });
  it("opens the one tracker's connector page, or the connector list when there are several", () => {
    expect(connectPath([zepp])).toBe("/connectors/zepp");
    expect(connectPath([zepp, { skillId: "fitbit" }])).toBe("/connectors");
  });
  it("names the tracker that failed instead of the connector's raw error", () => {
    expect(outcomeToast(finished(false))).toEqual({ message: "Zepp couldn't sync", tone: "danger" });
    expect(failedTrackers(finished(false)).map((t) => t.message)).toEqual(["spawn python3 ENOENT"]);
  });
  it("says how a good pass went, and nothing while one runs", () => {
    expect(outcomeToast(finished(true))).toEqual({ message: "Synced with Zepp", tone: "success" });
    expect(outcomeToast({ running: true, last: null })).toBeNull();
  });
  it("connects the first tracker not connected yet, and says where the coach's request shows up", () => {
    expect(toConnect([{ ...zepp, ready: true }, { id: "fit", name: "Fit", skillId: "fit", ready: false }])?.id).toBe("fit");
    expect(toConnect([{ ...zepp, ready: true }])).toBeUndefined();
    expect(connectToast(zepp)).toContain("Approve its request in Flock");
  });
});
