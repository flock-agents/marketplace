export interface Meal { id: string; date: string; slot: string; dish: string; recipe_id: string | null; created_at?: string; updated_at: string }
export interface Recipe { id: string; name: string; ingredients: string | null; method: string | null; notes: string | null }
export interface Grocery { id: string; item: string; aisle: string | null; done: boolean | null; for_dish: string | null }

import { SLOTS as SLOT_LIST, AISLES as AISLE_LIST } from "../../server/db/constants";
import { relativeDate } from "../flock/ui";

export const SLOTS: string[] = [...SLOT_LIST];
export const AISLES: string[] = [...AISLE_LIST];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

/** Today as an ISO date in the viewer's own time zone. */
export const today = (): string => iso(new Date());
/** The Monday on or before an ISO date. */
export const mondayOf = (s: string): string => { const d = parse(s); return iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7))); };
export const addDays = (s: string, n: number): string => { const d = parse(s); return iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)); };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Oct 6" */
export const shortDate = (s: string): string => `${MONTHS[parse(s).getMonth()]} ${parse(s).getDate()}`;
/** "Thu" */
export const weekday = (s: string): string => WEEKDAYS[parse(s).getDay()];

/** The form fields for one recipe. */
export const RECIPE_FIELDS = [
  { type: "text", name: "name", label: "Name", required: true, placeholder: "Rajma chawal" },
  { type: "longtext", name: "ingredients", label: "Ingredients, one per line", placeholder: "Rajma, 1 cup\nOnions, 2" },
  { type: "longtext", name: "method", label: "How we make it", placeholder: "How the family likes it made" },
  { type: "longtext", name: "notes", label: "Notes" },
] as const;

/** The form fields for one grocery item. */
export const GROCERY_FIELDS = [
  { type: "text", name: "item", label: "Item", required: true },
  { type: "select", name: "aisle", label: "Aisle", options: AISLES },
  { type: "text", name: "for_dish", label: "For which dish" },
] as const;

/** "today", "yesterday", "tomorrow" or "Oct 6", to follow a word ("Last planned yesterday"). */
export const whenSaid = (s: string, now: string): string => relativeDate(s, now).replace(/^(Today|Yesterday|Tomorrow)$/, (w) => w.toLowerCase());
/** "Had Oct 6", "On the plan today", or "Not planned lately". */
export const saidText = (said: { had: boolean; date: string } | null, now: string): string =>
  said ? `${said.had ? "Had" : "On the plan"} ${whenSaid(said.date, now)}` : "Not planned lately";
