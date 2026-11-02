import { test } from "node:test";
import assert from "node:assert/strict";

import { normalise } from "../src/body.js";

test("a manual HealthKit record flags its inconsistent BMI", () => {
  const item = {
    generatedTime: "1793600100",
    summary: { weight: 70, height: 175, bmi: 27.8, source: 2, thirdAppName: "Health" },
  };
  assert.deepEqual(normalise(item), {
    date: "2026-11-02T06:15:00+00:00",
    weight_kg: 70,
    height_cm: 175,
    bmi: 27.8,
    bmi_consistent: false,
  });
});

test("a full scale reading exposes body composition with provenance", () => {
  const item = {
    generatedTime: 1793600100,
    summary: {
      weight: "70.0", height: 175, bmi: 22.9, age: 34.9,
      fatRate: 18.4, bodyWaterRate: 55.1, boneMass: 3.1, metabolism: 1612,
      muscleRate: 54.2, visceralFat: 0, bodyScore: "82", impedance: 0,
      encryptImpedance: "451",
    },
  };
  const out = normalise(item);
  assert.deepEqual(Object.keys(out), [
    "date", "weight_kg", "height_cm", "bmi", "bmi_consistent",
    "body_composition", "body_composition_note", "age_years",
  ]);
  assert.equal(out.bmi_consistent, true);
  assert.deepEqual(out.body_composition, {
    body_fat_percent: 18.4,
    body_water_percent: 55.1,
    bone_mass_kg: 3.1,
    basal_metabolism_kcal: 1612,
    muscle_rate: 54.2,
    body_score: 82,
    impedance_ohms: 451,
  });
  assert.match(out.body_composition_note, /^Field names come from/);
  assert.equal(out.body_composition_note.includes("do not reconcile"), false);
  assert.equal(out.age_years, 34);
});

test("inconsistent records with composition carry the extra warning", () => {
  const out = normalise({ summary: { weight: 70, height: 175, bmi: 27.8, fatRate: 20 } });
  assert.equal(out.date, null);
  assert.match(out.body_composition_note, /do not reconcile/);
});

test("zeros, booleans and junk are treated as not measured", () => {
  assert.deepEqual(normalise({ generatedTime: 0, summary: { weight: 0, bmi: true, fatRate: "x" } }),
    { date: null });
  assert.deepEqual(normalise({ summary: "not a dict" }), { date: null });
  assert.deepEqual(normalise({}), { date: null });
});
