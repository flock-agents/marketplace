import { Card, Checklist, useToast } from "../flock/ui";
import { dayLabel, setTodoDone, type Todo } from "./shared";

/** An event's to-dos, opened with the event: each with the day it is due; a tick settles it (and takes it off the family's list). */
export function EventTodos({ eventId, todos, onChanged }: { eventId: string; todos: Todo[]; onChanged: () => void }) {
  const toast = useToast();
  if (!todos.length) return null;
  const toggle = async (key: string, done: boolean) => {
    try { await setTodoDone(eventId, key, done); } catch { toast.show({ message: "Couldn't save", tone: "danger" }); }
    onChanged();
  };
  return (
    <Card title="To-dos">
      <Checklist items={todos.map((t) => ({ id: t.key, label: t.title, done: t.done, meta: `By ${dayLabel(t.due)}` }))} onToggle={(id, done) => void toggle(id, done)} />
    </Card>
  );
}
