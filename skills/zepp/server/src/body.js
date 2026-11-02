// Normalises smart-scale body-composition readings (issue #7).
//
// The account behind this project's own captures never owned a real
// bio-impedance scale: `tests/fixtures/zepp/017_weight.json` carries two
// manual/HealthKit-linked records (`source: 2`, `thirdAppName: "Health"`)
// without fatRate/muscleRate/boneMass etc. -- and both have a `bmi` that does
// NOT reconcile with `weight`/`height` (record 1: reported 27.8 vs.
// 70 / 1.75**2 = 22.9). That inconsistency is the record itself, not a
// decoding bug; `bmi_consistent` flags it per record rather than silently
// trusting a number the API's own arithmetic contradicts.
//
// The fuller schema (`fatRate`, `bodyWaterRate`, `muscleRate`, `boneMass`,
// `metabolism`, `proteinRatio`, `visceralFat`, `bodyScore`, `impedance`) comes
// from a real Mi Body Composition Scale 2 capture documented by
// github.com/AlexxIT/SmartScaleConnect -- not from an account this project
// holds. See docs/api-findings.md. `weight`, `height` and `bmi` are verified
// by the same cross-check used there (bmi reproduces weight / (height/100)**2);
// everything else is exposed under `body_composition` with its provenance
// noted rather than asserted as fact. `muscleRate` keeps its ambiguous name:
// the source client itself does not know whether it is a percentage or an
// absolute mass.

import { isDict, isoFromTimestamp, pyFloat, pyGet, pyInt, pyOr, pyTruthy } from "./codes.js";

// summary key -> output key, for fields whose presence (not just decoding)
// is optional and scale/source-dependent. All are measurements where 0 is
// not a valid reading (nobody has 0% body fat or 0 kg of bone), so a zero or
// missing value is treated as "not measured" -- the same convention this
// project already uses for a zero step count.
const EXTRA_FIELDS = Object.freeze({
  fatRate: "body_fat_percent",
  bodyWaterRate: "body_water_percent",
  boneMass: "bone_mass_kg",
  metabolism: "basal_metabolism_kcal",
  muscleRate: "muscle_rate",
  muscleAge: "muscle_age",
  proteinRatio: "protein_percent",
  standBodyWeight: "ideal_weight_kg",
  visceralFat: "visceral_fat_rating",
  bodyScore: "body_score",
  bodyStyle: "body_style_code",
  bodyBalanceScore: "body_balance_score",
  oneFootMeasureTime: "one_foot_measure_time",
});

const BODY_COMPOSITION_NOTE = (
  "Field names come from a community-documented real-scale capture "
  + "(AlexxIT/SmartScaleConnect), not from this project's own verified "
  + "data -- see zepp_describe_schema known_gaps. weight_kg/height_cm/bmi "
  + "above are independently verified; these are not."
);

const INCONSISTENT_NOTE = (
  " This record's own weight/height/bmi do not reconcile with each "
  + "other, which is a signal the rest of this record's numbers may not "
  + "be trustworthy either."
);

function number(value) {
  return typeof value === "boolean" ? null : pyFloat(value);
}

function epoch(value) {
  const seconds = number(value);
  return pyTruthy(seconds) ? pyInt(seconds) : null;
}

/**
 * `impedance` (int) and `encryptImpedance` (string) carry the same value
 * where both are present (verified against the SmartScaleConnect capture:
 * 451 == "451"). Our own fixture only ever has the "encrypted" string, so it
 * is read as the fallback source rather than dropped as a duplicate --
 * "encrypt" is a misnomer, not a cipher we would need a key for.
 */
function impedanceOhms(summary) {
  return pyOr(number(pyGet(summary, "impedance")), number(pyGet(summary, "encryptImpedance")));
}

/** One `weightRecords` item -> a flat, snake_case reading. */
export function normalise(item) {
  const raw = pyGet(item, "summary");
  const summary = isDict(raw) ? raw : {};

  const generated = epoch(pyGet(item, "generatedTime"));
  const out = { date: generated ? isoFromTimestamp(generated, 0, "seconds") : null };

  const weight = number(pyGet(summary, "weight"));
  const height = number(pyGet(summary, "height"));
  const bmi = number(pyGet(summary, "bmi"));
  if (pyTruthy(weight)) out.weight_kg = weight;
  if (pyTruthy(height)) out.height_cm = height;
  if (pyTruthy(bmi)) {
    out.bmi = bmi;
    if (pyTruthy(weight) && pyTruthy(height)) {
      const expected = weight / (height / 100) ** 2;
      out.bmi_consistent = Math.abs(expected - bmi) < 0.15;
    }
  }

  const extra = {};
  for (const [src, key] of Object.entries(EXTRA_FIELDS)) {
    const value = number(pyGet(summary, src));
    if (pyTruthy(value)) extra[key] = value;
  }
  const impedance = impedanceOhms(summary);
  if (pyTruthy(impedance)) extra.impedance_ohms = impedance;

  if (pyTruthy(extra)) {
    let note = BODY_COMPOSITION_NOTE;
    if (out.bmi_consistent === false) note += INCONSISTENT_NOTE;
    out.body_composition = extra;
    out.body_composition_note = note;
  }

  const age = number(pyGet(summary, "age"));
  if (pyTruthy(age)) out.age_years = pyInt(age);

  return out;
}
