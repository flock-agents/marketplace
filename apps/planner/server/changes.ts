// Later changes (docs/slot-model-spec.md §6) and the answer to the next-day question (§5.7): the operations the agent calls
// when the family changes something after setup, and the Week page's own edits through the same routes. The model reads the
// family's words (the agent, before calling); code checks and writes. A change re-plans only the slot-days it touches, with
// the plan's own steps and checks (makePlan's `only`), and never a slot-day the family edited or said was made. No re-plan
// cap: the app's daily model budget is the guard.
//
//   set_slot        { name, kind?, addon_of?, usual_people?, days?, skip_days?, order?, remove? }
//   set_slot_day    { date, slot, people?, add_people?, remove_people?, guests?, occasion?, new_dishes_allowed?, skip?, dishes? }
//   add_dish        { name, slot, frequency?, days?, quote?, link? }
//   set_rule        { id?, hard?, what?, who?, slots?, days?, items?, to?, frequency?, per_meal?, fasting_food?, quote?, remove? }
//   set_setting     { new_dishes_per_week }
//   record_made     { date, slot, dishes }
//   record_feedback { date, slot, dish, made, liked?, again? }, or before it is cooked { date, slot, dish, answer: ok | swap | dont_like },
//                   or to the plan's check question { date, slot, dish, who, answer: fits | not_for }
import type { Context, Hono } from "hono";
import { asc, eq, gte } from "drizzle-orm";
import { people as people_t, slot_dishes, slot_days } from "./db/schema";
import { BASE_TAGS, NEW_DISHES_CHOICES, RULE_WHATS, SKIPS, SLOT_KINDS, SLOT_ORDER, UNTRIED_MAX_OFFERS, type RuleWhat, type Skip, type SlotKind } from "./db/constants";
import { addDays, mondayOf, todayStr, weekdayOf, type Weekday } from "./dates";
import { dishKey } from "./dishText";
import { dateOf, flag } from "./meals";
import { isObject, name, names, refuse, weekdays, words, writeRoutes, type Db, type Emit } from "./family";
import type { ModelCall } from "./model";
import { INGREDIENT_SCHEMA, INGREDIENT_SYSTEM, ingredientsFrom, makePlan, OP_BUDGET_MS, type MakePlanResult } from "./makePlan";
import { platformPeers, ruleHolds, type PlanDay } from "./planDays";
import { resolveGives, resolveTarget, targetsFor } from "./targets";
import { canonTag, checkSlot, forbidden, notFor, readFor, ruleTags, slotFacts, type Week } from "./planChecks";
import { containsRead, frequencyOf } from "./setup";
import { addRule, commit, getLibraryDish, getSlot, getSlotDay, listLibrary, listRules, listSlotDays, listSlots, newDishesPerWeek, recent, removeRule,
  removeSlot, saveSlotDay, slotHistory, updateLibraryByName, updateRule, upsertLibrary, upsertSlot, type Guest, type Rule, type RuleInput, type Slot,
  type SlotDay, type SlotDishInput } from "./slotStore";

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const uniq = <T>(xs: T[]) => [...new Set(xs)];
/** feedback_asked once the family answered the next-day question for a placement (1: asked, not answered). */
export const FEEDBACK_ANSWERED = 2;
/** A contains read made inside an operation: well inside Flock's wait for it. */
const CONTAINS_BUDGET_MS = 90_000;

export type ChangeDeps = { db: Db; emit: Emit; model: ModelCall; basePath: string; now: () => Date; platform?: () => unknown;
  sqlite?: { query: (q: string) => { get: () => unknown } }; log?: (line: string) => void };
type Target = { date: string; slot: string };
/** What a re-plan answers beside the change: the slot-days planned again, the message to send, its check question (asked), or why it could not. */
export type Replanned = { replanned: Target[]; message?: string; unmet?: string[]; asked?: string[]; planned?: false; say?: string };

// ── Re-planning only what a change touches ──

/** The slot-days a re-plan may touch: dated today or later, not edited by the family, not said to be made. */
const replannable = (d: SlotDay, today: string) => !!d.date && d.date >= today && !d.edited && d.status !== "confirmed";
/** The Mondays of the weeks planned from today on. */
function plannedWeeks(db: Db, today: string): string[] {
  const dates = db.select({ date: slot_days.date }).from(slot_days).where(gte(slot_days.date, today)).all().map((r) => r.date!).filter(Boolean);
  return uniq(dates.map(mondayOf)).sort();
}

/** Plan these slot-days again, week by week, with the plan's steps and checks (makePlan `only`). Nothing to do: nothing asked. */
export async function replan(deps: ChangeDeps, targets: Target[]): Promise<Replanned> {
  const list = targets.filter((t, i) => targets.findIndex((x) => x.date === t.date && same(x.slot, t.slot)) === i);
  if (!list.length) return { replanned: [] };
  const today = todayStr(deps.now());
  const out: Replanned = { replanned: [] };
  const messages: string[] = [], unmet: string[] = [], asked: string[] = [];
  for (const week of uniq(list.map((t) => mondayOf(t.date))).sort()) {
    const only = list.filter((t) => mondayOf(t.date) === week);
    const r: MakePlanResult = await makePlan({ db: deps.db, emit: deps.emit, model: deps.model, weekStart: week, today, basePath: deps.basePath,
      budgetMs: OP_BUDGET_MS, only, peers: deps.platform ? platformPeers(deps.platform()) : undefined, sqlite: deps.sqlite, log: deps.log });
    if (!r.ok) return { ...out, planned: false, say: r.say };
    out.replanned.push(...only);
    messages.push(r.message);
    unmet.push(...(r.unmet ?? []));
    asked.push(...(r.asked ?? []));
  }
  return { ...out, message: messages.join("\n\n"), ...(unmet.length ? { unmet: uniq(unmet) } : {}), ...(asked.length ? { asked } : {}) };
}

// ── What was sent, checked ──

const people = (db: Db): string[] => db.select().from(people_t).orderBy(asc(people_t.created_at)).all().filter((p) => p.active !== 0).map((p) => p.name);
/** Names of people at home, as saved (any capitals); `others`: a visitor's name may be anything. */
function personNames(db: Db, v: unknown, what: string, others = false): string[] {
  const all = people(db);
  return names(v, what).map((n) => all.find((p) => same(p, n)) ?? (others ? n : refuse(`${what}: ${n} is not one of the people at home (${all.join(", ") || "none saved"})`)));
}
function slotNamed(db: Db, v: unknown, what = "slot"): Slot {
  const n = name(v, what);
  const s = getSlot(db, n);
  if (!s || !s.active) refuse(`${what}: ${n} is not one of the meals (${listSlots(db).map((x) => x.name).join(", ") || "none saved"})`);
  return s!;
}
const skipOf = (v: unknown, what: string): Skip | null => (v === null ? null : (SKIPS as readonly unknown[]).includes(v) ? v as Skip : refuse(`${what} must be one of: ${SKIPS.join(", ")}, or null`));
function guestsOf(v: unknown): Guest[] {
  const shape = "guests must be a list of { count, rules? }: unnamed guests for this meal, rules their food rules in words";
  if (!Array.isArray(v)) return refuse(shape);
  return v.map((g) => {
    if (!isObject(g) || typeof g.count !== "number" || !Number.isInteger(g.count) || g.count < 1) return refuse(shape);
    return { count: g.count, ...(g.rules !== undefined ? { rules: names(g.rules, "guests' rules") } : {}) };
  });
}
/** Dishes as sent: names, or { dish, note?, ingredients? }. */
function dishesOf(v: unknown, what: string): (SlotDishInput & { given: boolean })[] {
  if (!Array.isArray(v)) return refuse(`${what} must be a list of dish names`);
  return v.map((d, i) => {
    if (typeof d === "string" && d.trim()) return { dish: d.trim(), given: false };
    if (!isObject(d)) return refuse(`${what}[${i}] must be a dish name or { dish, note?, ingredients? }`);
    const dish = name(d.dish, `${what}[${i}].dish`);
    const ingredients = d.ingredients === undefined ? undefined : Array.isArray(d.ingredients) ? d.ingredients.map((x, j) => {
      if (!isObject(x)) return refuse(`${dish}: ingredient ${j + 1} must be { item, amount?, unit? }`);
      const amount = x.amount == null ? null : typeof x.amount === "number" && x.amount > 0 ? x.amount : refuse(`${dish}: the amount of ${String(x.item)} must be above 0, or left out`);
      return { item: name(x.item, `${dish}: ingredient ${j + 1} item`), amount, unit: words(x.unit ?? null, `${dish}: unit`) };
    }) : refuse(`${dish}: ingredients must be a list`);
    return { dish, note: d.note === undefined ? null : words(d.note, `${dish}: note`), ...(ingredients ? { ingredients } : {}), given: !!ingredients };
  });
}

/** One fast call for the ingredients of dishes the family named (as make_plan asks them); what it cannot read stays empty. */
async function fillIngredients(deps: ChangeDeps, date: string, slot: string, count: number, dishes: (SlotDishInput & { given: boolean })[]): Promise<void> {
  const need = dishes.filter((d) => !d.given);
  if (!need.length) return;
  const r = await deps.model({ tier: "balanced", purpose: "meal plan: a day's ingredients", system: INGREDIENT_SYSTEM, schema: INGREDIENT_SCHEMA, maxTokens: 2000,
    user: JSON.stringify({ date, day: weekdayOf(date), dishes: need.map((d) => ({ slot, name: d.dish, people: Math.max(1, count) })) }) });
  if (!r.ok) return;
  for (const x of ingredientsFrom(r.json)) {
    const d = need.find((y) => same(y.dish, x.name));
    if (d) d.ingredients = x.ingredients.map(({ item, amount, unit }) => ({ item, amount, unit }));
  }
}

/** The tags not yet read for these library dishes, read now (setup's contains read) and written. */
async function readContains(deps: ChangeDeps, dishes: { name: string; slot: string }[], tags: string[]): Promise<void> {
  const ask = new Map<string, { name: string; tags: Set<string> }>();
  for (const d of dishes) {
    const row = getLibraryDish(deps.db, d.name, d.slot);
    if (!row) continue;
    const missing = tags.filter((t) => !row.contains_read.map(canonTag).includes(t));
    if (!missing.length) continue;
    const had = ask.get(row.key) ?? { name: row.name, tags: new Set<string>() };
    missing.forEach((t) => had.tags.add(t));
    ask.set(row.key, had);
  }
  if (!ask.size) return;
  const log = deps.log ?? ((l: string) => console.log(`[planner] ${l}`));
  const got = await containsRead(deps.model, ask, Date.now() + CONTAINS_BUDGET_MS, log);
  commit(deps.db, deps.emit, (tx, ch) => {
    for (const row of listLibrary(tx, { names: dishes.map((d) => d.name) })) {
      const r = got.get(row.key);
      if (!r) continue;
      const read = Object.keys(r).map(canonTag);
      upsertLibrary(tx, { name: row.name, slot: row.slot, contains_read: uniq([...row.contains_read, ...read]),
        contains: uniq([...row.contains.filter((t) => r[t] !== false), ...read.filter((t) => r[t])]) }, "app", ch);
    }
  });
}
/** Every tag the house's rules name, and the base ones. */
const houseTags = (db: Db) => uniq([...BASE_TAGS, ...ruleTags(listRules(db))].map(canonTag));

// ── The re-check of saved slot-days against the rules (set_rule) ──

/** The saved slot-days from `today` on that the rules as they are now fail: a person left with nothing to eat, a required
 *  item missing, a soft rule kept too often (planChecks' own checks), or a dish nobody at the slot-day may eat. Only
 *  slot-days a re-plan may touch are answered. */
export function failingSlotDays(db: Db, today: string): Target[] {
  const out: Target[] = [];
  const rules = listRules(db), library = listLibrary(db), slots = listSlots(db, { all: true });
  for (const week of plannedWeeks(db, today)) {
    const saved = listSlotDays(db, { from: week, to: addDays(week, 6) });
    const days: PlanDay[] = saved.map((d) => ({ date: d.date!, slot: d.slot, people: d.people, guests: d.guests, occasion: d.occasion, new_dishes_allowed: d.new_dishes_allowed,
      skip: d.skip, edited: d.edited, fixed: !replannable(d, today), why: [], fasting: [], dishes: d.dishes.map((x) => x.dish), note: d.note }));
    const w: Week = { days, slots: new Map(), rules, library, facts: new Map(), done: new Set(), newDishes: new Map() };
    for (const s of slots) {
      const history = slotHistory(db, s.name, week);
      w.slots.set(s.name.toLowerCase(), slotFacts(s, library, history, recent(history, week, 3)));
      w.done.add(s.name.toLowerCase());
    }
    for (const s of uniq(days.filter((d) => !d.fixed).map((d) => d.slot))) {
      if (!w.slots.has(s.toLowerCase())) continue;
      const mine = days.filter((d) => same(d.slot, s) && !d.fixed && !d.skip);
      const p = { days: new Map(mine.map((d) => [d.date, d.dishes])), newNames: new Map() };
      const problems = checkSlot(w, s, p);
      for (const d of mine) {
        const bad = (problems.get(d.date) ?? []).some((x) => !x.soft && (x.kind === "rule" || x.kind === "soft_over"))
          || (d.people.length > 0 && d.dishes.some((x) => notFor(w, d, x).length === d.people.length));
        if (bad) out.push({ date: d.date, slot: d.slot });
      }
    }
  }
  return out;
}
/** The saved slot-days from `today` on where a fasting rule holds for someone there (its people change with it). */
function fastingSlotDays(db: Db, today: string, r: Rule): Target[] {
  if (r.what !== "fasting") return [];
  const slots = listSlots(db, { all: true });
  return listSlotDays(db, { from: today }).filter((d) => replannable(d, today) && ruleHolds(r, d.date!, slots.find((s) => same(s.name, d.slot)), d.slot, slots)
    && (!r.who || d.people.some((p) => same(p, r.who!)) || getSlot(db, d.slot)?.usual_people.length === 0)).map((d) => ({ date: d.date!, slot: d.slot }));
}

// ── The routes ──

export function mountChangeRoutes(hono: Hono<any>, deps: Omit<ChangeDeps, "now"> & { now?: () => Date; appToken?: string | null }) {
  const write = writeRoutes(hono);
  const d: ChangeDeps = { ...deps, now: deps.now ?? (() => new Date()) };
  const { db, emit } = d;
  const today = () => todayStr(d.now());

  // set_slot: a meal slot added, changed or taken away; this week's (and next, when planned) slot-days of it planned again.
  write("/api/slots", async (b, by) => {
    const n = name(b.name, "name");
    const had = getSlot(db, n);
    if (b.remove === true) {
      if (!had) return { status: 404, body: { reason: `${n} is not one of the meals` } };
      const gone = commit(db, emit, (tx, ch) => {
        removeSlot(tx, had.name, by, ch);
        // Its slot-days from today on go with it, the family's own edits kept.
        const left = listSlotDays(tx, { from: today(), slot: had.name }).filter((x) => replannable(x, today()));
        for (const x of left) { saveSlotDay(tx, { date: x.date, slot: x.slot, dishes: [] }, by, ch); tx.delete(slot_days).where(eq(slot_days.id, x.id)).run(); ch.push(["slot_days", x.id, "delete", by]); }
        return left.length;
      });
      return { body: { ok: true, removed: had.name, slot_days_removed: gone } };
    }
    const kind = b.kind === undefined ? undefined : (SLOT_KINDS as readonly unknown[]).includes(b.kind) ? b.kind as SlotKind : refuse(`kind must be one of: ${SLOT_KINDS.join(", ")}`);
    if (!had && !kind) refuse(`${n} is a new meal: send its kind (${SLOT_KINDS.join(", ")})`);
    const k = kind ?? had!.kind;
    const addon_of = b.addon_of === undefined ? undefined : b.addon_of === null ? null : slotNamed(db, b.addon_of, "addon_of").name;
    if (k === "addon" && !(addon_of ?? had?.addon_of)) refuse("an addon slot needs addon_of: the main meal it adds to");
    const order = b.order === undefined ? undefined : typeof b.order === "number" && Number.isInteger(b.order) ? b.order : refuse("order must be a whole number");
    const skip_days = b.skip_days === undefined ? undefined : Array.isArray(b.skip_days) ? b.skip_days.map((x) => {
      if (!isObject(x)) return refuse("skip_days must be a list of { day, skip: eaten_out | ordered_in }");
      return { day: weekdays([x.day], "skip_days day")[0], skip: skipOf(x.skip, "skip_days skip") ?? refuse("skip_days skip must be eaten_out or ordered_in") };
    }) : refuse("skip_days must be a list of { day, skip: eaten_out | ordered_in }");
    const input = { name: had?.name ?? n, kind, addon_of, usual_people: b.usual_people === undefined ? undefined : personNames(db, b.usual_people, "usual_people"),
      days: b.days === undefined ? undefined : weekdays(b.days, "days") as Weekday[], skip_days, active: true,
      order: order ?? (had ? undefined : k === "addon" ? SLOT_ORDER.addon : k === "main" ? SLOT_ORDER[n as "Breakfast" | "Lunch" | "Dinner"] ?? refuse(`${n}: send its order (Breakfast 10, Lunch 30, Dinner 50)`) : SLOT_ORDER.snack) };
    const slot = commit(db, emit, (tx, ch) => upsertSlot(tx, input, by, ch));
    // This slot's slot-days in the planned weeks: the ones it has, and the days it now has none on.
    const targets: Target[] = [];
    for (const week of plannedWeeks(db, today())) for (let i = 0; i < 7; i++) {
      const date = addDays(week, i);
      if (date < today()) continue;
      const at = getSlotDay(db, date, slot.name);
      if (at && !replannable(at, today())) continue;
      if (slot.days.length && !slot.days.includes(weekdayOf(date))) {
        if (at) commit(db, emit, (tx, ch) => { saveSlotDay(tx, { date, slot: slot.name, dishes: [] }, by, ch); tx.delete(slot_days).where(eq(slot_days.id, at.id)).run(); ch.push(["slot_days", at.id, "delete", by]); });
        continue;
      }
      targets.push({ date, slot: slot.name });
    }
    return { body: { ok: true, slot, ...(await replan(d, targets)) } };
  });

  // set_slot_day: a one-off change to one slot on one day. Marked edited (never planned over); its dishes planned again for
  // the change unless the family named them, or it is eaten out or ordered in.
  write("/api/slot-days", async (b, by) => {
    const date = dateOf(b.date, "date");
    const slot = slotNamed(db, b.slot);
    const had = getSlotDay(db, date, slot.name);
    if (had?.status === "confirmed") return { status: 409, body: { reason: `${slot.name} on ${date} is already recorded as made: record_made changes what was made` } };
    let ppl = had?.people.length ? had.people : slot.usual_people.length ? slot.usual_people : people(db);
    if (b.people !== undefined) ppl = personNames(db, b.people, "people", true);
    if (b.add_people !== undefined) ppl = uniq([...ppl, ...personNames(db, b.add_people, "add_people", true)]);
    if (b.remove_people !== undefined) { const gone = personNames(db, b.remove_people, "remove_people", true); ppl = ppl.filter((p) => !gone.some((g) => same(g, p))); }
    const guests = b.guests === undefined ? undefined : guestsOf(b.guests);
    const occasion = b.occasion === undefined ? undefined : words(b.occasion, "occasion");
    const nda = b.new_dishes_allowed === undefined ? undefined : b.new_dishes_allowed === null ? null
      : typeof b.new_dishes_allowed === "number" && Number.isInteger(b.new_dishes_allowed) && b.new_dishes_allowed >= 0 ? b.new_dishes_allowed : refuse("new_dishes_allowed must be a whole number, 0 or more, or null");
    const skip = b.skip === undefined ? undefined : skipOf(b.skip, "skip");
    const dishes = b.dishes === undefined ? undefined : dishesOf(b.dishes, "dishes");
    if (skip && dishes?.length) refuse("a meal eaten out or ordered in has no dishes: send skip or dishes, not both");
    const attendance = ["people", "add_people", "remove_people"].some((k) => b[k] !== undefined);
    if (!attendance && guests === undefined && occasion === undefined && nda === undefined && skip === undefined && dishes === undefined)
      refuse("nothing to change: send people, add_people, remove_people, guests, occasion, new_dishes_allowed, skip or dishes");
    const count = ppl.length + (guests ?? had?.guests ?? []).reduce((n, g) => n + g.count, 0);
    if (dishes) await fillIngredients(d, date, slot.name, count, dishes);
    const saved = commit(db, emit, (tx, ch) => saveSlotDay(tx, { date, slot: slot.name, people: ppl, guests, occasion, new_dishes_allowed: nda, edited: true,
      ...(skip !== undefined ? { skip } : {}), ...(skip ? { dishes: [] } : {}),
      ...(dishes ? { dishes: dishes.map(({ given: _g, ...x }) => x) } : {}) }, by, ch));
    // Planned again only in a week that has a plan; else the week is planned with it later.
    const weekPlanned = listSlotDays(db, { from: mondayOf(date), to: addDays(mondayOf(date), 6) }).some((x) => x.id !== saved.id);
    const again = !dishes && !skip && date >= today() && (weekPlanned || saved.dishes.length > 0);
    const r = again ? await replan(d, [{ date, slot: slot.name }]) : { replanned: [] };
    return { body: { ok: true, slot_day: getSlotDay(db, date, slot.name), ...r } };
  });

  // add_dish: a dish the family has, added to a slot's library, what it contains read before it answers. From a reel or
  // recipe link they sent: not eaten yet (untried), the link kept as its video.
  write("/api/library", async (b, by) => {
    const dish = name(b.name, "name");
    const slot = slotNamed(db, b.slot);
    const frequency = b.frequency === undefined || b.frequency === null ? b.frequency as null | undefined
      : frequencyOf(b.frequency) ?? refuse('frequency must be daily, usually, sometimes, rarely or "<n>/week"');
    const days = b.days === undefined || b.days === null ? b.days as null | undefined : weekdays(b.days, "days") as Weekday[];
    const link = b.link === undefined || b.link === null ? null : typeof b.link === "string" && /^https?:\/\//i.test(b.link.trim()) ? b.link.trim() : refuse("link must be the reel's or recipe's http(s) link");
    if (b.quote !== undefined) words(b.quote, "quote");
    const had = getLibraryDish(db, dish, slot.name);
    // How often or the days changed: the family's words for them are the quote given, else none (old words would be wrong).
    const said = frequency === undefined && days === undefined ? undefined : (frequency || days?.length) && typeof b.quote === "string" ? b.quote.trim() || null : null;
    const row = commit(db, emit, (tx, ch) => upsertLibrary(tx, { name: had?.name ?? dish, slot: slot.name, frequency, days, said,
      // The family's own dish now, not a suggestion; one named in setup keeps its origin.
      ...(had?.origin === "setup_named" ? {} : { origin: "family_added" as const }), suggested: false,
      ...(link ? { video_url: link, ...(had && !had.untried ? {} : { untried: true }) } : had ? {} : { untried: false }) }, by, ch));
    await readContains(d, [{ name: row.name, slot: row.slot }], houseTags(db));
    return { body: { ok: true, dish: getLibraryDish(db, row.name, row.slot) } };
  });

  // set_rule: a food rule added, changed (by its id) or taken away; this week's slot-days re-checked, the failing ones planned again.
  write("/api/rules", async (b, by) => {
    const id = b.id === undefined ? null : name(b.id, "id");
    const before = id ? listRules(db).find((r) => r.id === id) ?? null : null;
    if (id && !before) return { status: 404, body: { reason: `no rule ${id}: read the rules (GET rules) for their ids` } };
    if (b.remove === true) {
      if (!before) refuse("remove needs the rule's id");
      commit(db, emit, (tx, ch) => removeRule(tx, before!.id, by, ch));
      return { body: { ok: true, removed: before, ...(await replan(d, fastingSlotDays(db, today(), before!))) } };
    }
    const input: Partial<RuleInput> = {};
    if (b.hard !== undefined) input.hard = flag(b.hard, "hard");
    if (b.what !== undefined) input.what = (RULE_WHATS as readonly unknown[]).includes(b.what) ? b.what as RuleWhat : refuse(`what must be one of: ${RULE_WHATS.join(", ")}`);
    if (b.who !== undefined) input.who = b.who === null ? null : personNames(db, [b.who], "who")[0];
    if (b.slots !== undefined) input.slots = b.slots === null ? null : names(b.slots, "slots").map((s) => slotNamed(db, s, "slots").name);
    if (b.days !== undefined) input.days = b.days === null ? null : weekdays(b.days, "days");
    if (b.items !== undefined) {
      const said = b.items === null ? null : names(b.items, "items");
      input.items = said && said.map(canonTag);
      // Resolved once, here, as targetsOf would derive them (targets.ts targetsFor): what the rule is about is typed from now on.
      const what = input.what ?? before?.what;
      input.targets = said && (what ? targetsFor({ what, items: said }) : said.flatMap((w) => [resolveTarget(w)]));
    }
    if (b.to !== undefined) input.to = words(b.to, "to");
    if (b.frequency !== undefined) input.frequency = b.frequency === null ? null : frequencyOf(b.frequency) ?? refuse('frequency must be usually, sometimes, rarely or "<n>/week"');
    // A swap's item: a soft swap with a frequency ("millets sometimes") stays its own kind, so it gives nothing typed.
    if (b.to !== undefined || b.frequency !== undefined) {
      const to = input.to ?? before?.to ?? null, freq = input.frequency !== undefined ? input.frequency : before?.frequency ?? null;
      input.gives = to && !freq ? resolveGives(to) : null;
    }
    if (b.per_meal !== undefined) input.per_meal = b.per_meal === null ? null : typeof b.per_meal === "number" && Number.isInteger(b.per_meal) && b.per_meal > 0 ? b.per_meal : refuse("per_meal must be a whole number above 0");
    if (b.fasting_food !== undefined) input.fasting_food = b.fasting_food === null ? null : names(b.fasting_food, "fasting_food");
    if (b.quote !== undefined) input.quote = name(b.quote, "quote");
    const merged = { ...(before ?? {}), ...input } as Partial<Rule>;
    if (!before) {
      if (merged.hard === undefined || !merged.what || !merged.quote) refuse("a new rule needs hard, what and quote (the family's own words)");
    }
    if (merged.hard && merged.frequency) refuse("a hard rule has no frequency: it always holds (send hard: false for one kept some times a week)");
    if (merged.what === "swap" && !merged.to) refuse("a swap needs to: what goes in place of its items");
    if (["avoid", "only", "swap", "require"].includes(merged.what!) && !merged.items?.length) refuse(`a ${merged.what} rule needs items: the tags it names`);
    const rule = commit(db, emit, (tx, ch) => before ? updateRule(tx, before.id, input, by, ch)! : addRule(tx, input as RuleInput, by, ch));
    // What the dishes contain for the rule's tags, read for every dish of the library first (unknown would fail closed).
    const tags = uniq([...forbidden(rule), ...(rule.items ?? []), ...(rule.to ? [rule.to] : [])].map(canonTag)).filter(Boolean);
    if (tags.length) await readContains(d, listLibrary(db).map((x) => ({ name: x.name, slot: x.slot })), tags);
    const targets = [...failingSlotDays(db, today()), ...fastingSlotDays(db, today(), rule), ...(before ? fastingSlotDays(db, today(), before) : [])];
    return { body: { ok: true, rule, ...(await replan(d, targets)) } };
  });

  // set_setting { new_dishes_per_week }: through the kit's settings route, with its check and change log.
  write("/api/planner-settings", async (b, _by, c: Context) => {
    const v = b.new_dishes_per_week;
    if (!(NEW_DISHES_CHOICES as readonly unknown[]).includes(v)) refuse(`new_dishes_per_week must be one of: ${NEW_DISHES_CHOICES.join(", ")} (none, 1–2, 3–4, surprise me)`);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (deps.appToken) headers.Authorization = `Bearer ${deps.appToken}`;
    for (const h of ["x-flock-agent", "x-flock-user"]) { const x = c.req.header(h); if (x) headers[h] = x; }
    const res = await hono.request("/api/_app/settings", { method: "PATCH", headers, body: JSON.stringify({ new_dishes_per_week: v }) });
    if (!res.ok) refuse(`the setting was not saved: ${(await res.json().catch(() => null) as any)?.message ?? res.status}`);
    return { body: { ok: true, new_dishes_per_week: newDishesPerWeek(db) } };
  });

  // record_made: the family said what was made at a meal ("we made khichdi instead"): its dishes replaced, confirmed.
  write("/api/slot-days/made", async (b, by) => {
    const date = dateOf(b.date, "date");
    if (date > today()) refuse(`${date} is still to come: record_made is for what was made; set_slot_day changes a planned meal`);
    const slot = name(b.slot, "slot");
    const known = getSlot(db, slot)?.name ?? getSlotDay(db, date, slot)?.slot ?? slotNamed(db, slot).name;
    const dishes = dishesOf(b.dishes, "dishes");
    if (!dishes.length) refuse("dishes: what was made (a meal eaten out or ordered in is set_slot_day skip)");
    const day = commit(db, emit, (tx, ch) => saveSlotDay(tx, { date, slot: known, status: "confirmed", edited: true, skip: null,
      dishes: dishes.map(({ given: _g, ...x }) => x) }, by, ch));
    return { body: { ok: true, slot_day: day } };
  });

  // record_feedback: the answer to the next-day question about a dish the family had not eaten before (spec §5.7), or
  // (`answer`) to "OK to try / make it, or swap?" about a brand-new dish before it is cooked (owner, 25 Nov): ok makes it
  // theirs; swap plans that slot-day again with nothing new; dont_like marks it disliked and, on a day to come, plans that
  // slot-day again too.
  write("/api/slot-days/feedback", async (b, by) => {
    const date = dateOf(b.date, "date");
    const dishName = name(b.dish, "dish");
    if (b.answer !== undefined) {
      if (b.made !== undefined || b.liked !== undefined || b.again !== undefined) refuse("send answer (before it is cooked) or made (after), not both");
      if ((CHECK_ANSWERS as readonly unknown[]).includes(b.answer)) {
        if (typeof b.who !== "string" || !b.who.trim()) refuse("who is required with answer fits or not_for");
        return checkAnswer(date, dishName, typeof b.slot === "string" ? b.slot : "", personNames(db, [b.who], "who")[0], b.answer as CheckAnswer, by);
      }
      if (!(NEW_DISH_ANSWERS as readonly unknown[]).includes(b.answer)) refuse(`answer must be one of: ${[...NEW_DISH_ANSWERS, ...CHECK_ANSWERS].join(", ")}`);
      return newDishAnswer(date, dishName, typeof b.slot === "string" ? b.slot : "", b.answer as NewDishAnswer, by);
    }
    if (b.made === undefined) refuse("made or answer is needed: made (true or false) after the day, answer (ok, swap, dont_like) before it is cooked");
    const made = flag(b.made, "made");
    const liked = b.liked === undefined || b.liked === null ? null : flag(b.liked, "liked");
    const again = b.again === undefined || b.again === null ? null : flag(b.again, "again");
    if (made && liked === null) refuse("liked is needed when made is true: did they like it?", "NEEDS_ANSWER");
    if (made && liked && again === null) refuse("again is needed when they made it and liked it: should it be suggested again?", "NEEDS_ANSWER");
    // The placement: at that slot that day, else the one dish of that name that day.
    const onDay = listSlotDays(db, { from: date, to: date });
    const slotName = typeof b.slot === "string" ? b.slot : "";
    const at = onDay.filter((x) => (!slotName || same(x.slot, slotName)) && x.dishes.some((y) => dishKey(y.dish) === dishKey(dishName)));
    const day = at.length ? at[0] : onDay.filter((x) => x.dishes.some((y) => dishKey(y.dish) === dishKey(dishName)))[0];
    if (!day) return { status: 404, body: { reason: `${dishName} was not on the plan on ${date}` } };
    const placed = day.dishes.find((y) => dishKey(y.dish) === dishKey(dishName))!;
    const rows = listLibrary(db, { names: [dishName] });
    if (!rows.length) return { status: 404, body: { reason: `${dishName} is not in the library` } };
    const outcome = !made ? "not_made" : !liked ? "disliked" : again ? "kept" : "not_again";
    commit(db, emit, (tx, ch) => {
      // The table of §5.7, the same for a planner suggestion and a reel's dish.
      if (outcome === "kept") updateLibraryByName(tx, dishName, { untried: 0, suggested: 0 }, by, ch);
      else if (outcome === "disliked") updateLibraryByName(tx, dishName, { disliked: 1 }, by, ch);
      else if (outcome === "not_again") updateLibraryByName(tx, dishName, { offers: Math.max(UNTRIED_MAX_OFFERS, ...rows.map((r) => r.offers)) }, by, ch);
      if (made) saveSlotDay(tx, { date, slot: day.slot, status: "confirmed" }, by, ch);
      tx.update(slot_dishes).set({ feedback_asked: FEEDBACK_ANSWERED, updated_at: new Date().toISOString(), updated_by: by }).where(eq(slot_dishes.id, placed.id)).run();
      ch.push(["slot_dishes", placed.id, "update", by]);
    });
    return { body: { ok: true, dish: dishName, outcome, library: listLibrary(db, { names: [dishName] }) } };
  });

  /** The answer to the plan's check question, "Is the Kadhi OK for Gowri Shankar, no egg?" (spec §9.1), saved as the dish's read
   *  for the person's hard rules' ingredient tags it was not read for (T), so it is never asked again for them: fits, the dish
   *  is read as without T; not_for, read as having T, and that slot-day planned again (the person gets an item they can eat). */
  async function checkAnswer(date: string, dishName: string, slotName: string, who: string, answer: CheckAnswer, by: string) {
    const onDay = listSlotDays(db, { from: date, to: date }).filter((x) => x.dishes.some((y) => dishKey(y.dish) === dishKey(dishName)));
    const day = onDay.find((x) => !slotName || same(x.slot, slotName)) ?? onDay[0];
    if (!day) return { status: 404 as const, body: { reason: `${dishName} was not on the plan on ${date}` } };
    const row = getLibraryDish(db, dishName, day.slot) ?? listLibrary(db, { names: [dishName] })[0];
    if (!row) return { status: 404 as const, body: { reason: `${dishName} is not in the library` } };
    const read = new Set(row.contains_read.map(canonTag));
    const tags = uniq(listRules(db).filter((r) => r.hard && (!r.who || same(r.who, who))).flatMap(forbidden)).filter((t) => !readFor(read, t));
    const again = answer === "not_for" && date >= today() && day.status !== "confirmed";
    commit(db, emit, (tx, ch) => {
      if (!tags.length) return;
      upsertLibrary(tx, answer === "fits"
        ? { name: row.name, slot: row.slot, contains_read: uniq([...row.contains_read, ...tags]), contains: row.contains.filter((t) => !tags.includes(canonTag(t))) }
        : { name: row.name, slot: row.slot, contains_read: uniq([...row.contains_read, ...tags]), contains: uniq([...row.contains, ...tags]) }, by, ch);
    });
    const r = again ? await replan(d, [{ date, slot: day.slot }]) : { replanned: [] };
    return { body: { ok: true, dish: row.name, who, outcome: answer, tags, library: listLibrary(db, { names: [row.name] }), ...r } };
  }

  /** The answer to "OK to try it, or should I swap it?" (the week's message) or "OK to make it, or swap?" (the evening before). */
  async function newDishAnswer(date: string, dishName: string, slotName: string, answer: NewDishAnswer, by: string) {
    const onDay = listSlotDays(db, { from: date, to: date }).filter((x) => x.dishes.some((y) => dishKey(y.dish) === dishKey(dishName)));
    const day = onDay.find((x) => !slotName || same(x.slot, slotName)) ?? onDay[0];
    if (!day) return { status: 404 as const, body: { reason: `${dishName} was not on the plan on ${date}` } };
    const placed = day.dishes.find((y) => dishKey(y.dish) === dishKey(dishName))!;
    if (!listLibrary(db, { names: [dishName] }).length) return { status: 404 as const, body: { reason: `${dishName} is not in the library` } };
    const again = answer === "swap" || (answer === "dont_like" && date >= today());
    if (answer === "swap" && date < today()) refuse(`${date} has passed: a dish already cooked or not is answered with made`);
    if (again && day.status === "confirmed") return { status: 409 as const, body: { reason: `${day.slot} on ${date} is already recorded as made` } };
    commit(db, emit, (tx, ch) => {
      if (answer === "ok") updateLibraryByName(tx, dishName, { untried: 0, suggested: 0 }, by, ch);
      if (answer === "dont_like") updateLibraryByName(tx, dishName, { disliked: 1 }, by, ch);
      if (answer !== "swap") {
        tx.update(slot_dishes).set({ feedback_asked: FEEDBACK_ANSWERED, updated_at: new Date().toISOString(), updated_by: by }).where(eq(slot_dishes.id, placed.id)).run();
        ch.push(["slot_dishes", placed.id, "update", by]);
      }
      // Planned again with nothing new that day (set_slot_day's new_dishes_allowed 0), kept as the family's change.
      if (again) saveSlotDay(tx, { date, slot: day.slot, new_dishes_allowed: 0, edited: true }, by, ch);
    });
    const r = again ? await replan(d, [{ date, slot: day.slot }]) : { replanned: [] };
    const outcome = answer === "ok" ? "accepted" : answer === "swap" ? "swapped" : "disliked";
    return { body: { ok: true, dish: dishName, outcome, library: listLibrary(db, { names: [dishName] }), ...r } };
  }
}

/** The answers to the question about a brand-new dish before it is cooked. */
export const NEW_DISH_ANSWERS = ["ok", "swap", "dont_like"] as const;
type NewDishAnswer = (typeof NEW_DISH_ANSWERS)[number];
/** The answers to the plan's check question about a dish and a person's rule ("Is the Kadhi OK for Gowri Shankar, no egg?"). */
export const CHECK_ANSWERS = ["fits", "not_for"] as const;
type CheckAnswer = (typeof CHECK_ANSWERS)[number];
