import { describe, it, expect } from "bun:test";
import { syncNow } from "./sync-now";
import type { RunReport as SyncReport } from "./run";

const report = (ok = true): SyncReport => ({ ok, trackers: [], message: ok ? "Synced with Zepp: 1 new, 0 updated" : "Zepp sync failed: x", newest: "2026-10-21T07:40:00.000Z", todayAsOf: "2026-10-21T07:30:00.000Z" });

/** A pass the test finishes by hand, so it can look at the button while one is under way. */
function setup() {
  let passes = 0;
  let finish: (r: SyncReport) => void = () => {};
  let fail: (e: Error) => void = () => {};
  const sync = syncNow(() => { passes++; return new Promise<SyncReport>((res, rej) => { finish = res; fail = rej; }); }, () => new Date("2026-10-21T08:00:00.000Z"));
  return { sync, passes: () => passes, finish: (r: SyncReport) => finish(r), fail: (e: Error) => fail(e) };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("syncNow", () => {
  it("starts a pass at a tap and shows it as running", () => {
    const { sync, passes } = setup();
    expect(sync.request()).toEqual({ running: true, last: null });
    expect(passes()).toBe(1);
  });
  it("joins the pass under way instead of starting a second one", () => {
    const { sync, passes } = setup();
    sync.request();
    sync.request();
    void sync.run();
    expect(passes()).toBe(1);
  });
  it("is done when the pass finishes, with what it said", async () => {
    const { sync, finish } = setup();
    const scheduled = sync.run();
    finish(report());
    expect(await scheduled).toMatchObject({ ok: true });
    expect(sync.status()).toEqual({ running: false, last: { at: "2026-10-21T08:00:00.000Z", ok: true, message: "Synced with Zepp: 1 new, 0 updated", newest: "2026-10-21T07:40:00.000Z", todayAsOf: "2026-10-21T07:30:00.000Z", trackers: [] } });
  });
  it("starts a new pass after one finished", async () => {
    const { sync, passes, finish } = setup();
    sync.request();
    finish(report());
    await settle();
    expect(sync.request().running).toBe(true);
    expect(passes()).toBe(2);
  });
  it("turns a pass that throws into a failed one, and stays free", async () => {
    const { sync, fail } = setup();
    const run = sync.run();
    fail(new Error("connector down"));
    expect(await run).toMatchObject({ ok: false, message: "Sync failed: connector down" });
    expect(sync.status()).toMatchObject({ running: false, last: { ok: false } });
  });
});
