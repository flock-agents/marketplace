import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createMessageHandler } from '../src/mcp-stdio.js';
import { INSTRUCTIONS, SERVER_INFO, createServer } from '../src/server.js';

const TODAY = '2026-11-02';
const CLIENT = { name: 'stub client' };

const outcome = (status, data = null, httpStatus = 200) => ({
  status,
  httpStatus,
  data,
  asDict() {
    const out = { status, http_status: httpStatus };
    if (data !== null) out.data = data;
    return out;
  },
});
const ok = (data) => outcome('ok', data);

/** Stub deps; `responses` maps an api function name to its outcome (or a thrower). */
function makeDeps(responses = {}, overrides = {}) {
  const calls = [];
  const respond = (name) => async (...args) => {
    calls.push([name, ...args]);
    const response = responses[name];
    if (typeof response === 'function') return response(...args);
    return response;
  };
  const api = {
    bandData: respond('bandData'),
    workoutHistory: respond('workoutHistory'),
    workoutDetail: respond('workoutDetail'),
    lactateThresholdHistory: respond('lactateThresholdHistory'),
    weightRecords: respond('weightRecords'),
    defaultRange: (days) => [`minus-${days}`, TODAY],
    parseRows: (payload) => payload.rows,
    parseWeightItems: (payload) => payload.items,
    parseLactateThresholdEvents: (payload) => payload.events.map((event) => ({ ...event })),
  };
  const decode = {
    summariseDay: (row) => row.summary,
    decodeHrMinutes: (encoded) => JSON.parse(encoded || '[]'),
    decodeDetail: (data, sections) => ({ sections: [...sections].sort(), raw: data }),
    STREAM_SPECS: {
      heart_rate: { encoding: 'delta', unit: 'bpm', scale: 1, verified: true },
      pool_swim_pace: { encoding: 'absolute', unit: 'unknown', scale: 1, verified: false },
    },
  };
  const deps = {
    api,
    decode,
    body: { normalise: (item) => ({ date: item.d, weight_kg: item.w }) },
    workouts: { normalise: (row) => ({ summary: {}, ...row }) },
    describeExpiry: (credential) => `expires ${credential.expiresAt}`,
    SPORT_CODES: { 1: 'outdoor_running' },
    getClient: () => CLIENT,
    today: () => TODAY,
    ...overrides,
  };
  return { deps, calls };
}

function serverFor(responses, overrides) {
  const { deps, calls } = makeDeps(responses, overrides);
  const server = createServer(deps);
  const tools = new Map(server.tools.map((tool) => [tool.name, tool]));
  const handle = createMessageHandler(server);
  const call = async (name, args = {}) => {
    const response = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    return response.result;
  };
  const run = async (name, args) => {
    const result = await call(name, args);
    assert.equal(result.isError, false, result.content[0].text);
    return result.structuredContent;
  };
  return { server, tools, calls, call, run };
}

const optionalString = (title) => ({ anyOf: [{ type: 'string' }, { type: 'null' }], default: null, title });
const dictOutput = (name) => ({ additionalProperties: true, title: `${name}DictOutput`, type: 'object' });

describe('tool registry', () => {
  const { server, tools } = serverFor();

  it('carries the Python server identity and instructions', () => {
    assert.deepEqual(server.info, { name: 'zepp', version: '1.0.0' });
    assert.equal(SERVER_INFO.name, 'zepp');
    assert.match(INSTRUCTIONS, /^Reads health and workout data/);
  });

  it('registers every tool from server.py, in order', () => {
    assert.deepEqual([...tools.keys()], [
      'zepp_daily_summary', 'zepp_heart_rate', 'zepp_sleep', 'zepp_list_workouts',
      'zepp_workout_detail', 'zepp_body_composition', 'zepp_training_thresholds',
      'zepp_describe_schema', 'zepp_raw_request', 'zepp_auth_status',
    ]);
    for (const tool of tools.values()) {
      assert.ok(tool.description.length > 20, tool.name);
      assert.deepEqual(tool.outputSchema, dictOutput(tool.name));
    }
  });

  it('derives pydantic-shaped input schemas', () => {
    assert.deepEqual(tools.get('zepp_daily_summary').inputSchema, {
      properties: { from_date: optionalString('From Date'), to_date: optionalString('To Date') },
      title: 'zepp_daily_summaryArguments',
      type: 'object',
    });
    assert.deepEqual(tools.get('zepp_heart_rate').inputSchema.properties, {
      date: optionalString('Date'),
      include_series: { default: false, title: 'Include Series', type: 'boolean' },
    });
    assert.deepEqual(tools.get('zepp_list_workouts').inputSchema.properties.limit,
      { default: 50, title: 'Limit', type: 'integer' });
    assert.deepEqual(tools.get('zepp_workout_detail').inputSchema, {
      properties: {
        track_id: { title: 'Track Id', type: 'string' },
        source: { title: 'Source', type: 'string' },
        include: {
          anyOf: [
            { items: { enum: ['summary', 'laps', 'streams', 'gps'], type: 'string' }, type: 'array' },
            { type: 'null' },
          ],
          default: null,
          title: 'Include',
        },
      },
      required: ['track_id', 'source'],
      title: 'zepp_workout_detailArguments',
      type: 'object',
    });
    assert.deepEqual(tools.get('zepp_body_composition').inputSchema.properties, {
      limit: { default: 20, title: 'Limit', type: 'integer' },
      before: optionalString('Before'),
    });
    assert.deepEqual(tools.get('zepp_raw_request').inputSchema, {
      properties: {
        path: { title: 'Path', type: 'string' },
        params: {
          anyOf: [{ additionalProperties: true, type: 'object' }, { type: 'null' }],
          default: null,
          title: 'Params',
        },
      },
      required: ['path'],
      title: 'zepp_raw_requestArguments',
      type: 'object',
    });
    assert.deepEqual(tools.get('zepp_auth_status').inputSchema,
      { properties: {}, title: 'zepp_auth_statusArguments', type: 'object' });
  });
});

describe('zepp_daily_summary', () => {
  it('summarises dict rows over the default 7-day range', async () => {
    const band = ok({ data: [{ summary: { date: 'a' } }, 'junk', { summary: { date: 'b' } }] });
    const { run, calls } = serverFor({ bandData: band });
    assert.deepEqual(await run('zepp_daily_summary'), {
      status: 'ok', range: { from: 'minus-7', to: TODAY }, day_count: 2,
      days: [{ date: 'a' }, { date: 'b' }],
    });
    assert.deepEqual(calls, [['bandData', CLIENT, 'minus-7', TODAY]]);
  });

  it('fills only the missing end of a half-open range', async () => {
    const { run, calls } = serverFor({ bandData: ok({ data: [] }) });
    await run('zepp_daily_summary', { from_date: '2026-01-01' });
    assert.deepEqual(calls[0].slice(2), ['2026-01-01', TODAY]);
  });

  it('passes a non-ok outcome through as_dict', async () => {
    const { run } = serverFor({ bandData: outcome('no_data', { data: [] }) });
    assert.deepEqual(await run('zepp_daily_summary'), { status: 'no_data', http_status: 200, data: { data: [] } });
  });

  it('turns an exception into the _fail dict', async () => {
    const { run } = serverFor({}, { getClient: () => { throw new Error('no creds'); } });
    assert.deepEqual(await run('zepp_daily_summary'), { status: 'error', error: 'no creds' });
  });
});

describe('zepp_heart_rate', () => {
  const series = [null, 70, 72, null, 75, 73, 71, null];
  const band = ok({ data: [{ data_hr: JSON.stringify(series) }] });

  it('reports statistics and Python-rounded average', async () => {
    const { run, calls } = serverFor({ bandData: band });
    assert.deepEqual(await run('zepp_heart_rate'), {
      status: 'ok', date: TODAY, unit: 'bpm', samples: 5, minutes_covered: 5,
      min: 70, max: 75, avg: 72.2, first_reading_minute: 1, last_reading_minute: 6,
    });
    assert.deepEqual(calls[0].slice(2), [TODAY, TODAY]);
  });

  it('adds the per-minute series on request', async () => {
    const { run } = serverFor({ bandData: band });
    const result = await run('zepp_heart_rate', { date: '2026-10-01', include_series: true });
    assert.equal(result.date, '2026-10-01');
    assert.deepEqual(result.per_minute, series);
  });

  it('reports no_data for no rows and for rows without samples', async () => {
    const empty = serverFor({ bandData: ok({ data: [] }) });
    assert.deepEqual(await empty.run('zepp_heart_rate'),
      { status: 'no_data', date: TODAY, note: 'No band_data row returned for this date.' });
    const blank = serverFor({ bandData: ok({ data: [{ data_hr: '[null,null]' }] }) });
    assert.equal((await blank.run('zepp_heart_rate')).note, "The day's row carried no usable heart rate samples.");
  });
});

describe('zepp_sleep', () => {
  it('spreads the first sleep block after status and date', async () => {
    const rows = [
      { summary: { date: '2026-11-01', sleep: {} } },
      { summary: { date: '2026-11-02', sleep: { deep_minutes: 90, main_sleep_recorded: true } } },
    ];
    const { run } = serverFor({ bandData: ok({ data: rows }) });
    const result = await run('zepp_sleep');
    assert.deepEqual(result, { status: 'ok', date: '2026-11-02', deep_minutes: 90, main_sleep_recorded: true });
    assert.deepEqual(Object.keys(result).slice(0, 2), ['status', 'date']);
  });

  it('reports an unrecorded night as no_data', async () => {
    const rows = [{ summary: { date: 'd', sleep: { main_sleep_recorded: false } } }];
    const { run } = serverFor({ bandData: ok({ data: rows }) });
    assert.equal((await run('zepp_sleep')).status, 'no_data');
  });

  it('reports a missing block as no_data with a note', async () => {
    const { run } = serverFor({ bandData: ok({ data: [{ summary: { date: 'd' } }] }) });
    assert.deepEqual(await run('zepp_sleep', { date: '2026-10-10' }),
      { status: 'no_data', date: '2026-10-10', note: "No sleep block in this date's record." });
  });
});

describe('zepp_list_workouts', () => {
  const rows = [
    { sport: 'pool_swimming', start_local: '2026-10-02T07:00' },
    { sport: 'outdoor_running', start_local: '2026-10-05T07:00' },
    { sport: 'indoor_running', start_local: null },
    { sport: 'outdoor_running', start_local: '2026-10-01T07:00' },
  ];

  it('sorts newest first, limits, and lists sports present', async () => {
    const { run, calls } = serverFor({ workoutHistory: ok({ rows }) });
    const result = await run('zepp_list_workouts', { limit: 2 });
    assert.deepEqual(result.range, { from: 'minus-90', to: TODAY });
    assert.equal(result.total, 4);
    assert.deepEqual(result.workouts.map((w) => w.start_local), ['2026-10-05T07:00', '2026-10-02T07:00']);
    assert.deepEqual(result.sports_present, ['indoor_running', 'outdoor_running', 'pool_swimming']);
    assert.deepEqual(calls[0].slice(2), ['minus-90', TODAY]);
  });

  it('filters by a case-insensitive sport substring', async () => {
    const { run } = serverFor({ workoutHistory: ok({ rows }) });
    const result = await run('zepp_list_workouts', { sport: ' RUNNING ' });
    assert.equal(result.total, 3);
    assert.deepEqual(result.workouts.map((w) => w.start_local),
      ['2026-10-05T07:00', '2026-10-01T07:00', null]);
  });
});

describe('zepp_workout_detail', () => {
  it('decodes summary and laps by default', async () => {
    const { run, calls } = serverFor({ workoutDetail: ok({ data: { x: 1 } }) });
    assert.deepEqual(await run('zepp_workout_detail', { track_id: '123', source: 'run.1' }), {
      status: 'ok', track_id: '123', sections: ['laps', 'summary'], raw: { x: 1 },
    });
    assert.deepEqual(calls[0], ['workoutDetail', CLIENT, '123', 'run.1']);
  });

  it('honours include, including a JSON-encoded list', async () => {
    const { run } = serverFor({ workoutDetail: ok({ data: { x: 1 } }) });
    assert.deepEqual((await run('zepp_workout_detail', { track_id: '1', source: 's', include: '["gps"]' })).sections,
      ['gps']);
  });

  it('rejects an unknown section and missing required args', async () => {
    const { call } = serverFor({ workoutDetail: ok({ data: {} }) });
    assert.equal((await call('zepp_workout_detail', { track_id: '1', source: 's', include: ['hr'] })).isError, true);
    assert.equal((await call('zepp_workout_detail', { track_id: '1' })).isError, true);
  });

  it('reports a payload without a data object', async () => {
    const { run } = serverFor({ workoutDetail: ok({ data: [1] }) });
    assert.deepEqual(await run('zepp_workout_detail', { track_id: '1', source: 's' }),
      { status: 'error', note: 'Detail payload had no data object.' });
  });
});

describe('zepp_body_composition', () => {
  it('normalises, sorts newest first and caps at limit', async () => {
    const items = [{ d: '2026-01-01', w: 70 }, { d: '2026-03-01', w: 71 }, { d: '2026-02-01', w: 72 }];
    const { run, calls } = serverFor({ weightRecords: ok({ items }) });
    assert.deepEqual(await run('zepp_body_composition', { limit: 2, before: '2026-04-01' }), {
      status: 'ok', reading_count: 3,
      readings: [{ date: '2026-03-01', weight_kg: 71 }, { date: '2026-02-01', weight_kg: 72 }],
    });
    assert.deepEqual(calls[0], ['weightRecords', CLIENT, 2, '2026-04-01']);
  });

  it('defaults to 20 readings and no cursor', async () => {
    const { run, calls } = serverFor({ weightRecords: ok({ items: [] }) });
    await run('zepp_body_composition');
    assert.deepEqual(calls[0], ['weightRecords', CLIENT, 20, null]);
  });
});

describe('zepp_training_thresholds', () => {
  const runs = [
    { sport: 'outdoor_running', start_local: '2026-09-01T07:00', track_id: 't1', summary: { VO2_max: 47 },
      foot: { lactate_threshold_hr_bpm: 166, lactate_threshold_pace_sec_per_km: 301.7 } },
    { sport: 'outdoor_running', start_local: '2026-10-01T07:00', track_id: 't2', summary: { VO2_max: 49 },
      foot: {} },
    { sport: 'pool_swimming', start_local: '2026-10-02T07:00', track_id: 't3', summary: { VO2_max: 60 } },
  ];

  it('prefers the event log and reports the change', async () => {
    const events = [
      { date: '2026-10-01', lactate_threshold_hr_bpm: 173, lactate_threshold_pace_sec_per_km: 290 },
      { date: '2026-08-01', lactate_threshold_hr_bpm: 166, lactate_threshold_pace_sec_per_km: null },
    ];
    const { run, calls } = serverFor({
      lactateThresholdHistory: ok({ events }),
      workoutHistory: ok({ rows: runs }),
    });
    const result = await run('zepp_training_thresholds');
    assert.equal(result.source, 'lactate_threshold_events');
    assert.deepEqual(result.range, { from: 'minus-180', to: TODAY });
    assert.deepEqual(result.history.map((e) => e.date), ['2026-08-01', '2026-10-01']);
    assert.deepEqual(result.current, {
      date: '2026-10-01', lactate_threshold_hr_bpm: 173, lactate_threshold_pace_sec_per_km: 290,
      lactate_threshold_pace: '4:50/km', vo2_max: 49,
    });
    assert.equal('vo2_max' in result.history[1], false, 'vo2_max only on current');
    assert.equal(result.estimate_count, 2);
    assert.equal(result.runs_without_an_estimate, 1);
    assert.deepEqual(result.change, { hr_bpm: 7, from_date: '2026-08-01', to_date: '2026-10-01' });
    assert.deepEqual(Object.keys(result), [
      'status', 'range', 'source', 'current', 'estimate_count', 'runs_without_an_estimate',
      'history', 'training_load', 'note', 'change',
    ]);
    assert.deepEqual(calls.map(([name]) => name), ['lactateThresholdHistory', 'workoutHistory']);
  });

  it('falls back to workout rows when the event log is empty', async () => {
    const { run } = serverFor({
      lactateThresholdHistory: outcome('no_data', { items: [] }),
      workoutHistory: ok({ rows: runs }),
    });
    const result = await run('zepp_training_thresholds', { from_date: '2026-01-01', to_date: '2026-10-31' });
    assert.equal(result.source, 'workout_rows');
    assert.deepEqual(result.history, [{
      date: '2026-09-01', track_id: 't1', lactate_threshold_hr_bpm: 166,
      lactate_threshold_pace_sec_per_km: 301.7, lactate_threshold_pace: '5:01/km',
    }]);
    assert.equal('change' in result, false);
  });

  it('reports absence of an estimate as no_data', async () => {
    const { run } = serverFor({
      lactateThresholdHistory: outcome('error', null, 500),
      workoutHistory: ok({ rows: [runs[1]] }),
    });
    const result = await run('zepp_training_thresholds');
    assert.equal(result.status, 'no_data');
    assert.equal(result.source, 'workout_rows');
    assert.equal(result.runs_without_an_estimate, 1);
    assert.match(result.note, /not a threshold of zero/);
  });

  it('raises a missing credential as a tool error, as the Python does', async () => {
    const { call } = serverFor({}, { getClient: () => { throw new Error('ZEPP_EMAIL missing'); } });
    const result = await call('zepp_training_thresholds');
    assert.equal(result.isError, true);
    assert.equal(result.content[0].text, 'Error executing tool zepp_training_thresholds: ZEPP_EMAIL missing');
  });
});

describe('zepp_describe_schema', () => {
  it('reports sport codes, stream units and known gaps', async () => {
    const { run } = serverFor();
    const result = await run('zepp_describe_schema');
    assert.deepEqual(result.sport_codes.identified, { 1: 'outdoor_running' });
    assert.deepEqual(result.stream_units, {
      heart_rate: { unit: 'bpm', encoding: 'delta', verified: true },
      pool_swim_pace: { unit: 'unknown', encoding: 'absolute', verified: false },
    });
    assert.equal(result.known_gaps.length, 8);
  });
});

describe('zepp_raw_request', () => {
  it('requires a leading slash', async () => {
    const { run } = serverFor();
    assert.deepEqual(await run('zepp_raw_request', { path: 'v1/x' }),
      { status: 'error', error: "path must start with '/'" });
  });

  it('forwards path and params and returns as_dict', async () => {
    const seen = [];
    const client = { get: async (...args) => { seen.push(args); return ok({ a: 1 }); } };
    const { run } = serverFor({}, { getClient: () => client });
    assert.deepEqual(await run('zepp_raw_request', { path: '/v1/x', params: { q: 1 } }),
      { status: 'ok', http_status: 200, data: { a: 1 } });
    await run('zepp_raw_request', { path: '/v1/y' });
    assert.deepEqual(seen, [['/v1/x', { q: 1 }], ['/v1/y', {}]]);
  });
});

describe('zepp_auth_status', () => {
  it('describes the credential without exposing the token', async () => {
    const credential = { appToken: 'secret', regionHost: 'api.example', countryCode: 'US', expiresAt: 5 };
    const { run } = serverFor({}, { getClient: () => ({ credential: async () => credential }) });
    const result = await run('zepp_auth_status');
    assert.deepEqual(result, {
      status: 'ok', region_host: 'api.example', country_code: 'US', token_expires_at: 'expires 5',
      note: 'Only the API token is cached on disk. No health data is stored by this server.',
    });
  });
});
