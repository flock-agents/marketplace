export interface Meal {
  id: string; date: string; slot: string; dish: string; recipe_id: string | null; created_at?: string; updated_at: string;
  status: string; confirmed_by: string | null; confirmed_at: string | null; portions: string | null; coach_check: string; coach_notes: string | null; note?: string | null;
}
export interface PrepStep { step: string; hours_before_cook: number }
export interface Recipe {
  id: string; name: string; ingredients: string | null; method: string | null; notes: string | null;
  prep_steps: string | null; prep_lead_hours: number | null;
}
export interface Grocery {
  id: string; item: string; aisle: string | null;
  done: boolean | null;                                          // legacy, predates `status` — never read or written; `status` alone is the source of truth
  for_dish: string | null;
  category: string | null; needed_by: string | null; buy_at: string | null; qty: string | null;
  source: string | null; added_by: string | null; status: string | null; service: string | null; price: number | null; cart_id: string | null;
  in_stock_until: string | null;                                // already have it: off the timeline until this date passes
}
export interface Diner { id: string; name: string; goal: string | null; kcal_target: number | null; protein_g_target: number | null; fat_note: string | null; source: string | null }
/** One ingredient, in the quantity for ONE REGULAR ADULT PORTION; what the suggested-quantity math (src/pages/portions.ts) reads from. */
export interface RecipeIngredient { id: string; recipe_id: string; item: string; qty: number | null; unit: string | null; category: string | null }
/** Background-only: a diner's typical portion relative to one adult serving. Never shown in any settings, column or edit UI. */
export interface DinerPortionRow { id: string; diner_id: string; slot: string; multiplier: number }
export interface Staple {
  id: string; item: string; pack: string | null; category: string; every_min_days: number | null; every_max_days: number | null;
  max_days_ahead: number | null; usual_qty: string | null; usual_price: number | null; last_ordered_at: string | null; last_checked_at: string | null; active: boolean | null;
}
export interface Cart {
  id: string; buy_at: string; categories: string | null; status: string; checkin_sent_at: string | null; owner_notes: string | null;
  estimate: number | null; chosen_service: string | null; items_total: number | null; fees: string | null; grand_total: number | null;
  quotes: string | null; delivery_eta: string | null; confirmed_by: string | null; order_ref: string | null; ordered_at: string | null; updated_at: string;
}

import { SLOTS as SLOT_LIST, AISLES as AISLE_LIST, BUY_CATEGORIES as CATEGORY_LIST, CART_STATUSES as CART_STATUS_LIST } from "../../server/db/constants";
import { relativeDate } from "../flock/ui";

export const SLOTS: string[] = [...SLOT_LIST];
export const AISLES: string[] = [...AISLE_LIST];
export const CATEGORIES: string[] = [...CATEGORY_LIST];
export const CART_STATUSES: string[] = [...CART_STATUS_LIST];

/** The grocery-service skill ids, as the family knows the services by name. */
export const SERVICE_NAMES: Record<string, string> = { zepto: "Zepto", "zomato-blinkit": "Blinkit", bigbasket: "BigBasket", "swiggy-instamart": "Instamart" };
export const serviceLabel = (id: string | null): string => (id ? SERVICE_NAMES[id] ?? id : "Not chosen yet");

export const CATEGORY_LABELS: Record<string, string> = { dairy: "Dairy", vegetables: "Vegetables", pantry: "Pantry", spices: "Spices/Condiments" };
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

/** Today as an ISO date in the viewer's own time zone. */
export const today = (): string => iso(new Date());
export const addDays = (s: string, n: number): string => { const d = parse(s); return iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)); };

export interface DateOption { label: string; value: string }

/** Quick picks for "Already have it, until" — the one way to push a grocery item's buy-timing out. Postponing
 *  a purchase never moves the item's own `needed_by` (what the dish actually needs it by); it only skips
 *  buying it until this date, same as the owner already has it in stock.
 *
 *  Scaled to the category's own shelf life: milk spoiling in a day or two makes "2 weeks" a meaningless offer,
 *  while a pantry/spice item keeping for weeks makes "3 days" too stingy a ceiling. Mixed or unknown category
 *  (a bulk selection spanning more than one, or a row with none set) falls back to the pantry-ish default. */
const IN_STOCK_DAYS: Record<string, number[]> = {
  dairy: [1, 2, 3], vegetables: [2, 4, 7], pantry: [3, 7, 14], spices: [7, 14, 30],
};
const dayLabel = (n: number): string =>
  n === 30 ? "1 month" : n >= 7 && n % 7 === 0 ? `${n / 7} week${n / 7 > 1 ? "s" : ""}` : `${n} day${n > 1 ? "s" : ""}`;
export const inStockOptionsFor = (category: string | null, today: string): DateOption[] =>
  (IN_STOCK_DAYS[category ?? ""] ?? IN_STOCK_DAYS.pantry).map((n) => ({ label: dayLabel(n), value: addDays(today, n) }));

export type QuickUnit = "hours" | "days" | "weeks" | "months";
export const QUICK_UNIT_OPTIONS: { id: QuickUnit; label: string }[] = [
  { id: "hours", label: "hours" }, { id: "days", label: "days" }, { id: "weeks", label: "weeks" }, { id: "months", label: "months" },
];
const UNIT_FROM_SUFFIX: Record<string, QuickUnit> = {
  h: "hours", hr: "hours", hrs: "hours", hour: "hours", hours: "hours",
  d: "days", day: "days", days: "days",
  w: "weeks", wk: "weeks", wks: "weeks", week: "weeks", weeks: "weeks",
  mo: "months", mon: "months", month: "months", months: "months",
};
const pad2 = (n: number) => String(n).padStart(2, "0");
const isoDateTime = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
function addByUnit(now: Date, amount: number, unit: QuickUnit): Date {
  if (unit === "hours") return new Date(now.getTime() + amount * 60 * 60 * 1000);
  if (unit === "months") return new Date(now.getFullYear(), now.getMonth() + amount, now.getDate(), now.getHours(), now.getMinutes());
  const days = unit === "weeks" ? amount * 7 : amount;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, now.getHours(), now.getMinutes());
}
/** Days/weeks/months land on that day's date alone (same as the quick-pick buttons — "in stock for 5 days"
 *  doesn't mean a particular hour); only "hours" keeps an exact time, since that is a same-day deadline. */
const toValue = (d: Date, unit: QuickUnit): string => (unit === "hours" ? isoDateTime(d) : iso(d));

/** "3h", "5d", "1w", "2 months" read straight off the text; a bare number ("5") pairs with the dropdown unit
 *  next to it; anything else tries `Date.parse` (so "Nov 2" or "2026-11-02 18:00" both work). Returns an ISO
 *  date ("YYYY-MM-DD") or, when an hour or an explicit time was given, a full "YYYY-MM-DDTHH:MM" — or null for
 *  text that parses as neither a duration nor a date. */
export function parseQuickWhen(input: string, unit: QuickUnit, now: Date): string | null {
  const text = input.trim();
  if (!text) return null;
  const suffixed = text.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)$/);
  if (suffixed) {
    const u = UNIT_FROM_SUFFIX[suffixed[2].toLowerCase()];
    return u ? toValue(addByUnit(now, Number(suffixed[1]), u), u) : null;
  }
  if (/^\d+(?:\.\d+)?$/.test(text)) return toValue(addByUnit(now, Number(text), unit), unit);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return /\d{1,2}:\d{2}/.test(text) ? isoDateTime(parsed) : iso(parsed);
}
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
  { type: "text", name: "qty", label: "Quantity" },
  { type: "select", name: "aisle", label: "Aisle", options: AISLES },
  { type: "select", name: "category", label: "Category", options: CATEGORIES },
  { type: "date", name: "needed_by", label: "Needed by" },
  { type: "text", name: "for_dish", label: "For which dish" },
  { type: "date", name: "in_stock_until", label: "Already have it, until" },
] as const;

/** "6:30 AM" from a "YYYY-MM-DDTHH:MM" local timestamp. */
export const timeOfDay = (dt: string): string => {
  const hm = dt.slice(11, 16); if (!hm.includes(":")) return "";
  const [h, m] = hm.split(":").map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
/** "today", "yesterday", "tomorrow" or "Oct 6", to follow a word ("Last planned yesterday"). */
export const whenSaid = (s: string, now: string): string => relativeDate(s, now).replace(/^(Today|Yesterday|Tomorrow)\b/, (w) => w.toLowerCase());
/** "today 6:30 AM", "tomorrow 6:30 AM" or "Oct 6, 6:30 AM", from a "YYYY-MM-DDTHH:MM" timestamp. */
export const whenAt = (dt: string, now: string): string => `${whenSaid(dt.slice(0, 10), now)}, ${timeOfDay(dt)}`;
/** "Had Oct 6", "On the plan today", or "Not planned lately". */
export const saidText = (said: { had: boolean; date: string } | null, now: string): string =>
  said ? `${said.had ? "Had" : "On the plan"} ${whenSaid(said.date, now)}` : "Not planned lately";
