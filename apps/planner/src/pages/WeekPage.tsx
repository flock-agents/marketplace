import { Fragment, useState } from "react";
import { Button, Callout, Confirm, ErrorCard, Field, Heading, Icon, InlinePanel, Page, Row, Section, Skeleton, Stack, Value, label, safeHref, useTable, useToast } from "../flock/ui";
import { addDays, dayLabel, mondayOf, todayStr, weekdayOf } from "../../server/dates";
import { SLOTS } from "../../server/db/constants";
import { DishPanel } from "./DishPanel";
import { dishNote, textList } from "./format";
import { send, useLive, why, type DishView, type Family, type MealView, type RecipeRow, type WeekView } from "./shared";

/** Which editor is open: a dish by its id, or a new dish for a meal by its date and slot. */
type Open = { dish: string } | { date: string; slot: string } | null;
const sameSlot = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The week's meals, day by day: each slot with its dishes. A dish opens for editing under its own row; a slot can be marked
 *  ordered in, which takes its dishes (and their groceries) away. */
export function WeekPage() {
  const thisWeek = mondayOf(todayStr());
  const [weekStart, setWeekStart] = useState(thisWeek);
  const week = useLive<WeekView>(`weeks/${weekStart}`, ["plan_meals", "dishes", "dish_items"]);
  const family = useLive<Family>("family", ["house"]);
  const recipes = useTable<RecipeRow>("saved_recipes", { limit: 500 });
  const toast = useToast();
  const [open, setOpen] = useState<Open>(null);
  const [asking, setAsking] = useState<{ date: string; slot: string; dishes: number } | null>(null);

  const go = (to: string) => { setOpen(null); setWeekStart(to); };
  const done = () => { setOpen(null); void week.refetch(); };
  const orderIn = async (date: string, slot: string, on: boolean) => {
    try { await send("meals", { date, slot, ordered_in: on }); void week.refetch(); }
    catch (e) { toast.show({ message: `Couldn't save: ${why(e)}`, tone: "danger" }); }
  };
  /** The slots a day shows: the three everyday ones, the family's own on their days, and any other a meal was planned in. */
  const slotsOf = (date: string, meals: MealView[]): string[] => {
    const extra = (family.data?.house.extra_slots ?? []).filter((s) => !s.days?.length || s.days.includes(weekdayOf(date))).map((s) => s.name);
    const all: string[] = [...SLOTS, ...extra];
    for (const m of meals) if (!all.some((s) => sameSlot(s, m.slot))) all.push(m.slot);
    return all;
  };
  /** A dish's video: its own link, else the first link of the recipe it points at. Only a safe link is ever shown. */
  const linkOf = (d: DishView): { href: string; text: string } | null => {
    const own = safeHref(d.video_url);
    if (own) return { href: own, text: "Video" };
    const recipe = d.recipe_id ? recipes.rows.find((r) => r.id === d.recipe_id) : undefined;
    const href = recipe ? textList(recipe.links).map((l) => safeHref(l)).find((l) => l) : null;
    return href ? { href, text: "Recipe video" } : null;
  };

  const draft = week.data?.status === "draft";
  const range = `${dayLabel(weekStart)} to ${dayLabel(addDays(weekStart, 6))}`;
  return (
    <Page
      title={label("title.week", "This week's meals")}
      subtitle={draft ? `${range} · groceries are ordered once the plan is final` : range}
      actions={
        <Row>
          {draft ? <Value kind="select" value="Draft" tones={{ Draft: "warning" }} /> : null}
          <Button size="sm" variant="soft" icon="chevron-left" onClick={() => go(addDays(weekStart, -7))}>Earlier</Button>
          {weekStart === thisWeek ? null : <Button size="sm" variant="soft" onClick={() => go(thisWeek)}>This week</Button>}
          <Button size="sm" variant="soft" icon="chevron-right" onClick={() => go(addDays(weekStart, 7))}>Later</Button>
        </Row>
      }
    >
      {week.error && !week.data ? <ErrorCard title="Couldn't load the week" message={week.error} onRetry={() => void week.refetch()} />
        : !week.data ? <Skeleton variant="card" lines={6} />
        : (
          <>
            {week.data.status === null ? <Callout tone="info" title="Nothing is planned for this week yet">Ask the assistant to plan it, or add dishes below.</Callout> : null}
            {week.data.days.map((day) => (
              <Section key={day.date} title={day.date === todayStr() ? `${dayLabel(day.date)} · Today` : dayLabel(day.date)}>
                <Stack gap="md">
                  {slotsOf(day.date, day.meals).map((slot) => {
                    const meal = day.meals.find((m) => sameSlot(m.slot, slot));
                    const adding = !!open && "slot" in open && open.date === day.date && sameSlot(open.slot, slot);
                    return (
                      <div className="pl-slot" key={slot}>
                        <Row justify="between">
                          <Row>
                            <Heading level={3}>{slot}</Heading>
                            {meal?.note ? <span className="pl-quiet">{meal.note}</span> : null}
                          </Row>
                          <Field type="checkbox" name={`ordered-in-${day.date}-${slot}`} label="Ordered in" value={!!meal?.ordered_in}
                            onChange={(v) => { if (v === true && meal?.dishes.length) setAsking({ date: day.date, slot, dishes: meal.dishes.length }); else void orderIn(day.date, slot, v === true); }} />
                        </Row>
                        {meal?.ordered_in ? <p className="pl-quiet">Ordered in: nothing is cooked or bought for it.</p> : (
                          <>
                            {(meal?.dishes ?? []).map((d) => {
                              const link = linkOf(d), note = dishNote(d);
                              return (
                                <Fragment key={d.id}>
                                  <div className="pl-dish">
                                    <Row>
                                      <b>{d.name}</b>
                                      {note ? <span className="pl-quiet">{note}</span> : null}
                                      {link ? <a className="pl-chip" href={link.href} target="_blank" rel="noopener noreferrer"><Icon name="play" size={12} />{link.text}</a> : null}
                                    </Row>
                                    <Button size="sm" variant="ghost" icon="pencil" onClick={() => setOpen(open && "dish" in open && open.dish === d.id ? null : { dish: d.id })}>Edit</Button>
                                  </div>
                                  {/* The dish opens in place, under its own row. */}
                                  {open && "dish" in open && open.dish === d.id ? (
                                    <InlinePanel label={`Edit ${d.name}`} onClose={() => setOpen(null)}>
                                      <DishPanel key={d.id} dish={d} at={{ date: day.date, slot }} onDone={done} />
                                    </InlinePanel>
                                  ) : null}
                                </Fragment>
                              );
                            })}
                            <Row><Button size="sm" variant="ghost" icon="plus" onClick={() => setOpen(adding ? null : { date: day.date, slot })}>Add a dish</Button></Row>
                            {adding ? (
                              <InlinePanel label={`Add a dish to ${slot}`} onClose={() => setOpen(null)}>
                                <DishPanel key={`${day.date}-${slot}`} dish={null} at={{ date: day.date, slot }} onDone={done} />
                              </InlinePanel>
                            ) : null}
                          </>
                        )}
                      </div>
                    );
                  })}
                </Stack>
              </Section>
            ))}
          </>
        )}
      <Confirm
        open={!!asking} title={asking ? `Order in for ${asking.slot} on ${dayLabel(asking.date)}?` : ""}
        body={asking ? `Its ${asking.dishes === 1 ? "dish is" : `${asking.dishes} dishes are`} taken off the plan, and what they need comes off the orders not yet placed.` : undefined}
        confirmLabel="Order in" onConfirm={() => { const a = asking!; setAsking(null); void orderIn(a.date, a.slot, true); }} onCancel={() => setAsking(null)}
      />
    </Page>
  );
}
