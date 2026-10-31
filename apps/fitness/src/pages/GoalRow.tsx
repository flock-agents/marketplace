import { Progress, Value } from "../flock/ui";
import type { GoalLine, GoalStatus } from "../../server/today/goals";

const STATUS_LABELS: Record<GoalStatus, string> = { done: "Done", on_track: "On track", to_go: "To go", over: "Over", not_logged: "Nothing yet", no_target: "No target" };
const STATUS_TONES = { done: "success", on_track: "success", to_go: "warning", over: "danger", not_logged: "muted", no_target: "muted" } as const;

const amount = (value: number, unit: string) => `${value.toLocaleString("en-IN", { maximumFractionDigits: 1 })} ${unit}`;

/** "1,240 of 1,650 kcal" — the day's number against its target, as far as either is known. */
function progressText({ current, target, unit }: GoalLine): string {
  if (target === null) return current === null ? "Nothing logged yet" : amount(current, unit);
  return current === null ? `Target ${amount(target, unit)}` : `${current.toLocaleString("en-IN", { maximumFractionDigits: 1 })} of ${amount(target, unit)}`;
}

/** What is left to do, in words. */
function remainingText({ status, remaining, unit }: GoalLine): string | null {
  if (remaining === null) return "No target set";
  if (status === "over") return `${amount(remaining, unit)} over`;
  if (status === "on_track") return `${amount(remaining, unit)} left`;
  if (status === "to_go") return `${amount(remaining, unit)} to go`;
  if (status === "done") return "Target reached";
  return null;
}

export function GoalRow({ line }: { line: GoalLine }) {
  const rest = remainingText(line);
  // A reach goal never goes red for doing more than asked: its bar stops full. Food over its target does go red.
  const bar = line.aim === "reach" ? Math.min(line.current ?? 0, line.target ?? 0) : line.current ?? 0;
  return (
    <div className="db-goal">
      <div className="db-goal-head">
        <span className="db-goal-label">{line.label}</span>
        <Value kind="select" value={line.status} labels={STATUS_LABELS} tones={STATUS_TONES} />
      </div>
      {line.target !== null ? <Progress value={bar} limit={line.target} showValue={false} /> : null}
      <div className="db-goal-text">
        <span>{progressText(line)}</span>
        {rest ? <span className="db-goal-rest">{rest}</span> : null}
      </div>
    </div>
  );
}
