import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { Credential, LoginError, cachePath, loadCached, saveCached } from "../src/auth.js";
import {
  Outcome, ZeppClient, bandData, defaultRange, fromEnv, lactateThresholdHistory,
  loadDotenv, parseLactateThresholdEvents, parseRows, parseWeightItems, weightRecords,
  workoutDetail, workoutHistory,
} from "../src/client.js";

const ENV_KEYS = ["HOME", "ZEPP_EMAIL", "ZEPP_PASSWORD", "ZEPP_COUNTRY", "ZEPP_TOKEN_CACHE",
  "ZEPP_TEST_A", "ZEPP_TEST_B", "ZEPP_TEST_C", "ZEPP_TEST_D", "ZEPP_TEST_E"];
const realFetch = globalThis.fetch;
let savedEnv;
let home;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  home = fs.mkdtempSync(path.join(os.tmpdir(), "zepp-client-"));
  process.env.HOME = home;
  process.env.ZEPP_EMAIL = "runner@example.com";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(home, { recursive: true, force: true });
});

function mockFetch(responses) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch to ${url}`);
    if (next instanceof Error) throw next;
    return next;
  };
  return calls;
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const redirect = (location) => new Response(null, { status: 303, headers: { location } });

function seedCredential(overrides = {}) {
  const cred = new Credential({
    appToken: "cached-token", userId: "42", regionHost: "api-mifit-us3.zepp.com",
    countryCode: "US", expiresAt: Date.now() / 1000 + 86400, ...overrides,
  });
  saveCached(cred);
  return cred;
}

const client = () => new ZeppClient("runner@example.com", "secret", "US");

describe("Outcome", () => {
  test("asDict omits empty note and null data", () => {
    assert.deepEqual(new Outcome("ok", 200).asDict(), { status: "ok", http_status: 200 });
    assert.deepEqual(new Outcome("ok", 200, { data: [], note: "n" }).asDict(),
      { status: "ok", http_status: 200, note: "n", data: [] });
    assert.deepEqual(new Outcome("error", 0, { note: "" }).asDict(),
      { status: "error", http_status: 0 });
  });
});

describe("ZeppClient.get", () => {
  test("uses the cached credential, region host, apptoken header and encoded params", async () => {
    seedCredential();
    const calls = mockFetch([json({ data: [{ date: "2026-11-01" }] })]);
    const outcome = await client().get("/v1/x.json", { a: "b c", n: 5 });
    assert.equal(outcome.status, "ok");
    assert.equal(outcome.httpStatus, 200);
    assert.deepEqual(outcome.data, { data: [{ date: "2026-11-01" }] });
    assert.equal(calls[0].url, "https://api-mifit-us3.zepp.com/v1/x.json?a=b+c&n=5");
    assert.deepEqual(calls[0].init.headers, { apptoken: "cached-token" });
  });

  test("no params → no query string", async () => {
    seedCredential();
    const calls = mockFetch([json({ x: 1 })]);
    await client().get("/p");
    assert.equal(calls[0].url, "https://api-mifit-us3.zepp.com/p");
  });

  test("logs in and caches when there is no cached credential", async () => {
    const calls = mockFetch([
      redirect("/?access=CODE"),
      json({ token_info: { app_token: "fresh", user_id: "9" } }),
      json({ items: [1] }),
    ]);
    const outcome = await client().get("/v2/y");
    assert.equal(outcome.status, "ok");
    assert.equal(calls[2].url, "https://api-mifit.zepp.com/v2/y");
    assert.equal(calls[2].init.headers.apptoken, "fresh");
    assert.equal(loadCached().appToken, "fresh");
  });

  test("401 re-authenticates exactly once, then retries", async () => {
    seedCredential();
    const calls = mockFetch([
      new Response("expired", { status: 401 }),
      redirect("/?access=CODE"),
      json({ token_info: { app_token: "new-token" } }),
      json({ data: { a: 1 } }),
    ]);
    const outcome = await client().get("/z");
    assert.equal(outcome.status, "ok");
    assert.equal(calls.length, 4);
    assert.equal(calls[3].init.headers.apptoken, "new-token");
    assert.equal(loadCached().appToken, "new-token");
  });

  test("a second 401 after re-auth is returned, not looped", async () => {
    seedCredential();
    const calls = mockFetch([
      new Response("", { status: 401 }),
      redirect("/?access=CODE"),
      json({ token_info: { app_token: "new-token" } }),
      new Response("", { status: 401 }),
    ]);
    const outcome = await client().get("/z");
    assert.equal(outcome.status, "error");
    assert.equal(outcome.httpStatus, 401);
    assert.equal(calls.length, 4);
  });

  test("re-auth LoginError becomes an error Outcome and clears the cache", async () => {
    seedCredential();
    mockFetch([new Response("", { status: 401 }), redirect("/?error=locked")]);
    const outcome = await client().get("/z");
    assert.equal(outcome.status, "error");
    assert.equal(outcome.httpStatus, 401);
    assert.match(outcome.note, /^Zepp login rejected the credentials: locked\./);
    assert.equal(fs.existsSync(cachePath()), false);
  });

  test("initial login failure propagates as LoginError", async () => {
    mockFetch([redirect("/?error=bad")]);
    await assert.rejects(client().get("/z"), LoginError);
  });

  test("network error → status 0", async () => {
    seedCredential();
    mockFetch([new TypeError("fetch failed")]);
    assert.deepEqual((await client().get("/z")).asDict(),
      { status: "error", http_status: 0, note: "network error: fetch failed" });
  });

  test("HTTP error quotes the first 200 chars of the body like Python repr", async () => {
    seedCredential();
    mockFetch([new Response(`it's "bad"\n${"x".repeat(300)}`, { status: 500 })]);
    const outcome = await client().get("/v1/q");
    assert.equal(outcome.httpStatus, 500);
    assert.equal(outcome.note,
      `Zepp returned HTTP 500 for /v1/q. Body starts: 'it\\'s "bad"\\n${"x".repeat(189)}'`);
  });

  test("non-JSON 200 → error", async () => {
    seedCredential();
    mockFetch([new Response("<html>", { status: 200 })]);
    assert.deepEqual((await client().get("/z")).asDict(),
      { status: "error", http_status: 200, note: "response was not JSON" });
  });

  const emptyPayloads = {
    "null": null, "empty list": [], "empty object": {},
    "items empty": { items: [] }, "items null": { items: null }, "items blank string": { items: "" },
    "data null": { data: null }, "data empty": { data: {} }, "data blank": { data: "" },
    "data only next": { data: { next: 5 } }, "data all blank": { data: { a: [], b: null, c: "" } },
  };
  for (const [name, payload] of Object.entries(emptyPayloads)) {
    test(`empty payload (${name}) → no_data with the ambiguity note`, async () => {
      seedCredential();
      mockFetch([json(payload)]);
      const outcome = await client().get("/z");
      assert.equal(outcome.status, "no_data");
      assert.deepEqual(outcome.data, payload);
      assert.match(outcome.note, /do not report it as confirmed absence\.$/);
    });
  }

  const fullPayloads = {
    "items with records": { items: [{ v: 1 }] }, "data list": { data: [1] },
    "data with value": { data: { next: 1, summary: "x" } }, "data scalar": { data: 0 },
    "unfamiliar shape": { foo: null }, "non-empty list": [0], "string": "", "zero": 0,
  };
  for (const [name, payload] of Object.entries(fullPayloads)) {
    test(`non-empty payload (${name}) → ok`, async () => {
      seedCredential();
      mockFetch([json(payload)]);
      assert.equal((await client().get("/z")).status, "ok");
    });
  }
});

describe("endpoints", () => {
  test("bandData / workoutHistory / workoutDetail paths and params", async () => {
    seedCredential();
    const calls = mockFetch([json({ data: [1] }), json({ data: [1] }), json({ data: [1] })]);
    const zepp = client();
    await bandData(zepp, "2026-10-01", "2026-10-07");
    await workoutHistory(zepp, "2026-10-01", "2026-10-07");
    await workoutDetail(zepp, "T1", "run.s");
    assert.deepEqual(calls.map((c) => c.url), [
      "https://api-mifit-us3.zepp.com/v1/data/band_data.json?query_type=detail" +
        "&device_type=android_phone&userid=42&from_date=2026-10-01&to_date=2026-10-07",
      "https://api-mifit-us3.zepp.com/v1/sport/run/history.json?from_date=2026-10-01" +
        "&to_date=2026-10-07&userid=42",
      "https://api-mifit-us3.zepp.com/v1/sport/run/detail.json?trackid=T1&source=run.s&userid=42",
    ]);
  });

  test("lactateThresholdHistory spans local midnights, end inclusive", async () => {
    seedCredential();
    const calls = mockFetch([json({ items: [] })]);
    await lactateThresholdHistory(client(), "2026-10-01", "2026-10-07");
    const from = new Date(2026, 9, 1).getTime();
    const to = new Date(2026, 9, 8).getTime();
    assert.equal(calls[0].url, "https://api-mifit-us3.zepp.com/v2/users/me/events" +
      `?from=${from}&to=${to}&eventType=LactateThreshold&subType=summary&limit=50`);
  });

  test("lactateThresholdHistory rejects a malformed date like strptime", async () => {
    seedCredential();
    await assert.rejects(lactateThresholdHistory(client(), "2026-13-01", "2026-10-07"),
      { message: "time data '2026-13-01' does not match format '%Y-%m-%d'" });
  });

  test("weightRecords: default limit, and toTime cursor in seconds", async () => {
    seedCredential();
    const calls = mockFetch([json({ items: [] }), json({ items: [] })]);
    await weightRecords(client());
    await weightRecords(client(), 5, "2026-10-07");
    const cutoff = new Date(2026, 9, 8).getTime() / 1000;
    assert.deepEqual(calls.map((c) => c.url), [
      "https://api-mifit-us3.zepp.com/users/42/members/-1/weightRecords?limit=20",
      `https://api-mifit-us3.zepp.com/users/42/members/-1/weightRecords?limit=5&toTime=${cutoff}`,
    ]);
  });
});

describe("parse helpers", () => {
  test("parseWeightItems keeps dict items only", () => {
    assert.deepEqual(parseWeightItems({ items: [{ w: 70 }, 3, null, [1]] }), [{ w: 70 }]);
    assert.deepEqual(parseWeightItems({ items: "x" }), []);
    assert.deepEqual(parseWeightItems([1]), []);
    assert.deepEqual(parseWeightItems(null), []);
  });

  test("parseLactateThresholdEvents walks items and samples", () => {
    const payload = { items: [
      { value: { samples: [
        { dateString: "2026-09-01", lactateThresholdHr: 166, lactateThresholdPace: 300 },
        { dateString: "2026-09-02", lactateThresholdHr: null },
        { dateString: "2026-09-03" },
        "junk",
      ] } },
      { value: { samples: [{ lactateThresholdHr: 173 }] } },
      { value: { samples: "nope" } }, { value: null }, 7,
    ] };
    assert.deepEqual(parseLactateThresholdEvents(payload), [
      { date: "2026-09-01", lactate_threshold_hr_bpm: 166, lactate_threshold_pace_sec_per_km: 300 },
      { date: null, lactate_threshold_hr_bpm: 173, lactate_threshold_pace_sec_per_km: null },
    ]);
    assert.deepEqual(parseLactateThresholdEvents({ items: {} }), []);
    assert.deepEqual(parseLactateThresholdEvents("x"), []);
  });

  test("parseRows handles nested JSON strings, summary key and junk", () => {
    assert.deepEqual(parseRows({ data: { summary: JSON.stringify([{ a: 1 }, 2]) } }), [{ a: 1 }]);
    assert.deepEqual(parseRows({ data: { summary: [{ b: 2 }] } }), [{ b: 2 }]);
    assert.deepEqual(parseRows({ data: [{ c: 3 }, "x"] }), [{ c: 3 }]);
    assert.deepEqual(parseRows({ data: JSON.stringify([{ d: 4 }]) }), [{ d: 4 }]);
    assert.deepEqual(parseRows({ data: { summary: "{bad" } }), []);
    assert.deepEqual(parseRows({ data: { summary: "{}" } }), []);
    assert.deepEqual(parseRows([1]), []);
  });
});

describe("environment", () => {
  test("loadDotenv parses quotes, export, comments; real env wins", () => {
    const file = path.join(home, ".env");
    fs.writeFileSync(file, [
      "# comment", "", "ZEPP_TEST_A = plain ", "export ZEPP_TEST_B=\"quoted value\"",
      "ZEPP_TEST_C='single'", "ZEPP_TEST_D=a=b", "no equals here", "ZEPP_TEST_E=from-file",
    ].join("\r\n"));
    process.env.ZEPP_TEST_E = "from-env";
    loadDotenv(file);
    assert.equal(process.env.ZEPP_TEST_A, "plain");
    assert.equal(process.env.ZEPP_TEST_B, "quoted value");
    assert.equal(process.env.ZEPP_TEST_C, "single");
    assert.equal(process.env.ZEPP_TEST_D, "a=b");
    assert.equal(process.env.ZEPP_TEST_E, "from-env");
  });

  test("loadDotenv ignores a missing file", () => {
    assert.doesNotThrow(() => loadDotenv(path.join(home, "missing.env")));
  });

  test("defaultRange returns local YYYY-MM-DD dates", () => {
    const [start, end] = defaultRange(3);
    const pad = (n) => String(n).padStart(2, "0");
    const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const now = new Date();
    assert.equal(end, iso(now));
    assert.equal(start, iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3)));
    assert.equal(defaultRange()[0], iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7)));
  });

  test("fromEnv requires email and password", () => {
    delete process.env.ZEPP_EMAIL;
    assert.throws(fromEnv, { name: "LoginError", message: /^ZEPP_EMAIL and ZEPP_PASSWORD are not set\./ });
    process.env.ZEPP_EMAIL = "a@b.c";
    process.env.ZEPP_PASSWORD = "pw";
    assert.ok(fromEnv() instanceof ZeppClient);
  });

  test("fromEnv passes ZEPP_COUNTRY through to login", async () => {
    process.env.ZEPP_PASSWORD = "pw";
    process.env.ZEPP_COUNTRY = "DE";
    const calls = mockFetch([redirect("/?error=x")]);
    await assert.rejects(fromEnv().credential(), LoginError);
    assert.ok(calls.length === 1);
  });
});
