import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Callout, Card, Empty, Field, Form, Page, Skeleton, SlotPicker, clockLabel, kitFetch, subscribeEvents, useTable, useToast, useToday, label } from "../flock/ui";
import { addDays, dayLabel, failure, minutesOf, pad, type Service } from "./shared";

interface Slots { date: string; closed: boolean; open: string | null; close: string | null; slotMinutes: number; length: number; taken: string[] }

/** Pick a day and a service, tap a free time, then say who is coming. The free times come from the server, which also refuses a clash. */
export function BookPage({ date: start, onBooked }: { date?: string; onBooked: () => void }) {
  const today = useToday();
  const toast = useToast();
  const services = useTable<Service>("services", { sort: "name", limit: 500 });
  const [date, setDate] = useState(start ?? today);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slots | null>(null);
  const [slotError, setSlotError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formKey, setFormKey] = useState(0);

  const chosen = services.rows.find((s) => s.id === serviceId) ?? services.rows[0];
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!chosen) return;
    const mine = ++seq.current;
    try {
      const r = await kitFetch<Slots>(`slots?date=${date}&service_id=${chosen.id}`);
      if (mine === seq.current) { setSlots(r); setSlotError(null); }
    } catch (e) { if (mine === seq.current) setSlotError(failure(e).message); }
  }, [date, chosen?.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSlots(null); setTime(null); void load(); }, [load]);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const soon = () => { clearTimeout(t); t = setTimeout(() => void load(), 150); };
    // A changed setting (opening hours, slot length) changes the grid, so the slots are fetched again.
    const off = subscribeEvents((e) => { if (e.table === "bookings" || e.table === "_settings") soon(); }, soon);
    return () => { clearTimeout(t); off(); };
  }, [load]);

  // Today's times that have already passed are not free, whatever the schedule says.
  const [tick, setTick] = useState(() => new Date());   // the clock moves while the page stays open: times pass without a reload
  useEffect(() => { const t = setInterval(() => setTick(new Date()), 60_000); return () => clearInterval(t); }, []);
  const nowMin = tick.getHours() * 60 + tick.getMinutes();
  const gone = slots && date === today && slots.open && slots.close
    ? Array.from({ length: Math.ceil((minutesOf(slots.close) - minutesOf(slots.open)) / slots.slotMinutes) }, (_, i) => minutesOf(slots.open!) + i * slots.slotMinutes).filter((m) => m <= nowMin).map((m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`)
    : [];

  const book = async (v: Record<string, any>) => {
    if (!chosen || !time) return;
    setErrors({}); setProblem(null);
    try {
      await kitFetch("bookings", { method: "POST", body: JSON.stringify({ customer_name: v.customer_name, phone: v.phone ?? null, notes: v.notes ?? null, service_id: chosen.id, start: `${date}T${time}` }) });
      toast.show({ message: `Booked ${v.customer_name} for ${dayLabel(date)}, ${clockLabel(time)}`, tone: "success", action: { label: "View schedule", onClick: onBooked } });
      setTime(null); setFormKey((k) => k + 1); void load();
    } catch (e) {
      const f = failure(e);
      if (f.field === "customer_name" || f.field === "phone" || f.field === "notes") setErrors({ [f.field]: f.message });
      else { setProblem(f.message); setTime(null); void load(); }   // the time was taken a moment ago: show the fresh slots
    }
  };

  return (
    <Page title={label("title.book", "Book an appointment")} subtitle="Pick a day and a service, then a free time">
      {services.error ? <Callout tone="danger" title="Couldn't load the services">{services.error}</Callout> : null}
      {!services.loading && !services.error && !services.rows.length ? (
        <Empty title="Add a service first" hint="Bookings are for a service, such as a consultation. Add one on the Services page." object="calendar" />
      ) : (
        <>
          <Card title="Day and service">
            <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 160px", minWidth: 0 }}><Field type="date" name="day" label="Day" value={date} onChange={(v) => v && setDate(String(v))} /></div>
              <div style={{ flex: "2 1 200px", minWidth: 0 }}>
                <Field type="select" name="service" label="Service" options={services.rows.map((s) => `${s.name} · ${s.minutes} min`)} value={chosen ? `${chosen.name} · ${chosen.minutes} min` : null}
                  onChange={(v) => setServiceId(services.rows.find((s) => `${s.name} · ${s.minutes} min` === v)?.id ?? null)} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <Button size="sm" variant="ghost" icon="chevron-left" onClick={() => setDate(addDays(date, -1))}>Previous day</Button>
              <Button size="sm" variant="ghost" onClick={() => setDate(today)}>Today</Button>
              <Button size="sm" variant="ghost" icon="chevron-right" onClick={() => setDate(addDays(date, 1))}>Next day</Button>
            </div>
          </Card>
          <Card title={`Free times on ${dayLabel(date)}`}>
            {slotError ? <Callout tone="danger" title="Couldn't load the times">{slotError}</Callout>
              : !slots || services.loading ? <Skeleton variant="card" lines={3} />
              : slots.closed ? <Callout tone="neutral" icon="moon" title="Closed">No bookings are taken on this day. Pick another.</Callout>
              
              : <SlotPicker open={slots.open!} close={slots.close!} slotMinutes={slots.slotMinutes} length={slots.length} taken={slots.taken} past={gone} value={time} onChange={setTime} label={`Times on ${dayLabel(date)}`} />}
          </Card>
          {problem ? <Callout tone="danger" title="Couldn't book that">{problem}</Callout> : null}
          {time ? (
            <Card title={`Who is coming at ${clockLabel(time)}?`}>
              <Form key={formKey} fields={[
                { type: "text", name: "customer_name", label: "Name", required: true },
                { type: "text", name: "phone", label: "Phone" },
                { type: "longtext", name: "notes", label: "Notes" },
              ]} submitLabel={`Book ${clockLabel(time)}`} errors={errors} onSubmit={book} />
            </Card>
          ) : null}
        </>
      )}
    </Page>
  );
}
