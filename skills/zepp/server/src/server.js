// MCP server exposing Zepp/Amazfit data.
//
// Nothing here writes health data to disk. The only thing cached is the API
// token, so a restart does not trigger a fresh login.
//
// createServer(deps) builds the tool table from injected modules so tests
// can stub the network layer; loadDefaultDeps() wires the real ones.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { pyRound } from './codes.js';
import { isPlainObject, serveStdio } from './mcp-stdio.js';

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const SERVER_INFO = Object.freeze({ name: 'zepp', version: '1.0.0' });

export const INSTRUCTIONS =
  'Reads health and workout data from a Zepp/Amazfit account.\n\n' +
  'Two rules when reporting results:\n' +
  '1. A `no_data` status means Zepp returned an empty success response. ' +
  'That is NOT proof the user has no data for that period -- the API ' +
  'returns the same empty response for malformed requests. Say the ' +
  'query came back empty, not that the activity did not happen.\n' +
  '2. Fields marked `unit_verified: false` have an unconfirmed unit. ' +
  'Report the number, name the field, and do not attach a unit to it.';

const DEFAULT_SECTIONS = ['summary', 'laps'];
const DETAIL_SECTIONS = ['summary', 'laps', 'streams', 'gps'];
const OUTDOOR_RUNNING = 'outdoor_running';

// --------------------------------------------------------------------------
// JSON schemas, shaped like the pydantic models the Python SDK derives from
// each tool's signature (titles included).
// --------------------------------------------------------------------------

const titleCase = (name) => name.split('_')
  .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
  .join(' ');

const optional = (name, schema) => ({ anyOf: [schema, { type: 'null' }], default: null, title: titleCase(name) });
const optionalString = (name) => optional(name, { type: 'string' });
const requiredString = (name) => ({ title: titleCase(name), type: 'string' });
const withDefault = (name, type, value) => ({ default: value, title: titleCase(name), type });

function inputSchema(toolName, properties, required = []) {
  const schema = { properties, title: `${toolName}Arguments`, type: 'object' };
  if (required.length) schema.required = required;
  return schema;
}

const outputSchema = (toolName) => ({
  additionalProperties: true,
  title: `${toolName}DictOutput`,
  type: 'object',
});

// --------------------------------------------------------------------------
// Small helpers mirroring Python semantics
// --------------------------------------------------------------------------

const fail = (error) => ({ status: 'error', error: error?.message ?? String(error) });

const pad2 = (n) => String(n).padStart(2, '0');

export function localIsoDate(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

const formatPace = (pace) => {
  const seconds = Math.trunc(Number(pace));
  if (!Number.isFinite(seconds)) throw new TypeError(`invalid lactate threshold pace: ${pace}`);
  return `${Math.floor(seconds / 60)}:${pad2(((seconds % 60) + 60) % 60)}/km`;
};

const dictRows = (value) => (Array.isArray(value) ? value.filter(isPlainObject) : []);

const byKey = (key, { descending = false } = {}) => (a, b) => {
  const left = a[key] || '';
  const right = b[key] || '';
  if (left === right) return 0;
  return (left < right) !== descending ? -1 : 1;
};

// --------------------------------------------------------------------------
// Tools
// --------------------------------------------------------------------------

export function createServer(deps) {
  const { api, decode, body, workouts, describeExpiry, SPORT_CODES } = deps;
  const today = deps.today ?? localIsoDate;
  let client = null;
  const getClient = deps.getClient ?? (() => {
    client ??= api.fromEnv();
    return client;
  });

  const range = (fromDate, toDate, days = 7) => {
    if (fromDate && toDate) return [fromDate, toDate];
    const [start, end] = api.defaultRange(days);
    return [fromDate || start, toDate || end];
  };

  async function dailySummary({ from_date, to_date }) {
    let start;
    let end;
    let outcome;
    try {
      [start, end] = range(from_date, to_date);
      outcome = await api.bandData(getClient(), start, end);
    } catch (error) {
      return fail(error);
    }
    if (outcome.status !== 'ok') return outcome.asDict();

    const days = dictRows(outcome.data?.data).map((row) => decode.summariseDay(row));
    return { status: 'ok', range: { from: start, to: end }, day_count: days.length, days };
  }

  async function bandRowsForDay(date) {
    const day = date || today();
    const outcome = await api.bandData(getClient(), day, day);
    return { day, outcome };
  }

  async function heartRate({ date, include_series }) {
    let day;
    let outcome;
    try {
      ({ day, outcome } = await bandRowsForDay(date));
    } catch (error) {
      return fail(error);
    }
    if (outcome.status !== 'ok') return outcome.asDict();

    const rows = dictRows(outcome.data?.data);
    if (!rows.length) {
      return { status: 'no_data', date: day, note: 'No band_data row returned for this date.' };
    }
    const minutes = decode.decodeHrMinutes(rows[0].data_hr || '');
    const present = minutes.map((value, minute) => [minute, value]).filter(([, value]) => value != null);
    if (!present.length) {
      return { status: 'no_data', date: day, note: "The day's row carried no usable heart rate samples." };
    }

    const values = present.map(([, value]) => value);
    const result = {
      status: 'ok', date: day, unit: 'bpm',
      samples: values.length, minutes_covered: values.length,
      min: Math.min(...values), max: Math.max(...values),
      avg: pyRound(values.reduce((sum, v) => sum + v, 0) / values.length, 1),
      first_reading_minute: present[0][0],
      last_reading_minute: present.at(-1)[0],
    };
    if (include_series) result.per_minute = minutes;
    return result;
  }

  async function sleep({ date }) {
    let day;
    let outcome;
    try {
      ({ day, outcome } = await bandRowsForDay(date));
    } catch (error) {
      return fail(error);
    }
    if (outcome.status !== 'ok') return outcome.asDict();

    for (const row of dictRows(outcome.data?.data)) {
      const summary = decode.summariseDay(row);
      const block = summary.sleep;
      if (!block || !Object.keys(block).length) continue;
      // A night the watch missed still produces a sleep block, just an
      // empty one. Report that as no_data so it is never read as a night
      // of zero sleep with a resting heart rate of zero.
      const recorded = 'main_sleep_recorded' in block ? block.main_sleep_recorded : true;
      return { status: recorded ? 'ok' : 'no_data', date: summary.date, ...block };
    }
    return { status: 'no_data', date: day, note: "No sleep block in this date's record." };
  }

  async function listWorkouts({ from_date, to_date, sport, limit }) {
    let start;
    let end;
    let outcome;
    try {
      [start, end] = range(from_date, to_date, 90);
      outcome = await api.workoutHistory(getClient(), start, end);
    } catch (error) {
      return fail(error);
    }
    if (outcome.status !== 'ok') return outcome.asDict();

    let items = api.parseRows(outcome.data).map((row) => workouts.normalise(row));
    if (sport) {
      const wanted = sport.trim().toLowerCase();
      items = items.filter((item) => item.sport.toLowerCase().includes(wanted));
    }
    items.sort(byKey('start_local', { descending: true }));

    return {
      status: 'ok', range: { from: start, to: end },
      total: items.length, workouts: items.slice(0, limit),
      sports_present: [...new Set(items.map((item) => item.sport))].sort(),
    };
  }

  async function workoutDetail({ track_id, source, include }) {
    let outcome;
    try {
      outcome = await api.workoutDetail(getClient(), track_id, source);
    } catch (error) {
      return fail(error);
    }
    if (outcome.status !== 'ok') return outcome.asDict();

    const sections = new Set(include?.length ? include : DEFAULT_SECTIONS);
    const data = isPlainObject(outcome.data) ? outcome.data.data : null;
    if (!isPlainObject(data)) return { status: 'error', note: 'Detail payload had no data object.' };

    return { status: 'ok', track_id, ...decode.decodeDetail(data, sections) };
  }

  async function bodyComposition({ limit, before }) {
    let outcome;
    try {
      outcome = await api.weightRecords(getClient(), limit, before);
    } catch (error) {
      return fail(error);
    }
    if (outcome.status !== 'ok') return outcome.asDict();

    const readings = api.parseWeightItems(outcome.data).map((item) => body.normalise(item));
    readings.sort(byKey('date', { descending: true }));
    return { status: 'ok', reading_count: readings.length, readings: readings.slice(0, limit) };
  }

  // The events endpoint is authoritative and carries its own date per
  // estimate. It can fail independently of the workout-history call, so this
  // falls back to deriving estimates from workout rows rather than returning
  // nothing.
  async function lactateThresholdEstimates(zepp, start, end) {
    const outcome = await api.lactateThresholdHistory(zepp, start, end);
    if (outcome.status === 'ok') {
      const events = api.parseLactateThresholdEvents(outcome.data);
      if (events.length) {
        for (const entry of events) {
          const pace = entry.lactate_threshold_pace_sec_per_km;
          if (pace) entry.lactate_threshold_pace = formatPace(pace);
        }
        events.sort(byKey('date'));
        return [events, 'lactate_threshold_events'];
      }
    }

    const history = await api.workoutHistory(zepp, start, end);
    if (history.status !== 'ok') return [[], 'workout_rows'];
    const estimates = [];
    for (const row of api.parseRows(history.data)) {
      const item = workouts.normalise(row);
      const foot = item.foot || {};
      const lthr = foot.lactate_threshold_hr_bpm;
      if (lthr == null) continue;
      const entry = {
        date: (item.start_local || '').slice(0, 10),
        track_id: item.track_id,
        lactate_threshold_hr_bpm: lthr,
        lactate_threshold_pace_sec_per_km: foot.lactate_threshold_pace_sec_per_km ?? null,
      };
      const pace = entry.lactate_threshold_pace_sec_per_km;
      if (pace) entry.lactate_threshold_pace = formatPace(pace);
      estimates.push(entry);
    }
    estimates.sort(byKey('date'));
    return [estimates, 'workout_rows'];
  }

  async function runStats(zepp, start, end) {
    let vo2Max = null;
    let without = 0;
    const history = await api.workoutHistory(zepp, start, end);
    if (history.status !== 'ok') return { vo2Max, without };
    const runs = api.parseRows(history.data)
      .map((row) => workouts.normalise(row))
      .filter((run) => run.sport === OUTDOOR_RUNNING)
      .sort(byKey('start_local'));
    for (const run of runs) {
      const vo2 = run.summary.VO2_max;
      if (vo2) vo2Max = vo2; // last one wins -- most recent estimate
      const foot = 'foot' in run ? run.foot : {};
      if (foot.lactate_threshold_hr_bpm == null) without += 1;
    }
    return { vo2Max, without };
  }

  async function trainingThresholds({ from_date, to_date }) {
    // Outside the try, as in the Python: a missing credential surfaces as a
    // tool execution error rather than a status dict.
    const zepp = getClient();
    let start;
    let end;
    let estimates;
    let source;
    let stats;
    try {
      [start, end] = range(from_date, to_date, 180);
      [estimates, source] = await lactateThresholdEstimates(zepp, start, end);
      stats = await runStats(zepp, start, end);
    } catch (error) {
      return fail(error);
    }

    if (!estimates.length) {
      return {
        status: 'no_data',
        range: { from: start, to: end },
        source,
        runs_without_an_estimate: stats.without,
        note: 'No lactate threshold estimate in this range, from ' +
              'either the event log or workout rows. The watch only ' +
              'produces one from qualifying runs -- typically a ' +
              'sustained hard effort. This is absence of an estimate, ' +
              'not a threshold of zero.',
      };
    }

    const latest = estimates.at(-1);
    const current = { ...latest };
    // VO2_max is a rolling athlete-level estimate, not per-session, so it is
    // attached to `current` rather than to each history entry.
    if (stats.vo2Max) current.vo2_max = stats.vo2Max;
    const result = {
      status: 'ok',
      range: { from: start, to: end },
      source,
      current,
      estimate_count: estimates.length,
      runs_without_an_estimate: stats.without,
      history: estimates,
      training_load: {
        note: 'Only a per-session exercise_load is available (see ' +
              'zepp_list_workouts summary.exercise_load). The rolling ' +
              'cumulative training-load figure is not: the dedicated ' +
              'WatchSportStatistics/SPORT_LOAD endpoint returns HTTP ' +
              '500 server-side.',
      },
      note: "Zone boundaries in zepp_list_workouts are the watch's own " +
            'personalised ones. They are reported as measured and are ' +
            'not recomputed from this threshold.',
    };
    if (estimates.length > 1) {
      const first = estimates[0];
      result.change = {
        hr_bpm: latest.lactate_threshold_hr_bpm - first.lactate_threshold_hr_bpm,
        from_date: first.date,
        to_date: latest.date,
      };
    }
    return result;
  }

  function describeSchema() {
    return {
      sport_codes: {
        identified: SPORT_CODES,
        note: 'Every sport code seen on this account is identified. ' +
              'Codes absent from this map are reported as ' +
              'unknown_sport_<code>: they are real activities, only ' +
              'the name is unknown. Most codes are confirmed against ' +
              'the Zepp app directly or against a sport-prefixed ' +
              "payload field (e.g. code 9's ride_-prefixed pb keys, " +
              "code 21's rope_skipping_-prefixed ones) -- code 16 " +
              '(free_training) has neither and was named by ' +
              'elimination instead, see known_gaps.',
      },
      stream_units: Object.fromEntries(Object.entries(decode.STREAM_SPECS).map(([name, spec]) => [
        name, { unit: spec.unit, encoding: spec.encoding, verified: spec.verified },
      ])),
      known_gaps: KNOWN_GAPS,
    };
  }

  async function rawRequest({ path: requestPath, params }) {
    if (!requestPath.startsWith('/')) return { status: 'error', error: "path must start with '/'" };
    try {
      return (await getClient().get(requestPath, params || {})).asDict();
    } catch (error) {
      return fail(error);
    }
  }

  async function authStatus() {
    let credential;
    try {
      credential = await getClient().credential();
    } catch (error) {
      return fail(error);
    }
    return {
      status: 'ok',
      region_host: credential.regionHost,
      country_code: credential.countryCode,
      token_expires_at: describeExpiry(credential),
      note: 'Only the API token is cached on disk. No health data is ' +
            'stored by this server.',
    };
  }

  const tool = (name, description, properties, handler, required) => ({
    name,
    description,
    inputSchema: inputSchema(name, properties, required),
    outputSchema: outputSchema(name),
    handler,
  });

  const dateRange = () => ({ from_date: optionalString('from_date'), to_date: optionalString('to_date') });

  const tools = [
    tool('zepp_daily_summary',
      'Daily steps, distance, calories and sleep for a date range. ' +
      'Sleep is broken into light/deep/REM/awake minutes.',
      dateRange(), dailySummary),
    tool('zepp_heart_rate',
      'Per-minute heart rate for a single day, with a summary. ' +
      'Minutes with no reading are returned as null.',
      { date: optionalString('date'), include_series: withDefault('include_series', 'boolean', false) },
      heartRate),
    tool('zepp_sleep',
      'Sleep breakdown for a single night: light, deep, REM and ' +
      'awake minutes, sleep score and resting heart rate.',
      { date: optionalString('date') }, sleep),
    tool('zepp_list_workouts',
      'List workouts across all sports, with sport-specific ' +
      'metrics (SWOLF and stroke counts for swims, pace and ' +
      'cadence for runs, set counts for strength work).',
      { ...dateRange(), sport: optionalString('sport'), limit: withDefault('limit', 'integer', 50) },
      listWorkouts),
    tool('zepp_workout_detail',
      'Full detail for one workout: laps, time-series streams and ' +
      'GPS. Get the track_id and source from zepp_list_workouts.',
      {
        track_id: requiredString('track_id'),
        source: requiredString('source'),
        include: optional('include', { items: { enum: DETAIL_SECTIONS, type: 'string' }, type: 'array' }),
      },
      workoutDetail, ['track_id', 'source']),
    tool('zepp_body_composition',
      'Body composition scale readings: weight, height, BMI, and ' +
      '-- when synced from a real bio-impedance scale rather than ' +
      'a manual entry -- body fat %, body water %, muscle, bone ' +
      'mass, visceral fat rating and basal metabolism (BMR).',
      { limit: withDefault('limit', 'integer', 20), before: optionalString('before') },
      bodyComposition),
    tool('zepp_training_thresholds',
      'Lactate threshold heart rate and pace, with how they have ' +
      'changed over time, plus the current VO2 max estimate. ' +
      'LTHR anchors every training zone, so it matters more than ' +
      'any single session.',
      dateRange(), trainingThresholds),
    tool('zepp_describe_schema',
      'Explain what this server knows: which sport codes are ' +
      'identified, which stream units are verified, and where the ' +
      'decoding is still uncertain.',
      {}, describeSchema),
    tool('zepp_raw_request',
      'Send an arbitrary GET to the Zepp API. Use this to reach ' +
      'endpoints this server does not model yet.',
      {
        path: requiredString('path'),
        params: optional('params', { additionalProperties: true, type: 'object' }),
      },
      rawRequest, ['path']),
    tool('zepp_auth_status', 'Check the stored Zepp credential and connection.', {}, authStatus),
  ];

  return { info: SERVER_INFO, instructions: INSTRUCTIONS, tools };
}

const KNOWN_GAPS = Object.freeze([
  'Sport code 16 (free_training) has no positive evidence in the ' +
  'payload -- no field is prefixed for it the way ride_ or ' +
  'rope_skipping_ are for codes 9 and 21. It was named by ' +
  'elimination: the account owner logged exactly two new sport ' +
  'codes back-to-back on 2026-09-11, code 21 is unambiguously ' +
  'rope skipping from its own pb keys, which leaves 16 as the ' +
  'other one -- consistent with the row itself carrying zero ' +
  'distance, zero cadence and no block-specific field, the ' +
  'signature of an equipment-free session with nothing to ' +
  'measure. Weaker confirmation than every other code in this ' +
  'map; a screenshot of the Zepp app naming code 16 would settle ' +
  'it outright.',
  'RTPC (avg_rtpc_unverified and friends) is present on every ' +
  'sport and reads a constant 21 outside running, which is ' +
  'evidence it is a sentinel -- but its actual meaning is ' +
  'unconfirmed. Report the number, not what it measures.',
  'Lap columns are recovered by inference, not documentation. ' +
  'Columns 1, 13 and 14 (duration, strokes, SWOLF) ARE confirmed ' +
  '-- SWOLF is self-checking as duration + strokes, matches the ' +
  'published SWOLF definition, and its components reconstruct ' +
  "the workout summary's own swolf figure. Everything outside " +
  'that set is inferred or raw.',
  'pool_swim_pace has an unconfirmed unit.',
  'Cumulative training load is unavailable -- ' +
  'WatchSportStatistics/SPORT_LOAD returns HTTP 500. Per-session ' +
  'exercise_load and VO2 max (from zepp_training_thresholds) are ' +
  'both available; only the rolling cumulative figure is not.',
  'No dedicated Zepp Coach endpoint exists, across 22 probed ' +
  'routes with controls. Plan progress (dailyScore, ' +
  'dailyPlanFinished, running_program_id) IS available, exposed ' +
  'as training_plan in zepp_list_workouts once a plan is active.',
  'zepp_body_composition: weight_kg/height_cm/bmi are verified ' +
  '(bmi reproduces weight / (height/100)**2). Everything under ' +
  'body_composition (fat/water/muscle %, bone mass, visceral ' +
  'fat, BMR, body score) uses a schema sourced from a different ' +
  "open-source Zepp API client's documented real-scale capture " +
  '(AlexxIT/SmartScaleConnect), not from an account this project ' +
  'holds -- see docs/api-findings.md. bmi_consistent flags ' +
  'records (typically manual/HealthKit entries, not a real ' +
  'scale sync) whose own weight/height/bmi do not reconcile.',
  'An empty 200 cannot always be distinguished from a rejected ' +
  'request. This does not apply to the v2 events family ' +
  '(readiness, HRV, DailyHealth, RespiratoryRate, ' +
  'LactateThreshold) any more than to v1 endpoints -- an earlier ' +
  'version of this classifier reported every v2 response empty ' +
  'regardless of content, which has been fixed.',
]);

// --------------------------------------------------------------------------
// Entry point
// --------------------------------------------------------------------------

/** The real modules, imported lazily so tests can run on stubs alone. */
export async function loadDefaultDeps() {
  const [api, auth, codes, decode, body, workouts] = await Promise.all([
    import('./client.js'),
    import('./auth.js'),
    import('./codes.js'),
    import('./decode.js'),
    import('./body.js'),
    import('./workouts.js'),
  ]);
  return {
    api, decode, body, workouts,
    describeExpiry: auth.describeExpiry,
    SPORT_CODES: codes.SPORT_CODES,
  };
}

export async function main() {
  const deps = await loadDefaultDeps();
  // Same as the Python server: a .env beside the package manifest is read
  // once at startup, and real environment variables win over it.
  deps.api.loadDotenv(path.join(PACKAGE_ROOT, '.env'));
  await serveStdio(createServer(deps));
}
