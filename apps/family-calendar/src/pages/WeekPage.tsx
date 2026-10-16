import { useState } from "react";
import { Button, Empty, ErrorCard, Page, Schedule, Skeleton, scheduleAddKey, useTable, useToast, useToday, label } from "../flock/ui";
import { EventEditor } from "./EventEditor";
import { FamilyList } from "./FamilyList";
import { addDays, eventOrder, shortDate, type EventPatch } from "./dates";
import { dayLabel, memberLabel, timeLabel, toneOf, undo, type Event, type Member, type Selected } from "./shared";

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
  const family = useTable<Member>("members", { sort: "name", limit: 100 });
  const names = family.rows.map((m) => m.name);
  const rows = [...events.rows].sort(eventOrder);

  const close = () => { setTarget(null); onSelect(null); };
  const open = (e: Event) => { setTarget({ kind: "edit", event: e, at: e.id }); onSelect({ table: "events", id: e.id, label: `${e.title} on ${dayLabel(e.date)}` }); };
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
      {events.error ? <ErrorCard title="Couldn't load the week" message={events.error} onRetry={events.refetch} />
        : events.loading && rows.length === 0 ? <Skeleton variant="card" lines={6} />
        : rows.length === 0 && !target ? <Empty title="Nothing on these days" hint="Add the first event, or ask the assistant to." object="calendar" action={<Button onClick={() => add(from)}>Add an event</Button>} />
        : <Schedule
          key={from} rows={rows} from={from} days={7} today={now} showEarlier={end < now}
          date={(e) => e.date} title={(e) => e.title} time={timeLabel} start={(e) => e.start_time ?? "00:00"}
          secondary={(e) => [memberLabel(e.who, family.rows), e.location].filter(Boolean).join(" · ")}
          tone={(e) => toneOf(e.who, family.rows)}
          selectedId={target?.kind === "edit" ? target.event.id : selected?.table === "events" ? selected.id : undefined}
          onSelect={open} onAdd={add}
          // The editor opens in place: under the event tapped, or under the "+ Add" of the day; the days below move down.
          expanded={target ? {
            at: target.at, onClose: close,
            label: target.kind === "add" ? `Add an event on ${dayLabel(target.date)}` : `Edit ${target.event.title}`,
            content: (
              <EventEditor
                key={target.kind === "edit" ? `edit:${target.event.id}` : `add:${target.date}`}
                title={target.kind === "add" ? `Add an event on ${dayLabel(target.date)}` : `Edit ${target.event.title}`}
                names={names} event={target.kind === "edit" ? target.event : undefined} date={target.kind === "add" ? target.date : undefined}
                onSave={save} onCancel={close} onRemove={target.kind === "edit" ? remove : undefined}
              />
            ),
          } : null}
        />}
      <FamilyList family={family} selected={selected} onSelect={onSelect} />
    </Page>
  );
}
