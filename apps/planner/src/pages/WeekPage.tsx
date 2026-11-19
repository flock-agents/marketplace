import { useState } from "react";
import { Button, Callout, Card, Confirm, ErrorCard, Field, Icon, Page, Row, Schedule, Skeleton, Stack, Value, safeHref, scheduleAddKey, useApp, useChat, useTable, useToast } from "../flock/ui";
import { addDays, clockText, dayLabel, mondayOf, todayStr, weekDates, weekdayLong, weekdayOf } from "../../server/dates";
import { DishPanel } from "./DishPanel";
import { agentName, dishNote, textList, weekTitle } from "./format";
import { send, useLive, why, type DishView, type Family, type MealView, type RecipeRow, type WeekView } from "./shared";

/** What is open in the schedule: a meal by its id (with one of its dishes, or a new one, being edited), or an add spot (a day,
 *  and the slot tapped if any) with the slot the new dish goes in. */
type Open = { meal: string; dish?: string } | { date: string; tapped?: string; slot?: string } | null;
const sameSlot = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/** "Sunday 29": a day as the not-a-cooking-day note names it. */
const dayWords = (date: string) => `${weekdayLong(date)} ${Number(date.slice(8))}`;
/** "Sunday 29 Nov". */
const longLabel = (date: string) => dayLabel(date).replace(weekdayOf(date), weekdayLong(date));

/** The week as a schedule of its cooking days: each meal with its dishes, an ordered-in meal muted. A meal opens in place,
 *  its dishes editable there. A day that is not a cooking day says so, with a way to plan it this once. */
export function WeekPage() {
  const thisWeek = mondayOf(todayStr());
  const [weekStart, setWeekStart] = useState(thisWeek);
  const week = useLive<WeekView>(`weeks/${weekStart}`, ["plan_meals", "dishes", "dish_items"]);
  const family = useLive<Family>("family", ["house"]);
  const recipes = useTable<RecipeRow>("saved_recipes", { limit: 500 });
  const agent = agentName(useApp().display);
  const chat = useChat();
  const toast = useToast();
  const [open, setOpen] = useState<Open>(null);
  const [asking, setAsking] = useState<{ date: string; slot: string; dishes: number } | null>(null);

  const go = (to: string) => { setOpen(null); setWeekStart(to); };
  const done = () => { setOpen(null); void week.refetch(); };
  const orderIn = async (date: string, slot: string, on: boolean) => {
    try { await send("meals", { date, slot, ordered_in: on }); setOpen(null); void week.refetch(); }
    catch (e) { toast.show({ message: `Couldn't save: ${why(e)}`, tone: "danger" }); }
  };
  /** A dish's video: its own link, else the first link of the recipe it points at. Only a safe link is ever shown. */
  const linkOf = (d: DishView): { href: string; text: string } | null => {
    const own = safeHref(d.video_url);
    if (own) return { href: own, text: "Video" };
    const recipe = d.recipe_id ? recipes.rows.find((r) => r.id === d.recipe_id) : undefined;
    const href = recipe ? textList(recipe.links).map((l) => safeHref(l)).find((l) => l) : null;
    return href ? { href, text: "Recipe video" } : null;
  };

  const house = family.data?.house;
  const today = todayStr();
  const meals = (week.data?.days ?? []).flatMap((d) => d.meals).filter((m) => m.ordered_in || m.dishes.length);
  // Breakfast, Lunch, the family's own meals, then Dinner; any other slot a meal was planned in after them.
  const slots = ["Breakfast", "Lunch", ...(house?.extra_slots ?? []).map((s) => s.name), "Dinner"];
  for (const m of meals) if (!slots.some((s) => sameSlot(s, m.slot))) slots.push(m.slot);
  const slotOf = (m: MealView) => slots.find((s) => sameSlot(s, m.slot)) ?? m.slot;
  const offDays = house ? weekDates(weekStart).filter((d) => d >= today && !house.cooking_days.includes(weekdayOf(d)) && !meals.some((m) => m.date === d)) : [];
  const status = week.data?.status ?? null;
  const subtitle = status === null ? `Not planned yet · ask ${agent} to plan it`
    : `Planned Sunday ${clockText(house?.plan_time ?? "11:00")} · tell ${agent} to change anything`;
  const opened = open && "meal" in open ? meals.find((m) => m.id === open.meal) : undefined;

  const mealPanel = (m: MealView, editing: string | undefined) => (
    <Card title={`${slotOf(m)} · ${dayLabel(m.date)}`}
      actions={<Field type="checkbox" name={`ordered-in-${m.id}`} label="Ordered in" value={m.ordered_in}
        onChange={(v) => { if (v === true && m.dishes.length) setAsking({ date: m.date, slot: m.slot, dishes: m.dishes.length }); else void orderIn(m.date, m.slot, v === true); }} />}>
      <Stack gap="md">
        {m.ordered_in ? <p className="pl-quiet">Ordered in: nothing is cooked or bought for it.</p> : (
          <>
            {m.dishes.map((d) => {
              if (editing === d.id) return <DishPanel key={d.id} dish={d} at={{ date: m.date, slot: m.slot }} onDone={done} />;
              const link = linkOf(d), note = dishNote(d);
              return (
                <div className="pl-dish" key={d.id}>
                  <Row>
                    <b>{d.name}</b>
                    {note ? <span className="pl-quiet">{note}</span> : null}
                    {link ? <a className="pl-chip" href={link.href} target="_blank" rel="noopener noreferrer"><Icon name="play" size={12} />{link.text}</a> : null}
                  </Row>
                  <Button size="sm" variant="ghost" icon="pencil" onClick={() => setOpen({ meal: m.id, dish: d.id })}>Edit</Button>
                </div>
              );
            })}
            {editing === "new" ? <DishPanel key={`${m.id}-new`} dish={null} at={{ date: m.date, slot: m.slot }} onDone={done} />
              : <Row><Button size="sm" variant="ghost" icon="plus" onClick={() => setOpen({ meal: m.id, dish: "new" })}>Add a dish</Button></Row>}
          </>
        )}
        <Row><Button size="sm" variant="ghost" onClick={() => setOpen(null)}>Close</Button></Row>
      </Stack>
    </Card>
  );
  /** A new dish on a day: in the slot tapped, or in one picked here when the whole day was tapped. */
  const addPanel = (o: { date: string; tapped?: string; slot?: string }) => (
    <Stack gap="md">
      {o.tapped ? null : (
        <Field type="select" name={`slot-${o.date}`} label="Meal" options={slots} value={o.slot ?? null}
          onChange={(v) => setOpen({ ...o, slot: v ? String(v) : undefined })} />
      )}
      {o.slot ? (
        <>
          <DishPanel key={`${o.date}-${o.slot}`} dish={null} at={{ date: o.date, slot: o.slot }} onDone={done} />
          <Row><Button size="sm" variant="ghost" onClick={() => void orderIn(o.date, o.slot!, true)}>{`${o.slot} is ordered in`}</Button></Row>
        </>
      ) : <Row><Button size="sm" variant="ghost" onClick={() => setOpen(null)}>Cancel</Button></Row>}
    </Stack>
  );
  const expanded = opened && open && "meal" in open
    ? { at: opened.id, label: `${slotOf(opened)} on ${dayLabel(opened.date)}`, onClose: () => setOpen(null), content: mealPanel(opened, open.dish) }
    : open && "date" in open
      ? { at: scheduleAddKey(open.date, open.tapped), label: `Add a dish on ${dayLabel(open.date)}`, onClose: () => setOpen(null), content: addPanel(open) }
      : null;

  return (
    <Page
      title={weekTitle(weekStart)} subtitle={subtitle}
      actions={
        <Row>
          {status === "draft" ? <Value kind="select" value="Draft" tones={{ Draft: "warning" }} /> : null}
          {weekStart === thisWeek
            ? <Button size="sm" variant="soft" icon="calendar" onClick={() => go(addDays(weekStart, 7))}>Next week</Button>
            : <Button size="sm" variant="soft" icon="calendar" onClick={() => go(thisWeek)}>This week</Button>}
        </Row>
      }
    >
      {week.error && !week.data ? <ErrorCard title="Couldn't load the week" message={week.error} onRetry={() => void week.refetch()} />
        : !week.data ? <Skeleton variant="card" lines={6} />
        : (
          <>
            <Schedule rows={meals} today={today} from={weekStart} days={7} date={(m) => m.date} slot={slotOf} slots={slots}
              title={(m) => (m.ordered_in ? "Ordered in" : m.dishes.map((d) => d.name).join(" · "))}
              secondary={(m) => [m.note, ...m.dishes.map((d) => { const n = dishNote(d); return n ? `${d.name} ${n}` : null; })].filter(Boolean).join(" · ") || undefined}
              tone={(m) => (m.ordered_in ? "muted" : "neutral")}
              selectedId={opened?.id}
              onSelect={(m) => setOpen(opened?.id === m.id ? null : { meal: m.id })}
              onAdd={(date, slot) => setOpen({ date, tapped: slot, slot })}
              expanded={expanded} />
            {offDays.map((d) => (
              <Callout key={d} tone="muted" icon="sun" title={`${dayWords(d)} isn't a cooking day`}>
                <Stack gap="sm">
                  <span>{chat.available ? `Change this on the Family page, or plan just this ${weekdayLong(d)}.` : `Change this on the Family page, or ask ${agent} to plan just this ${weekdayLong(d)}.`}</span>
                  {chat.available ? (
                    <Row><Button variant="soft" size="sm" onClick={() => chat.openChat({ message: `Plan ${longLabel(d)} too`, send: true })}>{`Plan ${weekdayLong(d)} too`}</Button></Row>
                  ) : null}
                </Stack>
              </Callout>
            ))}
          </>
        )}
      <Confirm
        open={!!asking} title={asking ? `Order in for ${asking.slot} on ${dayLabel(asking.date)}?` : ""}
        body={asking ? `Its ${asking.dishes === 1 ? "dish is" : `${asking.dishes} dishes are`} taken off the plan, and nothing is bought for it.` : undefined}
        confirmLabel="Order in" onConfirm={() => { const a = asking!; setAsking(null); void orderIn(a.date, a.slot, true); }} onCancel={() => setAsking(null)}
      />
    </Page>
  );
}
