import { describe, it, expect } from "bun:test";
import { findExercise } from "./library";
import { parseItems, planItems, shareText, type PlanRow } from "./plan";

const BASE = "https://example.test/a/fit/";

describe("findExercise", () => {
  it("names the library exercise a plan line means, plurals and spellings included", () => {
    const slug = (t: string) => findExercise(t)?.slug ?? null;
    expect(slug("goblet squats 3x12")).toBe("goblet-squat");
    expect(slug("Supported single-arm rows")).toBe("supported-single-arm-row");
    expect(slug("One arm dumbbell row")).toBe("supported-single-arm-row");
    expect(slug("Glute bridges")).toBe("glute-bridge");
    expect(slug("Side bridge 3x20s")).toBe("side-plank");
    expect(slug("Dead bugs")).toBe("dead-bug");
    expect(slug("bird dogs")).toBe("bird-dog");
    expect(slug("McGill curl-ups")).toBe("mcgill-curl-up");
    expect(slug("DB split squats")).toBe("split-squat");
    expect(slug("Floor press")).toBe("floor-press");
    expect(slug("Elliptical intervals")).toBe("elliptical");
    expect(slug("Pull-up")).toBe("pull-up");
    expect(slug("Pullups 4x3")).toBe("pull-up");
    expect(slug("Chin-ups")).toBe("chin-up");
    expect(slug("Neutral grip pull-ups")).toBe("neutral-grip-pull-up");
    expect(slug("Band-assisted pull-up")).toBe("band-assisted-pull-up");
    expect(slug("Assisted chin-ups")).toBe("band-assisted-pull-up");
    expect(slug("Negative pull-ups (5 s down)")).toBe("negative-pull-up");
    expect(slug("Chin-up negatives")).toBe("negative-pull-up");
    expect(slug("Scapular pull-ups")).toBe("scapular-pull-up");
    expect(slug("Dead hang 3x20s")).toBe("dead-hang");
    expect(slug("Bicep curl")).toBe("bicep-curl");
    expect(slug("DB curls")).toBe("bicep-curl");
    expect(slug("Hammer curls")).toBe("hammer-curl");
    expect(slug("Warm-up: cat-camel")).toBeNull();
  });
});

describe("plan", () => {
  const rows: PlanRow[] = [
    { id: "b", name: "Goblet squat", dose: "3x12", done: 1, position: 1 },
    { id: "a", name: "Elliptical", dose: "20 min", done: 0, position: 0 },
    { id: "c", name: "Cat-camel", dose: null, done: null, position: 2 },
  ];
  it("keeps plan order and links each exercise to its exact library entry", () => {
    const items = planItems(rows, BASE);
    expect(items.map((i) => [i.id, i.done])).toEqual([["a", false], ["b", true], ["c", false]]);
    expect(items[1].exercise).toEqual({ slug: "goblet-squat", name: "Goblet squat", link: `${BASE}#/exercises?ex=goblet-squat`, image: `${BASE}exercises/goblet-squat.gif` });
    expect(items[2].exercise).toBeNull();
  });
  it("shares the plan as numbered lines with linked names", () => {
    expect(shareText("2026-10-22", planItems(rows, BASE))).toBe([
      "Workout plan for 2026-10-22:",
      `1. [Elliptical](${BASE}#/exercises?ex=elliptical) — 20 min`,
      `2. [Goblet squat](${BASE}#/exercises?ex=goblet-squat) — 3x12`,
      "3. Cat-camel",
    ].join("\n"));
    expect(shareText("2026-10-22", [])).toBe("No workout plan set for 2026-10-22.");
  });
  it("accepts a whole day's items and refuses one without a name", () => {
    expect(parseItems({ items: [{ name: " Dead bug ", dose: "3x10/side", exercise: "Dead bug" }, { name: "Plank" }] })).toEqual([{ name: "Dead bug", dose: "3x10/side", exercise: "dead-bug" }, { name: "Plank", dose: null, exercise: null }]);
    expect(parseItems({ items: [{ dose: "3x10" }] })).toBeNull();
    expect(parseItems({})).toBeNull();
  });
});
