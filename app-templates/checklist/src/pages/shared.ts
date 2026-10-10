export interface Task {
  id: string; label: string; group_name: string | null; done: boolean | null; who: string | null; due: string | null;
  created_at: string; updated_at: string; updated_by: string | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const todayIso = (d = new Date()): string => {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** "due 12 Oct", or "overdue 12 Oct" for an open item past its date; nothing when there is no date. */
export function formatDue(due: string | null, done: boolean, today = todayIso()): string {
  if (!due) return "";
  const [, m, d] = due.split("-").map(Number);
  return `${!done && due < today ? "overdue" : "due"} ${d} ${MONTHS[m - 1]}`;
}

/** The form fields for one item. */
export const FIELDS = [
  { type: "text", name: "label", label: "Item", required: true },
  { type: "text", name: "group_name", label: "Group" },
  { type: "person", name: "who", label: "Who" },
  { type: "date", name: "due", label: "Due" },
  { type: "checkbox", name: "done", label: "Done" },
] as const;

/** Open items before done ones; within each, by due date with undated last. Stable, so equal items keep the order they were added in. */
export function orderTasks<T extends { due: string | null; done: boolean | null }>(rows: T[]): T[] {
  return rows.map((r, i) => ({ r, i })).sort((a, b) =>
    Number(!!a.r.done) - Number(!!b.r.done)
    || (a.r.due && b.r.due ? (a.r.due < b.r.due ? -1 : a.r.due > b.r.due ? 1 : 0) : Number(!a.r.due) - Number(!b.r.due))
    || a.i - b.i).map((x) => x.r);
}
