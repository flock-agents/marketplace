import type { GoalGroup } from "../../server/db/constants";
import type { GoalLine } from "../../server/today/goals";
import { useLive } from "./useLive";

const GOAL_TABLES = ["metrics", "events", "_settings"] as const;   // _settings: the coach changed which goals are in focus

/** The day's goals in focus, as /api/today works them out, kept current as rows change. */
export function useDayGoals(day: string) {
  const { data, error, refetch } = useLive<{ goals: GoalLine[]; trackerData?: boolean }>(`today?date=${day}`, GOAL_TABLES);
  const focused = (data?.goals ?? []).filter((g) => g.focus);
  const inGroup = (group: GoalGroup) => focused.filter((g) => g.group === group);
  // trackerData false: no tracker numbers lately, so the page hints that one can be connected
  return { loading: !data && !error, error, refetch, inGroup, noTracker: data?.trackerData === false };
}
