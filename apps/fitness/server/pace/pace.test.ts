import { describe, it, expect } from "bun:test";
import { paceSettings, paceParams, type PaceParams } from "./params";
import { curveShare, usualRoutine, valueAt, type PastDay } from "./routine";
import { paceVerdict, type MetricInput, type PaceContext } from "./check";
import { paceService } from "./service";
import type { PaceStore } from "./store";

/** The defaults, read the way the app reads its settings. */
const defaults = (over: Partial<PaceParams> = {}): PaceParams => ({
  ...paceParams(<T>(key: string) => paceSettings.find((s) => s.key === key)!.default as T),
  ...over,
});

const TODAY = "2026-10-21";   // a Wednesday
const day = (daysAgo: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - daysAgo * 86_400_000).toISOString().slice(0, 10);
const H = (h: number, m = 0) => h * 60 + m;

/** `n` usual days of `total` steps, each with hourly samples on a straight 7 AM-9 PM day (half done by 2 PM). */
function sampledDays(n: number, total: number, from = 1): PastDay[] {
  return Array.from({ length: n }, (_, i) => ({
    day: day(from + i), total,
    samples: Array.from({ length: 15 }, (_, h) => ({ minute: H(7 + h), value: Math.round((total * h) / 14) })),
  }));
}

const at = (hhmm: [number, number]) => new Date(`${TODAY}T${String(hhmm[0]).padStart(2, "0")}:${String(hhmm[1]).padStart(2, "0")}:00+05:30`);
/** The check at `hhmm`, with today's watch data reaching `lagMinutes` before it (null: nothing from today). */
function ctx(hhmm: [number, number], over: Partial<PaceContext> = {}, lagMinutes: number | null = 20): PaceContext {
  const now = at(hhmm), minute = H(...hhmm);
  const asOf = lagMinutes === null ? null : new Date(now.getTime() - lagMinutes * 60_000).toISOString();
  return { now, today: TODAY, minute, asOf, asOfMinute: lagMinutes === null ? null : minute - lagMinutes, nudgesToday: [], ...over };
}
const steps = (today: number | null, past: PastDay[], goal: number | null = null): MetricInput => ({ label: "Steps", today, goal, past });

describe("settings", () => {
  it("every default passes its own check", () => {
    for (const s of paceSettings) expect(s.check?.(s.default) ?? null).toBeNull();
  });
  it("refuses a curve that goes backwards or never reaches the whole day", () => {
    const curve = paceSettings.find((s) => s.key === "pace.default_curve")!;
    expect(curve.check!([["10:00", 0.5], ["09:00", 1]])).not.toBeNull();
    expect(curve.check!([["10:00", 0.5], ["20:00", 0.9]])).not.toBeNull();
  });
  it("refuses a number the check cannot pace", () => {
    expect(paceSettings.find((s) => s.key === "pace.metrics")!.check!([{ label: "Sleep", min_gap: 1 }])).not.toBeNull();
  });
});

describe("usual routine", () => {
  it("reads a past day's running total between the syncs that saw it", () => {
    const d: PastDay = { day: day(1), total: 1000, samples: [{ minute: H(10), value: 200 }, { minute: H(14), value: 600 }] };
    expect(valueAt(d, H(12))).toBe(400);
    expect(valueAt(d, H(5))).toBe(100);           // from nothing at midnight to the first sync
  });
  it("leaves watch-off days out of a usual day's total", () => {
    const past = [...sampledDays(6, 4000), { day: day(8), total: 28, samples: [] }, { day: day(9), total: 700, samples: [] }];
    expect(usualRoutine(past, TODAY, H(14), defaults())).toMatchObject({ total: 4000, days: 6 });
  });
  it("uses the person's own shape once enough days were sampled, else the default curve", () => {
    expect(usualRoutine(sampledDays(5, 4000), TODAY, H(14), defaults())).toMatchObject({ source: "personal", share: 0.5 });
    const few = usualRoutine(sampledDays(4, 4000), TODAY, H(14), defaults())!;
    expect(few).toMatchObject({ source: "default", sampledDays: 4 });
    expect(few.share).toBe(curveShare(defaults().default_curve, H(14)));
  });
  it("compares weekends with weekends once there are enough of them", () => {
    const weekdays = Array.from({ length: 10 }, (_, i) => day(i + 1)).filter((d) => ![0, 6].includes(new Date(d).getUTCDay()));
    const weekends = Array.from({ length: 30 }, (_, i) => day(i + 1)).filter((d) => [0, 6].includes(new Date(d).getUTCDay())).slice(0, 6);
    const past = [...weekdays.map((d) => ({ day: d, total: 6000, samples: [] })), ...weekends.map((d) => ({ day: d, total: 2000, samples: [] }))];
    expect(usualRoutine(past, TODAY, H(14), defaults())!.total).toBe(6000);                     // Wednesday: weekdays
    expect(usualRoutine(past, "2026-10-24", H(14), defaults())!.total).toBe(2000);              // Saturday: weekends
    expect(usualRoutine(past, TODAY, H(14), defaults({ split_weekends: false }))!.total).toBe(6000);
  });
  it("has nothing to say without history", () => expect(usualRoutine([], TODAY, H(14), defaults())).toBeNull());
});

describe("pace verdict", () => {
  const routine = sampledDays(7, 4000);   // half the day (2,000) done by 2 PM
  it("nudges when well behind a usual day by mid-afternoon", () => {
    const v = paceVerdict([steps(400, routine)], ctx([14, 0], {}, 0), defaults());
    expect(v).toMatchObject({ nudge: true, why: "well behind on Steps" });
    expect(v.metrics[0]).toMatchObject({ today: 400, expected: 2000, ratio: 0.2, behind: true });
  });
  it("stays quiet a little behind, and early in the day", () => {
    expect(paceVerdict([steps(1500, routine)], ctx([14, 0]), defaults())).toMatchObject({ nudge: false, why: "on pace" });
    expect(paceVerdict([steps(0, routine)], ctx([10, 0]), defaults()).metrics[0]!.why).toBe("too early in a usual day to judge");
  });
  it("stays quiet when the shortfall is too small to matter", () => {
    const small = sampledDays(7, 1200);
    expect(paceVerdict([steps(200, small)], ctx([14, 0]), defaults()).metrics[0]!.why).toBe("behind, but by too little to matter");
  });
  it("never judges stale data, outside the hours, or past today's nudges", () => {
    const behind = [steps(400, routine)];
    expect(paceVerdict(behind, ctx([14, 0], {}, 180), defaults()).why).toBe("the tracker's data only reaches 11:00, 180 minutes ago: a sync gap, not the person");
    expect(paceVerdict(behind, ctx([14, 0], {}, null), defaults()).why).toBe("the tracker has no data from today yet: a sync gap, not the person");
    expect(paceVerdict(behind, ctx([21, 30]), defaults()).why).toBe("outside the hours a nudge can go");
    expect(paceVerdict(behind, ctx([14, 0], { nudgesToday: [`${TODAY}T04:00:00.000Z`] }), defaults()).why).toBe("today's nudges are used up");
    const twice = defaults({ max_nudges_per_day: 2 });
    expect(paceVerdict(behind, ctx([14, 0], { nudgesToday: [`${TODAY}T07:00:00.000Z`] }), twice).why).toBe("nudged too recently");
    expect(paceVerdict(behind, ctx([14, 0], { nudgesToday: [`${TODAY}T04:00:00.000Z`] }), twice).nudge).toBe(true);
    expect(paceVerdict(behind, ctx([14, 0]), defaults({ enabled: false })).why).toBe("the pace check is off");
  });
  it("aims at the goal when the coach says so", () => {
    const v = paceVerdict([steps(1500, routine, 8000)], ctx([14, 0], {}, 0), defaults({ reference: "goal" }));
    expect(v.metrics[0]).toMatchObject({ aimedAt: "goal", expected: 4000, behind: true });
  });
  it("only checks the numbers the settings name", () => {
    const kcal: MetricInput = { label: "Calories burned", today: 0, goal: null, past: sampledDays(7, 400) };
    expect(paceVerdict([steps(1900, routine), kcal], ctx([14, 0]), defaults({ metrics: [{ label: "Steps", min_gap: 500 }] })).metrics.map((m) => m.label)).toEqual(["Steps"]);
  });
});

describe("stale data never reads as falling behind", () => {
  const routine = sampledDays(7, 4000);   // a straight 7 AM-9 PM day: 2,000 by 2 PM
  it("judges today against a usual day where the data reaches, not at the time of the check", () => {
    // 1,000 steps in data reaching 12:31 (89 minutes old at 2 PM): a usual day is at about 1,576 then, so this is on pace,
    // though against a usual 2 PM (2,000) it would have looked half done.
    const v = paceVerdict([steps(1000, routine)], ctx([14, 0], {}, 89), defaults());
    expect(v).toMatchObject({ nudge: false, why: "on pace" });
    expect(v.metrics[0]).toMatchObject({ expected: 1576, ratio: 0.63, behind: false });
    expect(paceVerdict([steps(1000, routine)], ctx([14, 0], {}, 0), defaults()).metrics[0]).toMatchObject({ expected: 2000, ratio: 0.5 });
  });
  it("skips silently with no watch data from today, even when the day's total reads zero", () => {
    // A real case: PAI and workouts uploaded recently, but nothing from the watch today, so no steps.
    expect(paceVerdict([steps(0, routine)], ctx([14, 0], {}, null), defaults()).nudge).toBe(false);
  });
  it("never treats a missing total for today as zero", () => {
    const v = paceVerdict([steps(null, routine)], ctx([14, 0], {}, 10), defaults());
    expect(v).toMatchObject({ nudge: false });
    expect(v.metrics[0]!.why).toBe("the tracker has no total for today yet");
  });
  it("skips at any age past the cutoff, not only just past it", () => {
    for (const lag of [91, 120, 300, 600]) expect(paceVerdict([steps(0, routine)], ctx([14, 0], {}, lag), defaults()).nudge).toBe(false);
  });
});

describe("pace service", () => {
  function memory(today: number | null) {
    const samples: unknown[] = [], nudges: { day: string; at: string; labels: string[]; message: string }[] = [];
    const store: PaceStore = {
      inputs: (labels) => labels.map((label) => (label === "Steps" ? steps(today, sampledDays(7, 4000)) : { label, today: null, goal: null, past: [] })),
      nudgesOn: (d) => nudges.filter((n) => n.day === d).map((n) => n.at),
      addSamples: async (d, minute, values) => { samples.push({ d, minute, values }); },
      addNudge: async (d, at, labels, message) => { nudges.push({ day: d, at, labels, message }); },
    };
    return { store, samples, nudges, service: paceService(store, () => defaults()) };
  }
  const now = ctx([14, 0], {}, 0);

  it("wakes the coach once with what is behind, and notes it", async () => {
    const { service, nudges } = memory(400);
    const wakes: string[] = [];
    const wake = async (message: string) => { wakes.push(message); return { ok: true }; };
    await service.check(now.asOf, wake, now.now);
    await service.check(now.asOf, wake, new Date(now.now.getTime() + 3_600_000));
    expect(wakes).toHaveLength(1);
    expect(wakes[0]).toContain("Steps: 400 by 2:00 PM; a usual day is at 2,000 by then (20% of that), and a usual day ends near 4,000.");
    expect(nudges).toMatchObject([{ day: TODAY, labels: ["Steps"] }]);
  });
  it("says a usual total as a whole number", async () => {
    const { store, service } = memory(400);
    store.inputs = (labels) => labels.map((label) => steps(400, [...sampledDays(6, 4000), { day: day(7), total: 4001, samples: [] }]));
    const wakes: string[] = [];
    await service.check(now.asOf, async (m) => { wakes.push(m); return { ok: true }; }, now.now);
    expect(wakes[0]).toContain("a usual day ends near 4,000.");
  });
  it("wakes nobody when on pace", async () => {
    const { service } = memory(1900);
    let woken = false;
    expect((await service.check(now.asOf, async () => { woken = true; return { ok: true }; }, now.now)).nudge).toBe(false);
    expect(woken).toBe(false);
  });
  it("fails the run, and notes nothing, when the coach cannot be woken", async () => {
    const { service, nudges } = memory(400);
    expect(service.check(now.asOf, async () => ({ ok: false, reason: "not paired" }), now.now)).rejects.toThrow("not paired");
    expect(nudges).toHaveLength(0);
  });
  it("keeps today's running totals at the minute the data reaches, and only from fresh data", async () => {
    const { service, samples } = memory(400);
    await service.sample(now.asOf, now.now);
    await service.sample(new Date(now.now.getTime() - 40 * 60_000).toISOString(), now.now);   // data reaching 1:20 PM
    await service.sample(`${TODAY}T01:00:00.000Z`, now.now);                                  // 6:30 AM: stale at 2 PM
    await service.sample(null, now.now);                                                       // nothing from today
    await service.sample("2026-10-20T13:00:00.000Z", now.now);                                 // yesterday's data
    expect(samples).toEqual([
      { d: TODAY, minute: H(14), values: [{ label: "Steps", value: 400 }] },
      { d: TODAY, minute: H(13, 20), values: [{ label: "Steps", value: 400 }] },
    ]);
  });
  it("stays silent through a whole day of stale data: no wake, no note, no failure", async () => {
    const { service, samples, nudges } = memory(0);
    let wakes = 0;
    const lastUpload = `${TODAY}T02:00:00.000Z`;   // 7:30 AM, never again that day
    for (let hour = 10; hour <= 20; hour++) {
      const v = await service.check(lastUpload, async () => { wakes++; return { ok: true }; }, at([hour, 30]));
      expect(v.nudge).toBe(false);
      await service.sample(lastUpload, at([hour, 30]));
    }
    expect(wakes).toBe(0);
    expect(nudges).toHaveLength(0);
    expect(samples).toHaveLength(0);
  });
  it("reads data stamped after the check as the check's own time", () => {
    const { service } = memory(400);
    const { ctx: c } = service.verdict(new Date(now.now.getTime() + 5 * 60_000).toISOString(), now.now);
    expect(c.asOfMinute).toBe(H(14));
  });
});
