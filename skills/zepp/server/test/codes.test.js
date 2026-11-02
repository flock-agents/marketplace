import { test } from "node:test";
import assert from "node:assert/strict";

import {
  HR_BYTE_SENTINELS, SENTINELS, SLEEP_STAGE_MODES, SLEEP_SUMMARY_FIELDS, SPORT_CODES,
  TRAINING_EFFECT_SCALE, clean, isSentinel, isValidTimeZone, isoFromTimestamp,
  pyB64decode, pyFloat, pyInt, pyOr, pyRound, pyStr, pyStrip, pyTruthy, sportName,
  trainingEffectBand, zoneOffsetSeconds,
} from "../src/codes.js";

test("tables carry the verified codes", () => {
  assert.equal(SLEEP_STAGE_MODES[8], "rem");
  assert.equal(SLEEP_SUMMARY_FIELDS.dt, "rem_minutes");
  assert.equal(SPORT_CODES[52], "strength_training");
  assert.deepEqual(Object.keys(SPORT_CODES), ["1", "8", "9", "14", "16", "18", "21", "22", "52"]);
  assert.deepEqual([...HR_BYTE_SENTINELS].sort((a, b) => a - b), [0, 254, 255]);
  assert.equal(TRAINING_EFFECT_SCALE, 0.1);
  assert.deepEqual(SENTINELS.temperature, [-274, -273, -1]);
});

test("sportName maps known codes and refuses to guess the rest", () => {
  assert.equal(sportName(14), "pool_swimming");
  assert.equal(sportName("9"), "outdoor_cycling");
  assert.equal(sportName(" 21 "), "rope_skipping");
  assert.equal(sportName(14.7), "pool_swimming");
  assert.equal(sportName(99), "unknown_sport_99");
  assert.equal(sportName("14.0"), "unknown_sport_14.0");
  assert.equal(sportName(null), "unknown_sport_None");
  assert.equal(sportName("abc"), "unknown_sport_abc");
  assert.equal(sportName(true), "outdoor_running");
  assert.throws(() => sportName(Infinity), RangeError);
});

test("isSentinel uses the field family, defaulting to -1 only", () => {
  assert.equal(isSentinel(-20000, "altitude"), true);
  assert.equal(isSentinel(-20000), false);
  assert.equal(isSentinel(-1), true);
  assert.equal(isSentinel(-274, "temperature"), true);
  assert.equal(isSentinel(-60, "frequency"), true);
  assert.equal(isSentinel(21, "rtpc"), true);
  assert.equal(isSentinel(-0, "pace"), true);
  assert.equal(isSentinel(5, "no-such-family"), false);
  assert.equal(isSentinel(-1, "no-such-family"), true);
});

test("clean strips markers and coerces like float()", () => {
  assert.equal(clean("-1"), null);
  assert.equal(clean("756.0"), 756);
  assert.equal(clean(" 29.5 "), 29.5);
  assert.equal(clean(0, "count"), null);
  assert.equal(clean(0), 0);
  assert.equal(clean(""), null);
  assert.equal(clean(null), null);
  assert.equal(clean([1]), null);
  assert.equal(clean("1_000"), 1000);
  assert.equal(clean(true), 1);
  assert.equal(clean(-274, "temperature"), null);
});

test("trainingEffectBand follows the Firstbeat bands", () => {
  assert.equal(trainingEffectBand(0.1), "no effect");
  assert.equal(trainingEffectBand(1.0), "minor");
  assert.equal(trainingEffectBand(3.2), "improving");
  assert.equal(trainingEffectBand(4.99), "highly improving");
  assert.equal(trainingEffectBand(5.0), "overreaching");
});

test("pyFloat and pyInt accept exactly what Python accepts", () => {
  assert.equal(pyFloat("1e3"), 1000);
  assert.equal(pyFloat(".5"), 0.5);
  assert.equal(pyFloat("5."), 5);
  assert.equal(pyFloat("-inf"), -Infinity);
  assert.ok(Number.isNaN(pyFloat("nan")));
  assert.equal(pyFloat("1__0"), null);
  assert.equal(pyFloat("0x10"), null);
  assert.equal(pyFloat("﻿1"), null);
  assert.equal(pyInt("007"), 7);
  assert.equal(pyInt("1.5"), null);
  assert.equal(pyInt(-2.9), -2);
  assert.equal(pyInt(NaN), null);
  assert.equal(pyInt(null), null);
});

test("pyStr, pyStrip, pyTruthy and pyOr follow Python semantics", () => {
  assert.equal(pyStr(null), "None");
  assert.equal(pyStr(false), "False");
  assert.equal(pyStr(42), "42");
  assert.equal(pyStrip("\x1c 12 \n"), "12");
  assert.equal(pyStrip("﻿1"), "﻿1");
  assert.equal(pyTruthy({}), false);
  assert.equal(pyTruthy([]), false);
  assert.equal(pyTruthy(NaN), true);
  assert.equal(pyTruthy(""), false);
  assert.equal(pyOr(0, null), null);
  assert.deepEqual(pyOr({}, []), []);
});

test("pyRound rounds the exact binary value, ties to even", () => {
  assert.equal(pyRound(2.675, 2), 2.67);
  assert.equal(pyRound(0.125, 2), 0.12);
  assert.equal(pyRound(0.375, 2), 0.38);
  assert.equal(pyRound(2.5, 0), 2);
  assert.equal(pyRound(3.5, 0), 4);
  assert.equal(pyRound(32 * 0.1, 1), 3.2);
  assert.equal(pyRound(-1.005, 2), -1);
  assert.equal(pyRound(279.61, 2), 279.61);
  assert.equal(pyRound(1 / 3, 3), 0.333);
  assert.equal(pyRound(12345678, 2), 12345678);
  assert.equal(pyRound(Infinity, 2), Infinity);
});

test("pyB64decode mirrors binascii's lenient decoding", () => {
  assert.equal(pyB64decode("QUJD").toString(), "ABC");
  assert.equal(pyB64decode("QQ==").toString(), "A");
  assert.equal(pyB64decode("QU\nJD").toString(), "ABC");
  assert.equal(pyB64decode("QQ==QUJD").toString(), "A");
  assert.equal(pyB64decode("QUJD====").toString(), "ABC");
  assert.equal(pyB64decode("").length, 0);
  assert.throws(() => pyB64decode("QQ"), RangeError);
  assert.throws(() => pyB64decode("QQ="), RangeError);
  assert.throws(() => pyB64decode("QUJDR"), RangeError);
  assert.throws(() => pyB64decode("é"), RangeError);
  assert.throws(() => pyB64decode(5), TypeError);
});

test("isoFromTimestamp matches datetime.isoformat()", () => {
  const ts = 1793600100; // 2026-11-02T06:15:00Z
  assert.equal(isoFromTimestamp(ts), "2026-11-02T06:15:00+00:00");
  assert.equal(isoFromTimestamp(ts, 19800), "2026-11-02T11:45:00+05:30");
  assert.equal(isoFromTimestamp(ts, 19800, "minutes"), "2026-11-02T11:45+05:30");
  assert.equal(isoFromTimestamp(ts, -18000), "2026-11-02T01:15:00-05:00");
  assert.equal(isoFromTimestamp(ts, 3661), "2026-11-02T07:16:01+01:01:01");
  assert.equal(isoFromTimestamp(ts, "Asia/Kolkata"), "2026-11-02T11:45:00+05:30");
  assert.equal(isoFromTimestamp(ts, "America/New_York"), "2026-11-02T01:15:00-05:00");
  assert.equal(isoFromTimestamp(1783000000, "America/New_York"), "2026-07-02T09:46:40-04:00");
  assert.equal(isoFromTimestamp(1, 0, "minutes"), "1970-01-01T00:00+00:00");
});

test("zone helpers accept IANA names and reject offsets/garbage", () => {
  assert.equal(isValidTimeZone("Asia/Kolkata"), true);
  assert.equal(isValidTimeZone("UTC"), true);
  assert.equal(isValidTimeZone("Etc/GMT-5"), true);
  assert.equal(isValidTimeZone("Mars/Olympus"), false);
  assert.equal(isValidTimeZone("+05:30"), false);
  assert.equal(isValidTimeZone("../etc/passwd"), false);
  assert.equal(zoneOffsetSeconds("Asia/Kolkata", 0), 19800);
});
