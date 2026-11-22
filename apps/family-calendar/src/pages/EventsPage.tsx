import { useState } from "react";
import { Button, Empty, InlinePanel, Page, Search, Table, useTable, useToast, useToday, label } from "../flock/ui";
import { EventEditor } from "./EventEditor";
import { EventTodos } from "./EventTodos";
import { eventOrder, nextOccurrence, repeatText, repeats, type EventPatch } from "./dates";
import { dayLabel, memberLabel, sourceLine, timeLabel, todoCount, undo, useExtras, type Event, type Member, type Selected } from "./shared";

/** Every event from today on, soonest first, with Add under the header and the picked event opened in place. An event that
 *  repeats is listed once, at the next day it falls on. */
export function EventsPage({ selected, onSelect }: { selected: Selected; onSelect: (s: Selected) => void }) {
  const today = useToday();
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const toast = useToast();
  const list = useTable<Event>("events", { where: { "date[gte]": today }, sort: "date", limit: 100, q: q || undefined });
  const repeating = useTable<Event>("events", { where: { "repeat[ne]": "none" }, sort: "date", limit: 500, q: q || undefined });
  const family = useTable<Member>("members", { sort: "name", limit: 100 });
  const names = family.rows.map((m) => m.name);
  const rows = [...list.rows.filter((e) => !repeats(e)), ...repeating.rows.map((e) => ({ ...e, date: nextOccurrence(e, today) ?? e.date }))].sort(eventOrder);
  /** A repeating event's own first day (it is listed at its next one): "Monthly on the 31st" stays so in a 30-day month. */
  const firstDay = (e: Event): string => repeating.rows.find((r) => r.id === e.id)?.date ?? e.date;
  const { extras, reload } = useExtras(rows.map((e) => `${e.id}:${e.updated_at}`).join(","));
  // The editor gets the event as it is kept (a repeating one with its first day), not the day it is listed on.
  const picked = selected?.table === "events" ? [...repeating.rows, ...list.rows].find((e) => e.id === selected.id) : undefined;
  const pick = (e: Event) => onSelect(selected?.id === e.id ? null : { table: "events", id: e.id, label: `${e.title} on ${dayLabel(e.date)}` });
  const add = async (row: EventPatch) => { await list.create(row); setAdding(false); };
  const remove = async (e: Event) => {
    let changeId: string | undefined;
    try { changeId = await list.remove(e.id); } catch { return; }   // the hook already said why
    onSelect(null);
    toast.show({ message: `Deleted ${e.title}`, tone: "success", action: changeId ? { label: "Undo", onClick: () => undo(changeId!, () => toast.show({ message: "Couldn't undo", tone: "danger" })) } : undefined });
  };
  return (
    <Page title={label("title.events", "Upcoming events")} subtitle={`${list.hasMore ? `${rows.length}+` : rows.length} coming up`} actions={<Button variant="app" icon="plus" onClick={() => setAdding(true)}>Add</Button>}>
      {adding ? (
        <InlinePanel label="New event" onClose={() => setAdding(false)}>
          <EventEditor title="New event" names={names} date={today} onSave={add} onCancel={() => setAdding(false)} />
        </InlinePanel>
      ) : null}
      <Search value={q} onChange={setQ} placeholder="Search the events" />
      <Table
        rows={rows} loading={list.loading || repeating.loading} error={list.error ?? repeating.error} hasMore={list.hasMore} onLoadMore={list.loadMore}
        selectedId={picked?.id} onRowClick={pick}
        empty={<Empty title="Nothing coming up" hint={q ? "Nothing matches. Clear the search." : "Add the first event, or ask the assistant to."} object="calendar" action={<Button onClick={() => setAdding(true)}>Add an event</Button>} />}
        columns={[
          { key: "title", label: "What", width: "wide", render: (e) => {
            const line = sourceLine(e, extras);
            // A cancelled event stays listed, struck through; the small line says where it came from or who added it.
            return <span>{e.status === "cancelled" ? <><s>{e.title}</s> (cancelled)</> : e.title}{line ? <span className="fc-source">{line}</span> : null}</span>;
          } },
          { key: "date", label: "When", kind: "date" },
          { key: "start_time", label: "Time", render: (e) => (repeats(e) ? `${repeatText(firstDay(e), e.repeat, e.monthly_by)}, ${timeLabel(e)}` : timeLabel(e)) },
          { key: "who", label: "Who", render: (e) => memberLabel(e.who, family.rows) || "Everyone" },
          { key: "location", label: "Where", phone: "hide" },
          { key: "id", label: "To-dos", render: (e) => todoCount(e.id, extras) },
        ]}
        // The picked event opens in place, under its row.
        expanded={picked ? {
          at: picked.id, label: `Edit ${picked.title}`, onClose: () => onSelect(null),
          content: (<>
            <EventTodos eventId={picked.id} todos={extras[picked.id]?.todos ?? []} onChanged={() => void reload()} />
            <EventEditor key={picked.id} title={`Edit ${picked.title}`} names={names} event={picked}
              onSave={async (row) => { await list.update(picked.id, row); onSelect(null); }} onCancel={() => onSelect(null)} onRemove={() => remove(picked)} />
          </>),
        } : null}
      />
    </Page>
  );
}
