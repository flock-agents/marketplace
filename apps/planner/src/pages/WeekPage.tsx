import "./week.css";
import { useEffect, useState } from "react";
import { Button, Confirm, ErrorCard, Page, Schedule, Skeleton, kitFetch, scheduleAddKey, useTable, useToast, useToday, label } from "../flock/ui";
import { MealEditor } from "./MealEditor";
import { SLOTS, addDays, shortDate, weekday, type Cart, type Meal } from "./shared";
import { combineReadiness, mealTimeLabel, readinessOf, readinessText, rowsByMeal, type GroceryV2, type MealV2, type Readiness } from "./shopping";
import { mealsReadiness } from "./shoppingApi";
import { MealReadinessPanel, ReadinessBadge } from "./MealReadiness";
import { groupMeals, newDish, otherDishes, slotKey, type MealSlot } from "./slots";

/** What the editor is for, and `at`: where it opens in the week (under the meal's line, or under the "+ Add" that was pressed). */
type Target = { kind: "add"; date: string; slot?: string; at: string } | { kind: "edit"; meal: Meal; at: string };

const SR = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" } as const;
/** The meal still ahead: by the clock for today, breakfast for any other day. */
const nextSlot = (date: string, now: string): string => {
  if (date !== now) return SLOTS[0];
  const h = new Date().getHours();
  return SLOTS[h < 10 ? 0 : h < 15 ? Math.min(1, SLOTS.length - 1) : SLOTS.length - 1];
};

/** "Add lunch on Mon Oct 12", or "Add to lunch on Mon Oct 12" when the meal already has dishes. */
const addTitle = (t: { date: string; slot?: string }, week: Meal[]): string => {
  const when = `on ${weekday(t.date)} ${shortDate(t.date)}`;
  if (!t.slot) return `Add a meal ${when}`;
  const has = week.some((m) => m.date === t.date && m.slot === t.slot);
  return `Add ${has ? "to " : ""}${t.slot.toLowerCase()} ${when}`;
};

/** A meal's dishes on one line ("Rice · Sambar · Bhindi"), each its own button that opens that dish. They wrap on a phone. */
function Dishes({ line, open, selected }: { line: MealSlot<Meal>; open: (m: Meal) => void; selected?: string }) {
  return (
    <span className="pl-dishes">
      {line.dishes.map((m, i) => (
        <span key={m.id} className="pl-dishw">
          <button type="button" className="pl-dish" aria-current={m.id === selected ? "true" : undefined}
            aria-label={`${m.dish}, ${line.slot.toLowerCase()} on ${weekday(m.date)} ${shortDate(m.date)}`} onClick={() => open(m)}>{m.dish}</button>
          {i < line.dishes.length - 1 ? <span className="pl-sep" aria-hidden="true">·</span> : null}
        </span>
      ))}
    </span>
  );
}

const READINESS_POLL_MS = 60_000;   // an order deadline can pass while the page sits open

/** The server's readiness per meal id, refetched when the meals or their groceries/carts change, and each minute. */
function useServerReadiness(week: Meal[], dataKey: string): Record<string, Readiness> {
  const [statuses, setStatuses] = useState<Record<string, Readiness>>({});
  const mealKey = week.map((m) => `${m.id}${m.date}${(m as MealV2).time ?? ""}`).join();
  useEffect(() => {
    if (!week.length) return;
    let live = true;
    const load = () => mealsReadiness(week.map((m) => m.id)).then((r) => { if (live) setStatuses(r.statuses); }).catch(() => { /* local rows stand in */ });
    void load();
    const timer = setInterval(load, READINESS_POLL_MS);
    return () => { live = false; clearInterval(timer); };
  }, [mealKey, dataKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return statuses;
}

export function WeekPage({ onSelect, onOpenGroceries }: {
  onSelect: (row: { table: string; id: string; label: string } | null) => void;
  /** A meal's "Need …" / "On … list" chip opens those items on Groceries. */
  onOpenGroceries?: (groceryIds: string[]) => void;
}) {
  const [shift, setShift] = useState(0);   // 7-day steps away from today
  const [target, setTarget] = useState<Target | null>(null);
  const [asking, setAsking] = useState(false);
  const toast = useToast();
  const now = useToday();
  // The Schedule starts at today, so the days already gone do not push today down.
  const from = addDays(now, shift * 7);
  const end = addDays(from, 6);
  const meals = useTable<Meal>("meals", { where: { "date[gte]": from, "date[lte]": end }, limit: 500, sort: "date" });
  const week = meals.rows;
  const lines = groupMeals(week);   // one line per date and slot, with every dish in it
  const groceries = useTable<GroceryV2>("groceries", { limit: 1000 });
  const carts = useTable<Cart>("carts", { limit: 200 });
  const cartsById = new Map(carts.rows.map((c) => [c.id, c]));
  const byMeal = rowsByMeal(groceries.rows);
  const rowsOf = (line: MealSlot<Meal>) => line.dishes.flatMap((d) => byMeal.get(d.id) ?? []);
  const server = useServerReadiness(week, `${groceries.rows.map((r) => `${r.id}${r.status}${r.cart_id}`).join()}|${carts.rows.map((c) => `${c.id}${c.status}`).join()}`);
  // The server's rule wins (it knows the order deadline); the local rows only stand in until it answers.
  const readinessOfLine = (line: MealSlot<Meal>): Readiness => line.dishes.every((d) => server[d.id])
    ? combineReadiness(line.dishes.map((d) => server[d.id]))
    : readinessOf(rowsOf(line), cartsById, now);

  const close = () => { setTarget(null); setAsking(false); onSelect(null); };
  const open = (m: Meal) => { setTarget({ kind: "edit", meal: m, at: slotKey(m) }); onSelect({ table: "meals", id: m.id, label: `${m.dish} · ${weekday(m.date)} ${m.slot.toLowerCase()}` }); };
  const save = async (v: { dish: string; recipe_id: string | null; slot?: string; time: string | null; note: string | null }) => {
    if (target?.kind === "add") await meals.create({ ...newDish({ date: target.date, slot: v.slot ?? target.slot ?? SLOTS[0] }, v), note: v.note });
    else if (target?.kind === "edit") await meals.update(target.meal.id, { dish: v.dish, recipe_id: v.recipe_id, time: v.time, note: v.note } as Partial<Meal>);
    close();
  };
  const remove = async () => {
    const meal = target?.kind === "edit" ? target.meal : null;
    let changeId: string | undefined;
    try { if (meal) changeId = await meals.remove(meal.id); } catch { /* useTable already toasted and rolled back */ }
    finally { close(); }
    if (meal && changeId) {
      toast.show({
        message: `Removed ${meal.dish}`, tone: "success",
        action: { label: "Undo", onClick: () => { void kitFetch(`_data/_changes/${changeId}/undo`, { method: "POST" }).catch(() => toast.show({ message: "Couldn't undo", tone: "danger" })); } },
      });
    }
  };

  return (
    <Page title={shift === 0 ? label("title.week", "This week's meals") : `From ${shortDate(from)}`}>
      <div className="pl-nav">
        <Button variant="ghost" size="sm" icon="chevron-left" onClick={() => setShift(shift - 1)}><span style={SR}>Previous 7 days</span></Button>
        <Button variant="ghost" size="sm" onClick={() => setShift(0)}>{shortDate(from)} – {shortDate(end)}</Button>
        <Button variant="ghost" size="sm" icon="chevron-right" onClick={() => setShift(shift + 1)}><span style={SR}>Next 7 days</span></Button>
      </div>
      {meals.error ? <ErrorCard title="Couldn't load this week" message={meals.error} onRetry={meals.refetch} />
        : meals.loading && week.length === 0 ? <Skeleton variant="card" lines={6} />
        : <Schedule
          key={from} rows={lines} from={from} days={7} today={now} showEarlier={end < now}
          slots={SLOTS} date={(g) => g.date} slot={(g) => g.slot}
          title={(g) => <Dishes line={g} open={open} selected={target?.kind === "edit" ? target.meal.id : undefined} />}
          secondary={(g) => (
            <span className="pl-when">
              <span>{mealTimeLabel(g.dishes[0] as MealV2)}</span>
              <ReadinessBadge value={readinessText(readinessOfLine(g), rowsOf(g), cartsById, now)} onOpen={onOpenGroceries} />
              {g.dishes.map((m) => (m.note ? <span key={m.id}>{m.note}</span> : null))}
            </span>
          )}
          trailing={(g) => (
            <button type="button" className="pl-more" aria-label={`Add a dish to ${g.slot.toLowerCase()} on ${weekday(g.date)} ${shortDate(g.date)}`}
              aria-expanded={target?.kind === "add" && target.at === g.id ? true : undefined}
              onClick={() => { setTarget({ kind: "add", date: g.date, slot: g.slot, at: g.id }); onSelect(null); }}>
              <span aria-hidden="true">+</span><span className="pl-more-t"> Add</span>
            </button>
          )}
          selectedId={target?.kind === "edit" ? slotKey(target.meal) : undefined}
          onAdd={(date, slot) => { setTarget({ kind: "add", date, slot, at: scheduleAddKey(date, slot) }); onSelect(null); }}
          // The editor opens in place: under the meal tapped, or under the "+ Add" pressed; the days below move down.
          expanded={target ? {
            at: target.at, onClose: close,
            label: target.kind === "add" ? addTitle(target, week) : `Edit ${target.meal.dish}`,
            content: (
              <>
              {target.kind === "edit" ? <MealReadinessPanel mealId={target.meal.id} rows={byMeal.get(target.meal.id) ?? []} carts={cartsById} today={now} onOpenGroceries={onOpenGroceries} /> : null}
              <MealEditor
                others={target.kind === "edit" ? otherDishes(week, target.meal) : undefined}
                key={target.kind === "edit" ? `edit:${target.meal.id}` : `${target.date}|${target.slot ?? ""}`}
                title={target.kind === "add" ? addTitle(target, week) : `${weekday(target.meal.date)} ${target.meal.slot.toLowerCase()}`}
                date={target.kind === "add" ? target.date : target.meal.date} today={now}
                meal={target.kind === "edit" ? target.meal : undefined}
                askSlot={target.kind === "add" && !target.slot ? nextSlot(target.date, now) : undefined}
                onSave={save} onCancel={close} onRemove={target.kind === "edit" ? () => setAsking(true) : undefined}
              />
              </>
            ),
          } : null}
        />}
      <Confirm open={asking} title="Remove this dish?" body={target?.kind === "edit" && otherDishes(week, target.meal).length ? "It comes off this meal; the other dishes stay." : "It comes off the week. Nobody is notified."} confirmLabel="Remove" tone="danger" onConfirm={remove} onCancel={() => setAsking(false)} />
    </Page>
  );
}
