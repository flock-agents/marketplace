import { Button, ErrorCard, Page, RowList, Section, Skeleton, useTable } from "../flock/ui";
import { WORKOUT_TITLE, canonicalKind, type GoalGroup } from "../../server/db/constants";
import { GoalGrid } from "./GoalGrid";
import { MealPlanBlock } from "./MealPlanBlock";
import { PlanBlock } from "./PlanBlock";
import { SyncButton } from "./SyncButton";
import { WaterBlock } from "./WaterBlock";
import { localDate, nutritionText, shiftDay, todayLocal, whenText, type DashEvent } from "./shared";
import { useDayGoals } from "./useDayGoals";

/** The summary at the top: the day's numbers in focus against their goals, workout first, then diet, then the rest. */
const SUMMARY: GoalGroup[] = ["exercise", "diet", "activity", "sleep", "body"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dateLine = (day: string) => `${DAY_NAMES[new Date(`${day}T00:00:00Z`).getUTCDay()]}, ${whenText(day)}`;
const openExercises = () => { location.hash = "#/exercises"; };

/** A day, most actionable first: the workout and diet summary against the goals, water by the glass, the workout plan and the
 *  planned meals to tick off, then the detailed log of what was eaten and done. Today also shows tomorrow's plans. The tab names the day. */
export function DayPage({ which }: { which: "today" | "yesterday" }) {
  const today = todayLocal();
  const day = which === "today" ? today : shiftDay(today, -1);
  const goals = useDayGoals(day);
  // Stored times are UTC or local: a day either side, then keep the viewer's local day.
  const events = useTable<DashEvent>("events", { where: { "at[gte]": shiftDay(day, -1), "at[lt]": shiftDay(day, 2) }, sort: "at", limit: 200 });
  const dayEvents = events.rows.filter((e) => localDate(e.at) === day);
  const meals = dayEvents.filter((e) => canonicalKind(e.kind) === "Meal");
  const workouts = dayEvents.filter((e) => WORKOUT_TITLE.test(e.title));
  const water = goals.inGroup("water")[0];
  const allExercises = <Button variant="soft" size="sm" icon="dumbbell" onClick={openExercises}>All exercises</Button>;
  if (goals.error) return <Page subtitle={dateLine(day)} actions={<SyncButton />}><ErrorCard title="Couldn't load the day" message={goals.error} onRetry={goals.refetch} /></Page>;
  return (
    <Page subtitle={dateLine(day)} actions={<SyncButton />}>
      <Section title="Summary">
        {goals.loading ? <Skeleton variant="card" lines={3} /> : <GoalGrid lines={SUMMARY.flatMap((g) => goals.inGroup(g))} />}
        {goals.noTracker ? <p className="db-quiet db-hint">Connect a tracker (Zepp) to the coach to add steps, sleep and PAI automatically.</p> : null}
      </Section>
      {water ? <Section title="Water"><WaterBlock day={day} line={water} /></Section> : null}
      <Section title="Workout plan" actions={allExercises}>
        <PlanBlock day={day} />
      </Section>
      <Section title="Meal plan">
        <MealPlanBlock day={day} canEat />
      </Section>
      <Section title="Logged" emphasis="subtle">
        <h3 className="db-log-head">Food eaten</h3>
        <RowList rows={meals} loading={events.loading} title={(e) => e.title} meta={(e) => [whenText(e.at), nutritionText(e)].filter(Boolean).join(" · ")}
          empty={<p className="db-quiet">No meals logged yet.</p>} />
        <h3 className="db-log-head">Exercise done</h3>
        <RowList rows={workouts} loading={events.loading} title={(e) => e.title} meta={(e) => whenText(e.at)}
          empty={<p className="db-quiet">No workout logged yet.</p>} />
      </Section>
      {which === "today" ? (
        <Section title="Tomorrow" emphasis="subtle">
          <PlanBlock day={shiftDay(day, 1)} readOnly />
          <MealPlanBlock day={shiftDay(day, 1)} />
        </Section>
      ) : null}
    </Page>
  );
}
