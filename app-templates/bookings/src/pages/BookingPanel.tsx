import { useState } from "react";
import { clockLabel, Button, Callout, Card, Confirm, Detail, Field, Form, kitFetch, useToast } from "../flock/ui";
import { STATUSES, STATUS_LABEL, STATUS_TONES, timeChoices, useBookingSettings, dateOf, dayLabel, failure, rangeLabel, timeOf, type Booking } from "./shared";

type Props = { booking: Booking; onClose: () => void };

/** The picked booking, open to mark done or no-show, edit, reschedule, cancel or delete. The server refuses a clash and says which booking is in the way. */
export function BookingPanel({ booking: b, onClose }: Props) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState<"cancel" | "delete" | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [day, setDay] = useState(dateOf(b.start));   // the day picked in the edit form: the time choices follow it
  const [problem, setProblem] = useState<string | null>(null);
  const settings = useBookingSettings();

  const patch = async (body: Record<string, unknown>): Promise<boolean> => {
    setErrors({}); setProblem(null);
    try { await kitFetch(`bookings/${b.id}`, { method: "PATCH", body: JSON.stringify(body) }); return true; }
    catch (e) {
      const f = failure(e);
      const field = f.field === "start" ? "time" : f.field;
      if (field && ["customer_name", "phone", "notes", "status", "time"].includes(field)) setErrors({ [field]: f.message }); else setProblem(f.message);
      return false;
    }
  };
  const setStatus = async (status: string) => { if (await patch({ status })) toast.show({ message: `${b.customer_name}: ${STATUS_LABEL[status].toLowerCase()}`, tone: "success" }); };
  const cancel = async () => { setAsking(null); if (await patch({ status: "cancelled" })) toast.show({ message: `Cancelled ${b.customer_name}`, tone: "success", action: { label: "Undo", onClick: () => { void kitFetch(`bookings/${b.id}`, { method: "PATCH", body: JSON.stringify({ status: "booked" }) }).catch((e) => toast.show({ message: `Couldn't undo: ${failure(e).message}`, tone: "danger" })); } } }); };
  const remove = async () => {
    setAsking(null);
    try {
      const r = await kitFetch<{ row: Booking }>(`bookings/${b.id}`, { method: "DELETE" });
      onClose();
      // The table is private, so the kit has no change to undo: booking the same details again is the undo.
      const { id, service_name, created_at, updated_at, updated_by, minutes, ...details } = r.row;
      toast.show({ message: `Deleted ${b.customer_name}`, tone: "success", action: { label: "Undo", onClick: () => { void kitFetch("bookings", { method: "POST", body: JSON.stringify(details) }).catch((e) => toast.show({ message: `Couldn't undo: ${failure(e).message}`, tone: "danger" })); } } });
    } catch (e) { setProblem(failure(e).message); }
  };
  const save = async (v: Record<string, any>) => {
    const time = choices.find((c) => c.label === String(v.time))?.value ?? timeOf(b.start);
    const ok = await patch({ customer_name: v.customer_name, phone: v.phone ?? null, notes: v.notes ?? null, status: v.status, start: `${day}T${time}` });
    if (ok) setEditing(false);
  };
  const live = b.status === "booked";
  const choices = timeChoices(settings, b, day);

  return (
    <Card
      title={b.customer_name}
      actions={<>
        {editing ? null : <Button size="sm" variant="soft" icon="pencil" onClick={() => setEditing(true)}>Edit</Button>}
        <Button size="sm" variant="ghost" icon="trash" onClick={() => setAsking("delete")}>Delete</Button>
        <Button size="sm" variant="ghost" icon="x" onClick={onClose}>Close</Button>
      </>}
    >
      {problem ? <Callout tone="danger" title="Couldn't save">{problem}</Callout> : null}
      {editing ? (
        <>
        <Field type="date" name="date" label="Day" value={day} onChange={(v) => v && setDay(String(v))} />
        <Form
          key={b.updated_at}
          fields={[
            { type: "text", name: "customer_name", label: "Customer", required: true },
            { type: "text", name: "phone", label: "Phone" },
            { type: "select", name: "time", label: "Time", options: choices.map((c) => c.label), required: true },
            { type: "select", name: "status", label: "Status", options: STATUSES },
            { type: "longtext", name: "notes", label: "Notes" },
          ]}
          initial={{ customer_name: b.customer_name, phone: b.phone, time: clockLabel(timeOf(b.start)), status: b.status, notes: b.notes }}
          errors={errors} onCancel={() => { setEditing(false); setErrors({}); setDay(dateOf(b.start)); }} onSubmit={save}
        />
        </>
      ) : (
        <>
          <Detail fields={[
            { label: "When", value: `${dayLabel(dateOf(b.start))}, ${rangeLabel(b)}` },
            { label: "Service", value: b.service_name },
            { label: "Status", value: b.status, kind: "select", tones: STATUS_TONES },
            { label: "Phone", value: b.phone },
            { label: "Notes", value: b.notes },
          ]} />
          {live ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              <Button size="sm" variant="app" icon="check" onClick={() => void setStatus("done")}>Mark done</Button>
              <Button size="sm" variant="soft" icon="user-x" onClick={() => void setStatus("no_show")}>No-show</Button>
              <Button size="sm" variant="ghost" icon="calendar-x" onClick={() => setAsking("cancel")}>Cancel booking</Button>
            </div>
          ) : null}
        </>
      )}
      <Confirm open={asking === "cancel"} title="Cancel this booking?" body="The time becomes free for someone else. You can undo it for a few seconds." confirmLabel="Cancel booking" tone="danger" onConfirm={cancel} onCancel={() => setAsking(null)} />
      <Confirm open={asking === "delete"} title="Delete this booking?" body="It disappears from the schedule. You can undo it for a few seconds." confirmLabel="Delete" tone="danger" onConfirm={remove} onCancel={() => setAsking(null)} />
    </Card>
  );
}
