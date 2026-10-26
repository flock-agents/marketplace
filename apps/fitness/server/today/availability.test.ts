import { describe, it, expect } from "bun:test";
import { availableGoals, dayGoals, hasTrackerData, recentLabels, type GoalReading } from "./goals";
import { dayOf } from "./routes";

const DAY = "2026-10-21";
const r = (label: string, value: number, created_at = "2026-10-21T03:00:00.000Z"): GoalReading => ({ label, value, created_at });
const CORE = ["Calories in", "Protein", "Fiber", "Water", "Workout", "Weight", "Waist"];
const available = (readings: GoalReading[]) => availableGoals(recentLabels(readings, DAY, dayOf));
const trackerData = (readings: GoalReading[]) => hasTrackerData(recentLabels(readings, DAY, dayOf));

describe("goal availability", () => {
  it("with no tracker: only the core goals, and the page hints to connect one", () => {
    const manual = [r("Weight", 72), r("Calorie target", 1800)];
    expect(available(manual)).toEqual(CORE);
    expect(trackerData(manual)).toBe(false);
  });
  it("with Zepp syncing sleep: activity, PAI and sleep goals join the core ones", () => {
    const zepp = [r("Steps", 4000), r("Calories burned", 300), r("PAI", 80), r("Sleep", 7.1), r("Weight", 72)];
    expect(available(zepp)).toEqual(["Calories in", "Protein", "Fiber", "Water", "Steps", "Calories burned", "Workout", "PAI", "Sleep", "Weight", "Waist"]);
    expect(trackerData(zepp)).toBe(true);
  });
  it("with Zepp but no sleep (watch off at night): no Sleep goal", () => {
    const zepp = [r("Steps", 4000), r("Calories burned", 300), r("PAI", 80)];
    expect(available(zepp)).not.toContain("Sleep");
    expect(available(zepp)).toContain("Steps");
  });
  it("a metric counts only with data in the last 7 days, and a hand-entered reading counts too", () => {
    expect(available([r("Sleep", 7, "2026-10-10T03:00:00.000Z")])).not.toContain("Sleep");
    expect(available([r("Sleep", 7, "2026-10-19T03:00:00.000Z")])).toContain("Sleep");
  });
  it("a goal in focus that is not available does not show", () => {
    const lines = dayGoals({ day: DAY, readings: [], events: [], dayOf, focus: ["PAI", "Water"], available: available([]) });
    expect(lines.map((l) => l.label)).toEqual(["Water", "Workout"]);
  });
});
