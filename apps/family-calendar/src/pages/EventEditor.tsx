import { useState } from "react";
import { Button, Card, Confirm, Form } from "../flock/ui";
import { normaliseEvent, type EventPatch } from "./dates";
import { eventFields, type Event } from "./shared";

interface Props {
  title: string;
  names: string[];                       // the family, as suggestions for Who
  event?: Event;                         // editing this one; adding one when absent
  date?: string;                         // the day a new event starts on
  onSave: (row: EventPatch) => Promise<void>;
  onCancel: () => void;
  onRemove?: () => Promise<void>;
}

/** Add or change one event, in place. Times are typed ("16:30" or "4:30 pm"); a bad one is said under its field. */
export function EventEditor({ title, names, event, date, onSave, onCancel, onRemove }: Props) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [asking, setAsking] = useState(false);
  const submit = async (values: Record<string, unknown>) => {
    const r = normaliseEvent(values);
    if (!r.ok) { setErrors(r.errors); return; }
    setErrors({});
    await onSave(r.row);
  };
  return (
    <Card title={title} actions={onRemove ? <Button size="sm" variant="ghost" icon="trash" onClick={() => setAsking(true)}>Delete</Button> : undefined}>
      <Form fields={[...eventFields(names)]} initial={event ? { ...event } : { date }} errors={errors} submitLabel={event ? "Save" : "Add"} onSubmit={submit} onCancel={onCancel} />
      {onRemove ? <Confirm open={asking} title="Delete this event?" body="It comes off the calendar. You can undo it for a few seconds." confirmLabel="Delete" tone="danger" onConfirm={() => { setAsking(false); void onRemove(); }} onCancel={() => setAsking(false)} /> : null}
    </Card>
  );
}
