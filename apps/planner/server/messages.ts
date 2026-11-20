// The messages the app writes for its agent to send, word for word: the order going out, the two daily reminders, the
// how-to-use intro and the line about an order nobody paid for; and what a recipe's link says about itself (where it is from, its thumbnail). Text in, text out: nothing
// here reads the database, and nothing imported here is server-only, so the pages can use it too.
import { APP_NAMES, type GroceryApp } from "./db/constants";
import { clockText } from "./dates";
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
/** The lines' total, or null when there are none or any has no price. */
const totalOf = (lines: OrderLineText[]): number | null =>
  lines.length && lines.every((l) => l.price != null) ? lines.reduce((sum, l) => sum + (l.qty ?? 1) * l.price!, 0) : null;

/** What the agent says just before an order is placed: "Ordering this now: Aashirvaad Atta 5 kg, Amul Taaza 500 ml ×4,
 *  ~₹405 on Zepto". The estimate adds up every line, and is left out when any line has no price (a part total would read
 *  as the whole). */
export function orderingNowText(o: { app: string; lines: OrderLineText[] }): string {
  const qty = (l: OrderLineText) => l.qty ?? 1;
  const names = o.lines.slice(0, SHOWN_LINES).map((l) => `${l.name_on_app ?? l.item}${qty(l) > 1 ? ` ×${qty(l)}` : ""}`);
  const more = o.lines.length - names.length;
  const sum = totalOf(o.lines);
  const total = sum == null ? "" : `, ~${rupees(sum)}`;
  return `Ordering this now: ${names.join(", ")}${more > 0 ? ` and ${more} more` : ""}${total} on ${APP_NAMES[o.app as GroceryApp] ?? o.app}`;
}

// ── The reminder (reminder.ts builds it) ──

/** "a", "a and b", "a, b and c". */
export const andList = (xs: string[]): string => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const daysAgo = (n: number): string => `${n} day${n === 1 ? "" : "s"} ago`;
const STILL_IN_STOCK = "Still in stock? If yes, when should I remind you?";

/** What a reminder's text is made of (reminder.ts Reminder). `carts` holds the lines of the carts it ordered. */
export type ReminderText = { which: "afternoon" | "evening"; meals: MealView[]; ask_ingredients: string[]; added: { item: string }[];
  cart_items: string[]; asks: { item: string; days_ago: number }[]; delivery_gap: { app: string; rupees: number } | null;
  ordered: { order_id: string; app: string }[]; carts: { order_id: string; lines: OrderLineText[] }[]; empty: boolean };

/** The reminder as the agent sends it: the meals it covers and the ingredients to check; then the cart (what was added, else
 *  what is on it, or what was ordered without asking); the items that may be running low, numbered, asked together; and how
 *  far the cart is from free delivery. `app`: the app chat's text, without the item lines (its block asks them). Empty: "". */
export function reminderText(r: ReminderText, opts: { app?: boolean } = {}): string {
  if (r.empty) return "";
  const meal = (m: MealView) => (m.ordered_in ? "ordering in" : m.dishes.map(dishText).join(", "));
  const top: string[] = [];
  if (r.meals.length) {
    const meals = r.meals.map(meal).join(" · ");
    top.push(r.which === "afternoon" ? `Tonight: ${meals}. ${ANYTHING}` : `Tomorrow: ${meals}`);
    if (r.ask_ingredients.length) top.push(`Do you have ${andList(r.ask_ingredients)}?`);
  }
  const rest: string[] = [];
  if (r.ordered.length) {
    for (const o of r.ordered) {
      const lines = (r.carts.find((c) => c.order_id === o.order_id)?.lines ?? []).filter((l) => (l.qty ?? 0) > 0);
      const sum = totalOf(lines);
      const total = sum == null ? "" : `, about ${rupees(sum)}`;
      rest.push(`I've ordered ${andList(lines.map((l) => l.item))} on ${APP_NAMES[o.app as GroceryApp] ?? o.app}${total}.`);
    }
  } else if (r.added.length) rest.push(`I've added ${andList([...new Set(r.added.map((a) => a.item))])} to your cart.`);
  else if (r.cart_items.length) rest.push(`Your cart: ${andList(r.cart_items)}.`);
  if (r.asks.length === 1) {
    if (!opts.app) rest.push(`${capital(r.asks[0].item)}, bought ${daysAgo(r.asks[0].days_ago)}.`);
    rest.push(STILL_IN_STOCK);
  } else if (r.asks.length) {
    rest.push("A few things were bought a while ago:");
    if (!opts.app) r.asks.forEach((a, i) => rest.push(`${i + 1}. ${capital(a.item)}, ${daysAgo(a.days_ago)}`));
    rest.push(STILL_IN_STOCK);
  }
  if (r.delivery_gap) rest.push(`${rupees(r.delivery_gap.rupees)} short of free delivery on ${r.delivery_gap.app}.`);
  return [top.join("\n"), rest.join("\n")].filter(Boolean).join("\n\n");
}

/** The stock check's answers, in the app chat. The guide maps them to answer_running_low: low; in_stock with days 3, 7 or 14;
 *  in_stock without days. */
export const STOCK_OPTIONS = ["Low, add it", "Fine for 3 days", "Fine for a week", "Fine for 2 weeks", "Fine, not sure how long"];

/** The stock check as a chat block: one item is one Choice, two to five are a Questions of Choice tabs. Null with none. */
export function stockBlock(asks: { item: string; days_ago: number }[], id: string): object | null {
  if (!asks.length) return null;
  if (asks.length === 1) return { type: "Choice", id, props: { question: `${capital(asks[0].item)}, ${daysAgo(asks[0].days_ago)}. Still in stock?`, options: STOCK_OPTIONS } };
  return { type: "Questions", id, props: { title: "Still in stock?", submitLabel: "Send" },
    children: asks.map((a) => ({ type: "Choice", props: { tab: capital(a.item), question: `${capital(a.item)}, ${daysAgo(a.days_ago)}`, options: STOCK_OPTIONS } })) };
}

/** The link to the Week page, opening the week planned (`weekStart`, its Monday). `flock_scope=app` marks it for Flock, which signs
 *  the person in to this app only and drops the marker. */
export function weekLink(basePath: string, weekStart?: string): string { return `${basePath}/?flock_scope=app#/week${weekStart ? `?week=${weekStart}` : ""}`; }

/** What the agent is told to do with a closing plan_week's answer: the message as it is (its link is the only one, signed in to
 *  this app), the intro once when there is one, and nothing after. */
export function weekSendText(intro: boolean): string {
  return [
    "Forward message to the family verbatim, word for word, as one message.",
    "It already holds the only link they need (the Week page, signed in to this app): send no other link, no link of your own, and do not reword it.",
    intro ? "Then send intro verbatim, once, exactly as given: never paraphrase it, and never send it again." : null,
    `After sending ${intro ? "them" : "it"}, end your turn.`,
  ].filter(Boolean).join(" ");
}

/** The Sunday message once the week is planned: Monday's meals and the link to the rest. `monday` is Monday's meals, empty when it is
 *  not a cooking day or has none. */
export function weekMessage(i: { monday: MealView[]; link: string }): string {
  const meals = i.monday.map((m) => (m.ordered_in ? "ordering in" : m.dishes.map(dishText).join(", "))).filter(Boolean);
  return [
    "Next week is planned.",
    `Monday: ${meals.length ? meals.join(" · ") : "nothing planned"}`,
    "",
    `The whole week: [Week page](${i.link})`,
    "Tell me anything to change.",
  ].join("\n");
}

/** A time of day as it reads inside a sentence: "3", "7:30" (no am or pm). */
const bare = (time: string): string => clockText(time).replace(/ [ap]m$/, "");
const partOfDay = (time: string): string => { const h = Number(time.split(":")[0]); return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening"; };

/** The how-to-use message, sent once with the first week. `times` are when the plan and the two reminders really run, as "HH:MM";
 *  `everyday` are the family's everyday items bought on the apps (subscriptions left out): the first two are named; with none
 *  known yet, the cart fills with them once the family orders. */
export function introText(times: { plan: string; afternoon: string; evening: string }, everyday: string[]): string {
  const named = andList(everyday.slice(0, 2));
  const each = named
    ? `each time I put your ${named} in the cart and mention anything that may be running low.`
    : "each time I mention anything that may be running low, and once you order, your cart fills with your everyday items.";
  return [
    "Your week is planned. How it works:",
    `• Every Sunday ${partOfDay(times.plan)} I plan the week. Change any meal by telling me, or in the app (Week).`,
    `• Every day at ${bare(times.afternoon)} I check tonight's dinner and at ${bare(times.evening)} tomorrow's meals; ${each} Reply and I order it together. Nothing is ordered until you reply.`,
    "• Saw a recipe on Instagram or YouTube? Share it here and say \"save this\"; I'll keep it and can plan it in.",
    "• Times can be changed, and you can tell me to order without asking.",
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
