// The messages the app writes for its agent to send, word for word: the order going out, the two daily reminders, the
// how-to-use intro and the line about an order nobody paid for; and what a recipe's link says about itself (where it is from, its thumbnail). Text in, text out: nothing
// here reads the database, and nothing imported here is server-only, so the pages can use it too.
import { APP_NAMES, type GroceryApp } from "./db/constants";
import { clockText } from "./dates";
import { dishKey, dishText, lastTimeText } from "./dishText";
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
  ordered: { order_id: string; app: string }[]; carts: { order_id: string; lines: OrderLineText[] }[]; empty: boolean;
  /** The next-day question (spec §5.7): yesterday's dishes the family had not eaten before, one line each. */
  feedback?: { dish: string; from: "suggestion" | "reel" }[] };

type ExtraDish = { name: string; video?: { url: string } | null; last_time?: Parameters<typeof lastTimeText>[0] };
/** What the cook should know about the meals' dishes, a line each, only for a dish with something to say: how it went last time
 *  ("Bhindi, last time: too oily") and its video's link ("Rajma chawal video: https://…"). Each dish once. */
export function dishExtras(meals: { ordered_in?: boolean; dishes: ExtraDish[] }[]): string[] {
  const out: string[] = [], seen = new Set<string>();
  for (const m of meals) for (const d of m.ordered_in ? [] : m.dishes) {
    if (seen.has(dishKey(d.name))) continue;
    seen.add(dishKey(d.name));
    const note = lastTimeText(d.last_time), url = d.video?.url;
    if (note && url) out.push(`${capital(d.name)}, last time: ${note}. Video: ${url}`);
    else if (note) out.push(`${capital(d.name)}, last time: ${note}`);
    else if (url) out.push(`${capital(d.name)} video: ${url}`);
  }
  return out;
}

/** The next-day question about one dish the family had not eaten before (spec §5.7, word for word): a planner suggestion, or
 *  a dish from a reel or recipe link they sent. The only question the app asks about what was cooked. */
export const feedbackLine = (f: { dish: string; from: "suggestion" | "reel" }): string => f.from === "reel"
  ? `Yesterday's plan had ${f.dish} from the reel you sent. Did you make it, did you like it, and should I keep suggesting it?`
  : `Yesterday's plan had ${f.dish}, which was new. Did you make it, did you like it, and should I suggest it again?`;

/** The reminder as the agent sends it: the meals it covers and the ingredients to check; then the cart (what was added, else
 *  what is on it, or what was ordered without asking); the items that may be running low, numbered, asked together; and how
 *  far the cart is from free delivery. `app`: the app chat's text, without the item lines (its block asks them). Empty: "". */
export function reminderText(r: ReminderText, opts: { app?: boolean } = {}): string {
  if (r.empty) return "";
  const meal = (m: MealView) => (m.skip === "eaten_out" ? "eating out" : m.ordered_in ? "ordering in" : m.dishes.map(dishText).join(", "));
  const top: string[] = [];
  if (r.meals.length) {
    const meals = r.meals.map(meal).join(" · ");
    top.push(r.which === "afternoon" ? `Tonight: ${meals}. ${ANYTHING}` : `Tomorrow: ${meals}`);
    top.push(...dishExtras(r.meals));
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
  const asked = (r.feedback ?? []).map(feedbackLine).join("\n");
  return [top.join("\n"), rest.join("\n"), asked].filter(Boolean).join("\n\n");
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

/** What the agent is told to do with a planned week's message (closeWeek, make_plan): the message as it is (its link is the only one, signed in to
 *  this app), the intro once when there is one, and nothing after. */
export function weekSendText(intro: boolean): string {
  return [
    "Forward message to the family verbatim, word for word, as one message.",
    "It already holds the only links they need (the Week page, signed in to this app, and a dish's video when it has one): send no other link, no link of your own, and do not reword it.",
    intro ? "Then send intro verbatim, once, exactly as given: never paraphrase it, and never send it again." : null,
    `After sending ${intro ? "them" : "it"}, end your turn.`,
  ].filter(Boolean).join(" ");
}

/** The Sunday message once the week is planned: Monday's meals and the link to the rest. `monday` is Monday's meals, empty when it has
 *  none. `unmet`: what the plan could not keep (the stepped plan's last resort), said plainly. */
export function weekMessage(i: { monday: MealView[]; link: string; unmet?: string[] }): string {
  const meals = i.monday.map((m) => (m.skip === "eaten_out" ? "eating out" : m.ordered_in ? "ordering in" : m.dishes.map(dishText).join(", "))).filter(Boolean);
  return [
    "Next week is planned.",
    `Monday: ${meals.length ? meals.join(" · ") : "nothing planned"}`,
    ...dishExtras(i.monday),
    ...(i.unmet?.length ? ["", `I couldn't keep everything this week: ${i.unmet.join("; ")}. Tell me what to change.`] : []),
    "",
    `The whole week: [Week page](${i.link})`,
    "Tell me anything to change.",
  ].join("\n");
}

/** What make_plan's message is made of: each day planned (`label`: "Monday"), its slot-days with their dishes (who a dish is
 *  not for, its note); the family's standing notes (said once); what could not be kept; the new dishes; what to ask (a calendar
 *  entry the plan could not read for meals). */
export type PlanText = {
  days: { label: string; meals: { slot: string; skip: string | null; note: string | null; dishes: { name: string; note: string | null; not_for?: string[] }[] }[] }[];
  standing: string[]; unmet: string[]; new_dishes: { name: string; why: string }[]; asked: string[]; link: string;
};
/** What a later change re-planned (spec §6), as the agent sends it: each slot-day planned again with its dishes, the new ones,
 *  what could not be kept, and the Week page. */
export function changeMessage(t: { meals: { label: string; skip: string | null; dishes: { name: string; note: string | null; not_for?: string[] }[] }[];
  unmet: string[]; new_dishes: { name: string; why: string }[]; link: string }): string {
  const lines = ["Updated the plan:"];
  for (const m of t.meals) lines.push(`${m.label}: ${m.skip ? (m.skip === "eaten_out" ? "eating out" : "ordering in")
    : m.dishes.map((x) => dishText({ name: x.name, portion_note: x.note, not_for: x.not_for })).join(", ") || "nothing planned"}`);
  if (t.new_dishes.length) lines.push("", `New: ${t.new_dishes.map((n) => (n.why ? `${n.name} (${n.why})` : n.name)).join("; ")}`);
  if (t.unmet.length) lines.push("", `I couldn't keep everything: ${t.unmet.join("; ")}. Tell me what to change.`);
  lines.push("", `The whole week: [Week page](${t.link})`);
  return lines.join("\n");
}

/** A note on this many days or more is said once, under "All week", not on each day. */
const ALL_WEEK_DAYS = 3;

/** The plan's message (spec §5.6): the week by day, the standing notes once ("All week"), the new dishes, what could not be
 *  kept and the questions; then the Week page. */
export function planMessage(t: PlanText): string {
  const daysWith = new Map<string, Set<string>>();
  const seen = (note: string | null, day: string) => { if (note) daysWith.set(note, (daysWith.get(note) ?? new Set()).add(day)); };
  for (const d of t.days) for (const m of d.meals) { seen(m.note, d.label); for (const x of m.dishes) seen(x.note, d.label); }
  const allWeek = [...daysWith].filter(([, ds]) => ds.size >= ALL_WEEK_DAYS).map(([n]) => n);
  const shown = (note: string | null) => (note && !allWeek.includes(note) ? note : null);
  const lines = ["Your week is planned."];
  for (const d of t.days) {
    if (!d.meals.length) continue;
    lines.push("", `*${d.label}*`);
    for (const m of d.meals) {
      const what = m.skip ? (m.skip === "eaten_out" ? "eating out" : "ordering in")
        : m.dishes.map((x) => dishText({ name: x.name, portion_note: shown(x.note), not_for: x.not_for })).join(", ") || "nothing planned";
      lines.push(`${m.slot}: ${what}${shown(m.note) ? `. ${m.note}` : ""}`);
    }
  }
  const standing = [...new Set([...t.standing, ...allWeek])];
  if (standing.length) lines.push("", `All week: ${standing.join("; ")}`);
  if (t.new_dishes.length) lines.push("", `New this week: ${t.new_dishes.map((n) => (n.why ? `${n.name} (${n.why})` : n.name)).join("; ")}`);
  if (t.unmet.length) lines.push("", `I couldn't keep everything this week: ${t.unmet.join("; ")}. Tell me what to change.`);
  if (t.asked.length) lines.push("", ...t.asked);
  lines.push("", `The whole week: [Week page](${t.link})`, "Tell me anything to change.");
  return lines.join("\n");
}

/** A time of day as it reads inside a sentence: "3", "7:30" (no am or pm). */
const bare = (time: string): string => clockText(time).replace(/ [ap]m$/, "");
const partOfDay = (time: string): string => { const h = Number(time.split(":")[0]); return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening"; };

/** The how-to-use message, sent once with the first week. `times` are when the plan and the two reminders really run, as "HH:MM";
 *  `everyday` are the things the family buys every day or two on the apps (subscriptions left out): the first two are named as
 *  what goes in the cart when due; with none known yet, none is named. */
export function introText(times: { plan: string; afternoon: string; evening: string }, everyday: string[]): string {
  const named = andList(everyday.slice(0, 2));
  const each = `each time I put what is due in the cart${named ? `, like your ${named},` : ""} and mention anything that may be running low.`;
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
