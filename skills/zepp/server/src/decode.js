// Decoders for Zepp's wire formats.
//
// Three unrelated encodings live behind one API:
//
// 1. Daily band data  -- base64 JSON summary, plus one byte per minute of heart
//    rate, plus a three-byte-per-minute activity blob.
// 2. Workout streams  -- semicolon-separated `time,value` pairs. Whether `value`
//    is a delta or an absolute reading is PER FIELD, not global. Getting this
//    wrong silently produces numbers that look real.
// 3. Workout laps     -- ~70 positional columns with no header.
//
// The rule throughout: a field is decoded and unit-attributed only when the
// fixture corpus proves its meaning. Everything else is passed through verbatim
// so the caller can see it without being told what it means.

import {
  HR_BYTE_SENTINELS, SLEEP_STAGE_MODES, clean, isDict, isoFromTimestamp, lookup,
  pyB64decode, pyFloat, pyGet, pyInt, pyOr, pyRound, pyStr, pyStrip, pyTruthy,
} from "./codes.js";

// --------------------------------------------------------------------------
// Daily band data
// --------------------------------------------------------------------------

const UTF8 = new TextDecoder("utf-8", { fatal: true });

function tryDecode(step, fallback) {
  try {
    return step();
  } catch (error) {
    if (error instanceof TypeError && error.code !== "ERR_ENCODING_INVALID_ENCODED_DATA") throw error;
    return fallback;
  }
}

/** The `summary` field is base64-wrapped JSON. */
export function decodeBandSummary(encoded) {
  return tryDecode(() => JSON.parse(UTF8.decode(pyB64decode(encoded))), {});
}

/**
 * `data_hr` is one unsigned byte per minute, 1440 per day.
 *
 * 0, 254 and 255 are not-worn / no-reading markers. They are returned as
 * null rather than dropped, so index still equals minute-of-day.
 */
export function decodeHrMinutes(encoded) {
  const raw = tryDecode(() => pyB64decode(encoded), null);
  if (raw === null) return [];
  return [...raw].map((byte) => (HR_BYTE_SENTINELS.has(byte) ? null : byte));
}

/** One band_data row -> a flat, unit-labelled day summary. */
export function summariseDay(row) {
  const summary = decodeBandSummary(pyOr(pyGet(row, "summary"), ""));
  const steps = pyOr(pyGet(summary, "stp"), {});
  const sleep = pyOr(pyGet(summary, "slp"), {});

  const out = {
    date: pyGet(row, "date_time"),
    steps: pyGet(steps, "ttl"),
    distance_metres: pyGet(steps, "dis"),
    calories_kcal: pyGet(steps, "cal"),
    run_distance_metres: pyGet(steps, "runDist"),
    step_goal: pyGet(summary, "goal"),
  };

  const maxHr = pyOr(pyGet(pyOr(pyGet(summary, "hr"), {}), "maxHr"), {});
  if (pyTruthy(pyGet(maxHr, "hr"))) out.max_heart_rate_bpm = maxHr.hr;

  if (pyTruthy(sleep)) out.sleep = sleepBlock(sleep, tz(summary));
  return out;
}

/**
 * Band payloads carry the watch's UTC offset in seconds as `tz`.
 *
 * Without it a 00:28 bedtime renders as the previous evening, which reads
 * as a completely different night.
 */
function tz(summary) {
  const offset = pyInt(pyGet(summary, "tz"));
  // dt.timezone only accepts offsets strictly inside +/-24h.
  if (offset === null || Math.abs(offset) >= 86400) return 0;
  return offset;
}

function stageMinutes(stages) {
  const byMode = {};
  for (const stage of Array.isArray(stages) ? stages : []) {
    if (!isDict(stage)) continue;
    const mode = pyGet(stage, "mode");
    const name = lookup(SLEEP_STAGE_MODES, mode) ?? `unknown_mode_${pyStr(mode)}`;
    byMode[name] = (byMode[name] ?? 0) + (stage.stop - stage.start + 1);
  }
  return byMode;
}

const ASLEEP_MODES = new Set(["light", "deep", "rem"]);

function asleepTotal(byMode) {
  return Object.entries(byMode)
    .filter(([mode]) => ASLEEP_MODES.has(mode))
    .reduce((sum, [, minutes]) => sum + minutes, 0);
}

function isEmptyValue(value) {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  return isDict(value) && Object.keys(value).length === 0;
}

/**
 * Sleep stage minutes, all four of them, plus naps.
 *
 * `dt` is REM. Reporting deep + light as total sleep omits it entirely.
 *
 * Two things this must not do, both found by running it against a real
 * night the watch did not record:
 *
 * 1. Report an unrecorded night as zeros. Zepp fills every field with 0 and
 *    sets `sleepSource: -1`. Emitting `sleep_score: 0` and
 *    `resting_heart_rate_bpm: 0` states a missing measurement as a
 *    measurement -- a resting heart rate of zero is not a low one.
 * 2. Discard naps. Daytime sleep lives in `odd_stage`, separate from the
 *    main `stage` list, and on a day with no main sleep it is the ONLY
 *    sleep there is.
 */
function sleepBlock(sleep, tzOffset = 0) {
  const byMode = stageMinutes(pyGet(sleep, "stage"));
  const naps = stageMinutes(pyGet(sleep, "odd_stage"));
  const napAsleep = asleepTotal(naps);

  // `sleepSource` is -1 when no main sleep was recorded. Corroborate with
  // the stage list rather than trusting one field.
  const mainRecorded = pyTruthy(byMode)
    || ["lt", "dp", "dt"].some((field) => pyTruthy(pyGet(sleep, field)));

  const block = {};
  if (mainRecorded) {
    Object.assign(block, {
      light_minutes: pyGet(sleep, "lt"),
      deep_minutes: pyGet(sleep, "dp"),
      rem_minutes: pyGet(sleep, "dt"),
      awake_minutes: pyGet(sleep, "wk"),
      total_asleep_minutes: pyOr(asleepTotal(byMode), null),
      wake_count: pyGet(sleep, "wc"),
      sleep_score: pyOr(pyGet(sleep, "ss"), null),
      resting_heart_rate_bpm: pyOr(pyGet(sleep, "rhr"), null),
      stage_minutes_recomputed: byMode,
    });
    for (const [key, field] of [["start_local", "st"], ["end_local", "ed"]]) {
      const value = pyGet(sleep, field);
      const seconds = value === true ? 1 : value;
      if (Number.isInteger(seconds) && seconds > 0) {
        block[key] = isoFromTimestamp(seconds, tzOffset, "minutes");
      }
    }
    // st == ed means a zero-length window, not a real night.
    if ((block.start_local ?? null) === (block.end_local ?? null)) {
      delete block.start_local;
      delete block.end_local;
    }
  } else {
    block.main_sleep_recorded = false;
    block.note = (
      "No main sleep was recorded for this date -- the watch reports "
      + "every field as zero. This is missing data, not a night of no "
      + "sleep, and says nothing about how the person actually slept."
    );
  }

  if (pyTruthy(naps)) {
    const oddStages = pyOr(pyGet(sleep, "odd_stage"), []);
    block.naps = {
      nap_count: Array.isArray(oddStages) ? oddStages.filter(isDict).length : 0,
      total_asleep_minutes: napAsleep,
      stage_minutes: naps,
    };
  }

  return Object.fromEntries(Object.entries(block).filter(([, v]) => !isEmptyValue(v)));
}

// --------------------------------------------------------------------------
// Workout streams
// --------------------------------------------------------------------------

function streamSpec(encoding, unit, { scale = 1.0, verified = true } = {}) {
  return Object.freeze({ encoding, unit, scale, verified });
}

// Encoding is per field and was determined by decoding each stream both ways
// and checking the result against the workout summary's own totals:
//
//   heart_rate       cumulative -> 116-164 bpm      (absolute -> nonsense)
//   temperature      cumulative -> 29.0 C           (absolute -> deltas only)
//   currentDistance  absolute   -> 75600 cm = 756 m (matches summary `dis`)
//   speed            absolute   -> 0-1.3 m/s, and integrates to 1061 m
//                                  against a summary distance of 1064 m
export const STREAM_SPECS = Object.freeze({
  heart_rate: streamSpec("delta", "bpm"),
  temperature: streamSpec("delta", "celsius"),
  currentDistance: streamSpec("absolute", "metres", { scale: 0.01 }),
  speed: streamSpec("absolute", "metres_per_second"),
  pool_stroke_speed: streamSpec("absolute", "strokes_per_second"),
  // Value tracks the summary's per-length pace but its unit does not match
  // the summary's own seconds-per-metre. Passed through unconverted.
  pool_swim_pace: streamSpec("absolute", "unknown", { verified: false }),
  // No non-GPS fixture carries these; the corpus excludes GPS workouts.
  altitude: streamSpec("delta", "unknown", { verified: false }),
  cadence: streamSpec("absolute", "unknown", { verified: false }),
});

/** `packed.strip().rstrip(";").split(";")`. */
function splitRecords(packed) {
  return pyStrip(packed).replace(/;+$/, "").split(";");
}

/** Split `t,v;t,v;...`. Returns null if the field is not pair-shaped. */
export function parsePairs(packed) {
  const out = [];
  for (const chunk of splitRecords(packed)) {
    if (!chunk) continue;
    const parts = chunk.split(",");
    if (parts.length !== 2) return null;
    const time = pyInt(parts[0]);
    const value = pyFloat(parts[1]);
    if (time === null || value === null) return null;
    out.push([time, value]);
  }
  return out;
}

const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;

/**
 * Decode one packed stream into a time series with an explicit unit.
 *
 * An unrecognised or non-pair field is returned raw. It is never guessed at:
 * a stream decoded with the wrong encoding yields plausible-looking numbers,
 * which is worse than returning nothing.
 */
export function decodeStream(name, packed) {
  const pairs = parsePairs(packed);
  if (pairs === null) {
    return { name, encoding: "unknown", note: "not a time,value stream", raw: packed };
  }

  const spec = Object.hasOwn(STREAM_SPECS, name) ? STREAM_SPECS[name] : null;
  if (spec === null) {
    return {
      name, encoding: "unknown", unit: "unknown", sample_count: pairs.length,
      note: "unrecognised stream; values returned unconverted", raw_pairs: pairs,
    };
  }

  let elapsed = 0;
  let running = 0.0;
  const times = [];
  const values = [];
  for (const [deltaT, value] of pairs) {
    elapsed += deltaT;
    running = spec.encoding === "delta" ? running + value : value;
    times.push(elapsed);
    values.push(clean(running * spec.scale));
  }

  const present = values.filter((v) => v !== null);
  return {
    name,
    unit: spec.unit,
    encoding: spec.encoding,
    unit_verified: spec.verified,
    sample_count: values.length,
    duration_seconds: times.length ? times.at(-1) : 0,
    min: present.length ? pyMin(present) : null,
    max: present.length ? pyMax(present) : null,
    avg: present.length ? pyRound(mean(present), 3) : null,
    offsets_seconds: times,
    values,
  };
}

// Python's min()/max() keep the first of equal values and never pick NaN
// over an earlier number, unlike Math.min/Math.max.
function pyMin(values) {
  return values.reduce((best, v) => (v < best ? v : best));
}

function pyMax(values) {
  return values.reduce((best, v) => (v > best ? v : best));
}

const unrecognisedZones = (packed) => ({ note: "unrecognised heart_range format", raw: packed });

/** int(float(text)): null where Python raises ValueError. */
function intOfFloat(text) {
  const number = pyFloat(text);
  return number === null ? null : pyInt(number);
}

/**
 * Decode `heart_range`: time spent in each heart-rate zone.
 *
 * Format is `seconds,upper_bpm;seconds,upper_bpm;...` where each pair is
 * the time spent below that boundary and above the previous one. It lives
 * on the workout INDEX row, not the detail payload, so a zone breakdown
 * costs no extra request.
 *
 * Verified on a run whose zone seconds total 3909 against a reported
 * run_time of 3921 -- 0.3% apart, consistent with unrecorded gaps rather
 * than a different quantity.
 *
 * Zone boundaries are the watch's own personalised ones. They are NOT
 * recomputed here, because a zone model derived from a guessed maximum
 * heart rate would disagree with what the athlete sees in the app.
 */
export function decodeHeartZones(packed) {
  const pairs = [];
  for (const chunk of splitRecords(packed)) {
    if (!chunk) continue;
    const parts = chunk.split(",");
    if (parts.length !== 2) return unrecognisedZones(packed);
    const seconds = intOfFloat(parts[0]);
    const upper = intOfFloat(parts[1]);
    if (seconds === null || upper === null) return unrecognisedZones(packed);
    pairs.push([seconds, upper]);
  }

  const total = pairs.reduce((sum, [seconds]) => sum + seconds, 0);
  if (!total) return { note: "no time recorded in any zone" };

  const zones = [];
  let lower = 0;
  for (const [seconds, upper] of pairs) {
    zones.push({
      lower_bpm: lower,
      upper_bpm: upper,
      seconds,
      percent: pyRound((seconds / total) * 100, 1),
    });
    lower = upper;
  }
  return { total_seconds: total, zone_count: zones.length, zones };
}

// --------------------------------------------------------------------------
// Laps
// --------------------------------------------------------------------------

// Column meanings recovered by cross-referencing a pool-swim capture against
// its own summary. Unlisted columns are returned by index under raw_columns.
//
// Columns 1, 13 and 14 are CONFIRMED rather than inferred, by three
// independent routes:
//
//  1. Internal identity. On a length row, column 14 == column 1 + column 13,
//     holding on 34 of 36 laps in the reference swim (the rest differ by 1,
//     which is rounding).
//  2. The published definition. SWOLF is standardised across swim wearables
//     as the time in seconds for one pool length plus the strokes taken in
//     that length -- exactly the identity above.
//  3. Session reconstruction. Summing the components and dividing by the
//     length count reproduces the workout summary's own figure:
//     (974 s + 478 strokes) / 36 lengths = 40.3 against a reported swolf 40.
//
// Lower is better: it penalises both slowing down and adding strokes.
export const LAP_COLUMNS = Object.freeze({
  0: "lap_index",
  1: "duration_seconds",
  2: "distance_metres",
  4: "avg_heart_rate_bpm",
  5: "elapsed_seconds_cumulative",
  9: "pace",
  12: "stroke_speed",
  13: "strokes",
  14: "swolf",
});

function parseLapRow(row) {
  const record = {};
  for (const [index, name] of Object.entries(LAP_COLUMNS)) {
    if (Number(index) < row.length) record[name] = clean(row[Number(index)]);
  }
  record.raw_columns = row;
  return record;
}

/** The most common value; ties go to the first one seen. */
function mostCommon(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) [best, bestCount] = [value, count];
  }
  return best;
}

/**
 * Split the lap field into individual laps and set summaries.
 *
 * The list interleaves TWO record types at different distances: one row per
 * length (or per split), plus a summary row per set. In a 567 m swim of 27
 * lengths the list held 29 rows -- 27 lengths of 21 m, plus set rows of
 * 63 m and 504 m. 3 + 24 = 27 lengths and 63 + 504 = 567 m.
 *
 * Summing the two types together is what made lap totals come to roughly
 * double the workout summary, and made the record count disagree with
 * `total_trips`. Separating them makes both reconcile exactly: the two set
 * rows above carry 32 and 291 strokes, and 32 + 291 = 323, the reported
 * `total_strokes`.
 *
 * Records are classified by distance: the most common distance is one
 * length (or one split), and anything longer is a set summary.
 */
export function decodeLaps(packed) {
  const rows = splitRecords(packed).filter(Boolean).map((r) => r.split(","));
  const parsed = rows.map(parseLapRow);
  const distances = parsed.map((r) => r.distance_metres ?? null).filter(pyTruthy);
  const unitDistance = distances.length ? mostCommon(distances) : null;

  const laps = [];
  const sets = [];
  for (const record of parsed) {
    const distance = record.distance_metres ?? null;
    if (unitDistance !== null && pyTruthy(distance) && distance > unitDistance) {
      sets.push(record);
    } else {
      laps.push(record);
    }
  }

  // SWOLF is self-checking; report whether the identity held.
  //
  // Tolerance is 1, not 0: Zepp computes SWOLF from unrounded seconds and
  // strokes and then rounds, while the two component columns are rounded
  // independently, so a ±1 disagreement is arithmetic rather than a wrong
  // column. On the reference swim 34 of 36 laps agree within 1; the two
  // that do not are off by 3.
  const checked = laps.filter((r) => ["swolf", "duration_seconds", "strokes"]
    .every((key) => (r[key] ?? null) !== null));
  const consistent = checked
    .filter((r) => Math.abs(r.swolf - (r.duration_seconds + r.strokes)) <= 1).length;

  const result = {
    lap_count: laps.length,
    set_count: sets.length,
    unit_distance_metres: unitDistance,
    column_map: LAP_COLUMNS,
    laps,
  };
  if (sets.length) result.sets = sets;
  if (checked.length) {
    result.swolf_check = {
      laps_checked: checked.length,
      identity_holds: consistent,
      rule: "swolf == duration_seconds + strokes (tolerance 1)",
    };
    if (consistent < checked.length * 0.9) {
      result.note = (
        "SWOLF did not equal duration + strokes on every lap, so the "
        + "column mapping may not hold for this sport. Treat the named "
        + "columns as unverified here and read raw_columns instead."
      );
    }
  }
  return result;
}

const GPS_FIELDS = new Set(["longitude_latitude", "altitude", "accuracy", "DEMAltitude"]);
const NON_STREAM_FIELDS = new Set([...GPS_FIELDS, "lap", "source", "provider"]);

const mapValues = (entries) => Object.fromEntries(
  entries.map(([key, value]) => [key, decodeStream(key, value)]),
);

/** Split a workout detail payload into laps / gps / other streams. */
export function decodeDetail(data, include) {
  const out = {};
  const populated = Object.entries(data)
    .filter(([, value]) => typeof value === "string" && pyStrip(value));
  const populatedMap = Object.fromEntries(populated);

  if (include.has("laps") && Object.hasOwn(populatedMap, "lap")) {
    out.laps = decodeLaps(populatedMap.lap);
  }

  if (include.has("gps")) {
    const tracks = populated.filter(([key]) => GPS_FIELDS.has(key));
    out.gps = tracks.length ? mapValues(tracks) : { note: "no GPS recorded for this activity" };
  }

  if (include.has("streams")) {
    out.streams = mapValues(populated.filter(([key]) => !NON_STREAM_FIELDS.has(key)));
  }

  out.available_fields = populated.map(([key]) => key).sort();
  return out;
}
