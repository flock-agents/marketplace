import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import {
  Credential, LoginError, cacheEnabled, cachePath, clearCached, describeExpiry,
  deviceId, deviceIdPath, loadCached, login, saveCached, urlencode,
} from "../src/auth.js";

const ENV_KEYS = ["HOME", "ZEPP_EMAIL", "ZEPP_TOKEN_CACHE"];
const realFetch = globalThis.fetch;
let savedEnv;
let home;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "zepp-auth-"));
  process.env.HOME = home;
  process.env.ZEPP_EMAIL = "Runner@Example.com ";
  delete process.env.ZEPP_TOKEN_CACHE;
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
    return next;
  };
  return calls;
}

const redirect = (location) => new Response(null, { status: 303, headers: { location } });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

function credential(overrides = {}) {
  return new Credential({
    appToken: "tok", userId: "42", regionHost: "api-mifit-us3.zepp.com",
    countryCode: "US", expiresAt: Date.now() / 1000 + 86400, ...overrides,
  });
}

describe("payload encryption", () => {
  test("AES-128-CBC/PKCS7 ciphertext matches openssl", async () => {
    const calls = mockFetch([redirect("https://x/?error=bad")]);
    await assert.rejects(login("runner+test@example.com", "p@ss w*rd~", "DE"), LoginError);
    // BODY is the quote_plus form (Python 3.7+ keeps ~ literal). Computed independently:
    //   printf '%s' "$BODY" | openssl enc -aes-128-cbc
    //   -K hex(xeNtBVqzDc6tuNTh) -iv hex(MAAAYAAAAAAAAABg) | base64
    const expected =
      "TGkGkEIm823aKRo536OOCQbtQiYPU/BKlkenXkzFm1johYEDiQDDXPwFoN8DkvohENtjqGw2HU2dKbpDZ7Q/2q8vUX" +
      "zDkRQ4kgOfnASdro5bRoMvmUWu4xUbxfWHykDpuG+PC0VgvLEosh459f2iv51rfDfzS5V7E65yJ02OMF23xMGIhHqbgpK1" +
      "+3RpwZX6fkY8jIVWdZcrVdyLAEtbyJ3AvxPS67TCSuEh9EEBf3RIqMwta3JcF3vsoU5pT/n1+g4vR+HxkLQblr5HXL1dFN" +
      "byoclNbgqzlRGZB4njItRyBy0YQcKBRcYKEmzKxR+ema8M16O5qBYgHXKds0GF+Q==";
    assert.equal(Buffer.from(calls[0].init.body).toString("base64"), expected);
  });

  test("urlencode matches Python quote_plus with doseq", () => {
    assert.equal(urlencode({ a: "x y", b: ["1", "2"], c: "~*!'()", d: 5, e: true }),
      "a=x+y&b=1&b=2&c=~%2A%21%27%28%29&d=5&e=true");
  });
});

describe("login", () => {
  test("success: parses the redirect, picks the region host, builds the credential", async () => {
    const calls = mockFetch([
      redirect("https://s3-us-west-2.amazonaws.com/hm-registration/successsignin.html" +
        "?region=us-west-2&access=CODE%2B1&country_code=US&expiration=1"),
      json({
        token_info: { app_token: "APP", user_id: 1234, app_ttl: 7200 },
        regist_info: { country_code: "GB" },
        domains: [
          { host: "api-user.zepp.com", cnames: ["api-user-us2.zepp.com"] },
          { host: "api-mifit.zepp.com", cnames: ["api-mifit-us3.zepp.com"] },
        ],
      }),
    ]);
    const before = Date.now() / 1000;
    const cred = await login("a@b.c", "pw", "US");

    assert.equal(cred.appToken, "APP");
    assert.equal(cred.userId, "1234");
    assert.equal(cred.regionHost, "api-mifit-us3.zepp.com");
    assert.equal(cred.countryCode, "GB");
    assert.ok(cred.expiresAt >= before + 7200 && cred.expiresAt <= Date.now() / 1000 + 7200);

    const [step1, step2] = calls;
    assert.equal(step1.url, "https://api-user.zepp.com/v2/registrations/tokens");
    assert.equal(step1.init.method, "POST");
    assert.equal(step1.init.redirect, "manual");
    assert.equal(step1.init.headers.app_name, "com.huami.midong");
    assert.ok(step1.init.signal instanceof AbortSignal);

    assert.equal(step2.url, "https://api-mifit.zepp.com/v2/client/login");
    assert.equal(step2.init.headers.app_name, "com.huami.webapp");
    const form = new URLSearchParams(step2.init.body);
    assert.equal(form.get("code"), "CODE+1");
    assert.equal(form.get("app_name"), "com.xiaomi.hm.health");
    assert.equal(form.get("device_id"), deviceId());
    assert.equal(form.get("country_code"), "US");
    assert.ok(step2.init.body.includes("dn=api-mifit.zepp.com%2Capi-user.zepp.com%2C"));
  });

  test("falls back to the default host and 30-day ttl", async () => {
    mockFetch([redirect("/x?access=A"), json({ token_info: { app_token: "T" } })]);
    const cred = await login("a@b.c", "pw", "DE");
    assert.equal(cred.regionHost, "api-mifit.zepp.com");
    assert.equal(cred.countryCode, "DE");
    assert.equal(cred.userId, "");
    assert.ok(Math.abs(cred.expiresAt - (Date.now() / 1000 + 2592000)) < 5);
  });

  test("rejected credentials → LoginError with attempt count, one request only", async () => {
    const calls = mockFetch([redirect("https://x/?error=invalid_grant&attempts=3&max_attempts=10")]);
    await assert.rejects(login("a@b.c", "bad"), (error) => {
      assert.ok(error instanceof LoginError);
      assert.equal(error.message,
        "Zepp login rejected the credentials: invalid_grant (failed attempt 3 of 10). " +
        "Check ZEPP_EMAIL and ZEPP_PASSWORD. This is not retried " +
        "automatically -- repeated failures lock the account.");
      return true;
    });
    assert.equal(calls.length, 1);
  });

  test("no Location header → generic rejection", async () => {
    mockFetch([new Response("nope", { status: 400 })]);
    await assert.rejects(login("a@b.c", "bad"),
      { name: "LoginError", message: /: no access code returned\. Check/ });
  });

  test("non-JSON token exchange → LoginError", async () => {
    mockFetch([redirect("/?access=A"), new Response("<html>", { status: 502 })]);
    await assert.rejects(login("a@b.c", "pw"),
      { name: "LoginError", message: "Token exchange returned HTTP 502 with a non-JSON body." });
  });

  test("missing app_token → LoginError quoting result like Python repr", async () => {
    mockFetch([redirect("/?access=A"), json({ result: "fail" })]);
    await assert.rejects(login("a@b.c", "pw"),
      { message: "Token exchange returned HTTP 200 but no app_token (result='fail')." });
    mockFetch([redirect("/?access=A"), json({})]);
    await assert.rejects(login("a@b.c", "pw"), { message: /\(result=None\)\.$/ });
  });

  test("Node fetch exposes the 3xx Location with redirect: manual", async () => {
    globalThis.fetch = realFetch;
    const server = http.createServer((req, res) => {
      res.writeHead(303, { Location: "https://x/?access=abc" });
      res.end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/`,
        { method: "POST", body: Buffer.from([1]), redirect: "manual" });
      assert.equal(res.status, 303);
      assert.equal(res.headers.get("location"), "https://x/?access=abc");
    } finally {
      server.close();
    }
  });
});

describe("token cache", () => {
  test("default path is per account under ~/.zepp-mcp", () => {
    const account = createHash("sha256").update("runner@example.com").digest("hex").slice(0, 16);
    assert.equal(cachePath(), path.join(home, ".zepp-mcp", account, "token.json"));
    assert.equal(deviceIdPath(), path.join(home, ".zepp-mcp", account, "device_id"));
  });

  test("ZEPP_TOKEN_CACHE overrides the path and expands ~", () => {
    process.env.ZEPP_TOKEN_CACHE = "~/custom/tok.json";
    assert.equal(cachePath(), path.join(home, "custom", "tok.json"));
    assert.equal(cacheEnabled(), true);
    for (const off of ["0", "OFF", "none"]) {
      process.env.ZEPP_TOKEN_CACHE = off;
      assert.equal(cacheEnabled(), false);
    }
  });

  test("save → load → clear round-trip, 0600, Python-compatible JSON", () => {
    const cred = credential();
    saveCached(cred);
    const file = cachePath();
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), {
      app_token: "tok", user_id: "42", region_host: "api-mifit-us3.zepp.com",
      country_code: "US", expires_at: cred.expiresAt,
    });
    assert.deepEqual(loadCached(), cred);
    clearCached();
    assert.equal(fs.existsSync(file), false);
    assert.equal(loadCached(), null);
    clearCached();
  });

  test("reads a cache written by the Python version", () => {
    const file = cachePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const expiresAt = Date.now() / 1000 + 86400;
    fs.writeFileSync(file, JSON.stringify({
      app_token: "py", user_id: "7", region_host: "h", expires_at: expiresAt,
    }, null, 2));
    const cred = loadCached();
    assert.equal(cred.appToken, "py");
    assert.equal(cred.countryCode, "");
    assert.equal(cred.expiresAt, expiresAt);
  });

  test("expired, corrupt or incomplete caches load as null", () => {
    saveCached(credential({ expiresAt: Date.now() / 1000 + 1800 }));
    assert.equal(loadCached(), null, "within the one-hour early-refresh window");
    fs.writeFileSync(cachePath(), "{not json");
    assert.equal(loadCached(), null);
    fs.writeFileSync(cachePath(), JSON.stringify({ app_token: "x" }));
    assert.equal(loadCached(), null);
  });

  test("disabled cache neither writes nor reads", () => {
    process.env.ZEPP_TOKEN_CACHE = "off";
    saveCached(credential());
    assert.equal(loadCached(), null);
    assert.deepEqual(fs.readdirSync(home), []);
  });
});

describe("device id", () => {
  test("persisted with 0600 and stable across calls", () => {
    const first = deviceId();
    assert.match(first, /^[0-9a-f-]{36}$/);
    assert.equal(deviceId(), first);
    assert.equal(fs.statSync(deviceIdPath()).mode & 0o777, 0o600);
  });

  test("reads an existing id file", () => {
    fs.mkdirSync(path.dirname(deviceIdPath()), { recursive: true });
    fs.writeFileSync(deviceIdPath(), "  fixed-id\n");
    assert.equal(deviceId(), "fixed-id");
  });

  test("fresh id each call when the cache is disabled", () => {
    process.env.ZEPP_TOKEN_CACHE = "0";
    assert.notEqual(deviceId(), deviceId());
  });
});

describe("Credential", () => {
  test("expired refreshes an hour early", () => {
    assert.equal(credential({ expiresAt: Date.now() / 1000 + 3500 }).expired, true);
    assert.equal(credential({ expiresAt: Date.now() / 1000 + 3700 }).expired, false);
  });

  test("describeExpiry matches Python isoformat(timespec='seconds') in UTC", () => {
    assert.equal(describeExpiry(credential({ expiresAt: 1780000000.987 })),
      "2026-05-28T20:26:40+00:00");
  });
});
