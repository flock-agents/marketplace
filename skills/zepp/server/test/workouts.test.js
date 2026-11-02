import { test } from "node:test";
import assert from "node:assert/strict";

import {
  COMMON_FIELDS, RUNNING_DYNAMICS_FIELDS, SPORT_FIELDS, normalise,
} from "../src/workouts.js";

const RUN = {
  trackid: "1793600100",
  end_time: "1793603700",
  source: "run.huami.com",
  type: 1,
  syncedTimezone: "Asia/Kolkata",
  calorie: "412.0",
  dis: "8012.5",
  avg_heart_rate: "153.0",
  max_heart_rate: 177,
  min_heart_rate: -1,
  te: "32",
  anaerobic_te: 1,
  avg_temperature: "-274",
  spo2_min: 0,
  avg_frequency: "153.0",
  max_frequency: "-60",
  average_power: "201",
  max_power: "274",
  averageRTPC: "1.2",
  bestRTPC: "21.0",
  lactateThresholdHr: 171,
  avgEquivPace: "354",
  equivDistance: "802490",
  total_step: "9500",
  avg_pace: "0.354",
  min_pace: "0",
  elevationGain: "27961",
  avg_altitude: "-20000",
  flight_ratio: "0",
  marathon: "",
  averageGct: "251",
  avgVertStrideRatio: "80",
  runningProgram: 7,
  runningType: "2",
  dailyPlanFinished: true,
  dailyScore: 98.75,
  pb: "{\"run_furthest_km\": 8.0}",
  heart_range: "600,110;1200,130;1800,150;309,170",
  parent_trackid: "0",
  child_list: [],
  weight: 91,
};

test("a run gets the common summary, foot block, dynamics and plan", () => {
  const out = normalise(RUN);
  assert.deepEqual(Object.keys(out), [
    "track_id", "source", "sport", "sport_code", "start_local", "end_local", "timezone",
    "elapsed_seconds", "summary", "foot", "training_plan", "personal_bests", "heart_rate_zones",
  ]);
  assert.equal(out.track_id, "1793600100");
  assert.equal(out.sport, "outdoor_running");
  assert.equal(out.start_local, "2026-11-02T11:45:00+05:30");
  assert.equal(out.end_local, "2026-11-02T12:45:00+05:30");
  assert.equal(out.timezone, "Asia/Kolkata");
  assert.equal(out.elapsed_seconds, 3600);
  assert.deepEqual(out.summary, {
    calorie: 412,
    dis: 8012.5,
    avg_heart_rate: 153,
    max_heart_rate: 177,
    aerobic_training_effect: 3.2,
    aerobic_training_effect_band: "improving",
    anaerobic_training_effect: 0.1,
    anaerobic_training_effect_band: "no effect",
    avg_cadence_per_minute: 153,
    avg_power_watts: 201,
    max_power_watts: 274,
    avg_rtpc_unverified: 1.2,
  });
  assert.deepEqual(out.foot, {
    lactate_threshold_hr_bpm: 171,
    avg_pace_sec_per_km: 354,
    equiv_distance_metres: 8024.9,
    total_step: 9500,
    avg_pace: 0.354,
    elevation_gain_metres: 279.61,
    running_dynamics: {
      avg_ground_contact_time_ms: 251,
      avg_vertical_stride_ratio_percent: 8,
    },
  });
  assert.deepEqual(out.training_plan, {
    running_program_id: 7,
    running_type_code: 2,
    plan_session_finished: true,
    plan_session_score_percent: 98.75,
  });
  assert.deepEqual(out.personal_bests, { run_furthest_km: 8 });
  assert.equal(out.heart_rate_zones.total_seconds, 3909);
  assert.equal("raw" in out, false);
  assert.equal(normalise(RUN, true).raw, RUN);
});

test("a swim keeps strings and rejects sentinel fields", () => {
  const out = normalise({
    trackid: 1793600100, type: "14", source: "s", swolf: "40", total_trips: "36",
    swim_style: "freestyle", max_stroke_speed: "-1", avg_temperature: "29.0",
    strengthScores: [], avg_pace: "3.4",
  });
  assert.equal(out.sport, "pool_swimming");
  assert.equal(out.sport_code, "14");
  assert.equal(out.timezone, "UTC");
  assert.equal(out.start_local, "2026-11-02T06:15:00+00:00");
  assert.equal(out.end_local, null);
  assert.equal("elapsed_seconds" in out, false);
  assert.deepEqual(out.summary, { avg_temperature: 29 });
  assert.deepEqual(out.swim, { swolf: 40, total_trips: 36, swim_style: "freestyle", avg_pace: 3.4 });
});

test("unknown sport codes surface every populated block as unclassified", () => {
  const out = normalise({
    trackid: "1793600100", type: 77, syncedTimezone: "Not/AZone",
    total_group: "4", avg_slope: "3", strengthScores: [1, 2],
  });
  assert.equal(out.sport, "unknown_sport_77");
  assert.equal(out.start_local, "2026-11-02T06:15:00+00:00");
  assert.equal(out.timezone, "Not/AZone");
  assert.deepEqual(out.unclassified_metrics, {
    strength: { total_group: 4, strengthScores: [1, 2] },
    hike: { avg_slope: 3 },
    ride: { avg_slope: 3 },
    rope_skipping: { total_group: 4 },
  });
});

test("free training and football emit only what is populated", () => {
  const free = normalise({ trackid: "5", type: 16, calorie: "120" });
  assert.equal(free.sport, "free_training");
  assert.equal("free_training" in free, false);
  const football = normalise({
    trackid: "5", type: 18, total_step: "0", avg_altitude: "-20000", run_time: "4800",
  });
  assert.deepEqual(football.field_sport, { run_time: 4800 });
});

test("multisport legs, bad pb and missing fields", () => {
  const out = normalise({ type: 9, parent_trackid: "1793600000", pb: "{bad", heart_range: "0,100" });
  assert.equal(out.track_id, "");
  assert.equal(out.sport_code, 9);
  assert.equal(out.start_local, null);
  assert.equal("personal_bests" in out, false);
  assert.equal("heart_rate_zones" in out, false);
  assert.deepEqual(out.multisport, {
    parent_track_id: "1793600000",
    child_track_ids: null,
    note: "This activity is a leg of, or the parent of, a multi-sport session.",
  });
  const child = normalise({ type: 9, trackid: null, child_list: ["1", "2"] });
  assert.equal(child.track_id, "None");
  assert.deepEqual(child.multisport.child_track_ids, ["1", "2"]);
  assert.equal("multisport" in normalise({ type: 9, parent_trackid: -1 }), false);
});

test("a run without a plan has no training_plan block", () => {
  const out = normalise({ trackid: "1", type: 8, runningProgram: 0, dailyScore: 50 });
  assert.equal("training_plan" in out, false);
  assert.equal(out.sport, "walking");
});

test("exported field tables match the Python tuples", () => {
  assert.equal(COMMON_FIELDS.length, 23);
  assert.equal(RUNNING_DYNAMICS_FIELDS.length, 5);
  assert.deepEqual(Object.keys(SPORT_FIELDS), [
    "swim", "foot", "strength", "hike", "field_sport", "ride", "rope_skipping", "free_training",
  ]);
  assert.equal(SPORT_FIELDS.foot.length, 27);
});
