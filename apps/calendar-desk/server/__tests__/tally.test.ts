import { describe, expect, test } from "bun:test";
import { tally, placeTally, placeState, PLACE_DONE_WINDOW_MS, TALLY_WINDOW_MS, type TallyRow } from "../tally";

const NOW = 1_800_000_000_000, DAY = 86400_000;
const K = new Map<string, string>();
let n = 0;
function row(kind: string, over: Partial<TallyRow>, ref = `step:e${n}:s${n++}`): TallyRow {
  K.set(ref, kind);
  return { sourceRef: ref, status: "open", title: "t", due: null, showFrom: null, ...over };
}
const done = (kind: string, ago: number) => row(kind, { status: "done", closedAt: NOW - ago });
const skip = (kind: string, ago: number) => row(kind, { status: "dismissed", skipped: true, closedAt: NOW - ago });
const state = (rows: TallyRow[], covered = new Set<string>(), kind = "gift") => tally(rows, K, NOW, covered).get(kind);

describe("tally", () => {
  test("a done close switches a kind on", () => expect(state([done("gift", DAY)])?.state).toBe("on"));
  test("two newest skips switch it off", () => expect(state([skip("gift", DAY), skip("gift", 2 * DAY)])).toEqual({ state: "off", done: 0, skips: 2 }));
  test("skip, done, skip (newest first) is none", () => expect(state([skip("gift", DAY), done("gift", 2 * DAY), skip("gift", 3 * DAY)])?.state).toBe("none"));
  test("a skip then a newer done is on", () => expect(state([done("gift", DAY), skip("gift", 2 * DAY)])?.state).toBe("on"));
  test("one skip alone is none", () => expect(state([skip("gift", DAY)])?.state).toBe("none"));
  test("withdrawn rows count nothing, even flagged skipped or done", () => {
    const rows = [row("gift", { status: "dismissed", skipped: true, withdrawn: true, closedAt: NOW - DAY }), row("gift", { status: "dismissed", skipped: true, withdrawn: true, closedAt: NOW - 2 * DAY }), row("gift", { status: "done", withdrawn: true, closedAt: NOW - 3 * DAY })];
    expect(state(rows)).toBeUndefined();
  });
  test("covered only counts nothing", () => {
    const r = done("gift", DAY);
    expect(state([r], new Set([r.sourceRef]))).toBeUndefined();
  });
  test("an expiry dismissal counts nothing", () => expect(state([row("gift", { status: "dismissed", closedAt: NOW - DAY })])).toBeUndefined());
  test("an open row counts nothing", () => expect(state([row("gift", {})])).toBeUndefined());
  test("a skip exactly 90 days old counts, 1 ms older does not", () => {
    expect(state([skip("gift", DAY), skip("gift", TALLY_WINDOW_MS)])?.state).toBe("off");
    expect(state([skip("gift", DAY), skip("gift", TALLY_WINDOW_MS + 1)])?.state).toBe("none");
  });
  test("keeps the newest 10 per kind", () => {
    const rows = Array.from({ length: 11 }, (_, i) => done("gift", (i + 1) * DAY));
    expect(state(rows)).toEqual({ state: "on", done: 10, skips: 0 });
  });
  test("rows without skipped or closedAt never switch off", () => {
    const rows = [row("gift", { status: "dismissed" }), row("gift", { status: "dismissed" }), row("gift", { status: "done", updatedAt: NOW - DAY })];
    expect(state(rows)).toEqual({ state: "on", done: 1, skips: 0 });
  });
  test("an older Flock done falls back to updatedAt", () => {
    expect(state([row("gift", { status: "done", updatedAt: NOW - DAY })])?.state).toBe("on");
    expect(state([row("gift", { status: "done", updatedAt: NOW - 100 * DAY })])).toBeUndefined();
  });
  test("equal closedAt treats the skip as older than the done", () => {
    expect(state([skip("gift", DAY), done("gift", DAY)])?.state).toBe("on");
  });
  test("kinds are tallied separately and unknown refs ignored", () => {
    const t = tally([skip("cab-local", DAY), skip("cab-local", 2 * DAY), done("gift", DAY), { sourceRef: "step:x:y", status: "done", title: "", due: null, showFrom: null, closedAt: NOW }], K, NOW);
    expect(t.get("cab-local")?.state).toBe("off");
    expect(t.get("gift")?.state).toBe("on");
    expect(t.size).toBe(2);
  });
});

describe("placeTally", () => {
  const PL = new Map<string, { kind: string; place: string }>();
  let m = 0;
  const at = (kind: string, place: string, over: Partial<TallyRow>): TallyRow => {
    const ref = `step:p${m}:s${m++}`; PL.set(ref, { kind, place });
    return { sourceRef: ref, status: "open", title: "t", due: null, showFrom: null, ...over };
  };
  const doneAt = (place: string, ago: number, kind = "cab-local") => at(kind, place, { status: "done", closedAt: NOW - ago });
  const skipAt = (place: string, ago: number, kind = "cab-local") => at(kind, place, { status: "dismissed", skipped: true, closedAt: NOW - ago });
  const st = (rows: TallyRow[], place = "apollo clinic", kind = "cab-local", covered = new Set<string>()) => placeState(placeTally(rows, PL, NOW, covered), kind, place);

  test("a done here is on; two newest skips here are off; one skip is none", () => {
    expect(st([doneAt("apollo clinic", DAY)])).toBe("on");
    expect(st([skipAt("apollo clinic", DAY), skipAt("apollo clinic", 2 * DAY)])).toBe("off");
    expect(st([skipAt("apollo clinic", DAY)])).toBe("none");
  });
  test("newest first: skip then older done is none; done then older skips is on", () => {
    expect(st([skipAt("apollo clinic", DAY), doneAt("apollo clinic", 2 * DAY)])).toBe("none");
    expect(st([doneAt("apollo clinic", DAY), skipAt("apollo clinic", 2 * DAY), skipAt("apollo clinic", 3 * DAY)])).toBe("on");
  });
  test("a done counts for 365 days, a skip for 90", () => {
    expect(st([doneAt("apollo clinic", PLACE_DONE_WINDOW_MS)])).toBe("on");
    expect(st([doneAt("apollo clinic", PLACE_DONE_WINDOW_MS + 1)])).toBe("none");
    expect(st([skipAt("apollo clinic", DAY), skipAt("apollo clinic", TALLY_WINDOW_MS)])).toBe("off");
    expect(st([skipAt("apollo clinic", DAY), skipAt("apollo clinic", TALLY_WINDOW_MS + 1)])).toBe("none");
    expect(st([skipAt("apollo clinic", DAY), skipAt("apollo clinic", 2 * DAY), doneAt("apollo clinic", 200 * DAY)])).toBe("off");
  });
  test("places and kinds are separate", () => {
    const rows = [skipAt("smile dental", DAY), skipAt("smile dental", 2 * DAY), doneAt("apollo clinic", 3 * DAY), doneAt("asha", 300 * DAY, "gift")];
    expect(st(rows)).toBe("on");
    expect(st(rows, "smile dental")).toBe("off");
    expect(st(rows, "asha", "gift")).toBe("on");
    expect(st(rows, "asha", "cab-local")).toBe("none");
    expect(placeState(placeTally(rows, PL, NOW), "cab-local", null)).toBe("none");
  });
  test("withdrawn, covered, other dismissals and open rows count nothing", () => {
    const w = at("cab-local", "apollo clinic", { status: "dismissed", skipped: true, withdrawn: true, closedAt: NOW - DAY });
    const c = doneAt("apollo clinic", DAY);
    const e = at("cab-local", "apollo clinic", { status: "dismissed", closedAt: NOW - DAY });
    const o = at("cab-local", "apollo clinic", {});
    expect(st([w, c, e, o], "apollo clinic", "cab-local", new Set([c.sourceRef]))).toBe("none");
  });
  test("older Flock rows (no skipped, no closedAt) never read off; a done falls back to updatedAt", () => {
    const rows = [at("cab-local", "apollo clinic", { status: "dismissed" }), at("cab-local", "apollo clinic", { status: "dismissed" })];
    expect(st(rows)).toBe("none");
    expect(st([at("cab-local", "apollo clinic", { status: "done", updatedAt: NOW - 200 * DAY })])).toBe("on");
  });
  test("a step with no recorded place is not counted for any place", () => {
    expect(st([done("cab-local", DAY)])).toBe("none"); // `done` from the tally tests: kind only, no place
  });
});
