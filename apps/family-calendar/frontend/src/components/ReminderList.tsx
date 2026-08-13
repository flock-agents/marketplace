import type { Reminder } from "@shared/types";
import { api } from "../lib/api";

interface Props {
  reminders: Reminder[];
  onUpdate: () => void;
}

function formatDue(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
  if (isToday) return time;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

export function ReminderList({ reminders, onUpdate }: Props) {
  if (reminders.length === 0) return null;

  const toggleDone = async (r: Reminder) => {
    await api.reminders.update(r.id, { status: r.status === "done" ? "pending" : "done" });
    onUpdate();
  };

  const pending = reminders.filter((r) => r.status === "pending");
  const done = reminders.filter((r) => r.status === "done");

  return (
    <div className="reminders-section">
      <div className="reminders-header">
        <h2>Reminders</h2>
        {pending.length > 0 && <span className="reminder-count">{pending.length}</span>}
      </div>
      <div className="reminder-list">
        {pending.map((r) => (
          <div key={r.id} className="reminder-item">
            <label className="reminder-checkbox">
              <input
                type="checkbox"
                className="reminder-check"
                checked={false}
                onChange={() => toggleDone(r)}
              />
              <span className="checkmark" />
            </label>
            <span className="reminder-title">{r.title}</span>
            <span className="reminder-time">{formatDue(r.dueTime)}</span>
          </div>
        ))}
        {done.map((r) => (
          <div key={r.id} className="reminder-item is-done">
            <label className="reminder-checkbox">
              <input
                type="checkbox"
                className="reminder-check"
                checked={true}
                onChange={() => toggleDone(r)}
              />
              <span className="checkmark" />
            </label>
            <span className="reminder-title">{r.title}</span>
            <span className="reminder-time">{formatDue(r.dueTime)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
