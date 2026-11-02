import { describe, it, expect } from "bun:test";
import { HOLD_REASON, routineHold } from "./routine-hold";

function flock(ok = true) {
  const calls: string[] = [];
  return {
    calls,
    routines: {
      hold: async (reason: string) => { calls.push(`hold:${reason}`); return { ok }; },
      release: async () => { calls.push("release"); return { ok }; },
    },
  };
}

describe("routineHold", () => {
  it("holds the routines while the app is not set up, with the reason the routines page shows", async () => {
    const f = flock();
    await routineHold(f.routines, () => false)();
    expect(f.calls).toEqual([`hold:${HOLD_REASON}`]);
  });
  it("releases them once set up, and asks Flock only when that changes", async () => {
    const f = flock();
    let setUp = false;
    const apply = routineHold(f.routines, () => setUp);
    await apply();
    await apply();
    setUp = true;
    await apply();
    await apply();
    expect(f.calls).toEqual([`hold:${HOLD_REASON}`, "release"]);
  });
  it("tries again on the next call when Flock did not do it", async () => {
    const f = flock(false);
    const apply = routineHold(f.routines, () => false, () => {});
    await apply();
    await apply();
    expect(f.calls.length).toBe(2);
  });
  it("does nothing on a Flock without hold and release", async () => {
    await routineHold(undefined, () => false)();
    await routineHold({}, () => false)();
  });
  it("never throws when the call fails", async () => {
    const logs: string[] = [];
    const apply = routineHold({ hold: async () => { throw new Error("down"); }, release: async () => ({ ok: true }) }, () => false, (m) => logs.push(m));
    await apply();
    expect(logs[0]).toContain("down");
  });
});
