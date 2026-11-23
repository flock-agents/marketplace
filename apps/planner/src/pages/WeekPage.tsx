import { useEffect, useState } from "react";
import { Button, Card, Confirm, ErrorCard, Field, Icon, Page, Row, Schedule, Skeleton, Stack, Value, safeHref, scheduleAddKey, useApp, useChat, useTable, useToast } from "../flock/ui";
import { addDays, dayLabel, mondayOf, todayStr } from "../../server/dates";
import { DishPanel } from "./DishPanel";
import { PlayLink } from "./Thumb";
import { lastTimeText } from "../../server/dishText";
import { agentName, dishNote, linkWeek, mealLines, plannedText, textList, weekTitle, weekToOpen } from "./format";
import { send, useLive, why, type DishView, type Family, type MealView, type RecipeRow, type WeekView } from "./shared";

/** What is open in the schedule: a meal by its id (with one of its dishes, or a new one, being edited), or an add spot (a day,
 *  and the slot tapped if any) with the slot the new dish goes in. */
type Open = { meal: string; dish?: string } | { date: string; tapped?: string; slot?: string } | null;
const sameSlot = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The week as a schedule of every day (every day is planned): each meal with its dishes named once and, under them, only what differs from
 *  everyone eating it (a person's portions, a dish for one person); an ordered-in meal muted. A meal opens in place,
 *  its dishes editable there. */
export function WeekPage() {
  const thisWeek = mondayOf(todayStr());
  // The planned week: the one the link names ("#/week?week=…", the Sunday message), else next week. The page opens on it when
  // nothing is planned in this week from today on (a Sunday, or a first week planned mid-week for the next).
  const [planned] = useState(() => linkWeek(typeof location === "undefined" ? "" : location.hash) ?? addDays(thisWeek, 7));
  const [weekStart, setWeekStart] = useState(thisWeek);
  const [chosen, setChosen] = useState(false);
  const week = useLive<WeekView>(`weeks/${weekStart}`, ["slot_days", "slot_dishes", "dish_ingredients", "library"]);
  const other = useLive<WeekView>(`weeks/${planned}`, ["slot_days"]);
  const family = useLive<Family>("family", ["house", "people", "slots"]);
  const recipes = useTable<RecipeRow>("saved_recipes", { limit: 500 });
  const agent = agentName(useApp().display);
  const chat = useChat();
  const toast = useToast();
  const [open, setOpen] = useState<Open>(null);
  const [asking, setAsking] = useState<{ date: string; slot: string; dishes: number } | null>(null);

  const go = (to: string) => { setOpen(null); setChosen(true); setWeekStart(to); };
  // Decided once, before the family picks a week themselves.
  useEffect(() => {
    if (chosen || weekStart !== thisWeek) return;
    const to = weekToOpen({ thisWeek, today: todayStr(), planned, current: week.data, other: other.data });
    if (to === null) return;
    setChosen(true);
    if (to !== thisWeek) setWeekStart(to);
  }, [chosen, weekStart, thisWeek, planned, week.data, other.data]);
  const done = () => { setOpen(null); void week.refetch(); };
  const orderIn = async (date: string, slot: string, on: boolean) => {
    // The same change as the agent's set_slot_day: ordered in takes its dishes off; cooked at home again plans its dishes.
    try { await send("slot-days", { date, slot, skip: on ? "ordered_in" : null }); setOpen(null); void week.refetch(); }
    catch (e) { toast.show({ message: `Couldn't save: ${why(e)}`, tone: "danger" }); }
  };
  /** A dish's video: the dish's own (kept by its name across weeks), else the first link of the recipe it points at. Only a
   *  safe link is ever shown. */
  const linkOf = (d: DishView): { href: string; text: string; thumbnail: string | null } | null => {
    const own = safeHref(d.video?.url ?? d.video_url);
    if (own) return { href: own, text: "Video", thumbnail: d.video?.thumbnail ?? null };
    const recipe = d.recipe_id ? recipes.rows.find((r) => r.id === d.recipe_id) : undefined;
    const href = recipe ? textList(recipe.links).map((l) => safeHref(l)).find((l) => l) : null;
    return href ? { href, text: "Recipe video", thumbnail: recipe?.thumbnail ?? null } : null;
  };
  /** A meal's videos as small play buttons at the end of its row: one a dish, two at most. */
  const videos = (m: MealView) => {
    const shown = m.ordered_in ? [] : m.dishes.map((d) => ({ d, link: linkOf(d) })).filter((x) => x.link).slice(0, 2);
    return shown.length ? <Row>{shown.map(({ d, link }) => <PlayLink key={d.id} href={link!.href} thumbnail={link!.thumbnail} label={`Watch the ${d.name} video`} />)}</Row> : null;
  };

  const everyone = (family.data?.people ?? []).map((p) => p.name);
  const today = todayStr();
  const meals = (week.data?.days ?? []).flatMap((d) => d.meals).filter((m) => m.ordered_in || m.dishes.length);
  // The house's slots in planning order (Breakfast, Lunch and Dinner until any is saved); any other slot a meal was planned in after them.
  const saved = (family.data?.slots ?? []).map((s) => s.name);
  const slots = saved.length ? saved : ["Breakfast", "Lunch", "Dinner"];
  for (const m of meals) if (!slots.some((s) => sameSlot(s, m.slot))) slots.push(m.slot);
  const slotOf = (m: MealView) => slots.find((s) => sameSlot(s, m.slot)) ?? m.slot;
  const status = week.data?.status ?? null;
  const subtitle = status === null ? `Not planned yet · ask ${agent} to plan it`
    : `${week.data?.planned_at ? plannedText(week.data.planned_at) : "Planned"} · tell ${agent} to change anything`;
  const opened = open && "meal" in open ? meals.find((m) => m.id === open.meal) : undefined;

  const mealPanel = (m: MealView, editing: string | undefined) => (
    <Card title={`${slotOf(m)} · ${dayLabel(m.date)}`}
      actions={<Field type="checkbox" name={`ordered-in-${m.id}`} label="Ordered in" value={m.ordered_in}
        onChange={(v) => { if (v === true && m.dishes.length) setAsking({ date: m.date, slot: m.slot, dishes: m.dishes.length }); else void orderIn(m.date, m.slot, v === true); }} />}>
      <Stack gap="md">
        {m.ordered_in ? <p className="pl-quiet">Ordered in: nothing is cooked or bought for it.</p> : (
          <>
            {m.dishes.map((d) => {
              if (editing === d.id) return <DishPanel key={d.id} dish={d} dishes={m.dishes} at={{ date: m.date, slot: m.slot }} onDone={done} />;
              const link = linkOf(d), note = dishNote(d), last = lastTimeText(d.last_time);
              return (
                <div className="pl-dish" key={d.id}>
                  <Stack gap="xs">
                    <Row>
                      <b>{d.name}</b>
                      {note ? <span className="pl-quiet">{note}</span> : null}
                      {link ? <a className="pl-chip" href={link.href} target="_blank" rel="noopener noreferrer"><Icon name="play" size={12} />{link.text}</a> : null}
                    </Row>
                    {last ? <span className="pl-quiet">{`Last time: ${last}`}</span> : null}
                  </Stack>
                  <Button size="sm" variant="ghost" icon="pencil" onClick={() => setOpen({ meal: m.id, dish: d.id })}>Edit</Button>
                </div>
              );
            })}
            {editing === "new" ? <DishPanel key={`${m.id}-new`} dish={null} dishes={m.dishes} at={{ date: m.date, slot: m.slot }} onDone={done} />
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
          <DishPanel key={`${o.date}-${o.slot}`} dish={null} dishes={meals.find((m) => m.date === o.date && sameSlot(m.slot, o.slot!))?.dishes ?? []} at={{ date: o.date, slot: o.slot }} onDone={done} />
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
              title={(m) => mealLines(m, everyone).title}
              secondary={(m) => mealLines(m, everyone).secondary}
              tone={(m) => (m.ordered_in ? "muted" : "neutral")}
              trailing={videos}
              selectedId={opened?.id}
              onSelect={(m) => setOpen(opened?.id === m.id ? null : { meal: m.id })}
              onAdd={(date, slot) => setOpen({ date, tapped: slot, slot })}
              expanded={expanded} />
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
