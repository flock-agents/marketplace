// Who the dashboard is for: the person's name, their clock and the note under the exercise library. Set by the coach at
// setup (PATCH /api/_app/settings) from what the owner told it; nothing about a person is written in the code.
import type { SettingDecl } from "@flock/app-kit";

import { EXERCISES_NOTE_SETTING, PERSON_SETTING, TIMEZONE_SETTING } from "./keys";

export { EXERCISES_NOTE_SETTING, PERSON_SETTING, TIMEZONE_SETTING };

/** Why `value` is not a usable IANA time zone, or null. Empty means "the server's own zone". */
export function timezoneProblem(value: unknown): string | null {
  if (value === "") return null;
  try { new Intl.DateTimeFormat("en", { timeZone: String(value) }); return null; }
  catch { return "must be an IANA time zone such as Europe/London or Asia/Kolkata"; }
}

export const profileSettings: SettingDecl[] = [
  { key: PERSON_SETTING, type: "string", default: "", label: "The name of the person this dashboard is for, as the coach's messages say it" },
  { key: TIMEZONE_SETTING, type: "string", default: "", check: timezoneProblem, label: "The person's time zone (IANA, e.g. Europe/London): their days start and end on this clock" },
  { key: EXERCISES_NOTE_SETTING, type: "string", default: "How each move is done", label: "The line under the Exercises page title (e.g. what the moves are chosen for)" },
];

/** The person as the coach's messages name them: their name, else "The person". */
export const personName = (name: string | null | undefined): string => name?.trim() || "The person";
