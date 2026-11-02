// Lookup tables for Zepp's numeric codes and sentinel values.
//
// Everything here is either verified against the fixture corpus or explicitly
// marked unverified. Nothing is guessed silently: a code we cannot prove is
// reported as unknown rather than given a plausible-sounding name, because the
// consumer is an LLM that will restate whatever we label as fact.
//
// The py* helpers at the bottom reproduce the Python built-ins the decoders
// relied on (float(), int(), round(), str(), truthiness, base64, isoformat)
// so the JSON output matches the original server.

// Sleep stage modes. VERIFIED against tests/fixtures/zepp/014: summing stage
// minutes per mode reproduces the summary's own lt/dp/wk/dt totals exactly on
// three separate nights.
//
// Note `dt` is REM. Implementations that report `dp + lt` as "total sleep" drop
// REM entirely -- 73, 53 and 96 minutes on the three verified nights.
export const SLEEP_STAGE_MODES = Object.freeze({
  4: "light",
  5: "deep",
  7: "awake",
  8: "rem",
});

export const SLEEP_SUMMARY_FIELDS = Object.freeze({
  lt: "light_minutes",
  dp: "deep_minutes",
  dt: "rem_minutes",
  wk: "awake_minutes",
  wc: "wake_count",
  ss: "sleep_score",
  st: "sleep_start_ts",
  ed: "sleep_end_ts",
  rhr: "resting_heart_rate",
  is: "fall_asleep_minutes",
});

// Sport type codes, all confirmed by the account owner against the Zepp app
// on 2026-08-16. The payload itself carries no human-readable sport name, so
// this map cannot be derived from the data alone. See codes.py for the
// per-code evidence (pace, pb keys, field signatures).
//
// Codes outside this map are reported as unknown_sport_<code> rather than
// guessed. A fabricated sport name in front of the model becomes a fact.
export const SPORT_CODES = Object.freeze({
  1: "outdoor_running",
  8: "walking",
  9: "outdoor_cycling",
  14: "pool_swimming",
  16: "free_training",
  18: "football",
  21: "rope_skipping",
  22: "hiking",
  52: "strength_training",
});

export function sportName(code) {
  const number = pyInt(code);
  if (number === null) return `unknown_sport_${pyStr(code)}`;
  return lookup(SPORT_CODES, number) ?? `unknown_sport_${pyStr(code)}`;
}

// Sentinels. Zepp does not use a single not-applicable marker; it uses a
// different one per field family, and several are plausible readings in their
// own units. -20000 rendered as an altitude in metres looks like data.
export const SENTINELS = Object.freeze({
  altitude: [-20000.0, -1.0],
  angle: [-361.0],
  elevation: [-100.0, -1.0],
  // -274 C is below absolute zero: it is the "no thermometer reading"
  // marker. Only the pool swims carry a real temperature, because the
  // watch is reading water.
  temperature: [-274.0, -273.0, -1.0],
  // SpO2 uses TWO markers -- -1 on most activities, 0 on the hikes. A
  // blood oxygen saturation of 0% is not a reading.
  percentage: [0.0, -1.0],
  // Cadence / stroke rate, reported in `avg_frequency`. -60 is a real marker
  // seen on hiking activities; a negative frequency is not a measurement.
  frequency: [0.0, -1.0, -60.0],
  // A pace of 0 s/m is infinite speed. `min_pace` reports 0 when the watch
  // did not establish a fastest split.
  pace: [0.0, -1.0],
  // Gait ratios read 0 when unmeasured.
  ratio: [0.0, -1.0],
  // Step counts. Football records 0 steps across 79 minutes of play, which
  // is the watch declining to count them in that sport mode.
  count: [0.0, -1.0],
  // RTPC. Unconfirmed meaning -- see RTPC_FIELDS in workouts.js.
  rtpc: [21.0, -1.0],
  default: [-1.0],
});

// Per-minute heart rate byte stream (`data_hr`). 254 (0xFE) and 255 dominate
// unworn stretches; 0 means no reading, not a stopped heart.
export const HR_BYTE_SENTINELS = new Set([0, 254, 255]);

export function isSentinel(value, family = "default") {
  const markers = Object.hasOwn(SENTINELS, family) ? SENTINELS[family] : SENTINELS.default;
  return markers.includes(value);
}

/** Return the number, or null when it is that field's not-applicable marker. */
export function clean(value, family = "default") {
  const number = pyFloat(value);
  if (number === null) return null;
  return isSentinel(number, family) ? null : number;
}

// Training Effect is reported at ten times its displayed value: a workout the
// Zepp app shows as 3.2 arrives as `te: 32`, and 0.1 as `anaerobic_te: 1`.
// The bands are an interpretation of the number, not a measurement, so they
// are emitted under their own key rather than replacing the value.
export const TRAINING_EFFECT_SCALE = 0.1;

const TE_BANDS = [
  [1.0, "no effect"],
  [2.0, "minor"],
  [3.0, "maintaining"],
  [4.0, "improving"],
  [5.0, "highly improving"],
];

/** Qualitative band for a Training Effect score on the 0.0-5.0 scale. */
export function trainingEffectBand(value) {
  for (const [upper, label] of TE_BANDS) {
    if (value < upper) return label;
  }
  return "overreaching";
}

// --------------------------------------------------------------------------
// Python built-in equivalents
// --------------------------------------------------------------------------

/** Look up a Python dict keyed by int in a JS object. */
export function lookup(table, key) {
  if (typeof key !== "number" || !Number.isInteger(key)) return undefined;
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

// Python's str.isspace() set: JS \s minus U+FEFF, plus \x1c-\x1f and \x85.
const PY_SPACE = "[\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const LEADING_SPACE = new RegExp(`^${PY_SPACE}+`);
const TRAILING_SPACE = new RegExp(`${PY_SPACE}+$`);

/** str.strip() with no arguments. */
export function pyStrip(text) {
  return text.replace(LEADING_SPACE, "").replace(TRAILING_SPACE, "");
}

const DIGITS = "\\d(?:_?\\d)*";
const INT_LITERAL = new RegExp(`^[+-]?${DIGITS}$`);
const FLOAT_LITERAL = new RegExp(
  `^[+-]?(?:(?:${DIGITS}\\.(?:${DIGITS})?|\\.${DIGITS}|${DIGITS})(?:[eE][+-]?${DIGITS})?|inf|infinity|nan)$`,
  "i",
);

/** float(value), or null where Python raises TypeError/ValueError. */
export function pyFloat(value) {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value !== "string") return null;
  const text = pyStrip(value);
  if (!FLOAT_LITERAL.test(text)) return null;
  const lower = text.toLowerCase().replace(/^\+/, "");
  if (lower === "inf" || lower === "infinity") return Infinity;
  if (lower === "-inf" || lower === "-infinity") return -Infinity;
  if (lower.endsWith("nan")) return NaN;
  return Number(text.replaceAll("_", ""));
}

/**
 * int(value), or null where Python raises TypeError/ValueError.
 * int() of an infinite float raises OverflowError in Python, which the
 * original never caught, so it is thrown here too.
 */
export function pyInt(value) {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") {
    if (Number.isNaN(value)) return null;
    if (!Number.isFinite(value)) throw new RangeError("cannot convert float infinity to integer");
    return Math.trunc(value) + 0;
  }
  if (typeof value !== "string") return null;
  const text = pyStrip(value);
  return INT_LITERAL.test(text) ? Number(text.replaceAll("_", "")) : null;
}

/** str(value) for the scalar types Zepp payloads carry. */
export function pyStr(value) {
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "nan";
    if (!Number.isFinite(value)) return value > 0 ? "inf" : "-inf";
  }
  return String(value);
}

/** Python truthiness: empty containers and NaN differ from JS. */
export function pyTruthy(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value instanceof Set || value instanceof Map) return value.size > 0;
  if (typeof value === "number") return value !== 0;
  if (value !== null && typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

/** `value or fallback`. */
export function pyOr(value, fallback) {
  return pyTruthy(value) ? value : fallback;
}

/** dict.get(key) on a parsed JSON object; null when absent or not a dict. */
export function pyGet(obj, key, fallback = null) {
  if (!isDict(obj) || !Object.hasOwn(obj, key)) return fallback;
  return obj[key];
}

export function isDict(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function doubleParts(value) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const exponentBits = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  if (exponentBits === 0) return { mantissa: fraction, exponent: -1074 };
  return { mantissa: fraction | (1n << 52n), exponent: exponentBits - 1075 };
}

/**
 * round(value, ndigits) for a float: rounds the exact binary value, with
 * exact ties going to even -- so round(2.675, 2) is 2.67 and round(0.125, 2)
 * is 0.12, unlike toFixed().
 */
export function pyRound(value, ndigits) {
  if (!Number.isFinite(value) || value === 0) return value;
  const { mantissa, exponent } = doubleParts(Math.abs(value));
  if (exponent >= 0) return value;
  const scaled = mantissa * 10n ** BigInt(ndigits);
  const denominator = 1n << BigInt(-exponent);
  let quotient = scaled / denominator;
  const twiceRemainder = 2n * (scaled % denominator);
  if (twiceRemainder > denominator || (twiceRemainder === denominator && quotient % 2n === 1n)) {
    quotient += 1n;
  }
  const sign = value < 0 ? "-" : "";
  return Number(`${sign}${quotient}e-${ndigits}`);
}

const B64_VALUES = new Map(
  [..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"].map((c, i) => [c, i]),
);

/**
 * base64.b64decode(text) in its default non-validating mode: characters
 * outside the alphabet are skipped, decoding stops at the first complete
 * padding, and incomplete input throws like binascii.Error.
 */
export function pyB64decode(text) {
  if (typeof text !== "string") throw new TypeError("argument should be a bytes-like object or ASCII string");
  if (/[^\x00-\x7f]/.test(text)) throw new RangeError("string argument should contain only ASCII characters");
  const out = [];
  let quadPos = 0;
  let pads = 0;
  let leftChar = 0;
  for (const ch of text) {
    if (ch === "=") {
      if (quadPos >= 2 && quadPos + ++pads >= 4) return Buffer.from(out);
      continue;
    }
    const sextet = B64_VALUES.get(ch);
    if (sextet === undefined) continue;
    pads = 0;
    if (quadPos === 0) {
      leftChar = sextet;
    } else {
      out.push(((leftChar << (2 * quadPos)) | (sextet >> (6 - 2 * quadPos))) & 0xff);
      leftChar = sextet & ((1 << (6 - 2 * quadPos)) - 1);
    }
    quadPos = (quadPos + 1) % 4;
  }
  if (quadPos !== 0) throw new RangeError("Incorrect padding");
  return Buffer.from(out);
}

const UTC_FORMAT_FIELDS = ["year", "month", "day", "hour", "minute", "second"];
const zoneFormatters = new Map();

function zoneFormatter(timeZone) {
  if (!zoneFormatters.has(timeZone)) {
    zoneFormatters.set(timeZone, new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric", era: "short",
    }));
  }
  return zoneFormatters.get(timeZone);
}

/** True when `name` is an IANA zone that both Intl and zoneinfo accept. */
export function isValidTimeZone(name) {
  // zoneinfo keys are path-like; Intl also takes "+05:30"-style offsets,
  // which zoneinfo rejects.
  if (!/^[A-Za-z0-9_][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+)*$/.test(name)) return false;
  try {
    zoneFormatter(name);
    return true;
  } catch {
    return false;
  }
}

/** UTC offset in seconds of an IANA zone at epoch `seconds`. */
export function zoneOffsetSeconds(timeZone, seconds) {
  const parts = Object.fromEntries(
    zoneFormatter(timeZone).formatToParts(new Date(seconds * 1000)).map((p) => [p.type, p.value]),
  );
  const [year, month, day, hour, minute, second] = UTC_FORMAT_FIELDS.map((f) => Number(parts[f]));
  const fullYear = parts.era === "BC" ? 1 - year : year;
  const date = new Date(0);
  date.setUTCFullYear(fullYear, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return Math.round(date.getTime() / 1000 - Math.floor(seconds));
}

const pad = (n, width = 2) => String(n).padStart(width, "0");

function formatOffset(offsetSeconds) {
  const sign = offsetSeconds < 0 ? "-" : "+";
  const abs = Math.abs(offsetSeconds);
  const text = `${sign}${pad(Math.floor(abs / 3600))}:${pad(Math.floor((abs % 3600) / 60))}`;
  return abs % 60 ? `${text}:${pad(abs % 60)}` : text;
}

/**
 * datetime.fromtimestamp(seconds, tz).isoformat(timespec=...).
 * `tz` is a fixed offset in seconds (dt.timezone) or an IANA zone name
 * (ZoneInfo); "UTC" or 0 for dt.UTC. Timestamps are whole seconds here.
 */
export function isoFromTimestamp(seconds, tz = 0, timespec = "seconds") {
  const whole = Math.floor(seconds);
  const offset = typeof tz === "number" ? tz : zoneOffsetSeconds(tz, whole);
  const local = new Date((whole + offset) * 1000);
  const year = local.getUTCFullYear();
  if (year < 1 || year > 9999) throw new RangeError(`year ${year} is out of range`);
  const date = `${pad(year, 4)}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
  let time = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
  if (timespec === "seconds") time += `:${pad(local.getUTCSeconds())}`;
  return `${date}T${time}${formatOffset(offset)}`;
}
