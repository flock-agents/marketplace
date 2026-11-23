// The words the pages show for a dish, a meal, a cart, an order, a pantry item and a recipe. No React and no
// library import here, so the wording is tested on its own. The dates, the grocery apps' names and a dish's line are the
// server's own. The app an item is bought on is never named on the Pantry or the item page.
import { addDays, clockText, dayLabel, todayStr, WEEKDAYS, weekdayLong, weekdayOf, type Weekday } from "../../server/dates";
import { ruleText, type Rule } from "../../server/rules";
import { APP_NAMES, SUBSCRIPTION_UNNAMED, SYNC_ASK_COOLDOWN_MIN, type GroceryApp } from "../../server/db/constants";
import { dishText, forAll, lastTimeText, type LastTime } from "../../server/dishText";

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

/** Is a profile carried over from the old Meal Planner still waiting to be turned into people, rules, the cook and slots? */
export const profileWaiting = (house: { profile_to_structure?: string | null }): boolean => !!house.profile_to_structure?.trim();

/** A meal as the Week page lists it: its dishes' names, each once, and under them only what differs from "everyone eats
 *  it": the meal's note, a dish's portions note ("Idli: two eggs for Shiva"), or who a dish is for when that is not everyone
 *  at home ("Milk for Meera"); and how a dish went last time when the family said something about it ("Bhindi, last time:
 *  too oily"). `everyone`: the names of the people at home. */
export function mealLines(m: { ordered_in?: boolean; note?: string | null; dishes: { name: string; for_people?: string[] | null; portion_note?: string | null; last_time?: LastTime | null }[] },
  everyone: readonly string[] = []): { title: string; secondary: string | undefined } {
  if (m.ordered_in) return { title: "Ordered in", secondary: m.note?.trim() || undefined };
  const key = (v: string) => v.trim().toLowerCase();
  const names: string[] = [], under: string[] = m.note?.trim() ? [m.note.trim()] : [];
  for (const d of m.dishes) {
    if (!names.some((n) => key(n) === key(d.name))) names.push(d.name);
    const note = d.portion_note?.trim(), who = d.for_people ?? [];
    const all = forAll(who) || (everyone.length > 0 && everyone.every((p) => who.some((w) => key(w) === key(p))));
    const line = note ? `${d.name}: ${note}` : who.length && !all ? `${d.name} for ${who.join(", ")}` : null;
    if (line && !under.includes(line)) under.push(line);
    const last = lastTimeText(d.last_time), said = last ? `${d.name}, last time: ${last}` : null;
    if (said && !under.includes(said)) under.push(said);
  }
  return { title: names.join(" · "), secondary: under.join(" · ") || undefined };
}

/** Where a saved recipe is from: "Instagram", "YouTube" or "Link". */
export function recipeSourceLabel(r: { source: string | null }): "Instagram" | "YouTube" | "Link" {
  return r.source === "instagram" ? "Instagram" : r.source === "youtube" ? "YouTube" : "Link";
}

// ── Shopping: one cart per app, and the orders ──

/** "₹1,680": whole rupees. */
const rupees = (n: number): string => `₹${new Intl.NumberFormat("en-IN").format(Math.round(n))}`;
const appName = (c: { app: string; app_name?: string }): string => c.app_name ?? APP_NAMES[c.app as GroceryApp] ?? c.app;

type CartLine = { id: string; item: string; name_on_app: string | null; pack: string | null; for_note: string | null; image: string | null;
  price: number | null; qty: number | null; source: string | null };
type CartLike = { app: string; app_name?: string; status: string; lines: CartLine[]; total: number | null; delivery_gap: number | null;
  sync_state: string | null; synced_at: string | null; sync_asked_at: string | null; building_at_order: boolean; connected?: boolean };
/** One thing in the ItemPicker, as the library takes it. */
export type PickItem = { id: string; name: string; meta?: string; image?: string; price?: number; qty: number };
/** One line's qty as the cart's picks route takes it. */
export type Pick = { line_id: string; qty: number };

/** A cart's lines as the ItemPicker shows them, each at the cart's qty: a running-low line is there at 0, with Add. */
export function pickerItems(lines: CartLine[]): PickItem[] {
  return lines.map((l) => {
    const meta = [l.pack, l.for_note ?? (l.source === "low" ? "might be running low" : null)].filter(Boolean).join(" · ");
    return { id: l.id, name: l.name_on_app ?? l.item, meta: meta || undefined, image: l.image ?? undefined, price: l.price ?? undefined, qty: l.qty ?? 0 };
  });
}

/** Is the cart the same as the app's own, so the app's total is its total? */
const inStep = (c: CartLike): boolean => c.sync_state !== "pending" && !!c.synced_at;

/** What the cart costs: the app's own total when the cart is in step with it, else its picked lines added up; null when a
 *  picked line has no price (a part total would read as the whole) or nothing is picked. */
export function cartTotal(c: CartLike): number | null {
  if (c.total != null && inStep(c)) return c.total;
  const picked = c.lines.filter((l) => (l.qty ?? 0) > 0);
  if (!picked.length || picked.some((l) => l.price == null)) return null;
  return picked.reduce((n, l) => n + (l.qty ?? 0) * l.price!, 0);
}

/** The cart's Order button: "Order on Zepto · ₹751", or "Order on Zepto" when its cost is not known. */
export function orderLabel(c: CartLike): string {
  const total = cartTotal(c);
  return `Order on ${appName(c)}${total == null ? "" : ` · ${rupees(total)}`}`;
}

/** The line under a cart, or null: being ordered, waiting for payment, still ordering her last cart, no chat to order from,
 *  an app not signed in to yet (nothing is copied to it, so it is never "updating"), built when she orders, her edits being copied to the app, the app's cart being read, or how far from free delivery. */
export function cartNote(c: CartLike, opts: { now?: Date; already?: boolean; chat?: boolean; agent?: string } = {}): string | null {
  const app = appName(c);
  if (c.status === "ordering") return "Ordering…";
  if (c.status === "placed") return "Waiting for payment";
  if (opts.already) return `${app} is still ordering your last cart`;
  if (opts.chat === false) return `Ask ${opts.agent ?? "Butler"} on WhatsApp to order`;
  if (c.connected === false) return `You haven't signed in to ${app} yet`;
  if (c.building_at_order) return `Putting this on ${app} takes a minute when you order`;
  if (c.sync_state === "pending") return `Updating your ${app} cart…`;
  const now = (opts.now ?? new Date()).getTime();
  const asked = !!c.sync_asked_at && (!c.synced_at || c.sync_asked_at > c.synced_at) && now - Date.parse(c.sync_asked_at) < SYNC_ASK_COOLDOWN_MIN * 60_000;
  if (asked) return `Checking your ${app} cart…`;
  return c.delivery_gap != null && c.delivery_gap > 0 ? `${rupees(c.delivery_gap)} short of free delivery` : null;
}

/** A cart's heading: its app, and for the fallback app's cart what it is for ("BigBasket · when Zepto doesn't have it"). */
export function cartTitle(c: { app: string; app_name?: string }, shopping: { main: string; fallback: string | null } | null): string {
  return shopping && shopping.fallback === c.app && shopping.main !== c.app
    ? `${appName(c)} · when ${APP_NAMES[shopping.main as GroceryApp] ?? shopping.main} doesn't have it` : appName(c);
}

/** What she put in the app's own cart herself: "Already in your cart: Maggi ×2, Lays"; null when there is nothing. */
export function outsideText(outside: { name: string; qty?: number }[]): string | null {
  return outside.length ? `Already in your cart: ${outside.map((o) => (o.qty && o.qty > 1 ? `${o.name} ×${o.qty}` : o.name)).join(", ")}` : null;
}

/** How long the page waits after her last tap on a cart before saving its picks. */
export const PICKS_DEBOUNCE_MS = 800;
type Timer = { set: (run: () => void, ms: number) => unknown; clear: (handle: unknown) => void };
const realTimer: Timer = { set: (run, ms) => setTimeout(run, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/** Her taps on each app's picker, saved once they stop: per app, the last picks of a burst are sent `ms` after the last change.
 *  `flush` sends an app's waiting picks at once (before Order) and answers what `send` answered, or undefined when nothing
 *  was waiting; `flushAll` sends every app's (when the page closes). `P` is what is sent: the picks, and what goes with them. */
export function debouncePicks<R, P = Pick[]>(send: (app: string, picks: P) => R, ms: number, timer: Timer = realTimer) {
  const waiting = new Map<string, { picks: P; handle: unknown }>();
  const flush = (app: string): R | undefined => {
    const w = waiting.get(app);
    if (!w) return undefined;
    timer.clear(w.handle);
    waiting.delete(app);
    return send(app, w.picks);
  };
  return {
    change(app: string, picks: P): void {
      const had = waiting.get(app);
      if (had) timer.clear(had.handle);
      waiting.set(app, { picks, handle: timer.set(() => { void flush(app); }, ms) });
    },
    flush,
    flushAll(): void { for (const app of [...waiting.keys()]) void flush(app); },
  };
}

/** Keeping the picker in step with a cart changed elsewhere (the agent made the curd 2, a reminder added to a line). `known`
 *  is each line's qty as the page last saved it, or last read it with none of her taps waiting; `pending` is her taps not
 *  yet saved. A line whose qty on the server differs from `known`, with no tap of hers waiting, was changed elsewhere: the
 *  picker is made again (`rekey`) so it shows it. Her own save's echo matches `known`, and a line with a tap waiting is
 *  left alone, so neither ever makes it again. Answers what the page now knows; `known` itself is not changed. */
export function syncPicker(lines: { id: string; qty: number | null }[], known: Record<string, number>, pending: Record<string, number>):
  { rekey: boolean; known: Record<string, number> } {
  const next = { ...known };
  let rekey = false;
  for (const l of lines) {
    if (pending[l.id] != null) continue;
    const qty = l.qty ?? 0;
    if (next[l.id] != null && next[l.id] !== qty) rekey = true;
    next[l.id] = qty;
  }
  return { rekey, known: next };
}

export const ORDER_STATUS_TEXT: Record<string, string> = { ordering: "Ordering", placed: "Waiting for payment", paid: "Paid", not_paid: "Not paid", cancelled: "Cancelled" };
export const ORDER_TONES = { Ordering: "info", "Waiting for payment": "warning", Paid: "success", "Not paid": "danger", Cancelled: "muted" } as const;

/** An order on the Orders tab: its app; when it was placed, how many items and what it cost; and how it stands. */
export function orderRow(o: CartLike & { placed_at?: string | null; updated_at?: string | null }): { title: string; meta: string; status: string } {
  const at = o.placed_at ?? o.updated_at ?? null;
  const when = at ? `${dayLabel(todayStr(new Date(at)))}, ${clockText(timeOf(new Date(at)))}` : null;
  const n = o.lines.filter((l) => (l.qty ?? 0) > 0).length;
  const total = o.total ?? (o.lines.every((l) => !(l.qty ?? 0) || l.price != null) && n ? o.lines.reduce((s, l) => s + (l.qty ?? 0) * (l.price ?? 0), 0) : null);
  return { title: appName(o), meta: [when, n ? `${n} ${n === 1 ? "item" : "items"}` : null, total == null ? null : rupees(total)].filter(Boolean).join(" · "),
    status: ORDER_STATUS_TEXT[o.status] ?? o.status };
}
const timeOf = (d: Date): string => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** The agent's name: the one the app's display was given, else "Butler". */
export function agentName(display: Record<string, unknown> | null | undefined): string {
  const v = display?.agent_name;
  return typeof v === "string" && v.trim() ? v.trim() : "Butler";
}

// ── Pantry and the item page ──

export type PantryCounts = { all: number; in_stock: number; low: number; snoozed: number; subscription?: number };
export const PANTRY_FILTER: Record<string, string | null> = { all: null, in_stock: "In stock", low: "Low", snoozed: "Snoozed" };

/** The Pantry's one control: All · In stock · Low · Snoozed, with their counts. */
export function pantryTabs(counts: PantryCounts): { id: string; label: string; count: number }[] {
  return [{ id: "all", label: "All", count: counts.all }, { id: "in_stock", label: "In stock", count: counts.in_stock },
    { id: "low", label: "Low", count: counts.low }, { id: "snoozed", label: "Snoozed", count: counts.snoozed }];
}

const STATUS_TONES = { "In stock": "success", Low: "warning", Snoozed: "info", Subscription: "muted" } as const;
/** A status's pill tone. */
export const statusTone = (status: string): "success" | "warning" | "info" | "muted" | "neutral" => STATUS_TONES[status as keyof typeof STATUS_TONES] ?? "neutral";
/** The pills of the Pantry's statuses and of an event's tag (the server sends the tag as words). */
export const TAG_TONES: Record<string, "success" | "warning" | "info" | "neutral" | "muted" | "accent"> = {
  ...STATUS_TONES, counted: "neutral", "early buy": "accent", "your answer": "info", "one-off, not counted": "muted", "not counted": "muted" };

const GROUP_TEXT: Record<string, string> = { daily: "Daily", few_days: "Every few days", monthly: "Monthly" };
type ItemLike = { name: string; group: string | null; status: string; run_out: string | null; snoozed_until: string | null; subscription?: string | null; product: string | null;
  usual: string | null; price: number | null; lasts_days: number | null; uses: string | null; follows_plan: boolean; cycle?: string | null; cycle_stated?: boolean };

/** Under the item's name: its cycle, "Monthly · 10 kg about once a month"; with no cycle yet, the usual amount ("Monthly · 10 kg"). */
export const itemSubtitle = (i: ItemLike): string => [i.group ? GROUP_TEXT[i.group] ?? i.group : null, i.cycle ?? i.usual].filter(Boolean).join(" · ");

/** Where the item's pattern is from: the purchases counted, the family's own words, or nothing yet. */
export function patternSource(i: ItemLike, counted: number): string {
  if (i.cycle_stated) return "as you said";
  return counted ? `from the last ${counted} ${counted === 1 ? "purchase" : "purchases"}` : "nothing counted yet";
}

/** A subscribed item's pill: "Subscription · the milkman"; just "Subscription" when nobody was named. */
export const subscriptionTag = (source: string | null | undefined): string =>
  source && source !== SUBSCRIPTION_UNNAMED ? `Subscription · ${source}` : "Subscription";

/** Why the item is on a subscription, low or snoozed, or null when it is in stock. */
export function itemCallout(i: ItemLike): { tone: "warning" | "info"; icon: string; title: string; body: string } | null {
  if (i.subscription) return { tone: "info", icon: "repeat", title: subscriptionTag(i.subscription), body: "Delivered outside the apps: never put in a cart or asked about." };
  if (i.status === "Low") return { tone: "warning", icon: "triangle-alert", title: i.run_out ? `Low · about to run out around ${dayLabel(i.run_out)}` : "Low",
    body: "Snooze it if you still have enough." };
  if (i.status === "Snoozed" && i.snoozed_until) return { tone: "info", icon: "bell-off", title: `Snoozed until ${dayLabel(i.snoozed_until)}`, body: "Not asked about until then." };
  return null;
}

/** Her pattern, as the Detail shows it. An unknown value is null (shown as a dash). */
export function patternFields(i: ItemLike): { label: string; value: string | number | null; kind?: "money" }[] {
  const days = i.lasts_days == null ? null : Math.round(i.lasts_days);
  return [
    { label: "Usually buys", value: i.product },
    { label: "Usual amount", value: i.usual },
    { label: "Price last time", value: i.price, kind: "money" },
    { label: "Lasts about", value: days == null ? null : `${days} ${days === 1 ? "day" : "days"}` },
    { label: "Uses about", value: i.uses == null ? null : i.follows_plan ? `${i.uses}, going by the plan` : i.uses },
  ];
}

/** What the item was learned from, as the list shows it: each with its day. */
export function eventRows(events: { what: string; when: string; tag: string | null }[]): { id: string; what: string; when: string; tag: string | null }[] {
  return events.map((e, n) => ({ id: String(n), what: e.what, when: dayLabel(e.when), tag: e.tag }));
}

/** "23 Nov" from a date. */
const dayMonth = (date: string): string => dayLabel(date).split(" ").slice(1).join(" ");

/** The Week page's title: the week's dates, Monday to Sunday, every day being planned ("23 – 29 Nov"; across months
 *  "30 Nov – 6 Dec"). */
export function weekTitle(weekStart: string): string {
  const [from, to] = [dayMonth(weekStart), dayMonth(addDays(weekStart, 6))];
  const [fromDay, fromMonth] = from.split(" "), toMonth = to.split(" ")[1];
  return fromMonth === toMonth ? `${fromDay} – ${to}` : `${from} – ${to}`;
}

/** A weekday's full name, "Sunday". 2026-11-23 is a Monday. */
export const longDay = (d: Weekday): string => weekdayLong(addDays("2026-11-23", WEEKDAYS.indexOf(d)));

/** The cooking days in words: "Every day", a run of three or more as "Mon – Sat (Sunday off)", else "Mon, Wed, Fri". */
export function cookingDaysText(days: readonly string[]): string {
  const on = WEEKDAYS.filter((d) => days.includes(d));
  if (!on.length) return "No days";
  if (on.length === WEEKDAYS.length) return "Every day";
  const first = WEEKDAYS.indexOf(on[0]), last = WEEKDAYS.indexOf(on[on.length - 1]);
  if (on.length >= 3 && last - first + 1 === on.length) {
    const off = WEEKDAYS.filter((d) => !on.includes(d));
    const offText = off.length <= 2 ? ` (${off.map(longDay).join(" and ")} off)` : "";
    return `${on[0]} – ${on[on.length - 1]}${offText}`;
  }
  return on.join(", ");
}

// ── The family and the week ──

/** A house rule as a chip: its days ("Tue", "In general" for every day) and what it says ("No eggs", "Meera eats only plain
 *  idli at Breakfast"; an other rule is its note), then the family's note. */
export function ruleChip(r: Omit<Rule, "days" | "note"> & { days: readonly string[]; note?: string | null }): { label: string; value: string } {
  const said = ruleText({ ...r, days: [...r.days], note: undefined }, { days: false });
  const what = r.kind === "other" && r.note ? r.note : [said.charAt(0).toUpperCase() + said.slice(1), r.note].filter(Boolean).join(": ");
  return { label: r.days.length ? r.days.join(", ") : "In general", value: what };
}

/** When the cook comes, as the Family page says it: "comes at 7:30 am", or for a cook who comes twice "comes at 6 am
 *  (Breakfast, Lunch) and 4:30 pm (Dinner)"; null when no time was said. */
export function cookVisitsText(visits: readonly { at: string; meals?: string[] }[]): string | null {
  if (!visits.length) return null;
  return `comes at ${visits.map((v) => `${clockText(v.at)}${v.meals?.length ? ` (${v.meals.join(", ")})` : ""}`).join(" and ")}`;
}

/** What the Family page says about the cook beyond who and when: what they make well and will not make, their time, and
 *  whether they try new recipes. Only what was said. */
export function cookDetails(h: { cook_makes_well: string | null; cook_wont_make: string | null; cook_time_limit: string | null; cook_new_recipes: string | null }):
  { label: string; value: string }[] {
  const recipes = h.cook_new_recipes === "open" ? "Open to new recipes" : h.cook_new_recipes === "set_menu" ? "Better with familiar dishes" : null;
  return [["Makes well", h.cook_makes_well], ["Doesn't make", h.cook_wont_make], ["Cook's time", h.cook_time_limit], ["New recipes", recipes]]
    .filter((f): f is [string, string] => !!f[1]).map(([label, value]) => ({ label, value }));
}

/** When the week was planned, as the Week page's header says it: "Planned Sat 21 Nov, 4:05 pm" (local time). */
export function plannedText(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `Planned ${dayLabel(date)}, ${clockText(`${pad(d.getHours())}:${pad(d.getMinutes())}`)}`;
}

/** The week a link opens ("#/week?week=2026-11-23"): its Monday, or null. */
export function linkWeek(hash: string): string | null {
  const w = /[?&]week=(\d{4}-\d{2}-\d{2})(?:&|$)/.exec(hash)?.[1];
  return w && addDays(w, 0) === w && weekdayOf(w) === "Mon" ? w : null;
}

/** The week the Week page opens on: this week, unless nothing is planned in it from today on and the planned week (the link's,
 *  else next week) has meals. Null while either is still loading. */
export function weekToOpen(o: { thisWeek: string; today: string; planned: string; current: { days: { date: string; meals: unknown[] }[] } | null;
  other: { days: { date: string; meals: unknown[] }[] } | null }): string | null {
  if (o.planned === o.thisWeek) return o.thisWeek;
  if (!o.current) return null;
  if (o.current.days.some((d) => d.date >= o.today && d.meals.length)) return o.thisWeek;
  if (!o.other) return null;
  return o.other.days.some((d) => d.meals.length) ? o.planned : o.thisWeek;
}
