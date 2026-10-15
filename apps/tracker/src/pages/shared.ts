export interface Item {
  id: string; title: string; status: string; owner: string | null; due: string | null; priority: string | null;
  notes: string | null; created_at: string; updated_at: string; updated_by: string | null;
}
import { STATUSES as STATUS_LIST, PRIORITIES as PRIORITY_LIST } from "../../server/db/constants";

export const STATUSES: string[] = [...STATUS_LIST];
export const PRIORITIES: string[] = [...PRIORITY_LIST];
export const STATUS_TONES = { New: "info", "In progress": "accent", Waiting: "warning", Done: "success" } as const;
export const PRIORITY_TONES = { Low: "muted", Normal: "neutral", High: "danger" } as const;

/** Today as an ISO date in the viewer's own time zone. */
export const today = (plusDays = 0): string => {
  const d = new Date(); d.setDate(d.getDate() + plusDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** The form fields for one row. The statuses and priorities live in server/db/constants.ts. */
export const FIELDS = [
  { type: "text", name: "title", label: "Title", required: true },
  { type: "select", name: "status", label: "Status", options: STATUSES },
  { type: "person", name: "owner", label: "Owner" },
  { type: "date", name: "due", label: "Due" },
  { type: "select", name: "priority", label: "Priority", options: PRIORITIES },
  { type: "longtext", name: "notes", label: "Notes" },
] as const;
