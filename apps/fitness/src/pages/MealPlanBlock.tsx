import { useState } from "react";
import { Button, Progress, kitFetch } from "../flock/ui";
import { hasNumbers, nutritionLine, type MealPlanItem } from "../../server/meals/plan";
import { useLive } from "./useLive";

interface MealPlanView { items: MealPlanItem[]; planned: Parameters<typeof nutritionLine>[0] }
const PLAN_TABLES = ["meal_plan_items", "events"] as const;   // a logged meal ticks its planned one

/** The day's planned meals (the coach syncs them from the family meal plan, with this person's portions), each beside what was eaten for it. `canEat`: one tap logs a
 *  planned meal as eaten, with its numbers (or asks the coach to estimate them), so no nutrient is ever entered by hand. */
export function MealPlanBlock({ day, canEat = false }: { day: string; canEat?: boolean }) {
  const { data, refetch } = useLive<MealPlanView>(`meal-plan?date=${day}`, PLAN_TABLES);
  const [busy, setBusy] = useState<string | null>(null);
  const [asked, setAsked] = useState<string[]>([]);
  if (!data) return null;
  if (data.items.length === 0) return <p className="db-quiet">No meals planned yet: the coach brings them over from the family meal plan.</p>;
  const eat = async (it: MealPlanItem) => {
    setBusy(it.id);
    try {
      await kitFetch("meal-plan/eaten", { method: "POST", body: JSON.stringify({ date: day, id: it.id }) });
      if (!hasNumbers(it)) setAsked((a) => [...a, it.id]);
      await refetch();
    } finally { setBusy(null); }
  };
  const done = data.items.filter((i) => i.done).length;
  const planned = nutritionLine(data.planned);
  return (
    <div className="db-plan">
      <div className="db-plan-head">
        <span className="db-goal-label">{canEat ? "Meals" : "Planned meals"}</span>
        {canEat ? <span className="db-plan-count">{done} of {data.items.length} eaten</span> : null}
      </div>
      {canEat ? <Progress value={done} limit={data.items.length} showValue={false} /> : null}
      <ul className="db-plan-list">
        {data.items.map((it) => (
          <li key={it.id} className={it.done ? "db-plan-item db-meal-item is-done" : "db-plan-item db-meal-item"}>
            <span className="db-plan-name">
              {it.slot ? <span className="db-meal-slot">{it.slot}</span> : null}{it.name}
              {nutritionLine(it) ? <span className="db-meal-numbers">Planned: {nutritionLine(it)}</span> : null}
              {it.loggedAs ? <span className="db-meal-numbers">Ate: {it.loggedAs}{it.actual && nutritionLine(it.actual) ? ` · ${nutritionLine(it.actual)}` : ""}</span> : null}
            </span>
            {canEat ? <MealAction item={it} busy={busy === it.id} asked={asked.includes(it.id)} onEat={() => void eat(it)} /> : null}
          </li>
        ))}
      </ul>
      {planned ? <p className="db-quiet">Planned for the day: {planned}</p> : null}
    </div>
  );
}

function MealAction({ item, busy, asked, onEat }: { item: MealPlanItem; busy: boolean; asked: boolean; onEat: () => void }) {
  if (item.done) return <span className="db-plan-dose">Eaten</span>;
  if (asked) return <span className="db-plan-dose">Coach is logging it…</span>;
  return <Button variant="soft" size="sm" icon="check" loading={busy} onClick={onEat}>Eaten</Button>;
}
