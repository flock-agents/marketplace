/**
 * Zepp password login, plus a token cache.
 *
 * Differences from the recon spike, all of them forced by what the spike found:
 *
 * - One login attempt, never a loop. The step-1 redirect carries
 *   `attempts=N&max_attempts=10`, and that counter is shared across every host
 *   and region -- so a retry loop walks the account toward a lockout. The spike
 *   also showed the `region` parameter is ignored at step 1, which made the
 *   five-variant matrix five identical requests.
 * - The region host is read from the login response's `domains` block rather
 *   than probed. The server returns the account's real region; we never guess.
 * - The token is cached, so a server restart does not mean a fresh login. Only
 *   the credential is cached. No health data is ever written to disk.
 *
 * Step 2's `app_name` is deliberately NOT `com.huami.midong` (the real Zepp
 * Android app's package id). Huami's backend appears to key a session by
 * `(user, app_name)`: logging in under the phone app's own identity evicts the
 * phone's active session (see GitHub issue #5). We instead identify as the
 * retired Mi Fit client id, `com.xiaomi.hm.health`, which other unofficial
 * Huami API clients (e.g. micw/hacking-mifit-api) use successfully without
 * this collision. `device_id` is likewise held stable across logins rather
 * than randomized, so we don't look like a new device registering every time
 * the cached token expires.
 */

import { createCipheriv, createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const AES_KEY = Buffer.from("xeNtBVqzDc6tuNTh");
const AES_IV = Buffer.from("MAAAYAAAAAAAAABg");
const REDIRECT = "https://s3-us-west-2.amazonaws.com/hm-registration/successsignin.html";

const AUTH_HOST = "api-user.zepp.com";
const DEFAULT_DATA_HOST = "api-mifit.zepp.com";

// The app identity we register the token under at step 2. Must NOT be
// "com.huami.midong" (the real Zepp app) -- see module docstring.
const CLIENT_APP_NAME = "com.xiaomi.hm.health";

const LOGIN_TIMEOUT_MS = 20_000;
const DEFAULT_APP_TTL_SECONDS = 2592000;
const EARLY_REFRESH_SECONDS = 3600;
const CACHE_DISABLED_VALUES = ["0", "off", "none"];

const STEP1_HEADERS = {
  "app_name": "com.huami.midong", "appname": "com.huami.midong",
  "cv": "151689_9.12.5", "v": "2.0", "appplatform": "android_phone",
  "vb": "202509151347", "vn": "9.12.5", "x-hm-ekv": "1",
  "user-agent": "Zepp/9.12.5 (Pixel 4; Android 12; Density/2.75)",
  "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
};

const STEP2_HEADERS = {
  "app_name": "com.huami.webapp", "appname": "com.huami.webapp",
  "origin": "https://user.zepp.com", "referer": "https://user.zepp.com/",
  "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) " +
                "Gecko/20100101 Firefox/133.0",
};

/** Login failed. Message is safe to surface; it never contains secrets. */
export class LoginError extends Error {
  constructor(message) {
    super(message);
    this.name = "LoginError";
  }
}

export class Credential {
  constructor({ appToken, userId, regionHost, countryCode, expiresAt, extra = {} }) {
    this.appToken = appToken;
    this.userId = userId;
    this.regionHost = regionHost;
    this.countryCode = countryCode;
    this.expiresAt = expiresAt;
    this.extra = extra;
  }

  get expired() {
    // Refresh an hour early rather than discover expiry mid-request.
    return nowSeconds() >= this.expiresAt - EARLY_REFRESH_SECONDS;
  }

  // On-disk keys stay snake_case so the Python and JS caches are interchangeable.
  toJson() {
    return {
      app_token: this.appToken, user_id: this.userId,
      region_host: this.regionHost, country_code: this.countryCode,
      expires_at: this.expiresAt,
    };
  }

  static fromJson(blob) {
    const required = ["app_token", "user_id", "region_host", "expires_at"];
    if (!isPlainObject(blob) || required.some((key) => !(key in blob))) {
      throw new TypeError("credential blob is missing a required key");
    }
    const expiresAt = Number(blob.expires_at);
    if (blob.expires_at === null || Number.isNaN(expiresAt)) {
      throw new TypeError("credential expires_at is not a number");
    }
    return new Credential({
      appToken: blob.app_token, userId: blob.user_id,
      regionHost: blob.region_host,
      countryCode: blob.country_code ?? "",
      expiresAt,
    });
  }
}

function nowSeconds() {
  return Date.now() / 1000;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Python's urllib.parse.quote_plus: only A-Z a-z 0-9 _ . - ~ stay literal and
 * spaces become '+'. encodeURIComponent additionally leaves ! ' ( ) * alone.
 */
function quotePlus(value) {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, "+");
}

function primitiveToString(value) {
  if (value === true) return "true";
  if (value === false) return "false";
  if (value === null || value === undefined) return "";
  return String(value);
}

/**
 * Form/query encoding byte-identical to `urlencode(..., doseq=True)` as httpx
 * applies it to `data=` and `params=`: array values repeat their key.
 */
export function urlencode(fields) {
  const pairs = [];
  for (const [key, value] of Object.entries(fields)) {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      pairs.push(`${quotePlus(key)}=${quotePlus(primitiveToString(item))}`);
    }
  }
  return pairs.join("&");
}

function buildPayload(email, password, country) {
  const body = urlencode({
    emailOrPhone: email, password,
    state: "REDIRECTION", client_id: "HuaMi",
    redirect_uri: REDIRECT,
    region: "us-west-2", token: ["access", "refresh"],
    country_code: country,
  });
  // createCipheriv pads with PKCS7 by default, matching pycryptodome pad().
  const cipher = createCipheriv("aes-128-cbc", AES_KEY, AES_IV);
  return Buffer.concat([cipher.update(body, "utf8"), cipher.final()]);
}

/**
 * Pick the regional CNAME for the data host out of the login response.
 *
 * The response carries a `domains` list mapping each logical host to its
 * regional alias, e.g. api-mifit.zepp.com -> api-mifit-us3.zepp.com.
 */
function regionHost(payload) {
  const domains = Array.isArray(payload.domains) ? payload.domains : [];
  for (const entry of domains) {
    if (!isPlainObject(entry) || entry.host !== DEFAULT_DATA_HOST) continue;
    const cnames = entry.cnames || [];
    if (cnames.length && typeof cnames[0] === "string") return cnames[0];
  }
  return DEFAULT_DATA_HOST;
}

function queryOf(location) {
  const withoutFragment = location.split("#")[0];
  const index = withoutFragment.indexOf("?");
  return new URLSearchParams(index === -1 ? "" : withoutFragment.slice(index + 1));
}

/** Python's repr() for the scalar values a login response can carry. */
function pyRepr(value) {
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "string") return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  return typeof value === "number" ? String(value) : JSON.stringify(value);
}

function rejectedCredentialsError(query) {
  const error = query.get("error") || "no access code returned";
  const attempts = query.get("attempts");
  const maximum = query.get("max_attempts") || "None";
  const detail = attempts ? ` (failed attempt ${attempts} of ${maximum})` : "";
  return new LoginError(
    `Zepp login rejected the credentials: ${error}${detail}. ` +
    "Check ZEPP_EMAIL and ZEPP_PASSWORD. This is not retried " +
    "automatically -- repeated failures lock the account.",
  );
}

/** Two-step password login. Exactly one attempt at each step. */
export async function login(email, password, country = "US") {
  const step1 = await fetch(`https://${AUTH_HOST}/v2/registrations/tokens`, {
    method: "POST",
    body: buildPayload(email, password, country),
    headers: STEP1_HEADERS, redirect: "manual",
    signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
  });
  const query = queryOf(step1.headers.get("location") || "");
  const accessCode = query.get("access");
  if (!accessCode) throw rejectedCredentialsError(query);

  // Step 2: exchange the one-time code for a long-lived app token.
  const step2 = await fetch(`https://${DEFAULT_DATA_HOST}/v2/client/login`, {
    method: "POST",
    headers: STEP2_HEADERS,
    signal: AbortSignal.timeout(LOGIN_TIMEOUT_MS),
    body: urlencode({
      code: accessCode, device_id: deviceId(),
      grant_type: "access_token", third_name: "huami",
      app_name: CLIENT_APP_NAME, country_code: country,
      device_model: "android_phone", app_version: "9.12.5",
      allow_registration: "false", lang: "en",
      dn: "api-mifit.zepp.com,api-user.zepp.com," +
          "api-watch.zepp.com,auth.zepp.com",
      source: "com.huami.watch.hmwatchmanager:9.12.5:151689",
    }),
  });
  let payload;
  try {
    payload = JSON.parse(await step2.text());
  } catch {
    throw new LoginError(
      `Token exchange returned HTTP ${step2.status} with a non-JSON body.`,
    );
  }
  if (!isPlainObject(payload)) payload = {};

  const tokenInfo = isPlainObject(payload.token_info) ? payload.token_info : {};
  const appToken = tokenInfo.app_token;
  if (!appToken) {
    throw new LoginError(
      `Token exchange returned HTTP ${step2.status} but no ` +
      `app_token (result=${pyRepr(payload.result)}).`,
    );
  }

  // app_ttl is the app_token's lifetime in seconds; observed at 2592000 (30
  // days). `ttl` is the longer-lived login_token and is not what we hold.
  const ttl = Math.trunc(Number(tokenInfo.app_ttl) || 0) || DEFAULT_APP_TTL_SECONDS;
  const regist = isPlainObject(payload.regist_info) ? payload.regist_info : {};

  return new Credential({
    appToken,
    userId: String(tokenInfo.user_id ?? ""),
    regionHost: regionHost(payload),
    countryCode: regist.country_code || country,
    expiresAt: nowSeconds() + ttl,
  });
}

// --------------------------------------------------------------------------
// Device identity
// --------------------------------------------------------------------------

export function deviceIdPath() {
  return path.join(path.dirname(cachePath()), "device_id");
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function writePrivate(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  fs.chmodSync(file, 0o600);
}

/**
 * A stable per-install device id, persisted next to the token cache.
 *
 * Not a secret, just an opaque identifier -- kept stable across logins so
 * a re-login (e.g. after the cached token expires or a 401) doesn't look
 * like a new device registering under the account. See the module
 * docstring for why that matters.
 */
export function deviceId() {
  if (!cacheEnabled()) return randomUUID();
  const file = deviceIdPath();
  if (isFile(file)) {
    const cached = fs.readFileSync(file, "utf8").trim();
    if (cached) return cached;
  }
  const newId = randomUUID();
  try {
    writePrivate(file, newId);
  } catch {
    // Falls back to a fresh id next call; not a secret, not fatal.
  }
  return newId;
}

// --------------------------------------------------------------------------
// Token cache
// --------------------------------------------------------------------------

function expandUser(file) {
  if (file === "~") return os.homedir();
  return file.startsWith("~/") ? path.join(os.homedir(), file.slice(2)) : file;
}

export function cachePath() {
  const override = process.env.ZEPP_TOKEN_CACHE;
  if (override) return expandUser(override);
  // Default is per account: one person's token must never be read by another's server.
  const email = (process.env.ZEPP_EMAIL || "").trim().toLowerCase();
  const account = createHash("sha256").update(email, "utf8").digest("hex").slice(0, 16);
  return path.join(os.homedir(), ".zepp-mcp", account, "token.json");
}

export function cacheEnabled() {
  return !CACHE_DISABLED_VALUES.includes((process.env.ZEPP_TOKEN_CACHE || "").toLowerCase());
}

export function loadCached() {
  if (!cacheEnabled()) return null;
  const file = cachePath();
  if (!isFile(file)) return null;
  let credential;
  try {
    credential = Credential.fromJson(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return null;
  }
  return credential.expired ? null : credential;
}

export function saveCached(credential) {
  if (!cacheEnabled()) return;
  try {
    writePrivate(cachePath(), JSON.stringify(credential.toJson(), null, 2));
  } catch {
    // A cache miss is recoverable; a crashed server is not.
  }
}

export function clearCached() {
  try {
    fs.rmSync(cachePath(), { force: true });
  } catch {
    // Nothing to clear, or not ours to clear.
  }
}

export function describeExpiry(credential) {
  const iso = new Date(credential.expiresAt * 1000).toISOString();
  return `${iso.slice(0, 19)}+00:00`;
}
