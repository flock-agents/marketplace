// Normalise a workout index row into something an LLM can read safely.
//
// The index row carries ~172 fields, most of them not applicable to any given
// sport and filled with a sentinel. Emitting all of them invites the model to
// report `swolf: -1` as a swim statistic on a bike ride.
//
// So: a common block every sport has, plus one sport-specific block, plus the
// untouched row under `raw` for anything not covered.

import {
  TRAINING_EFFECT_SCALE, clean, isDict, isValidTimeZone, isoFromTimestamp, lookup,
  pyFloat, pyGet, pyInt, pyOr, pyRound, pyStr, pyStrip, pyTruthy, sportName,
  trainingEffectBand,
} from "./codes.js";
import { decodeHeartZones } from "./decode.js";

// Fields worth surfacing per sport, in the sport's own terms. A field is only
// emitted when it is not that field's not-applicable sentinel.
export const SPORT_FIELDS = Object.freeze({
  swim: [
    "swolf", "total_strokes", "total_trips", "swim_pool_length",
    "avg_distance_per_stroke", "avg_stroke_speed", "max_stroke_speed",
    "swim_style", "freestyle_length", "breast_stroke_length",
    "butterfly_length", "medley_length", "back_stroke_length",
    "other_stroke_length",
    // Pace and duration. avg_pace is seconds per METRE here too (3.2-4.0
    // s/m across three swims -- roughly 4x a run's pace, consistent with
    // water), the same unit as foot/hike/ride, so no rename is needed.
    "avg_pace", "max_pace", "run_time",
  ],
  // `avg_cadence` / `max_cadence` are deliberately absent: they read 0 on
  // every activity this has been checked against. Real cadence arrives in
  // `avg_frequency`, which is a COMMON_FIELD.
  foot: [
    // Lactate threshold. Only present when lactateThresholdUpdateFlag is
    // non-zero -- on a run where the watch has not estimated it, the
    // fields are ABSENT from the payload entirely rather than sentinelled.
    "lactateThresholdHr", "lactateThresholdPace",
    "lactateThresholdUpdateFlag",
    // Pace in seconds per KILOMETRE, which is how runners actually read
    // it. Confirmed against avg_pace (s/m) x 1000 on three runs.
    "avgEquivPace", "bestEquivPace",
    // equivDistance is centimetres (see CENTIMETRE_FIELDS) and is close
    // to but not equal to `dis`, so it is grade-adjusted distance, not a
    // duplicate.
    "equivDistance",
    "total_step", "avg_pace", "max_pace", "min_pace",
    "avg_stride_length", "elevationGain", "elevationLoss",
    "avg_altitude", "max_altitude", "min_altitude", "landing_time",
    "flight_ratio", "forefoot_ratio", "marathon", "run_time",
    // Elevation/climb fields the hike block already had. Runs climb
    // hills too.
    "altitude_ascend", "altitude_descend", "distance_ascend",
    "climb_dis_descend", "climb_dis_ascend_time", "climb_dis_descend_time",
  ],
  strength: [
    "total_group", "work_value", "totalMuscularExertion",
    "totalCardiacExertion", "totalScore", "strengthScores",
  ],
  hike: [
    "total_step", "avg_pace", "max_pace", "run_time",
    "elevationGain", "elevationLoss", "altitude_ascend",
    "altitude_descend", "distance_ascend", "avg_altitude",
    "max_altitude", "min_altitude", "avg_slope", "max_slope",
  ],
  // Stop-start field sports. Football (code 18) records distance, pace and
  // duration but no step count, no cadence and no altitude -- the watch
  // reports altitude as -20000 and elevation as -100 throughout, both
  // sentinels. Everything that matters for this sport is heart rate, which
  // lives in COMMON_FIELDS and the zone breakdown.
  field_sport: [
    "avg_pace", "max_pace", "run_time", "total_step",
  ],
  // Sport code 9. Power and cadence come through COMMON_FIELDS and are
  // absent on a bike without the corresponding sensors.
  ride: [
    "avg_pace", "max_pace", "run_time",
    "avg_slope", "max_slope",
    "elevationGain", "elevationLoss",
    "altitude_ascend", "altitude_descend",
    "distance_ascend", "climb_dis_descend",
    "climb_dis_ascend_time", "climb_dis_descend_time",
    "avg_altitude", "max_altitude", "min_altitude",
  ],
  // Sport code 21. Jump count and longest unbroken streak are confirmed
  // against the row's own pb object; total_group is the count of skipping
  // sets. rope_skipping_avg_frequency / _max_frequency duplicate
  // avg_frequency and are deliberately dropped.
  rope_skipping: [
    "rope_skipping_count", "numberOfConsecutive", "total_group",
  ],
  // Sport code 16. No sport-specific field exists; everything about it is
  // already in COMMON_FIELDS.
  free_training: [],
});

// Which sport-specific block applies to which numeric type code.
const BLOCK_FOR_CODE = Object.freeze({
  1: "foot", 8: "foot", 9: "ride", 14: "swim", 16: "free_training",
  18: "field_sport", 21: "rope_skipping", 22: "hike", 52: "strength",
});

// Running biomechanics, nested under foot.running_dynamics rather than
// flattened into the foot list: ground contact time and vertical
// oscillation have no equivalent in walking, hiking or football.
export const RUNNING_DYNAMICS_FIELDS = Object.freeze([
  "averageGct", "minGct", "averageVo", "maxVo", "avgVertStrideRatio",
]);

// Fields seen in the payload and deliberately NOT exposed (weight,
// rope_skipping_*_frequency, rope_skipping_rest_time, strength_training_group,
// the centimetre altitude duplicates, sport_mode) -- see workouts.py for the
// reason behind each, so nobody "fixes" a decision as an oversight.

export const COMMON_FIELDS = Object.freeze([
  "calorie", "dis", "avg_heart_rate", "max_heart_rate", "min_heart_rate",
  "te", "anaerobic_te", "exercise_load", "rpe", "VO2_max", "spo2_max",
  "spo2_min", "avg_temperature", "min_temperature", "max_temperature",
  // Cadence and power are COMMON, not per-sport. `average_power` is a
  // SEPARATE key from `avg_power`: on a run, only `average_power` is
  // populated; `max_power` is real on a run and sentinelled -1 on an
  // unpowered bike.
  "avg_frequency", "max_frequency",
  "avg_power", "average_power", "max_power",
  // RTPC. Meaning unconfirmed -- reads a constant 21.0 everywhere except
  // running, so 21 is very likely a sentinel. Exposed, flagged unverified.
  "averageRTPC", "bestRTPC", "worstRTPC",
]);

// Altitude readings and elevation totals use DIFFERENT not-applicable
// markers, so they cannot share a sentinel family.
const ALTITUDE_FIELDS = ["avg_altitude", "max_altitude", "min_altitude", "upstairs_height"];
const ELEVATION_FIELDS = ["elevationGain", "elevationLoss", "altitude_ascend", "altitude_descend"];

// elevationGain / elevationLoss are CENTIMETRES, and are renamed on the way
// out so the unit travels with the number. Verified in the hiking rows:
// elevationGain 27961 sits beside altitude_ascend 279 in the same row.
const CENTIMETRE_FIELDS = Object.freeze({
  elevationGain: "elevation_gain_metres",
  elevationLoss: "elevation_loss_metres",
  // Most likely a grade-adjusted distance; within 45 m of `dis` on four runs.
  equivDistance: "equiv_distance_metres",
});

// avgVertStrideRatio arrives at ten times its displayed percentage.
const TENTHS_FIELDS = Object.freeze({
  avgVertStrideRatio: "avg_vertical_stride_ratio_percent",
});

const TEMPERATURE_FIELDS = ["avg_temperature", "min_temperature", "max_temperature"];
const PERCENTAGE_FIELDS = ["spo2_max", "spo2_min"];
// 0 on a code-21 row with no jumps recorded is treated the same as
// football's 0 steps -- the watch declining to count.
const COUNT_FIELDS = [
  "total_step", "total_strokes", "total_trips",
  "rope_skipping_count", "numberOfConsecutive",
];
const FREQUENCY_FIELDS = ["avg_frequency", "max_frequency"];
const PACE_FIELDS = ["avg_pace", "max_pace", "min_pace"];
const RATIO_FIELDS = ["flight_ratio", "forefoot_ratio", "left_flight_ratio", "right_flight_ratio"];
// 21.0 recurs on every non-running sport regardless of activity length or
// intensity -- the signature of a not-applicable marker.
const RTPC_FIELDS = ["averageRTPC", "bestRTPC", "worstRTPC"];

const familyOf = (family, names) => names.map((name) => [name, family]);

// Which sentinel family guards each field. A field left out defaults to -1
// only, which is why a -274 temperature reached the output on first run.
const FAMILY_FOR_FIELD = Object.freeze(Object.fromEntries([
  ...familyOf("altitude", ALTITUDE_FIELDS),
  ...familyOf("elevation", ELEVATION_FIELDS),
  ...familyOf("temperature", TEMPERATURE_FIELDS),
  ...familyOf("percentage", PERCENTAGE_FIELDS),
  ...familyOf("count", COUNT_FIELDS),
  ...familyOf("frequency", FREQUENCY_FIELDS),
  ...familyOf("pace", PACE_FIELDS),
  ...familyOf("ratio", RATIO_FIELDS),
  ...familyOf("rtpc", RTPC_FIELDS),
]));

// Renamed on output so the unit travels with the number.
const RENAMED_FIELDS = Object.freeze({
  avg_frequency: "avg_cadence_per_minute",
  max_frequency: "max_cadence_per_minute",
  // `lactateThresholdPace: 325` is seconds per kilometre (5:25/km), while
  // `avg_pace` is seconds per METRE -- a thousand-fold apart.
  lactateThresholdHr: "lactate_threshold_hr_bpm",
  lactateThresholdPace: "lactate_threshold_pace_sec_per_km",
  avgEquivPace: "avg_pace_sec_per_km",
  bestEquivPace: "best_pace_sec_per_km",
  // Two raw keys for the same quantity -- both land on one output key.
  avg_power: "avg_power_watts",
  average_power: "avg_power_watts",
  max_power: "max_power_watts",
  averageGct: "avg_ground_contact_time_ms",
  minGct: "min_ground_contact_time_ms",
  averageVo: "avg_vertical_oscillation_mm",
  maxVo: "max_vertical_oscillation_mm",
  rope_skipping_count: "total_jumps",
  numberOfConsecutive: "max_consecutive_jumps",
  // RTPC is unverified, so the key says so.
  averageRTPC: "avg_rtpc_unverified",
  bestRTPC: "best_rtpc_unverified",
  worstRTPC: "worst_rtpc_unverified",
});

// Training Effect arrives at ten times its displayed value. Scaled and
// renamed, because `te: 32` on a 0.0-5.0 scale is not a large number -- it is
// a different number.
const TRAINING_EFFECT_FIELDS = Object.freeze({
  te: "aerobic_training_effect",
  anaerobic_te: "anaerobic_training_effect",
});

const own = (table, key) => (Object.hasOwn(table, key) ? table[key] : undefined);

/** int(str(value).strip()), positive only. */
function epoch(value) {
  let seconds = null;
  if (typeof value === "string") seconds = pyInt(value);
  else if (typeof value === "number" && Number.isInteger(value)) seconds = value;
  return seconds !== null && seconds > 0 ? seconds : null;
}

/**
 * Workout rows name their timezone (`syncedTimezone: "Asia/Kolkata"`).
 *
 * An 08:04 swim rendered in UTC becomes 02:34, which looks like a different
 * session entirely when the user scans a list by time of day.
 */
function zone(row) {
  const name = pyGet(row, "syncedTimezone");
  if (typeof name === "string" && pyStrip(name) && isValidTimeZone(pyStrip(name))) {
    return pyStrip(name);
  }
  return 0;
}

function iso(value, tz = 0) {
  const seconds = epoch(value);
  return seconds === null ? null : isoFromTimestamp(seconds, tz, "seconds");
}

/**
 * Zepp sends numbers as strings about half the time: a workout row has
 * `dis` as "756.0" and `type` as 14. Sentinel stripping has to see through
 * that, or `swolf: "-1"` survives into the output as real-looking data.
 */
function numeric(value) {
  return typeof value === "boolean" ? null : pyFloat(value);
}

function collectNumber(out, name, number) {
  const cleaned = clean(number, own(FAMILY_FOR_FIELD, name) ?? "default");
  if (cleaned === null) return;
  if (own(CENTIMETRE_FIELDS, name)) {
    out[CENTIMETRE_FIELDS[name]] = pyRound(cleaned / 100, 2);
  } else if (own(TENTHS_FIELDS, name)) {
    out[TENTHS_FIELDS[name]] = pyRound(cleaned / 10, 1);
  } else if (own(TRAINING_EFFECT_FIELDS, name)) {
    const key = TRAINING_EFFECT_FIELDS[name];
    const score = pyRound(cleaned * TRAINING_EFFECT_SCALE, 1);
    out[key] = score;
    // The band is an interpretation, so it gets its own key and never
    // replaces the score.
    out[`${key}_band`] = trainingEffectBand(score);
  } else {
    out[own(RENAMED_FIELDS, name) ?? name] = cleaned;
  }
}

function collect(row, names) {
  const out = {};
  for (const name of names) {
    if (!Object.hasOwn(row, name)) continue;
    const value = row[name];
    if (Array.isArray(value) || isDict(value)) {
      if (pyTruthy(value)) out[name] = value;
      continue;
    }
    const number = numeric(value);
    if (number !== null) {
      collectNumber(out, name, number);
      continue;
    }
    if (typeof value === "string" && pyStrip(value)) out[name] = value;
  }
  return out;
}

/**
 * Structured-plan progress for a run, when one is active.
 *
 * runningProgram is 0 and every field here is absent/empty on a run with
 * no plan (confirmed on 2026-08-08); once a plan is active, runningProgram
 * is a non-zero id and dailyScore/dailyPlanFinished populate per session
 * (confirmed on three later runs, dailyScore 98.75-100.0). There is no
 * separate training-plan endpoint (22 candidate routes probed, all 404 or
 * 400-as-unknown-name).
 *
 * dailyPlanFinished and the numeric fields arrive as real bool/int/float,
 * not the usual numeric-ish strings, so this reads them directly.
 */
function trainingPlanBlock(row) {
  const programNumber = numeric(pyGet(row, "runningProgram"));
  if (!pyTruthy(programNumber)) return null;

  const block = { running_program_id: pyInt(programNumber) };

  const runType = numeric(pyGet(row, "runningType"));
  if (runType !== null) {
    // Values observed: 1, 2. No independent way to name what they mean.
    block.running_type_code = pyInt(runType);
  }

  const finished = pyGet(row, "dailyPlanFinished");
  if (typeof finished === "boolean") block.plan_session_finished = finished;

  const score = numeric(pyGet(row, "dailyScore"));
  if (score !== null) block.plan_session_score_percent = pyRound(score, 2);

  return block;
}

function sportBlocks(out, row, code) {
  const codeNumber = numeric(code);
  const block = lookup(BLOCK_FOR_CODE, codeNumber === null ? -1 : pyInt(codeNumber));
  if (!block) {
    // Unnamed sport: show every sport block that has non-sentinel values,
    // so nothing is hidden just because the code is unrecognised.
    for (const [name, fields] of Object.entries(SPORT_FIELDS)) {
      const detail = collect(row, fields);
      if (pyTruthy(detail)) (out.unclassified_metrics ??= {})[name] = detail;
    }
    return;
  }
  const detail = collect(row, SPORT_FIELDS[block]);
  if (pyTruthy(detail)) out[block] = detail;
  if (block !== "foot") return;
  const dynamics = collect(row, RUNNING_DYNAMICS_FIELDS);
  if (pyTruthy(dynamics)) (out.foot ??= {}).running_dynamics = dynamics;
  const plan = trainingPlanBlock(row);
  if (plan) out.training_plan = plan;
}

/**
 * `pb` is a personal-best object arriving as JSON nested inside JSON. Its
 * keys are sport-prefixed (ride_furthest_km, ride_most_up_m), which is what
 * confirmed sport code 9 as cycling.
 */
function personalBests(row) {
  let best = pyGet(row, "pb");
  if (typeof best === "string" && pyStrip(best)) {
    try {
      best = JSON.parse(best);
    } catch {
      best = null;
    }
  }
  return isDict(best) && pyTruthy(best) ? best : null;
}

function multisport(row) {
  const parent = pyGet(row, "parent_trackid");
  const children = pyGet(row, "child_list");
  const parentNumber = numeric(parent);
  const hasParent = parent !== null && (parentNumber === null || parentNumber > 0);
  if (!hasParent && !pyTruthy(children)) return null;
  return {
    parent_track_id: parent,
    child_track_ids: children,
    note: "This activity is a leg of, or the parent of, a multi-sport session.",
  };
}

export function normalise(row, includeRaw = false) {
  const code = pyGet(row, "type");
  const start = epoch(pyGet(row, "trackid"));
  const end = epoch(pyGet(row, "end_time"));

  const tz = zone(row);
  const out = {
    track_id: pyStr(pyGet(row, "trackid", "")),
    source: pyGet(row, "source"),
    sport: sportName(code),
    sport_code: code,
    start_local: iso(pyGet(row, "trackid"), tz),
    end_local: iso(pyGet(row, "end_time"), tz),
    timezone: pyOr(pyGet(row, "syncedTimezone"), "UTC"),
  };
  if (start && end && end > start) out.elapsed_seconds = end - start;

  out.summary = collect(row, COMMON_FIELDS);
  sportBlocks(out, row, code);

  const best = personalBests(row);
  if (best) out.personal_bests = best;

  // `heart_range` is a time-in-zone breakdown on the index row itself, so
  // it costs no extra request. Zone boundaries are the watch's own.
  const zones = pyGet(row, "heart_range");
  if (typeof zones === "string" && pyStrip(zones)) {
    const decoded = decodeHeartZones(zones);
    if (pyTruthy(decoded.zones)) out.heart_rate_zones = decoded;
  }

  const legs = multisport(row);
  if (legs) out.multisport = legs;

  if (includeRaw) out.raw = row;
  return out;
}
