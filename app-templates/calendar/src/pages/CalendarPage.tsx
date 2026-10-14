import { useState, type MouseEvent } from "react";
import { Button, Calendar, Card, ErrorCard, Form, InlinePanel, Page, Skeleton, Tabs, useTable, label } from "../flock/ui";
import { RowPanel } from "./RowPanel";
import {
  EVENT_FIELDS, addDays, addMonths, dateOf, firstOfMonth, fromForm, longDay, monthDays, mondayOf, shortDay, timeOf, toForm, today, weekLabel, whenText,
  type CalEvent, type Selected,
} from "./shared";

type View = "month" | "week";
/** Where an add form is open: under the page header, under the picked day's list (month) or under the week (week). */
type Adding = { at: "top" | "day" | "week"; date: string } | null;

const VIEWS = [{ id: "month", label: "Month" }, { id: "week", label: "Week" }];

export function CalendarPage({ selected, onSelect }: { selected: Selected; onSelect: (s: Selected) => void }) {
  const list = useTable<CalEvent>("events", { sort: "start", limit: 500 });
  const now = today();
  const [view, setView] = useState<View>("month");
  const [anchor, setAnchor] = useState(now);   // a day in the month or week on screen
  const [day, setDay] = useState(now);         // month view: the day listed under the grid
  const [adding, setAdding] = useState<Adding>(null);

  const pick = (r: CalEvent) => onSelect(selected?.id === r.id ? null : { table: "events", id: r.id, label: r.title });
  const close = () => onSelect(null);
  const go = (to: string) => { setAnchor(to); setAdding(null); close(); if (view === "month") setDay(firstOfMonth(to) === firstOfMonth(now) ? now : firstOfMonth(to)); };
  const step = (n: number) => go(view === "month" ? addMonths(anchor, n) : addDays(mondayOf(anchor), 7 * n));
  const switchView = (v: string) => { setView(v as View); setAdding(null); close(); setAnchor(v === "week" ? day : anchor); };
  const add = async (v: Record<string, any>) => {
    const row = fromForm(v);
    await list.create(row as Partial<CalEvent>);
    setAdding(null);
    if (view === "month") { setDay(dateOf(row.start)); setAnchor(dateOf(row.start)); }
  };

  /** A click anywhere in a month cell lists that day under the grid. The cell's place in the grid says which day it is. */
  const pickDay = (e: MouseEvent<HTMLDivElement>) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('.fl-cal-mo [role="gridcell"]');
    const row = cell?.parentElement, grid = row?.parentElement;
    if (!cell || !row || !grid) return;
    const w = Array.from(grid.children).indexOf(row) - 1, d = Array.from(row.children).indexOf(cell);
    const picked = monthDays(firstOfMonth(anchor))[w]?.[d];
    if (!picked || picked === day) return;
    setDay(picked);
    if (adding?.at === "day") setAdding(null);
    if (selected) close();
  };

  const inView = (r: CalEvent) => {
    const d = dateOf(r.start);
    if (view === "month") return d.slice(0, 7) === anchor.slice(0, 7);
    const mon = mondayOf(anchor);
    return d >= mon && d <= addDays(mon, 6);
  };
  const shown = list.rows.filter(inView).length;
  const dayRows = list.rows.filter((r) => dateOf(r.start) === day);

  const form = (date: string, title: string) => (
    <InlinePanel label={title} onClose={() => setAdding(null)}>
      <Card title={title}>
        <Form fields={EVENT_FIELDS} initial={{ start_date: date, all_day: false }} submitLabel="Add" onSubmit={add} onCancel={() => setAdding(null)} />
      </Card>
    </InlinePanel>
  );
  const panel = (id: string) => (
    <RowPanel<CalEvent>
      key={id} table="events" id={id} noun="Event" onClose={close}
      heading={(r) => r.title}
      detail={(r) => [
        { label: "Date", value: dateOf(r.start), kind: "date" }, { label: "When", value: whenText(r) }, { label: "Notes", value: r.notes },
      ]}
      fields={EVENT_FIELDS} toForm={toForm} fromForm={(v) => fromForm(v) as Partial<CalEvent>}
    />
  );
  const expanded = selected?.table === "events" ? { at: selected.id, label: selected.label, onClose: close, content: panel(selected.id) } : null;
  const common = {
    rows: list.rows, today: now, selectedId: selected?.id,
    date: (r: CalEvent) => dateOf(r.start),
    time: (r: CalEvent) => (r.all_day ? "" : timeOf(r.start)),
    tone: (r: CalEvent) => (r.all_day ? "accent" as const : "info" as const),
    title: (r: CalEvent) => (
      <span style={{ display: "inline-flex", flexDirection: "column", minWidth: 0 }}>
        <span>{r.title}</span>
        {view === "week" || r.all_day || r.end ? <small style={{ color: "var(--ink-3)", fontSize: 12.5, fontWeight: 400 }}>{whenText(r)}</small> : null}
      </span>
    ),
    onSelect: pick,
  };

  return (
    <Page
      title={label("title.calendar", "Calendar")}
      subtitle={`${shown} ${shown === 1 ? "event" : "events"} this ${view}`}
      actions={<Button variant="app" icon="plus" onClick={() => setAdding({ at: "top", date: view === "month" ? day : now })}>Add</Button>}
    >
      {adding?.at === "top" ? form(adding.date, "New event") : null}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
        <Tabs tabs={VIEWS} value={view} onChange={switchView} />
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Button size="sm" variant="ghost" icon="chevron-left" onClick={() => step(-1)}>Previous</Button>
          <Button size="sm" variant="soft" onClick={() => go(now)}>Today</Button>
          <Button size="sm" variant="ghost" icon="chevron-right" onClick={() => step(1)}>Next</Button>
        </div>
      </div>
      {list.error ? <ErrorCard title="Couldn't load the calendar" message={list.error} onRetry={list.refetch} />
        : list.loading && !list.rows.length ? <Skeleton variant="card" lines={6} />
        : view === "week" ? (
          <>
            <h2 style={{ margin: "0 0 8px", font: "600 13px var(--body)", color: "var(--ink-2)" }}>{weekLabel(mondayOf(anchor))}</h2>
            <Calendar<CalEvent>
              {...common} view="schedule" weekStart={mondayOf(anchor)} expanded={expanded}
              onAdd={(d) => { close(); setAdding({ at: "week", date: d }); }}
            />
            {adding?.at === "week" ? form(adding.date, `New event on ${shortDay(adding.date)}`) : null}
          </>
        ) : (
          <>
            <div onClickCapture={pickDay}>
              <Calendar<CalEvent>
                {...common} view="month" weekStart={firstOfMonth(anchor)}
                onAdd={(d) => { close(); setDay(d); setAdding({ at: "day", date: d }); }}
              />
            </div>
            <section aria-label={longDay(day)} style={{ marginTop: 16 }}>
              {dayRows.length ? (
                <Calendar<CalEvent> {...common} rows={dayRows} view="timeline" expanded={expanded} />
              ) : <p style={{ color: "var(--ink-3)", margin: "0 0 8px" }}>Nothing on {longDay(day)}.</p>}
              <Button size="sm" variant="soft" icon="plus" onClick={() => { close(); setAdding({ at: "day", date: day }); }}>Add on {shortDay(day)}</Button>
              {adding?.at === "day" ? form(adding.date, `New event on ${shortDay(adding.date)}`) : null}
            </section>
          </>
        )}
    </Page>
  );
}
