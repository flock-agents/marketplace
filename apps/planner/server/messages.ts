// The messages the app writes for its agent to send, word for word: the order going out, the two daily check-ins, the
// how-to-use intro and the line about an order nobody paid for; and what a recipe's link says about itself (where it is from, its thumbnail). Text in, text out: nothing
// here reads the database, and nothing imported here is server-only, so the pages can use it too.
import { APP_NAMES, type GroceryApp } from "./db/constants";
import { clockText, dayLabel } from "./dates";
import { dishText } from "./dishText";
import type { MealView } from "./meals";

export { dishText } from "./dishText";
export { clockText } from "./dates";

export type OrderLineText = { item: string; name_on_app?: string | null; qty?: number | null; price?: number | null };

const SHOWN_LINES = 8;
/** Rupees as the app's pages write them (the component library's formatINR): whole, digits grouped the Indian way. The
 *  library is the pages' own, not the server's, so the same format is written here. */
const rupees = (n: number): string => `₹${new Intl.NumberFormat("en-IN").format(Math.round(n))}`;
const ANYTHING = "Anything to change?";
const notOnAnOrder = (missing: string[]): string[] => (missing.length ? [`Not on any order yet: ${missing.join(", ")}.`] : []);

/** What the agent says just before an order is placed: "Ordering this now: Aashirvaad Atta 5 kg, Amul Taaza 500 ml ×4,
 *  ~₹405 on Zepto". The estimate adds up the lines that have a price, and is left out when none has. */
export function orderingNowText(o: { app: string; lines: OrderLineText[] }): string {
  const qty = (l: OrderLineText) => l.qty ?? 1;
  const names = o.lines.slice(0, SHOWN_LINES).map((l) => `${l.name_on_app ?? l.item}${qty(l) > 1 ? ` ×${qty(l)}` : ""}`);
  const more = o.lines.length - names.length;
  const priced = o.lines.filter((l) => l.price != null);
  const total = priced.length ? `, ~${rupees(priced.reduce((sum, l) => sum + qty(l) * l.price!, 0))}` : "";
  return `Ordering this now: ${names.join(", ")}${more > 0 ? ` and ${more} more` : ""}${total} on ${APP_NAMES[o.app as GroceryApp] ?? o.app}`;
}

/** The afternoon check-in about tonight's dinner: its dishes, the fresh items it needs that are on an order (`covered`) and
 *  the ones on none (`missing`). Null when there is nothing to check: no dinner, one ordered in, or one with no dishes. */
export function dinnerCheckText(i: { meal: MealView | null; missing: string[]; covered: string[] }): string | null {
  if (!i.meal || i.meal.ordered_in || !i.meal.dishes.length) return null;
  return [
    `Tonight's dinner: ${i.meal.dishes.map(dishText).join(", ")}.`,
    ...(i.covered.length ? [`Fresh items on an order: ${i.covered.join(", ")}.`] : []),
    ...notOnAnOrder(i.missing),
    ANYTHING,
  ].join("\n");
}

/** The evening check-in about tomorrow, which is also the cook's brief: each meal on its own line, then the videos of its
 *  dishes (for the cook when they come that day). Null when no meal is planned. */
export function tomorrowCheckText(i: { date: string; meals: MealView[]; cook?: { name: string; arrival: string; today: boolean };
  videos: { dish: string; url: string }[]; missing: string[] }): string | null {
  const meals = i.meals.filter((m) => m.ordered_in || m.dishes.length);
  if (!meals.length) return null;
  const videos = i.videos.map((v) => `${v.dish} ${v.url}`).join(", ");
  // "07:30" reads "7:30": the cook's arrival as it was given, without the leading zero.
  const forWhom = i.cook?.today ? `For ${i.cook.name} (comes ${i.cook.arrival.replace(/^0/, "")})` : "Videos";
  return [
    `Tomorrow, ${dayLabel(i.date)}:`,
    ...meals.map((m) => `${m.slot}: ${m.ordered_in ? "ordering in" : m.dishes.map(dishText).join(", ")}`),
    ...(videos ? [`${forWhom}: ${videos}`] : []),
    ...notOnAnOrder(i.missing),
    ANYTHING,
  ].join("\n");
}

/** The how-to-use message, sent once the first week is planned and its first order placed. `orderDay` is that order's day
 *  ("Saturday"); `times` are when the two check-ins really run, as "HH:MM". */
export function introText(orderDay: string, times: { dinner: string; tomorrow: string }): string {
  return [
    `Your week is planned and ${orderDay}'s order is placed. How it works:`,
    "• Change any meal by telling me, or in the app (Week).",
    `• I check in at ${clockText(times.dinner)} about dinner and ${clockText(times.tomorrow)} about tomorrow; reply to change anything. Times can be changed.`,
    "• Orders go out on their own; I message you just before. Tell me to add anything.",
    "• Saw a recipe on Instagram or YouTube? Share it here and say \"save this\"; I'll keep it and can plan it in.",
    "• Everyday items (milk, curd, eggs) are ordered automatically; tell me to change them.",
  ].join("\n");
}

/** The one line said when a placed order was not paid and the app closed it: its items are back on the app's open cart.
 *  `appName` is the app's name ("Zepto"), `placedDay` the day it was placed ("Monday"). */
export function unpaidText(appName: string, placedDay: string): string {
  return `${placedDay}'s ${appName} order wasn't paid, so its items are back in your cart.`;
}

// ── Recipe links ──

/** A link read as a URL, or null when it is not one. */
const urlOf = (link: string): URL | null => { try { return new URL(link.trim()); } catch { return null; } };
/** A site's name without the "www." or "m." in front. */
export const hostOf = (url: URL): string => url.hostname.toLowerCase().replace(/^(www|m)\./, "");

export function linkSource(url: string): "instagram" | "youtube" | "other" {
  const u = urlOf(url), host = u ? hostOf(u) : "";
  if (host === "instagram.com" || host === "instagr.am") return "instagram";
  return host === "youtube.com" || host === "youtu.be" ? "youtube" : "other";
}

/** A YouTube video's id, from youtube.com/watch?v=, youtu.be/ and /shorts/ links; null for any other link. */
export function youtubeId(url: string): string | null {
  const u = urlOf(url);
  if (!u || linkSource(url) !== "youtube") return null;
  const id = hostOf(u) === "youtu.be" ? u.pathname.split("/")[1]
    : u.pathname === "/watch" ? u.searchParams.get("v")
    : /^\/shorts\/([^/]+)/.exec(u.pathname)?.[1];
  return id || null;
}

export function youtubeThumb(url: string): string | null {
  const id = youtubeId(url);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}
