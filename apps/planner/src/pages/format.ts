// The words the pages show for a dish, an order, an everyday item and a recipe. No React and no library import here, so
// the wording is tested on its own. The dates, the grocery apps' names and a dish's line are the server's own.
import { clockText, dayLabel } from "../../server/dates";
import { APP_NAMES, type GroceryApp } from "../../server/db/constants";
import { dishText } from "../../server/dishText";

/** A dish in one line, "Parathas (for Dad)": the same words the messages use. */
export const forText = dishText;

/** What follows a dish's name in that line: "(for Dad)", "(4 for me, 1 for wife)", or nothing for a dish for everyone. */
export const dishNote = (d: Parameters<typeof dishText>[0]): string => dishText(d).slice(d.name.length).trim();

/** A list kept as JSON text (or already read): anything else reads as empty. */
export function textList<T = string>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (typeof v !== "string" || !v) return [];
  try { const out = JSON.parse(v); return Array.isArray(out) ? out : []; } catch { return []; }
}

export const STATUS_TEXT: Record<string, string> = { scheduled: "scheduled", placed: "placed, waiting for payment", paid: "paid", not_paid: "not paid", cancelled: "cancelled" };
/** The orders that went to a grocery app: only those name it. */
const WENT_OUT = ["placed", "paid", "not_paid"];

/** An order by when it is placed: "Sat 21 Nov, 6 pm". */
export function orderWhen(o: { place_at: string }): string {
  const [date, time] = o.place_at.split("T");
  return time ? `${dayLabel(date)}, ${clockText(time)}` : dayLabel(date);
}

/** Is the assistant placing this order now? It was handed the order, and has not recorded what happened yet. */
export const beingPlaced = (o: { status: string; wake_sent_at?: string | null }): boolean => o.status === "scheduled" && !!o.wake_sent_at;

/** "Sat 21 Nov, 6 pm · Zepto · placed, waiting for payment", "Tue 24 Nov, 6 pm · scheduled", or "… · being placed". */
export function orderHeading(o: { place_at: string; app: string; status: string; wake_sent_at?: string | null }): string {
  const app = WENT_OUT.includes(o.status) ? APP_NAMES[o.app as GroceryApp] ?? o.app : null;
  return [orderWhen(o), app, beingPlaced(o) ? "being placed" : STATUS_TEXT[o.status] ?? o.status].filter(Boolean).join(" · ");
}

/** Is a profile carried over from the old Meal Planner still waiting to be turned into people, rules, the cook and slots? */
export const profileWaiting = (house: { profile_to_structure?: string | null }): boolean => !!house.profile_to_structure?.trim();

/** What an order costs: the amount recorded from the grocery app when there is one, else the estimate added up from its
 *  lines (`estimate`: shown as "about"). Null when neither is known. */
export function orderMoney(o: { total: number; recorded_total: number | null }): { amount: number; estimate: boolean } | null {
  if (o.recorded_total != null) return { amount: o.recorded_total, estimate: false };
  return o.total > 0 ? { amount: o.total, estimate: true } : null;
}

/** What an order line is for: "Mon 23 Nov lunch: Aloo gobi · Everyday: milk". Empty for a line the family added. */
export function lineFor(l: { sources: unknown }): string {
  return textList<{ label?: unknown }>(l.sources).map((s) => (typeof s?.label === "string" ? s.label : "")).filter(Boolean).join(" · ");
}

type Regular = { amount: number | null; unit: string | null; every: string; times_per_week?: number | null; weekdays?: unknown; paused_until?: string | null };

/** Is the item paused on `today`? A pause runs up to and including its date. */
export function pausedNow(r: { paused_until?: string | null }, today: string): boolean { return !!r.paused_until && r.paused_until >= today; }

/** "1 l a day", "1 pack twice a week", "6 a week", "500 g on Mon, Wed, Fri", plus " · paused until Sun 29 Nov". With
 *  `today`, a pause that is over is left out. */
export function regularText(r: Regular, today?: string): string {
  const much = [r.amount ?? 1, r.unit?.trim()].filter(Boolean).join(" ");
  const times = r.times_per_week ?? 1;
  const often = r.every === "day" ? "a day"
    : r.every === "weekdays" ? `on ${textList(r.weekdays).join(", ")}`
    : times === 1 ? "a week" : times === 2 ? "twice a week" : `${times} times a week`;
  const paused = r.paused_until && (!today || pausedNow(r, today)) ? ` · paused until ${dayLabel(r.paused_until)}` : "";
  return `${much} ${often}${paused}`;
}

/** Where a saved recipe is from: "Instagram", "YouTube" or "Link". */
export function recipeSourceLabel(r: { source: string | null }): "Instagram" | "YouTube" | "Link" {
  return r.source === "instagram" ? "Instagram" : r.source === "youtube" ? "YouTube" : "Link";
}
