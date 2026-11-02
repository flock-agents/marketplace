/**
 * HTTP client for the Zepp mobile API.
 *
 * Two behaviours matter more than the plumbing:
 *
 * - An empty 200 is not the same as "you have no data". Zepp returns HTTP 200
 *   with an empty payload both when a day genuinely has no records and when a
 *   request is subtly malformed. The two are indistinguishable from a single
 *   response, so this client reports `no_data` with that ambiguity attached
 *   rather than asserting absence. An MCP tool that renders an empty 200 as
 *   "you didn't exercise that week" is stating a fault as a fact.
 * - A 401 means the app_token expired. The client re-authenticates once, then
 *   gives up -- it never loops against the auth endpoint.
 */

import fs from "node:fs";

import {
  LoginError, clearCached, loadCached, login, saveCached, urlencode,
} from "./auth.js";

const REQUEST_TIMEOUT_MS = 30_000;
const BODY_PREVIEW_CHARS = 200;

const NO_DATA_NOTE =
  "Zepp returned HTTP 200 with an empty payload. This " +
  "means either there is genuinely no data for this range, " +
  "or the request was rejected in a way the API does not " +
  "report. These are not distinguishable from this " +
  "response alone -- do not report it as confirmed absence.";

/** A response plus an explicit verdict about what it means. */
export class Outcome {
  constructor(status, httpStatus, { data = null, note = null } = {}) {
    this.status = status; // "ok" | "no_data" | "error"
    this.httpStatus = httpStatus;
    this.data = data;
    this.note = note;
  }

  asDict() {
    const out = { status: this.status, http_status: this.httpStatus };
    if (this.note) out.note = this.note;
    if (this.data !== null && this.data !== undefined) out.data = this.data;
    return out;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBlank(value) {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return isPlainObject(value) && Object.keys(value).length === 0;
}

/**
 * A response is empty when its data container holds nothing.
 *
 * Zepp uses two different container keys across API generations: v1
 * endpoints (band_data, workout history, profile) wrap results in `data`,
 * while v2 events (`/v2/users/me/events` -- readiness, HRV, DailyHealth,
 * RespiratoryRate, LactateThreshold) wrap them in `items`.
 *
 * Checking only `data` meant every v2 response was reported empty
 * regardless of content, because `payload.data` is missing whether or
 * not `items` holds real records. This was found live: `hrv_sdnn` and
 * `readiness` each returned 20 real samples and were both reported
 * `no_data` -- which the server then instructed the model to describe as
 * "the query came back empty", a fault stated as a fact and the exact
 * failure this classifier exists to prevent.
 */
function isEmpty(payload) {
  if (payload === null || payload === undefined) return true;
  if (Array.isArray(payload)) return payload.length === 0;
  if (!isPlainObject(payload)) return false;
  if (Object.keys(payload).length === 0) return true;

  if ("items" in payload) return isBlank(payload.items);

  if ("data" in payload) {
    const inner = payload.data;
    if (isBlank(inner)) return true;
    if (isPlainObject(inner)) {
      const meaningful = Object.entries(inner).filter(([key]) => key !== "next");
      return meaningful.every(([, value]) => isBlank(value));
    }
    return false;
  }

  // Neither recognised container is present. This is an unfamiliar shape,
  // not a known-empty one -- treat it as non-empty so the caller can
  // inspect the payload rather than have it silently disappear as
  // "no data".
  return false;
}

/** Python's repr() of a str, used for the error body preview. */
function pyStrRepr(text) {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  const escaped = text.replace(/[\\\n\r\t]|[\x00-\x1f\x7f]/g, (c) => {
    const named = { "\\": "\\\\", "\n": "\\n", "\r": "\\r", "\t": "\\t" }[c];
    return named ?? `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`;
  });
  return quote + (quote === "'" ? escaped.replace(/'/g, "\\'") : escaped) + quote;
}

function withQuery(url, params) {
  const query = urlencode(params || {});
  if (!query) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}

export class ZeppClient {
  #email;
  #password;
  #country;
  #credential = null;

  constructor(email, password, country = "US") {
    this.#email = email;
    this.#password = password;
    this.#country = country;
  }

  // -- auth ------------------------------------------------------------
  async credential() {
    if (this.#credential && !this.#credential.expired) return this.#credential;
    const cached = loadCached();
    if (cached) {
      this.#credential = cached;
      return cached;
    }
    this.#credential = await login(this.#email, this.#password, this.#country);
    saveCached(this.#credential);
    return this.#credential;
  }

  async #reauthenticate() {
    clearCached();
    this.#credential = null;
    return this.credential();
  }

  // -- requests --------------------------------------------------------
  async get(path, params = null) {
    let credential = await this.credential();
    let outcome = await this.#request(credential, path, params);
    if (outcome.httpStatus === 401) {
      try {
        credential = await this.#reauthenticate();
      } catch (error) {
        if (!(error instanceof LoginError)) throw error;
        return new Outcome("error", 401, { note: error.message });
      }
      outcome = await this.#request(credential, path, params);
    }
    return outcome;
  }

  async #request(credential, path, params) {
    const url = withQuery(`https://${credential.regionHost}${path}`, params);
    let response;
    let text;
    try {
      response = await fetch(url, {
        headers: { apptoken: credential.appToken },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      text = await response.text();
    } catch (error) {
      return new Outcome("error", 0, { note: `network error: ${error.message}` });
    }

    if (response.status >= 400) {
      const preview = Array.from(text).slice(0, BODY_PREVIEW_CHARS).join("");
      return new Outcome("error", response.status, {
        note: `Zepp returned HTTP ${response.status} for ${path}. ` +
              `Body starts: ${pyStrRepr(preview)}`,
      });
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      return new Outcome("error", response.status, { note: "response was not JSON" });
    }

    if (isEmpty(payload)) {
      return new Outcome("no_data", response.status, { data: payload, note: NO_DATA_NOTE });
    }
    return new Outcome("ok", response.status, { data: payload });
  }

  close() {
    // fetch has no per-client connection pool to release.
  }
}

// --------------------------------------------------------------------------
// Endpoints
// --------------------------------------------------------------------------

/** Daily steps / sleep / heart rate. `detail` is a superset of `summary`. */
export async function bandData(client, fromDate, toDate) {
  const { userId } = await client.credential();
  return client.get("/v1/data/band_data.json", {
    query_type: "detail", device_type: "android_phone",
    userid: userId,
    from_date: fromDate, to_date: toDate,
  });
}

/**
 * All workouts, every sport.
 *
 * The `run` path segment is a fixed route name, not a filter: this one call
 * returns every activity type. Every other slug 404s.
 */
export async function workoutHistory(client, fromDate, toDate) {
  const { userId } = await client.credential();
  return client.get("/v1/sport/run/history.json", {
    from_date: fromDate, to_date: toDate,
    userid: userId,
  });
}

export async function workoutDetail(client, trackId, source) {
  const { userId } = await client.credential();
  return client.get("/v1/sport/run/detail.json", {
    trackid: trackId, source,
    userid: userId,
  });
}

/** Local midnight of a YYYY-MM-DD date, as Python's naive strptime gives it. */
function parseLocalDate(value) {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(value));
  const [year, month, day] = match ? match.slice(1).map(Number) : [];
  const date = match ? new Date(year, month - 1, day) : null;
  if (!date || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error(`time data ${pyStrRepr(String(value))} does not match format '%Y-%m-%d'`);
  }
  return date;
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/**
 * The watch's own lactate threshold estimate log.
 *
 * This is the AUTHORITATIVE source, not the workout row. `lthr` also
 * appears on individual run rows (see workouts.js), but this endpoint
 * carries the full history with its own `dateString` per estimate, so it
 * stands on its own without joining against workout history -- and it
 * survives even if the originating run later drops out of the retention
 * window `zepp_list_workouts` queries.
 *
 * Found via `/v2/users/me/events?eventType=LactateThreshold&subType=
 * summary`, the same v2 events family that also carries readiness, HRV,
 * DailyHealth and RespiratoryRate. It returns real data (verified: two
 * estimates, 166 and 173 bpm) and was masked entirely by the `isEmpty`
 * bug that only checked for a `data` key -- this endpoint's response uses
 * `items`, so every call here was reported `no_data` until that fix.
 */
export async function lactateThresholdHistory(client, fromDate, toDate) {
  const start = parseLocalDate(fromDate);
  const end = addDays(parseLocalDate(toDate), 1);
  return client.get("/v2/users/me/events", {
    from: String(start.getTime()),
    to: String(end.getTime()),
    eventType: "LactateThreshold", subType: "summary", limit: 50,
  });
}

/**
 * Body-composition scale readings for the account holder (member -1).
 *
 * Neither the endpoint nor its schema is in Zepp's own API surface docs --
 * found via a sibling open-source Zepp API client, AlexxIT/
 * SmartScaleConnect, which documents a real Mi Body Composition Scale 2
 * capture (see docs/api-findings.md). Family members other than the
 * account holder are not modelled. `before` walks backward through
 * history via the `toTime` cursor this endpoint actually takes; unlike
 * bandData / workoutHistory, it has no from/to range parameter.
 */
export async function weightRecords(client, limit = 20, before = null) {
  const params = { limit };
  if (before) {
    const cutoff = addDays(parseLocalDate(before), 1);
    params.toTime = Math.trunc(cutoff.getTime() / 1000);
  }
  const { userId } = await client.credential();
  return client.get(`/users/${userId}/members/-1/weightRecords`, params);
}

/** weightRecords wraps results in `items`, like the v2 events family. */
export function parseWeightItems(payload) {
  const items = isPlainObject(payload) ? payload.items : undefined;
  return Array.isArray(items) ? items.filter(isPlainObject) : [];
}

/**
 * Flatten the LactateThreshold events payload into one row per estimate.
 *
 * Shape: {"items": [{"value": {"samples": [{"dateString", "lactate
 * ThresholdHr", "lactateThresholdPace"}, ...]}}, ...]}. One item can carry
 * more than one sample; both levels are walked.
 */
export function parseLactateThresholdEvents(payload) {
  const items = isPlainObject(payload) ? payload.items : undefined;
  if (!Array.isArray(items)) return [];

  const out = [];
  for (const item of items) {
    const value = isPlainObject(item) ? item.value : undefined;
    const samples = isPlainObject(value) ? value.samples : undefined;
    if (!Array.isArray(samples)) continue;
    for (const sample of samples) {
      if (!isPlainObject(sample)) continue;
      const hr = sample.lactateThresholdHr;
      if (hr === null || hr === undefined) continue;
      out.push({
        date: sample.dateString ?? null,
        lactate_threshold_hr_bpm: hr,
        lactate_threshold_pace_sec_per_km: sample.lactateThresholdPace ?? null,
      });
    }
  }
  return out;
}

export function fromEnv() {
  const email = process.env.ZEPP_EMAIL;
  const password = process.env.ZEPP_PASSWORD;
  if (!email || !password) {
    throw new LoginError(
      "ZEPP_EMAIL and ZEPP_PASSWORD are not set. Put them in .env next " +
      "to package.json, or in the server's environment.",
    );
  }
  return new ZeppClient(email, password, process.env.ZEPP_COUNTRY ?? "US");
}

function unquote(value) {
  const quoted = value.length >= 2 && value[0] === value.at(-1) && `"'`.includes(value[0]);
  return quoted ? value.slice(1, -1) : value;
}

/**
 * Read KEY=VALUE lines into the environment. Real env vars win.
 *
 * Never logs values -- this file holds a password.
 */
export function loadDotenv(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const separator = line.indexOf("=");
    let key = line.slice(0, separator).trim();
    if (key.startsWith("export ")) key = key.slice("export ".length);
    key = key.trim();
    const value = unquote(line.slice(separator + 1).trim());
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

function isoDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function defaultRange(days = 7) {
  const today = new Date();
  return [isoDate(addDays(today, -days)), isoDate(today)];
}

/** Workout index rows arrive as a JSON string nested inside JSON. */
export function parseRows(payload) {
  const data = isPlainObject(payload) ? payload.data : undefined;
  let rows = isPlainObject(data) ? data.summary : data;
  if (typeof rows === "string") {
    try {
      rows = JSON.parse(rows);
    } catch {
      return [];
    }
  }
  return Array.isArray(rows) ? rows.filter(isPlainObject) : [];
}
