import { KINDS as KIND_LIST, PEOPLE as PEOPLE_LIST, STATUSES as STATUS_LIST } from "../../server/db/constants";

export interface PlanItem { id: string; day: string; time: string | null; kind: string; title: string; detail: string | null }
export interface Booking { id: string; what: string; ref: string | null; when: string | null; status: string; cost: number | null; plan_id?: string | null }
export interface PackItem { id: string; item: string; who: string; packed: boolean | null }
export interface BudgetRow { id: string; category: string; spent: number | null; limit_amount: number }
/** What the chat is pointed at: the row the viewer last picked. */
export type Selected = { table: string; id: string; label: string } | null;

export const KINDS: string[] = [...KIND_LIST];
export const PEOPLE: string[] = [...PEOPLE_LIST];
export const STATUSES: string[] = [...STATUS_LIST];
export const STATUS_TONES = { Confirmed: "success", Pending: "warning", Cancelled: "danger" } as const;
/** Plan kinds: the icon for the row and the tone of its edge. */
export const KIND_LOOK: Record<string, { label: string; icon: string; tone: "info" | "accent" | "warning" | "success" | "neutral" }> = {
  flight: { label: "Flight", icon: "plane", tone: "info" },
  stay: { label: "Stay", icon: "bed-double", tone: "accent" },
  food: { label: "Food", icon: "utensils", tone: "warning" },
  do: { label: "Activity", icon: "sun", tone: "success" },
};

/** Today as an ISO date in the viewer's own time zone. */
export const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** "9:30", "930" or "9.30" as 24h "09:30"; anything else is kept as typed. */
export const normaliseTime = (t: unknown): string | null => {
  const s = String(t ?? "").trim();
  if (!s) return null;
  const m = /^(\d{1,2})[:.]?(\d{2})$/.exec(s);
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1].padStart(2, "0")}:${m[2]}` : s;
};

export type FieldDef = { type: "text" | "longtext" | "number" | "money" | "date" | "select" | "multi" | "checkbox" | "person" | "url"; name: string; label: string; options?: string[]; required?: boolean };
export const PLAN_FIELDS: FieldDef[] = [
  { type: "date", name: "day", label: "Day", required: true },
  { type: "text", name: "time", label: "Time (24h, like 19:30)" },
  { type: "select", name: "kind", label: "Kind", options: KINDS, required: true },
  { type: "text", name: "title", label: "What", required: true },
  { type: "text", name: "detail", label: "Detail" },
];
export const BOOKING_FIELDS: FieldDef[] = [
  { type: "text", name: "what", label: "What", required: true },
  { type: "text", name: "ref", label: "Reference" },
  { type: "date", name: "when", label: "Date" },
  { type: "select", name: "status", label: "Status", options: STATUSES },
  { type: "money", name: "cost", label: "Cost" },
];
