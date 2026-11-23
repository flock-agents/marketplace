import { useState } from "react";
import { Button, Empty, ErrorCard, Page, Schedule, Skeleton, scheduleAddKey, useTable, useToast, useToday, label } from "../flock/ui";
import { EventEditor } from "./EventEditor";
import { EventTodos } from "./EventTodos";
import { FamilyList } from "./FamilyList";
import { addDays, eventOrder, occurrences, repeats, shortDate, type EventPatch } from "./dates";
import { dayLabel, memberLabel, sourceLine, spanOf, timeLabel, todoCount, toneOf, undo, useExtras, type Event, type Member, type Selected } from "./shared";

/** What the editor is for, and `at`: where it opens in the week (under the event, or under the "+ Add" of a day). */
type Target = { kind: "add"; date: string; at: string } | { kind: "edit"; event: Event; at: string };

const SR = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" } as const;

export function WeekPage({ selected, onSelect }: { selected: Selected; onSelect: (s: Selected) => void }) {
  const [shift, setShift] = useState(0);   // 7-day steps away from today
  const [target, setTarget] = useState<Target | null>(null);
  const toast = useToast();
  const now = useToday();
  // The Schedule starts at today, so the days already gone do not push today down.
  const from = addDays(now, shift * 7);
  const end = addDays(from, 6);
  const events = useTable<Event>("events", { where: { "date[gte]": from, "date[lte]": end }, limit: 500, sort: "date" });
  // An event that repeats (skating every Tuesday) is one row, whenever it began: read apart, and shown on its days of these seven.
  const repeating = useTable<Event>("events", { where: { "repeat[ne]": "none", "date[lte]": end }, limit: 500, sort: "date" });
  // An event over several days that began before these seven (a trip still on): read apart, and shown on its days of these.
  const spanning = useTable<Event>("events", { where: { "date[lt]": from, "end_date[gte]": from }, limit: 500, sort: "date" });
  const family = useTable<Member>("members", { sort: "name", limit: 100 });
  const names = family.rows.map((m) => m.name);
  // Each event once (a repeating one is in two reads), then on each of its days of these seven.
  const byId = new Map<string, Event>();
  for (const e of [...events.rows.filter((e) => !repeats(e)), ...repeating.rows, ...spanning.rows.filter((e) => !repeats(e))]) byId.set(e.id, e);
  const rows = [...byId.values()].flatMap((e) => occurrences(e, from, end).map((date) => ({ ...e, date }))).sort(eventOrder);
  // Where each event came from and its to-dos: read again when the events change.
  const { extras, reload } = useExtras(rows.map((e) => `${e.id}:${e.updated_at}`).join(","));
  /** The event as it is kept: a repeating one, or one over several days, is shown on its days of this week, and edited as the one
   *  row it is (its first day). */
  const kept = (e: Event): Event => byId.get(e.id) ?? e;
  /** A row of the week: an event on one of its days. An event that happens every day is seven rows of one id, so the day is in the key. */
  const keyOf = (e: Event): string => `${e.id}:${e.date}`;

  const close = () => { setTarget(null); onSelect(null); };
  const open = (e: Event) => { setTarget({ kind: "edit", event: kept(e), at: keyOf(e) }); onSelect({ table: "events", id: e.id, label: `${e.title} on ${dayLabel(e.date)}` }); };
  const add = (date: string) => { setTarget({ kind: "add", date, at: scheduleAddKey(date) }); onSelect(null); };
  const save = async (row: EventPatch) => {
    if (target?.kind === "edit") await events.update(target.event.id, row); else await events.create(row);
    close();
  };
  const remove = async () => {
    const e = target?.kind === "edit" ? target.event : null;
    let changeId: string | undefined;
    try { if (e) changeId = await events.remove(e.id); } catch { /* useTable already toasted and rolled back */ }
    finally { close(); }
    if (e && changeId) toast.show({ message: `Deleted ${e.title}`, tone: "success", action: { label: "Undo", onClick: () => undo(changeId!, () => toast.show({ message: "Couldn't undo", tone: "danger" })) } });
  };

  return (
    <Page title={shift === 0 ? label("title.week", "This week") : `From ${shortDate(from)}`} subtitle={`${shortDate(from)} to ${shortDate(end)}`} actions={<Button variant="app" icon="plus" onClick={() => add(from)}>Add</Button>}>
      <div className="fc-nav">
        <Button variant="ghost" size="sm" icon="chevron-left" onClick={() => setShift(shift - 1)}><span style={SR}>Previous 7 days</span></Button>
        <Button variant="ghost" size="sm" onClick={() => setShift(0)}>Today</Button>
        <Button variant="ghost" size="sm" icon="chevron-right" onClick={() => setShift(shift + 1)}><span style={SR}>Next 7 days</span></Button>
      </div>
      {events.error ?? repeating.error ?? spanning.error ? <ErrorCard title="Couldn't load the week" message={(events.error ?? repeating.error ?? spanning.error)!} onRetry={() => { void events.refetch(); void repeating.refetch(); void spanning.refetch(); }} />
        : (events.loading || repeating.loading || spanning.loading) && rows.length === 0 ? <Skeleton variant="card" lines={6} />
        : rows.length === 0 && !target ? <Empty title="Nothing on these days" hint="Add the first event, or ask the assistant to." object="calendar" action={<Button onClick={() => add(from)}>Add an event</Button>} />
        : <Schedule
          key={from} rows={rows} rowKey={keyOf} from={from} days={7} today={now} showEarlier={end < now}
          date={(e) => e.date} time={timeLabel} start={(e) => e.start_time ?? "00:00"}
          // A cancelled event stays on its day, struck through.
          title={(e) => (e.status === "cancelled" ? <><s>{e.title}</s><span style={SR}> (cancelled)</span></> : e.title)}
          secondary={(e) => [spanOf(kept(e)), memberLabel(e.who, family.rows), e.location, sourceLine(e, extras), todoCount(e.id, extras)].filter(Boolean).join(" · ")}
          tone={(e) => toneOf(e.who, family.rows)}
          selectedId={target?.kind === "edit" ? target.at : selected?.table === "events" ? selected.id : undefined}
          onSelect={open} onAdd={add}
          // The editor opens in place: under the event tapped, or under the "+ Add" of the day; the days below move down.
          expanded={target ? {
            at: target.at, onClose: close,
            label: target.kind === "add" ? `Add an event on ${dayLabel(target.date)}` : `Edit ${target.event.title}`,
            content: (<>
              {target.kind === "edit" ? <EventTodos eventId={target.event.id} todos={extras[target.event.id]?.todos ?? []} onChanged={() => void reload()} /> : null}
              <EventEditor
                key={target.kind === "edit" ? `edit:${target.event.id}` : `add:${target.date}`}
                title={target.kind === "add" ? `Add an event on ${dayLabel(target.date)}` : `Edit ${target.event.title}`}
                names={names} event={target.kind === "edit" ? target.event : undefined} date={target.kind === "add" ? target.date : undefined}
                onSave={save} onCancel={close} onRemove={target.kind === "edit" ? remove : undefined}
              />
            </>),
          } : null}
        />}
      <FamilyList family={family} selected={selected} onSelect={onSelect} />
    </Page>
  );
}
