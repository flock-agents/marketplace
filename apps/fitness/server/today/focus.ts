// The goals in focus: an app setting the coach changes as the person's focus changes (PATCH /api/_app/settings {"focus": [...]}).
import type { SettingDecl } from "@flock/app-kit";
import { DAILY_GOALS, DEFAULT_FOCUS, FOCUS_SETTING } from "../db/constants";

const GOAL_LABELS = DAILY_GOALS.map((g) => g.label);

/** Why `value` cannot be the focus list, or null: it must name goals, each once. */
export function focusProblem(value: unknown): string | null {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) return "must be a list of goal labels";
  const unknown = value.filter((v) => !GOAL_LABELS.includes(v));
  if (unknown.length) return `names no goal: ${unknown.join(", ")} (goals: ${GOAL_LABELS.join(", ")})`;
  return new Set(value).size === value.length ? null : "names a goal twice";
}

export const focusSetting: SettingDecl = {
  key: FOCUS_SETTING, type: "json", default: [...DEFAULT_FOCUS], check: focusProblem,
  label: "Goals shown on the Today page; every other goal stays on the History page",
};
