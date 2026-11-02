import type { GoalLine } from "../../server/today/goals";
import { GoalRow } from "./GoalRow";

/** Goal cards, two across on a wide screen. */
export function GoalGrid({ lines }: { lines: GoalLine[] }) {
  return <div className="db-goals">{lines.map((l) => <GoalRow key={l.label} line={l} />)}</div>;
}
