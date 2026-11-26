// The week's slot-days, worked out in code before any dish is chosen (docs/slot-model-spec.md §5.1): for each active slot on
// each of its days, who it is for: the slot's usual people (everyone at home when none), less who is away that weekday
// (household.weekly), changed by the week's calendar events or the household's dated stays, less who fasts with nothing to
// eat; a slot the family eats out or orders in that weekday is skipped. A slot-day the family changed (`edited`) is kept as
// it is. Nothing here reads the meaning of a word: a calendar event whose effect on meals code cannot see from its fields
// goes to one small model call (eventsRead), and what that call is unsure of is asked of the family.
import { CALENDAR_APP, INSTEAD_STEP, MAIN_SLOT_HOURS, SLOT_ORDER, type Skip } from "./db/constants";
import { addDays, weekDates, weekdayOf, type Weekday } from "./dates";
import { isObject } from "./family";
import type { EventAsk } from "./messages";
import type { ModelCall, ModelResult } from "./model";
import type { Guest, Rule, Slot, SlotDay } from "./slotStore";

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && addDays(v, 0) === v;
const isClock = (v: unknown): v is string => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

// ── The household, as Flock sends it ──

/** One weekday pattern (spec §2.3 household.weekly). */
export type Weekly = { person: string; where: string; weekdays: Weekday[]; from?: string; to?: string; lunch?: string | null };
/** One dated stay or trip (household.dated), the fallback for a family with no Family Calendar. */
export type Dated = { person?: string; what: string; from: string; to?: string; slots?: string[] };
/** What the plan reads of the household: `weekly` null when Flock sent none, or not as a list (unknown: plan with the usual people). */
export type Household = { weekly: Weekly[] | null; dated: Dated[] };

/** A household fact by its name, whichever way it is keyed ("household.weekly", `weekly`, or under `household`). */
function fact(h: unknown, name: string): unknown {
  if (!isObject(h)) return undefined;
  if (h[`household.${name}`] !== undefined) return h[`household.${name}`];
  if (h[name] !== undefined) return h[name];
  return isObject(h.household) ? fact(h.household, name) : undefined;
}
const DAYS: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const weekdayList = (v: unknown): Weekday[] => (Array.isArray(v) ? v.map((d) => DAYS.find((w) => typeof d === "string" && same(w, d.slice(0, 3)))).filter((d): d is Weekday => !!d) : []);

/** The household facts the plan reads, checked for shape; anything not in shape is left out. */
export function readHousehold(h: unknown): Household {
  const w = fact(h, "weekly");
  const weekly = Array.isArray(w) ? w.flatMap((x): Weekly[] => {
    if (!isObject(x) || !str(x.person)) return [];
    return [{ person: str(x.person), where: str(x.where), weekdays: weekdayList(x.weekdays), ...(isClock(x.from) ? { from: x.from } : {}),
      ...(isClock(x.to) ? { to: x.to } : {}), lunch: typeof x.lunch === "string" ? x.lunch.trim().toLowerCase() : null }];
  }) : null;
  const d = fact(h, "dated");
  const dated = Array.isArray(d) ? d.flatMap((x): Dated[] => {
    if (!isObject(x) || !str(x.what) || !isDate(x.from)) return [];
    return [{ what: str(x.what), from: x.from, ...(str(x.person) ? { person: str(x.person) } : {}), ...(isDate(x.to) ? { to: x.to } : {}),
      ...(Array.isArray(x.slots) ? { slots: x.slots.filter((s): s is string => typeof s === "string" && !!s.trim()) } : {}) }];
  }) : [];
  return { weekly, dated };
}

/** What the family said in setup about weekday lunch (house.setup_state.weekday_lunch, apply_setup's read of their replies):
 *  it wins over household.weekly's lunch for that person, being the family's own later words. A person said of with no weekly
 *  pattern is taken as away on weekdays (Mon to Fri) with that lunch. */
export type LunchSaid = { person: string; lunch: "away" | "carries" | "home" };
export function withLunchSaid(h: Household, said: LunchSaid[]): Household {
  if (!said.length) return h;
  const weekly = [...(h.weekly ?? [])];
  for (const s of said) {
    const at = weekly.filter((w) => same(w.person, s.person));
    if (at.length) for (const w of at) weekly[weekly.indexOf(w)] = { ...w, lunch: s.lunch };
    else weekly.push({ person: s.person, where: "", weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri"], lunch: s.lunch });
  }
  return { ...h, weekly };
}
/** house.setup_state's weekday_lunch, read tolerantly: no column, no row or no such key is none. */
export function lunchSaid(sqlite: { query: (q: string) => { get: () => unknown } }): LunchSaid[] {
  try {
    const row = sqlite.query("SELECT setup_state FROM house ORDER BY created_at LIMIT 1").get() as { setup_state?: string | null } | null;
    const state = row?.setup_state ? JSON.parse(row.setup_state) : null;
    const list = isObject(state) && Array.isArray(state.weekday_lunch) ? state.weekday_lunch : [];
    return list.flatMap((x: unknown): LunchSaid[] => isObject(x) && str(x.person) && (x.lunch === "away" || x.lunch === "carries" || x.lunch === "home")
      ? [{ person: str(x.person), lunch: x.lunch }] : []);
  } catch { return []; }
}

// ── What the platform gives the plan (feature-detected: an older SDK has neither) ──

/** A calendar entry as the Family Calendar's get_events answers it. */
export type CalendarEvent = { id: string; title: string; date: string; end_date?: string; repeat?: string; kind?: string; start_time?: string;
  end_time?: string; who?: string; notes?: string };
/** The household fresh (null: none to be had), and the calendar's events between two dates (null: no calendar to read). */
export type Peers = { household?: () => Promise<unknown | null>; calendar?: (from: string, to: string) => Promise<CalendarEvent[] | null> };

type SdkResult = { ok: boolean; data?: unknown; status?: number; code?: string };
/** The SDK 0.5.2 household read and app-to-app op call on a platform context, when it has them (an older SDK has not: none). */
export function platformPeers(platform: unknown): Peers {
  const p = platform as { household?: { get?: () => Promise<SdkResult> }; apps?: { op?: (app: string, name: string, input?: object) => Promise<SdkResult> } } | null | undefined;
  const out: Peers = {};
  const get = p?.household?.get, op = p?.apps?.op;
  if (typeof get === "function") out.household = async () => {
    try {
      const r = await get.call(p!.household);
      return r?.ok && isObject(r.data) ? (r.data as Record<string, unknown>).household ?? r.data : null;
    } catch { return null; }
  };
  if (typeof op === "function") out.calendar = async (from, to) => {
    try {
      const r = await op.call(p!.apps, CALENDAR_APP, "get_events", { from, to });
      const events = r?.ok && isObject(r.data) ? (r.data as { events?: unknown }).events : undefined;
      return Array.isArray(events) ? events.filter((e): e is CalendarEvent => isObject(e) && isDate(e.date) && typeof e.title === "string") : null;
    } catch { return null; }
  };
  return out;
}

// ── Calendar and dated stays → who is away or joins ──

/** One change to who eats at home: `people` away from, or joining, the given dates' slots (all slots when null). */
export type Attendance = { effect: "away" | "joins"; people: string[]; dates: string[]; slots: string[] | null; why: string };
/** An event or stay as the plan reads it, from either source. */
type Happening = { id: string; title: string; who: string | null; from: string; to: string; repeat?: string; start_time?: string; end_time?: string; notes?: string; slots?: string[] };

const EVENTS_SCHEMA = { type: "object", required: ["changes"], properties: { changes: { type: "array", items: { type: "object", required: ["id", "effect"], properties: {
  id: { type: "string" }, effect: { type: "string", enum: ["away", "joins", "none", "unsure"] }, people: { type: "array", items: { type: "string" } },
  dates: { type: "array", items: { type: "string" } }, slots: { type: ["array", "null"], items: { type: "string" } } } } } } };

export const EVENTS_SYSTEM = [
  "You read a family's calendar entries for one week and say how each changes who eats at home. Answer with JSON only: { changes: [{ id, effect, people, dates, slots }] }, one per entry.",
  "effect: \"away\" when people of the household are not home for meals (a trip, a stay elsewhere, a dinner out); \"joins\" when someone eats at home who usually does not (a relative visiting or staying, guests for a meal); \"none\" when meals at home do not change (a deadline, a class, a birthday at home, an appointment between meals); \"unsure\" when the entry does not say enough to tell.",
  "people: the names it concerns, as `people` names them (or the visitor's name as the entry writes it, for joins). dates: the days of `week` it holds on, as YYYY-MM-DD. slots: the slots it touches, from `slots`, or null for every slot of those days (a timed entry touches only the slots in its hours).",
  "Never guess: an entry you cannot read for meals is unsure.",
].join("\n");

/** Is a calendar entry part of its person's week (owner, 25 Nov: never asked, never read): everyone it names has a weekday
 *  pattern (household.weekly) that has them out on each of its days in the week, and the entry is that routine: it repeats
 *  (a weekly class, school, office), is the pattern's place by name ("Office" for an office pattern; "School trip to Udaipur"
 *  is more than the place, and read), or sits inside the
 *  pattern's hours. A one-off entry on such a day (a dinner out, a trip) may change who eats at home: not covered. */
export function coveredByWeek(h: { title: string; who: string | null; from: string; to: string; repeat?: string; start_time?: string; end_time?: string },
  weekly: Weekly[] | null | undefined, week: { from: string; to: string }): boolean {
  if (!weekly?.length || !h.who) return false;
  const names = h.who.split(/\s*(?:,|&|\band\b)\s*/i).map((x) => x.trim()).filter(Boolean);
  const days: Weekday[] = [];
  for (let d = h.from < week.from ? week.from : h.from; d <= (h.to > week.to ? week.to : h.to); d = addDays(d, 1)) days.push(weekdayOf(d));
  if (!names.length || !days.length) return false;
  const out = (w: Weekly) => (w.where ? !same(w.where, "home") : w.lunch === "away" || w.lunch === "carries");
  // The title is the place itself ("Office", "<name> school"), not more ("School trip to Udaipur", "Office offsite": those may
  // take them away from meals at home, so they are read).
  const wordsOf = (x: string) => x.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const nameWords = new Set(names.flatMap(wordsOf));
  const title = wordsOf(h.title).filter((x) => !nameWords.has(x));
  const isPlace = (w: Weekly) => !!w.where && title.length > 0 && title.every((x) => wordsOf(w.where).includes(x));
  return names.every((n) => {
    const mine = weekly.filter((w) => same(w.person, n) && out(w));
    if (!days.every((d) => mine.some((w) => w.weekdays.includes(d)))) return false;
    const repeats = !!h.repeat && h.repeat !== "none";
    return repeats || mine.some((w) => isPlace(w)
      || (!!w.from && !!w.to && !!h.start_time && !!h.end_time && w.from <= h.start_time && h.end_time <= w.to));
  });
}

/** Every happening of the week from the calendar (or, with none, the household's dated stays), read into attendance changes:
 *  a deadline changes nothing (code), nor an entry that is part of its person's week (coveredByWeek, code); every other
 *  entry goes to one small fast call; what it is unsure of, or what the call could not read, is `asked` (folded into the
 *  plan's one question). A stop (no credits, the day's budget) is answered as is. */
export async function readEvents(o: { events: CalendarEvent[] | null; dated: Dated[]; from: string; to: string; people: string[]; slots: string[];
  weekly?: Weekly[] | null; model: (req: Parameters<ModelCall>[0]) => Promise<ModelResult>; log: (l: string) => void }): Promise<{ changes: Attendance[]; asked: EventAsk[]; stop?: Extract<ModelResult, { ok: false }> }> {
  const list: Happening[] = o.events
    ? o.events.filter((e) => e.kind !== "deadline").map((e) => ({ id: e.id || `${e.title}@${e.date}`, title: e.title, who: str(e.who) || null, from: e.date,
      to: isDate(e.end_date) ? e.end_date : e.date, ...(e.repeat ? { repeat: e.repeat } : {}), ...(e.start_time ? { start_time: e.start_time } : {}), ...(e.end_time ? { end_time: e.end_time } : {}), ...(e.notes ? { notes: e.notes } : {}) }))
    : o.dated.map((d, i) => ({ id: `dated-${i}`, title: d.what, who: d.person ?? null, from: d.from, to: d.to ?? d.from, ...(d.slots?.length ? { slots: d.slots } : {}) }));
  const week = { from: o.from, to: o.to };
  const all = list.filter((h) => h.from <= o.to && h.to >= o.from);
  const inWeek = all.filter((h) => !coveredByWeek(h, o.weekly, week));
  if (all.length > inWeek.length) o.log(`calendar: ${all.length - inWeek.length} entr${all.length - inWeek.length === 1 ? "y" : "ies"} part of the weekly routine, not read`);
  if (!inWeek.length) return { changes: [], asked: [] };
  const asked = (h: Happening): EventAsk => ({ title: h.title, who: h.who,
    when: h.from === h.to ? weekdayOf(h.from) : `${weekdayOf(h.from < o.from ? o.from : h.from)} to ${weekdayOf(h.to > o.to ? o.to : h.to)}` });
  const r = await o.model({ tier: "fast", purpose: "meal plan: calendar entries", system: EVENTS_SYSTEM, schema: EVENTS_SCHEMA, maxTokens: 1500,
    user: JSON.stringify({ week: { from: o.from, to: o.to }, people: o.people, slots: o.slots, entries: inWeek }) });
  if (!r.ok) {
    o.log(`calendar read failed (${r.code}): ${inWeek.length} entr${inWeek.length === 1 ? "y" : "ies"} asked`);
    return { changes: [], asked: inWeek.map(asked), ...(["out_of_credits", "daily_budget", "rate_limited", "not_declared", "bad_request"].includes(r.code) ? { stop: r } : {}) };
  }
  const raw = isObject(r.json) && Array.isArray(r.json.changes) ? r.json.changes : [];
  const changes: Attendance[] = [], out: EventAsk[] = [];
  for (const h of inWeek) {
    const c = raw.find((x) => isObject(x) && x.id === h.id) as Record<string, unknown> | undefined;
    const effect = c?.effect;
    if (effect === "none") continue;
    if (effect !== "away" && effect !== "joins") { out.push(asked(h)); continue; }
    // Dates inside the week and the entry's own days; people known for away (a visitor may be anyone for joins).
    const dates = (Array.isArray(c!.dates) ? c!.dates : []).filter((d): d is string => isDate(d) && d >= o.from && d <= o.to && d >= h.from && d <= h.to);
    const named = (Array.isArray(c!.people) ? c!.people : []).map(str).filter(Boolean);
    const people = effect === "away" ? named.map((n) => o.people.find((p) => same(p, n))).filter((p): p is string => !!p) : named.map((n) => o.people.find((p) => same(p, n)) ?? n);
    const slots = Array.isArray(c!.slots) ? c!.slots.map((s) => o.slots.find((x) => typeof s === "string" && same(x, s))).filter((s): s is string => !!s) : null;
    if (!dates.length || !people.length || (slots && !slots.length)) { out.push(asked(h)); continue; }
    changes.push({ effect, people, dates, slots, why: h.title });
  }
  o.log(`calendar: ${inWeek.length} entr${inWeek.length === 1 ? "y" : "ies"}, ${changes.length} change${changes.length === 1 ? "" : "s"}, ${out.length} asked`);
  return { changes, asked: out };
}

// ── The slot-days ──

/** One slot-day of the week as the plan works on it. `fixed`: the family set its dishes (an edited slot-day with dishes) or it
 *  is before today: kept as it is, read for counts. `why`: who is missing from the usual people and why, for the slot call.
 *  `fasting`: notes for a person fasting with what they may eat. */
export type PlanDay = { date: string; slot: string; people: string[]; guests: Guest[]; occasion: string | null; new_dishes_allowed: number | null;
  skip: Skip | null; edited: boolean; fixed: boolean; why: string[]; fasting: string[]; dishes: string[]; note: string | null };

/** Does a rule hold on this slot-day: its days, and its slots (an add-on slot is held by its main slot's rules too; so is a box
 *  that replaces the meal, the week's `slots`: a meal's rules hold at the box eaten in its place, §5.4). */
export function ruleHolds(r: Pick<Rule, "days" | "slots">, date: string, slot: Slot | undefined, slotName: string, slots: Slot[]): boolean {
  if (r.days?.length && !r.days.includes(weekdayOf(date))) return false;
  const meal = slot ? replacedMeal(slot, slots) : null;
  if (r.slots?.length && !r.slots.some((s) => same(s, slotName) || (!!slot?.addon_of && same(s, slot.addon_of)) || (!!meal && same(s, meal.name)))) return false;
  return true;
}

/** Is a person away from this main slot on this weekday by their weekday pattern. `lunch`: the family's word for weekday lunch
 *  (away: not eating the home lunch; carries: the home lunch is cooked for them and packed, so they count; home: at home);
 *  else the pattern's hours covering the slot's whole span (MAIN_SLOT_HOURS: school at 7:30 still eats breakfast, back at
 *  9 still eats dinner); else home. */
function awayBy(w: Weekly, day: Weekday, slot: Slot): boolean {
  if (!w.weekdays.includes(day) || w.where === "home") return false;
  const base = slot.kind === "main" ? slot : null;
  const order = base?.order;
  if (order === SLOT_ORDER.Lunch && w.lunch) return w.lunch === "away";
  const span = order != null ? MAIN_SLOT_HOURS[order] : undefined;
  return !!(span && w.from && w.to && w.from <= span[0] && span[1] <= w.to);
}

/** The main meal a custom slot replaces (§5.4): the main slot one INSTEAD_STEP before it, when the slot names its people. */
export function replacedMeal(s: Pick<Slot, "kind" | "order" | "usual_people">, slots: Slot[]): Slot | null {
  if (s.kind !== "custom" || !s.usual_people.length) return null;
  return slots.find((m) => m.kind === "main" && m.order + INSTEAD_STEP === s.order) ?? null;
}

/** The key of a slot-day in a set of them: its date and its slot's name, any capitals. */
export const slotDayKey = (date: string, slot: string): string => `${date}|${slot.trim().toLowerCase()}`;

/** The week's slot-days (§5.1), every active slot on its days, dates `from` on (a week planned part way through keeps the
 *  days before). `saved`: the week's slot-days as saved, an edited one is kept; one before `from` is fixed. `only` (a later
 *  change, spec §6): only these slot-days are planned; every other one is kept as saved (fixed, read for counts) and one not
 *  saved is left out. A slot-day in `only` that the family edited is planned with the people, guests and occasion they set,
 *  its dishes planned again (set_slot_day asks for exactly that). */
export function buildDays(o: { weekStart: string; from: string; slots: Slot[]; people: string[]; rules: Rule[]; household: Household;
  changes: Attendance[]; saved: SlotDay[]; only?: Set<string> }): PlanDay[] {
  const out: PlanDay[] = [];
  const bySlot = new Map(o.slots.map((s) => [s.name.toLowerCase(), s]));
  for (const date of weekDates(o.weekStart)) {
    const day = weekdayOf(date);
    for (const s of o.slots) {
      if (s.days.length && !s.days.includes(day)) continue;
      const had = o.saved.find((d) => d.date === date && same(d.slot, s.name));
      const asked = o.only?.has(slotDayKey(date, s.name));
      if (o.only && !asked && !had) continue;
      if (date < o.from || (o.only && !asked) || (!asked && had?.edited && had.dishes.length) || (had?.edited && had.skip) || had?.status === "confirmed") {
        if (had) out.push({ date, slot: s.name, people: had.people, guests: had.guests, occasion: had.occasion, new_dishes_allowed: had.new_dishes_allowed, skip: had.skip,
          edited: had.edited, fixed: true, why: [], fasting: [], dishes: had.dishes.map((x) => x.dish), note: had.note });
        continue;
      }
      // An edited slot-day without dishes: its people and the rest as the family set them, its dishes planned.
      if (had?.edited) {
        out.push({ date, slot: s.name, people: had.people, guests: had.guests, occasion: had.occasion, new_dishes_allowed: had.new_dishes_allowed, skip: had.skip,
          edited: true, fixed: false, why: [], fasting: [], dishes: [], note: had.note });
        continue;
      }
      const why: string[] = [], fasting: string[] = [];
      let people = s.usual_people.length ? s.usual_people.map((p) => o.people.find((x) => same(x, p)) ?? p) : [...o.people];
      // Who is away that weekday (main slots and their add-ons; a person's own slot, a tiffin, goes with them).
      const main = s.kind === "addon" && s.addon_of ? bySlot.get(s.addon_of.toLowerCase()) : s;
      if (main?.kind === "main" && o.household.weekly) for (const w of o.household.weekly) {
        const p = people.find((x) => same(x, w.person));
        if (p && awayBy(w, day, main)) { people = people.filter((x) => x !== p); why.push(`${p}: ${w.where || "away"} on ${day}`); }
      }
      // A box that replaces this meal takes its people off it, on the days it runs and when they are at the box that day.
      if (s.kind === "main") for (const b of o.slots) {
        if (b.active === false || replacedMeal(b, o.slots) !== s || (b.days.length && !b.days.includes(day))) continue;
        for (const bp of b.usual_people) {
          const p = people.find((x) => same(x, bp));
          if (!p || o.changes.some((c) => c.effect === "away" && c.dates.includes(date) && c.people.some((x) => same(x, bp))
            && (!c.slots || c.slots.some((x) => same(x, b.name))))) continue;
          people = people.filter((x) => x !== p); why.push(`${p}: has ${b.name} on ${day}`);
        }
      }
      for (const c of o.changes) {
        if (!c.dates.includes(date) || (c.slots && !c.slots.some((x) => same(x, s.name) || (!!s.addon_of && same(x, s.addon_of))))) continue;
        if (c.effect === "away") for (const p of c.people) { if (people.some((x) => same(x, p))) { people = people.filter((x) => !same(x, p)); why.push(`${p}: ${c.why}`); } }
        // A visitor joins the shared slots, never a person's own (a tiffin, an add-on).
        else if (!s.usual_people.length || s.kind === "main") for (const p of c.people) if (!people.some((x) => same(x, p))) { people.push(p); why.push(`${p} joins: ${c.why}`); }
      }
      // Fasting: with nothing to eat, the person is not at this slot-day; with fasting food, they stay, with a note.
      for (const r of o.rules.filter((x) => x.what === "fasting" && ruleHolds(x, date, s, s.name, o.slots))) {
        const who = r.who ? people.filter((p) => same(p, r.who!)) : [...people];
        if (!who.length) continue;
        if (r.fasting_food?.length) for (const p of who) fasting.push(`${p} fasts: only ${r.fasting_food.join(", ")} (${r.quote})`);
        else { people = people.filter((p) => !who.includes(p)); for (const p of who) why.push(`${p} fasts (${r.quote})`); }
      }
      // An add-on is cooked beside its main slot: a main slot eaten out or ordered in that weekday takes its add-ons with it.
      const skip = s.skip_days.find((x) => x.day === day)?.skip ?? (s.kind === "addon" && main && main !== s ? main.skip_days.find((x) => x.day === day)?.skip : null) ?? null;
      if (!people.length && !skip) continue;
      out.push({ date, slot: s.name, people, guests: [], occasion: null, new_dishes_allowed: null, skip, edited: false, fixed: false, why, fasting, dishes: [], note: null });
    }
  }
  return out;
}
