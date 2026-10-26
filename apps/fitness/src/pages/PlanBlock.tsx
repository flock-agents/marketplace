import { Empty, Progress, useTable } from "../flock/ui";
import { planItems, type PlanRow } from "../../server/exercises/plan";

type PlanTableRow = PlanRow & { day: string };

/** The workout the coach set for the day: each exercise linked to its picture in the library, ticked off as it is done.
 *  `readOnly`: a day ahead, shown but not ticked. */
export function PlanBlock({ day, readOnly = false }: { day: string; readOnly?: boolean }) {
  const plan = useTable<PlanTableRow>("plan_items", { where: { day }, sort: "position", limit: 50 });
  const items = planItems(plan.rows, "");   // links and pictures relative to the app
  const done = items.filter((i) => i.done).length;
  if (!plan.loading && items.length === 0) {
    return readOnly
      ? <p className="db-quiet">No workout planned yet.</p>
      : <Empty title="No plan set for this day" hint="Ask the coach for the day's workout: it shows up here, each exercise linked to how it is done." object="globe" />;
  }
  return (
    <div className="db-plan">
      <div className="db-plan-head">
        <span className="db-goal-label">{readOnly ? "Workout plan" : "Exercises"}</span>
        {readOnly ? <span className="db-plan-count">{items.length} exercises</span> : <span className="db-plan-count">{done} of {items.length} done</span>}
      </div>
      {readOnly ? null : <Progress value={done} limit={Math.max(items.length, 1)} showValue={false} />}
      <ul className="db-plan-list">
        {items.map((it) => (
          <li key={it.id} className={it.done ? "db-plan-item is-done" : "db-plan-item"}>
            <input type="checkbox" checked={it.done} disabled={readOnly} aria-label={`${it.name} done`} onChange={(e) => void plan.update(it.id, { done: e.target.checked })} />
            {it.exercise ? <a href={it.exercise.link}><img className="db-plan-thumb" src={it.exercise.image} alt="" loading="lazy" /></a> : <span className="db-plan-thumb" />}
            <span className="db-plan-name">{it.exercise ? <a href={it.exercise.link}>{it.name}</a> : it.name}</span>
            {it.dose ? <span className="db-plan-dose">{it.dose}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
