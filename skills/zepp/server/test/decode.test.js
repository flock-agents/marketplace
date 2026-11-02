import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LAP_COLUMNS, STREAM_SPECS, decodeBandSummary, decodeDetail, decodeHeartZones,
  decodeHrMinutes, decodeLaps, decodeStream, parsePairs, summariseDay,
} from "../src/decode.js";

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64");
const epoch = (iso) => Date.parse(iso) / 1000;

const NIGHT = {
  st: epoch("2026-11-01T17:58:00Z"), // 23:28 at +05:30
  ed: epoch("2026-11-02T01:30:00Z"),
  lt: 60, dp: 30, dt: 30, wk: 5, wc: 2, ss: 81, rhr: 54,
  stage: [
    { mode: 4, start: 1000, stop: 1059 },
    { mode: 5, start: 1060, stop: 1089 },
    { mode: 8, start: 1090, stop: 1119 },
    { mode: 7, start: 1120, stop: 1124 },
  ],
};

test("decodeBandSummary unwraps base64 JSON and fails soft", () => {
  assert.deepEqual(decodeBandSummary(b64({ goal: 8000 })), { goal: 8000 });
  assert.deepEqual(decodeBandSummary(""), {});
  assert.deepEqual(decodeBandSummary("QQ"), {});
  assert.deepEqual(decodeBandSummary(Buffer.from("not json").toString("base64")), {});
  assert.deepEqual(decodeBandSummary(Buffer.from([0xff, 0xfe, 0x7b]).toString("base64")), {});
});

test("decodeHrMinutes keeps minute indexes and nulls the markers", () => {
  const encoded = Buffer.from([72, 0, 254, 255, 130]).toString("base64");
  assert.deepEqual(decodeHrMinutes(encoded), [72, null, null, null, 130]);
  assert.deepEqual(decodeHrMinutes("QQ"), []);
  assert.deepEqual(decodeHrMinutes(""), []);
});

test("summariseDay flattens steps, max HR and a recorded night", () => {
  const row = {
    date_time: "2026-11-02",
    summary: b64({
      tz: "19800",
      goal: 8000,
      stp: { ttl: 9123, dis: 6800, cal: 312, runDist: 3363 },
      hr: { maxHr: { hr: 164, ts: 1 } },
      slp: NIGHT,
    }),
  };
  const day = summariseDay(row);
  assert.deepEqual(Object.keys(day), [
    "date", "steps", "distance_metres", "calories_kcal", "run_distance_metres",
    "step_goal", "max_heart_rate_bpm", "sleep",
  ]);
  assert.equal(day.steps, 9123);
  assert.equal(day.max_heart_rate_bpm, 164);
  assert.deepEqual(day.sleep, {
    light_minutes: 60,
    deep_minutes: 30,
    rem_minutes: 30,
    awake_minutes: 5,
    total_asleep_minutes: 120,
    wake_count: 2,
    sleep_score: 81,
    resting_heart_rate_bpm: 54,
    stage_minutes_recomputed: { light: 60, deep: 30, rem: 30, awake: 5 },
    start_local: "2026-11-01T23:28+05:30",
    end_local: "2026-11-02T07:00+05:30",
  });
});

test("summariseDay with no summary yields nulls and no sleep", () => {
  assert.deepEqual(summariseDay({ date_time: "2026-11-02" }), {
    date: "2026-11-02", steps: null, distance_metres: null, calories_kcal: null,
    run_distance_metres: null, step_goal: null,
  });
});

test("an unrecorded night is missing data, naps survive, bad tz falls back to UTC", () => {
  const slp = {
    lt: 0, dp: 0, dt: 0, wk: 0, ss: 0, rhr: 0, st: 0, ed: 0, sleepSource: -1,
    stage: [],
    odd_stage: [
      { mode: 4, start: 840, stop: 859 },
      { mode: 7, start: 860, stop: 861 },
      { mode: 99, start: 862, stop: 862 },
      "junk",
    ],
  };
  const { sleep } = summariseDay({ date_time: "d", summary: b64({ tz: "bogus", slp }) });
  assert.equal(sleep.main_sleep_recorded, false);
  assert.match(sleep.note, /missing data/);
  assert.deepEqual(sleep.naps, {
    nap_count: 3,
    total_asleep_minutes: 20,
    stage_minutes: { light: 20, awake: 2, unknown_mode_99: 1 },
  });
  assert.equal("sleep_score" in sleep, false);
});

test("zero-score fields drop out and an equal start/end window is removed", () => {
  const slp = { ...NIGHT, ss: 0, rhr: 0, ed: NIGHT.st + 30, stage: [] };
  const { sleep } = summariseDay({ summary: b64({ tz: 999999, slp }) });
  assert.equal("sleep_score" in sleep, false);
  assert.equal("resting_heart_rate_bpm" in sleep, false);
  assert.equal("total_asleep_minutes" in sleep, false);
  assert.equal("stage_minutes_recomputed" in sleep, false);
  // tz out of range -> UTC; 17:58:00 and 17:58:30 render the same minute.
  assert.equal("start_local" in sleep, false);
  assert.equal("end_local" in sleep, false);
  assert.equal(sleep.light_minutes, 60);
});

test("parsePairs accepts t,v pairs and rejects anything else", () => {
  assert.deepEqual(parsePairs(" 0,120;1,2;2,-1; ;"), null);
  assert.deepEqual(parsePairs(" 0,120;1,2;2,-1;;"), [[0, 120], [1, 2], [2, -1]]);
  assert.deepEqual(parsePairs(""), []);
  assert.equal(parsePairs("1,2,3"), null);
  assert.equal(parsePairs("1.5,2"), null);
  assert.equal(parsePairs("a,b"), null);
});

test("decodeStream accumulates deltas and keeps absolutes", () => {
  const hr = decodeStream("heart_rate", "0,116;5,4;5,-1;5,45;");
  assert.deepEqual(hr, {
    name: "heart_rate", unit: "bpm", encoding: "delta", unit_verified: true,
    sample_count: 4, duration_seconds: 15, min: 116, max: 164, avg: 129.75,
    offsets_seconds: [0, 5, 10, 15], values: [116, 120, 119, 164],
  });
  const dist = decodeStream("currentDistance", "0,0;10,37800;10,75600");
  assert.deepEqual(dist.values, [0, 378, 756]);
  assert.equal(dist.unit, "metres");
  const speed = decodeStream("speed", "0,1.3;1,-1;1,0.4");
  assert.deepEqual(speed.values, [1.3, null, 0.4]);
  assert.equal(speed.avg, 0.85);
  assert.equal(decodeStream("pool_swim_pace", "0,3").unit_verified, false);
});

test("decodeStream returns unknown and non-pair fields raw", () => {
  assert.deepEqual(decodeStream("mystery", "0,1;2,3"), {
    name: "mystery", encoding: "unknown", unit: "unknown", sample_count: 2,
    note: "unrecognised stream; values returned unconverted", raw_pairs: [[0, 1], [2, 3]],
  });
  assert.deepEqual(decodeStream("speed", "a;b"), {
    name: "speed", encoding: "unknown", note: "not a time,value stream", raw: "a;b",
  });
  const empty = decodeStream("speed", "");
  assert.equal(empty.duration_seconds, 0);
  assert.equal(empty.min, null);
  assert.equal(empty.avg, null);
});

test("STREAM_SPECS exposes encoding, unit, scale and verified", () => {
  assert.deepEqual(STREAM_SPECS.currentDistance,
    { encoding: "absolute", unit: "metres", scale: 0.01, verified: true });
  assert.equal(STREAM_SPECS.altitude.verified, false);
});

test("decodeHeartZones builds zones from the watch's own boundaries", () => {
  assert.deepEqual(decodeHeartZones("600,110;1200.0,130;1800,150;309,170;"), {
    total_seconds: 3909,
    zone_count: 4,
    zones: [
      { lower_bpm: 0, upper_bpm: 110, seconds: 600, percent: 15.3 },
      { lower_bpm: 110, upper_bpm: 130, seconds: 1200, percent: 30.7 },
      { lower_bpm: 130, upper_bpm: 150, seconds: 1800, percent: 46 },
      { lower_bpm: 150, upper_bpm: 170, seconds: 309, percent: 7.9 },
    ],
  });
  assert.deepEqual(decodeHeartZones("0,110;0,130"), { note: "no time recorded in any zone" });
  assert.deepEqual(decodeHeartZones("1,2,3"), { note: "unrecognised heart_range format", raw: "1,2,3" });
  assert.deepEqual(decodeHeartZones("x,2"), { note: "unrecognised heart_range format", raw: "x,2" });
  assert.deepEqual(decodeHeartZones("nan,2"), { note: "unrecognised heart_range format", raw: "nan,2" });
});

const lapRow = (index, duration, distance, strokes, swolf) => {
  const columns = Array(16).fill("-1");
  Object.assign(columns, {
    0: String(index), 1: String(duration), 2: String(distance), 4: "128",
    5: String(index * 27), 13: String(strokes), 14: String(swolf),
  });
  return columns.join(",");
};

test("decodeLaps separates length rows from set summaries and checks SWOLF", () => {
  const packed = [
    lapRow(1, 27, 21, 13, 40),
    lapRow(2, 26, 21, 14, 41),
    lapRow(3, 28, 21, 12, 40),
    lapRow(4, 81, 63, 39, 120),
  ].join(";") + ";";
  const result = decodeLaps(packed);
  assert.equal(result.lap_count, 3);
  assert.equal(result.set_count, 1);
  assert.equal(result.unit_distance_metres, 21);
  assert.equal(result.column_map, LAP_COLUMNS);
  assert.deepEqual(Object.keys(result.laps[0]), [
    "lap_index", "duration_seconds", "distance_metres", "avg_heart_rate_bpm",
    "elapsed_seconds_cumulative", "pace", "stroke_speed", "strokes", "swolf", "raw_columns",
  ]);
  assert.equal(result.laps[0].pace, null);
  assert.equal(result.laps[0].raw_columns.length, 16);
  assert.equal(result.sets[0].distance_metres, 63);
  assert.deepEqual(result.swolf_check, {
    laps_checked: 3, identity_holds: 3, rule: "swolf == duration_seconds + strokes (tolerance 1)",
  });
  assert.equal("note" in result, false);
});

test("decodeLaps flags a sport where the SWOLF identity fails", () => {
  const result = decodeLaps([lapRow(1, 300, 1000, 10, 900), lapRow(2, 310, 1000, 10, 320)].join(";"));
  assert.equal(result.swolf_check.identity_holds, 1);
  assert.match(result.note, /SWOLF did not equal/);
  assert.equal("sets" in result, false);
});

test("decodeLaps handles short rows and no distance", () => {
  const result = decodeLaps("1,60;2,61");
  assert.equal(result.unit_distance_metres, null);
  assert.equal(result.lap_count, 2);
  assert.deepEqual(result.laps[0], { lap_index: 1, duration_seconds: 60, raw_columns: ["1", "60"] });
  assert.equal("swolf_check" in result, false);
});

test("decodeDetail splits laps, gps and streams", () => {
  const data = {
    heart_rate: "0,120;5,2",
    lap: lapRow(1, 27, 21, 13, 40),
    longitude_latitude: "0,1;1,2",
    source: "run.huami.com",
    speed: "  ",
    count: 7,
    temperature: "0,29",
  };
  const all = decodeDetail(data, new Set(["laps", "gps", "streams"]));
  assert.deepEqual(Object.keys(all), ["laps", "gps", "streams", "available_fields"]);
  assert.equal(all.laps.lap_count, 1);
  assert.deepEqual(Object.keys(all.gps), ["longitude_latitude"]);
  assert.deepEqual(Object.keys(all.streams), ["heart_rate", "temperature"]);
  assert.deepEqual(all.available_fields,
    ["heart_rate", "lap", "longitude_latitude", "source", "temperature"]);

  const none = decodeDetail({ heart_rate: "0,1" }, new Set(["gps"]));
  assert.deepEqual(none, {
    gps: { note: "no GPS recorded for this activity" }, available_fields: ["heart_rate"],
  });
});
