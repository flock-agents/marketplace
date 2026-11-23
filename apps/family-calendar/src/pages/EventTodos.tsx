import { Card, Checklist, useToast } from "../flock/ui";
import { dayLabel, setTodoDone, type Todo } from "./shared";

/** An event's to-dos, opened with the event: each with the day it is due; a tick settles it (and marks it done on the family's
 *  list). One someone else had already done says so. */
export function EventTodos({ eventId, todos, onChanged }: { eventId: string; todos: Todo[]; onChanged: () => void }) {
  const toast = useToast();
  if (!todos.length) return null;
  const toggle = async (key: string, done: boolean) => {
    try {
      const r = await setTodoDone(eventId, key, done);
      if (r?.message) toast.show({ message: r.message, tone: "success" });
    } catch { toast.show({ message: "Couldn't save", tone: "danger" }); }
    onChanged();
  };
  return (
    <Card title="To-dos">
      <Checklist items={todos.map((t) => ({ id: t.key, label: t.title, done: t.done, meta: t.done && t.note ? t.note : `By ${dayLabel(t.due)}` }))} onToggle={(id, done) => void toggle(id, done)} />
    </Card>
  );
}
