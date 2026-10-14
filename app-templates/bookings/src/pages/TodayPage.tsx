import { Button, Callout, Empty, ErrorCard, Page, Schedule, Skeleton, StatStrip, useToday, label } from "../flock/ui";
import { BookingPanel } from "./BookingPanel";
import { STATUS_TONES, addDays, dateOf, minutesOf, rangeLabel, timeOf, useBookings, type Selected } from "./shared";

export function TodayPage({ selected, onSelect, onBook }: { selected: Selected; onSelect: (s: Selected) => void; onBook: (date?: string) => void }) {
  const today = useToday();
  const list = useBookings(today, addDays(today, 6));
  const shown = list.rows.filter((b) => b.status !== "cancelled");
  const day = (d: string) => shown.filter((b) => dateOf(b.start) === d);
  const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
  const todays = day(today);
  const ahead = todays.filter((b) => b.status === "booked" && minutesOf(timeOf(b.start)) + b.minutes > nowMin).length;
  const picked = selected?.table === "bookings" ? list.rows.find((b) => b.id === selected.id) : undefined;
  const pick = (b: { id: string; customer_name: string; start: string }) =>
    onSelect(selected?.id === b.id ? null : { table: "bookings", id: b.id, label: `${b.customer_name} at ${timeOf(b.start)} on ${dateOf(b.start)}` });
  return (
    <Page title={label("title.today", "Today's bookings")} subtitle={`${todays.length} today, ${day(addDays(today, 1)).length} tomorrow`} actions={<Button variant="app" icon="plus" onClick={() => onBook(today)}>Book</Button>}>
      {list.error ? (
        <ErrorCard title="Couldn't load the bookings" message={list.error} onRetry={() => void list.refetch()} />
      ) : list.loading ? <Skeleton variant="card" lines={5} /> : (
        <>
          <StatStrip stats={[
            { label: "today", value: todays.length },
            { label: "still to come", value: ahead },
            { label: "tomorrow", value: day(addDays(today, 1)).length },
          ]} />
          {list.truncated ? <Callout tone="warning" title="Showing the first 500 bookings">Narrow the dates to see the rest.</Callout> : null}
          {picked ? <BookingPanel key={picked.id} booking={picked} onClose={() => onSelect(null)} /> : null}
          {shown.length === 0 ? (
            <Empty title="Nothing booked this week" hint="Book the first appointment, or ask the assistant to." object="calendar" action={<Button onClick={() => onBook(today)}>Book a slot</Button>} />
          ) : (
            <Schedule
              rows={shown} date={(b) => dateOf(b.start)} today={today} days={7} selectedId={selected?.id}
              title={(b) => b.customer_name} time={(b) => rangeLabel(b).split(" to ")[0]} start={(b) => minutesOf(timeOf(b.start))}
              secondary={(b) => `${b.service_name} · ${b.minutes} min${b.notes ? ` · ${b.notes}` : ""}${b.status === "booked" ? "" : ` · ${b.status.replace("_", "-")}`}`}
              tone={(b) => STATUS_TONES[b.status as keyof typeof STATUS_TONES] ?? "neutral"}
              onSelect={pick} onAdd={(d) => onBook(d)}
            />
          )}
        </>
      )}
    </Page>
  );
}
