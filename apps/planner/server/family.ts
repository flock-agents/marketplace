// The family profile: who eats at home, the house rules, the cook, the extra slots and the meals ordered in. The agent writes
// it during the interview through these routes (its set_person, set_house_rules, set_cook and set_slots operations) and the
// Family page reads it. Everything a person said is kept in their own words; only what the app itself reads later (a group,
// a weekday, the cook's arrival times) is checked.
import type { Context, Hono } from "hono";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { asc, eq } from "drizzle-orm";
import { _settings } from "@flock/app-kit";
import { house, people } from "./db/schema";
import { appOf, COOK_NEW_RECIPES, COOKING_DAYS_DEFAULT, GROUPS, RULE_KINDS, SETTINGS, SHOP_APPS, SLOTS, type GroceryApp } from "./db/constants";
import { WEEKDAYS, type Weekday } from "./dates";
import { closest } from "./agentOps";
import { CATEGORIES, CHECKED_KINDS, KIND_NEEDS, rulesSaid, type Rule } from "./rules";

export type Db = BunSQLiteDatabase<any>;
/** Tell live pages a row changed, and who changed it (the kit's emitChange). */
export type Emit = (table: string, id: string, op: "insert" | "update" | "delete", by: string) => void;

export type PersonRow = typeof people.$inferSelect;
export type HouseRow = typeof house.$inferSelect;
/** A house rule (rules.ts, the spec's one shape). `days` empty: it holds every day; no `who`: everyone; no `slots`: every meal. */
export type HouseRule = Rule & { kind: (typeof RULE_KINDS)[number] };
export type ExtraSlot = { name: string; days?: Weekday[]; for?: string[] };
export type OrderIn = { day: Weekday; slot: string; note?: string };
/** One visit of the cook: when they come, and the meals that visit makes when the family said. */
export type CookVisit = { at: string; meals?: string[] };
/** The house row with its lists read: what the routes answer with. */
export type HouseView = Omit<HouseRow, "rules" | "cook_days" | "extra_slots" | "order_in" | "cooking_days" | "connected_apps" | "history_synced"> &
  { rules: HouseRule[]; cook_days: Weekday[]; cook_visits: CookVisit[]; extra_slots: ExtraSlot[]; order_in: OrderIn[];
    cooking_days: Weekday[]; connected_apps: GroceryApp[]; history_synced: HistorySynced };
/** How far each app's order history was read, by reader: whoever gave the orders (`agent:<id>`, a person's own agent reading
 *  that person's account). `*` is a date kept before readers were told apart. */
export type HistorySynced = Record<string, Record<string, string>>;
export const ANY_READER = "*";

/** The household's one row, made the first time anything asks for it. */
export function getHouse(db: Db): HouseRow {
  const row = db.select().from(house).orderBy(asc(house.created_at)).limit(1).get();
  return row ?? db.insert(house).values({ updated_by: "app" }).returning().get();
}

export const list = <T>(json: string | null): T[] => { try { const v = json ? JSON.parse(json) : []; return Array.isArray(v) ? v : []; } catch { return []; } };

/** house.history_synced read: `{ app: { reader: date } }`, an app read per shop account under "<app>:<account>"; a plain date (an install from before) is under ANY_READER. */
function historySynced(json: string | null): HistorySynced {
  let v: unknown = null;
  try { v = json ? JSON.parse(json) : null; } catch { /* unreadable: nothing read yet */ }
  const out: HistorySynced = {};
  if (!isObject(v)) return out;
  for (const [app, read] of Object.entries(v)) {
    if (typeof read === "string") out[app] = { [ANY_READER]: read };
    else if (isObject(read)) out[app] = Object.fromEntries(Object.entries(read).filter((e): e is [string, string] => typeof e[1] === "string"));
  }
  return out;
}

/** How far `reader` read `app`'s order history, or null. `legacy`: a date from before readers were told apart counts as this
 *  reader's (true only for the app's own paired agent, which was the one reading then). */
export function readUntil(synced: HistorySynced, app: string, reader: string, legacy = false): string | null {
  return synced[app]?.[reader] ?? (legacy ? synced[app]?.[ANY_READER] : undefined) ?? null;
}

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
/** The cook's visits from `cook_arrival`: one plain "HH:MM" (every row before a cook could come twice) is one visit; a cook who
 *  comes more than once, or whose visit names its meals, is kept as a JSON list. Earliest first. */
export function cookVisits(arrival: string | null): CookVisit[] {
  if (!arrival) return [];
  if (CLOCK.test(arrival)) return [{ at: arrival }];
  return list<CookVisit>(arrival).filter((v) => isObject(v) && typeof v.at === "string" && CLOCK.test(v.at));
}

export function houseView(row: HouseRow): HouseView {
  const cooking = list<Weekday>(row.cooking_days);
  const visits = cookVisits(row.cook_arrival);
  // cook_arrival stays one time for whoever reads it as before (the first visit); cook_visits is every visit.
  return { ...row, cook_arrival: visits[0]?.at ?? null, cook_visits: visits, rules: list(row.rules), cook_days: list(row.cook_days), extra_slots: list(row.extra_slots), order_in: list(row.order_in),
    cooking_days: cooking.length ? cooking : [...COOKING_DAYS_DEFAULT], connected_apps: list<GroceryApp>(row.connected_apps), history_synced: historySynced(row.history_synced) };
}

/** One of the app's settings as saved, else its default. */
function setting(db: Db, key: string): unknown {
  const def = SETTINGS.find((s) => s.key === key)!.default;
  try {
    const row = db.select({ value: _settings.value }).from(_settings).where(eq(_settings.key, key)).get();
    return row?.value ? JSON.parse(row.value) : def;
  } catch { return def; }
}

/** The grocery app orders go to: the owner's setting, else its default. */
export function groceryApp(db: Db): GroceryApp {
  const v = setting(db, "grocery_app");
  return (SHOP_APPS as readonly unknown[]).includes(v) ? (v as GroceryApp) : (SETTINGS[0].default as GroceryApp);
}

/** The family's shopping profile: the main app, the one tried when something is not on it, every app signed in to (the main
 *  app and the fallback are among them only once the family has signed in to them), and whether an order may go without her say. */
export function shoppingApps(db: Db): { main: GroceryApp; fallback: GroceryApp | null; connected: GroceryApp[]; order_without_asking: boolean } {
  const fb = setting(db, "fallback_app");
  return { main: groceryApp(db), fallback: (SHOP_APPS as readonly unknown[]).includes(fb) ? (fb as GroceryApp) : null,
    connected: houseView(getHouse(db)).connected_apps, order_without_asking: setting(db, "order_without_asking") === true };
}

/** A write the app will not make: the route answers 400 with the reason, and with a code when the agent acts on the kind of
 *  refusal (NEEDS_NAME: ask the family for a name). */
export class Refused extends Error {
  constructor(reason: string, readonly code?: string, readonly detail?: Record<string, unknown>) { super(reason); }
}
/** `detail`: more for the agent to act on, answered beside the reason (a plan's check lists the dishes it names). */
export const refuse = (reason: string, code?: string, detail?: Record<string, unknown>): never => { throw new Refused(reason, code, detail); };

export const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const DAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
/** A weekday however it was written ("Tue", "tuesday", "TUES"), or null. */
const weekday = (v: unknown): Weekday | null => {
  const w = typeof v === "string" ? v.trim().toLowerCase() : "";
  return w.length < 3 ? null : WEEKDAYS[DAY_NAMES.findIndex((d) => d.startsWith(w))] ?? null;
};
export const weekdays = (v: unknown, what: string): Weekday[] => {
  if (!Array.isArray(v)) return refuse(`${what} must be a list of weekdays (${WEEKDAYS.join(", ")})`);
  return v.map((d) => weekday(d) ?? refuse(`${what}: ${JSON.stringify(d)} is not a weekday (${WEEKDAYS.join(", ")})`));
};
export const name = (v: unknown, what: string): string => (typeof v === "string" && v.trim() ? v.trim() : refuse(`${what} is required`));
/** A free-text field: text, or null to clear it. Blank text clears it too. */
export const words = (v: unknown, what: string): string | null =>
  v === null ? null : typeof v === "string" ? v.trim() || null : refuse(`${what} must be text`);
export const names = (v: unknown, what: string): string[] =>
  Array.isArray(v) && v.every((n) => typeof n === "string" && n.trim()) ? v.map((n: string) => n.trim()) : refuse(`${what} must be a list of names`);
const optionalNote = (v: unknown, what: string): { note?: string } => {
  const note = v === undefined ? null : words(v, what);
  return note ? { note } : {};
};

const PERSON_WORDS = ["relationship", "portions", "diet", "allergies", "dislikes", "targets", "note"] as const;

const RULE_SHAPE = "rules must be a list of { kind, who?, days?, slots?, items?, to?, per_week?, per_meal?, note? }";
const KIND_HELP = `a rule's kind must be one of: ${RULE_KINDS.join(", ")} (avoid: no dish with items; only: who eats only items; swap: who has to in place of items; `
  + `require: who eats one of items at each of slots; cap: items in at most per_week meals, or at most per_meal dishes in each meal of slots; no_eggs: "no eggs on Tuesday"; egg: eggs but no meat; fasting: who eats nothing at slots on days (without slots a note); other: the family's own words in note)`;
const CATEGORY_LIST = Object.keys(CATEGORIES).map((c) => `@${c}`).join(", ");
const isChecked = (kind: unknown): kind is (typeof CHECKED_KINDS)[number] => (CHECKED_KINDS as readonly unknown[]).includes(kind);

/** The rules as sent, checked. `people`: the names on the Family page (a rule's who is one of them); `slots`: the meal slots. */
/** A rule as compared for add: true, its fields in one order, its note left out. */
const ruleKey = (r: Rule): string => JSON.stringify([r.kind, r.who ?? null, r.days, r.slots ?? null, r.items ?? null, r.to ?? null, r.per_week ?? null, r.per_meal ?? null,
  r.kind === "other" || r.kind === "fasting" ? (r.note ?? "").trim().toLowerCase() : null]);

function rules(v: unknown, ctx: { people: string[]; slots: string[] }): HouseRule[] {
  if (!Array.isArray(v)) return refuse(RULE_SHAPE);
  return v.map((r) => {
    if (!isObject(r)) return refuse(RULE_SHAPE);
    const note = optionalNote(r.note, "a rule's note");
    // A rule in the family's own words only ("mostly vegetarian") is an `other` rule.
    const kind = r.kind == null && note.note ? "other" : r.kind;
    if (!(RULE_KINDS as readonly unknown[]).includes(kind)) return refuse(KIND_HELP);
    if (kind === "other" && !note.note) return refuse("an other rule says what it is in note");
    const out: HouseRule = { kind: kind as HouseRule["kind"], days: [] };
    const given = (k: string) => r[k] !== undefined && r[k] !== null;
    if (given("who")) {
      const who = typeof r.who === "string" ? r.who.trim() : refuse(`the ${kind} rule: who is one person's name, as on the Family page`);
      const person = ctx.people.find((p) => p.toLowerCase() === who.toLowerCase());
      if (!person) {
        const near = closest(who, ctx.people);
        return refuse(ctx.people.length
          ? `the ${kind} rule: who: ${JSON.stringify(who)} is not on the Family page (${ctx.people.join(", ")})${near ? ` (did you mean ${near}?)` : ""}; add a new person with set_person first`
          : `the ${kind} rule: who: ${JSON.stringify(who)} is not on the Family page: add them with set_person first`);
      }
      out.who = person;
    }
    const label = `the ${kind} rule${out.who ? ` for ${out.who}` : ""}`;
    if (r.days != null) {
      if (isChecked(kind)) out.days = weekdays(r.days, `${label}: days`);
      else if (!Array.isArray(r.days) || !r.days.every((d) => typeof d === "string" && d.trim()))
        return refuse(`the ${kind} rule's days are weekdays or the family's own words for a day ("Ekadashi"); leave days out for a rule that holds every day`);
      else out.days = (r.days as string[]).map((d) => weekday(d) ?? d.trim());
    }
    if (given("slots")) out.slots = names(r.slots, `${label}: slots`).map((s) => {
      const hit = ctx.slots.find((x) => x.toLowerCase() === s.toLowerCase());
      if (hit) return hit;
      const within = ctx.slots.filter((x) => x.toLowerCase().includes(s.toLowerCase()));
      const near = within.length === 1 ? within[0] : closest(s, ctx.slots);
      return refuse(`${label}: slots: ${JSON.stringify(s)} is not a meal (${ctx.slots.join(", ")})${near ? ` (did you mean ${near}?)` : ""}`);
    });
    // What only the checked kinds take: a fast the app checks is { kind: only, who, days, items }.
    for (const k of ["items", "to", "per_week", "per_meal"]) if (given(k) && !isChecked(kind))
      return refuse(`${label} takes no ${k}: a rule about particular foods is ${CHECKED_KINDS.join(", ")} (a fast: { kind: only, who, days, items })`);
    if (given("items")) {
      if (!Array.isArray(r.items) || !r.items.length || !r.items.every((i) => typeof i === "string" && i.trim()))
        return refuse(`${label}: items must be a list of foods or dishes ("plain idli") or categories (${CATEGORY_LIST})`);
      out.items = (r.items as string[]).map((i) => {
        const t = i.trim();
        if (!t.startsWith("@")) return t;
        const cat = t.slice(1).toLowerCase();
        if (CATEGORIES[cat]) return `@${cat}`;
        // A category written a little off ("@mushrooms", "@spicy") is not worth refusing the whole list over (sim run
        // seed 15: the family's every rule lost to one plural): its singular when that is a category, else the plain word,
        // which matches dish names as any word item does.
        const singular = cat.replace(/(?<=[a-z])(es|s)$/, "");
        if (CATEGORIES[singular]) return `@${singular}`;
        return cat.replace(/_/g, " ");
      });
    }
    if (given("to")) {
      if (kind !== "swap") return refuse(`${label} takes no to: to is what a swap rule gives in place of its items`);
      out.to = name(r.to, `${label}: to`);
    }
    if (given("per_week")) {
      if (kind !== "cap") return refuse(`${label} takes no per_week: per_week is a cap rule's most meals in a week`);
      out.per_week = typeof r.per_week === "number" && Number.isInteger(r.per_week) && r.per_week >= 0 ? r.per_week
        : refuse(`${label}: per_week must be a whole number of meals, 0 or more`);
    }
    if (given("per_meal")) {
      if (kind !== "cap") return refuse(`${label} takes no per_meal: per_meal is a cap rule's most dishes in a meal`);
      out.per_meal = typeof r.per_meal === "number" && Number.isInteger(r.per_meal) && r.per_meal >= 1 ? r.per_meal
        : refuse(`${label}: per_meal must be a whole number of dishes, 1 or more`);
    }
    if (kind === "cap") {
      if (out.per_week !== undefined && out.per_meal !== undefined)
        return refuse(`${label} takes per_week or per_meal, not both: per_week is the most meals a week with items, per_meal the most dishes in a meal`);
      if (out.per_week === undefined && out.per_meal === undefined)
        return refuse(`${label} needs per_week (items in at most per_week meals a week) or per_meal (at most per_meal dishes in each meal of slots)`);
      if (out.per_week !== undefined && !out.items) return refuse(`${label} needs items: the foods a per_week cap counts`);
    }
    if (isChecked(kind)) {
      const missing = KIND_NEEDS[kind].filter((k) => (out as Record<string, unknown>)[k] === undefined);
      if (missing.length) return refuse(`${label} needs ${missing.join(", ")}`);
    }
    return { ...out, ...note };
  });
}

/** The house's notes: text, or a list of the family's lines. */
const notesOf = (v: unknown): string | null =>
  Array.isArray(v) && v.every((n) => typeof n === "string") ? v.map((n) => n.trim()).filter(Boolean).join("\n") || null : words(v, "notes");

function extraSlots(v: unknown): ExtraSlot[] {
  if (!Array.isArray(v)) return refuse("extra_slots must be a list of { name, days?, for? }");
  const slots = v.map((s) => {
    if (!isObject(s)) return refuse("extra_slots must be a list of { name, days?, for? }");
    const slot: ExtraSlot = { name: name(s.name, "an extra slot's name") };
    if (s.days != null) slot.days = weekdays(s.days, `${slot.name}: days`);
    if (s.for != null) slot.for = names(s.for, `${slot.name}: for`);
    return slot;
  });
  const taken = new Set(SLOTS.map((s) => s.toLowerCase()));
  for (const s of slots) {
    if (taken.has(s.name.toLowerCase())) return refuse(`there is already a slot named ${s.name}`);
    taken.add(s.name.toLowerCase());
  }
  return slots;
}

function orderIn(v: unknown, slotNames: string[]): OrderIn[] {
  if (!Array.isArray(v)) return refuse("order_in must be a list of { day, slot, note? }");
  return v.map((o) => {
    if (!isObject(o)) return refuse("order_in must be a list of { day, slot, note? }");
    const day = weekday(o.day) ?? refuse(`order_in: ${JSON.stringify(o.day)} is not a weekday (${WEEKDAYS.join(", ")})`);
    const slot = slotNames.find((s) => typeof o.slot === "string" && s.toLowerCase() === o.slot.trim().toLowerCase())
      ?? refuse(`order_in: the slot must be one of: ${slotNames.join(", ")}`);
    return { day, slot, ...optionalNote(o.note, "an order-in note") };
  });
}

const ARRIVAL_SHAPE = 'arrival must be a time as "HH:MM", like "07:30", or for a cook who comes more than once a list of visits: ["06:00", "16:30"] or [{ at: "06:00", meals: ["Breakfast", "Lunch"] }, { at: "16:30", meals: ["Dinner"] }]';
/** The cook's arrival as sent: one time, or a list of visits (each a time, or { at, meals? }). `slotNames`: the meals a visit
 *  may make. Stored as the plain time when it is one visit with no meals, so rows read as they always did. */
function arrival(v: unknown, slotNames: string[]): string {
  const time = (t: unknown): string => (typeof t === "string" && CLOCK.test(t) ? t : refuse(ARRIVAL_SHAPE));
  if (!Array.isArray(v)) return time(v);
  if (!v.length) return refuse(ARRIVAL_SHAPE);
  const visits = v.map((x): CookVisit => {
    if (!isObject(x)) return { at: time(x) };
    const visit: CookVisit = { at: time(x.at) };
    if (x.meals != null) visit.meals = names(x.meals, `the ${visit.at} visit's meals`).map((m) =>
      slotNames.find((s) => s.toLowerCase() === m.toLowerCase()) ?? refuse(`the ${visit.at} visit's meals must be from: ${slotNames.join(", ")}`));
    return visit;
  }).sort((a, b) => a.at.localeCompare(b.at));
  if (new Set(visits.map((x) => x.at)).size !== visits.length) return refuse("arrival: two visits have the same time");
  return visits.length === 1 && !visits[0].meals ? visits[0].at : JSON.stringify(visits);
}

/** Who is writing: the agent Flock relayed, the person on the page, or the app itself. */
const writer = (c: Context): string => {
  const agent = c.req.header("x-flock-agent")?.trim(); if (agent) return `agent:${agent}`;
  const user = c.req.header("x-flock-user")?.trim(); return user ? `user:${user}` : "app";
};
type Answer = { status?: 404 | 409; body: Record<string, unknown> };
/** The app's write routes: a JSON body in, the answer out, a refusal as a 400 with the reason. A route answers 404 for a row
 *  that is not there and 409 for one in a state the write does not fit, each with its reason. */
export const writeRoutes = (hono: Hono<any>) =>
  (path: string, run: (b: Record<string, unknown>, by: string, c: Context) => Answer | Promise<Answer>) =>
    hono.post(path, async (c) => {
      let b: unknown = null;
      try { b = await c.req.json(); } catch { /* no JSON: refused below */ }
      if (!isObject(b)) return c.json({ ok: false, reason: "send a JSON object" }, 400);
      try {
        const res = await run(b, writer(c), c);
        return c.json(res.status ? { ok: false, ...res.body } : res.body, res.status ?? 200);
      } catch (e) {
        if (e instanceof Refused) return c.json({ ok: false, reason: e.message, ...(e.code ? { code: e.code } : {}), ...(e.detail ?? {}) }, 400);
        throw e;
      }
    });

const LONG_DAY: Record<Weekday, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
/** Weekdays as a person says them: "every day", "Mon–Fri" (three or more in a row), "Mon, Wed and Fri". */
export function daysSaid(days: readonly string[] | undefined): string {
  const set = WEEKDAYS.filter((d) => days?.includes(d));
  if (!set.length || set.length === 7) return "every day";
  const at = set.map((d) => WEEKDAYS.indexOf(d));
  if (set.length >= 3 && at[at.length - 1] - at[0] === set.length - 1) return `${set[0]}–${set[set.length - 1]}`;
  return set.length === 1 ? `on ${LONG_DAY[set[0]]}s` : `${set.slice(0, -1).join(", ")} and ${set[set.length - 1]}`;
}
const andWords = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The meals a week is planned with, in the words the setup reads back: "Each day we'll plan Breakfast, Lunch and Dinner,
 *  plus Agastya's tiffin Mon–Fri and Evening snack every day. Sunday dinner you order in." */
export function slotsSaid(h: Pick<HouseView, "extra_slots" | "order_in">): string {
  const extra = h.extra_slots.map((s) => {
    const whose = (s.for ?? []).filter((p) => !s.name.toLowerCase().includes(p.toLowerCase()));
    return `${s.name} ${daysSaid(s.days)}${whose.length ? ` for ${andWords(whose)}` : ""}`;
  });
  const out = [`Each day we'll plan Breakfast, Lunch and Dinner${extra.length ? `, plus ${andWords(extra)}` : ""}.`];
  if (h.order_in.length) {
    const meals = h.order_in.map((o) => `${LONG_DAY[o.day]} ${(SLOTS as readonly string[]).includes(o.slot) ? o.slot.toLowerCase() : o.slot}`);
    out.push(`${andWords(meals)} you order in.`);
  }
  return out.join(" ");
}

/** `appToken`: the token Flock gave this app (null on an install that is not paired). The kit lets a setting change only
 *  with it, so that settings change through Flock alone; the app holds it, and uses it for the one setting its agent sets. */
export function mountFamilyRoutes(hono: Hono<any>, db: Db, emit: Emit, opts: { appToken?: string | null } = {}) {
  const write = writeRoutes(hono);
  /** Settings written through the kit's own settings route: its check, its change log and the event the pages listen to,
   *  stamped with whoever asked. */
  const patchSettings = async (values: Record<string, unknown>, c: Context): Promise<void> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.appToken) headers.Authorization = `Bearer ${opts.appToken}`;
    for (const h of ["x-flock-agent", "x-flock-user"]) { const v = c.req.header(h); if (v) headers[h] = v; }
    const res = await hono.request("/api/_app/settings", { method: "PATCH", headers, body: JSON.stringify(values) });
    if (!res.ok) refuse(`the shopping apps were not saved: ${(await res.json().catch(() => null) as any)?.message ?? res.status}`);
  };
  const saveHouse = (set: Partial<typeof house.$inferInsert>, by: string) => {
    const row = db.update(house).set({ ...set, updated_at: new Date().toISOString(), updated_by: by }).where(eq(house.id, getHouse(db).id)).returning().get();
    emit("house", row.id, "update", by);
    return { body: { house: houseView(row) } };
  };

  hono.get("/api/family", (c) => c.json({
    people: db.select().from(people).where(eq(people.active, 1)).orderBy(asc(people.created_at)).all(),
    house: houseView(getHouse(db)),
    shopping: shoppingApps(db),
  }));

  // set_person { name, relationship?, group, portions?, diet?, allergies?, dislikes?, targets?, note?, remove?: true }: one person by
  // name, whatever its capitals. Only the fields given change. `remove` takes them out of the family; their row stays.
  write("/api/family/people", (b, by) => {
    const given = name(b.name, "name");
    const same = db.select().from(people).all().filter((p) => p.name.trim().toLowerCase() === given.toLowerCase());
    const existing = same.find((p) => p.active) ?? same[0];
    if (b.remove === true && !existing) return { status: 404, body: { reason: `nobody named ${given} is in the family` } };
    const set: Partial<typeof people.$inferInsert> = { active: b.remove === true ? 0 : 1 };
    if (b.group != null) set.group = (GROUPS as readonly unknown[]).includes(b.group) ? (b.group as string) : refuse(`group must be one of: ${GROUPS.join(", ")}`);
    else if (!existing) refuse(`group is required: one of ${GROUPS.join(", ")}`);
    for (const k of PERSON_WORDS) if (b[k] !== undefined) set[k] = words(b[k], k);
    const person = existing
      ? db.update(people).set({ ...set, updated_at: new Date().toISOString(), updated_by: by }).where(eq(people.id, existing.id)).returning().get()
      : db.insert(people).values({ ...set, name: given, updated_by: by }).returning().get();
    emit("people", person.id, existing ? "update" : "insert", by);
    return { body: { person } };
  });

  // set_house_rules { rules?, add?: true, notes?, structured?: true }: the rules given replace the ones there; with add: true
  // they are added to them instead (a rule already there is not added twice), so each answer of the setup interview can save
  // just the rules it said. `structured: true` says the profile carried over from Meal Planner 2.0 (gate.ts) is now in the
  // app's own rows, and clears it. The grocery app has its own operation, set_shopping_apps. Answers the house and `said`,
  // every rule in plain words (rules.ts rulesSaid), which the setup reads back to the family.
  write("/api/family/rules", (b, by) => {
    if (b.grocery_app !== undefined) refuse("grocery_app is set with set_shopping_apps { main, fallback, connected }");
    if (b.add !== undefined && b.add !== true) refuse("add is true, or left out to replace the rules");
    if (b.add === true && b.rules === undefined) refuse("add: true goes with rules, the rules to add");
    const set: Partial<typeof house.$inferInsert> = {};
    if (b.rules !== undefined) {
      const given = rules(b.rules, {
        people: db.select({ name: people.name }).from(people).where(eq(people.active, 1)).all().map((p) => p.name),
        slots: [...SLOTS, ...houseView(getHouse(db)).extra_slots.map((s) => s.name)] });
      const kept = b.add === true ? houseView(getHouse(db)).rules : [];
      const seen = new Set(kept.map(ruleKey));
      set.rules = JSON.stringify([...kept, ...given.filter((r) => { const k = ruleKey(r); return seen.has(k) ? false : (seen.add(k), true); })]);
    }
    if (b.notes !== undefined) set.notes = notesOf(b.notes);
    if (b.structured === true) set.profile_to_structure = null;
    if (!Object.keys(set).length) refuse("give rules, notes or structured: true");
    const saved = saveHouse(set, by);
    return { body: { ...saved.body, said: rulesSaid(saved.body.house.rules) } };
  });

  // set_cooking_days { days }: the weekdays the family cooks at home; a plan has meals on these days only.
  write("/api/family/cooking-days", (b, by) => {
    const lower = WEEKDAYS.map((d) => d.toLowerCase()).join(", ");
    if (!Array.isArray(b.days)) refuse(`days must be a list of weekdays (${lower})`);
    const days = (b.days as unknown[]).map((d) => weekday(d) ?? refuse(`days: ${JSON.stringify(d)} is not a weekday (${lower})`));
    if (!days.length) refuse("days must have at least one weekday");
    // The cook's days are always cooking days: the cook comes to cook. An answer to "Sunday too?" that names only Sunday
    // adds it (sim run seed 16: "Ankita makes a quick breakfast and dinner on Sunday" saved Sunday alone, and only
    // Sunday was planned).
    const cookDays = houseView(getHouse(db)).cook_days;
    const saved = saveHouse({ cooking_days: JSON.stringify(WEEKDAYS.filter((d) => days.includes(d) || cookDays.includes(d))) }, by);
    return { body: { ...saved.body, slots_said: slotsSaid(saved.body.house) } };
  });

  // set_shopping_apps { main, fallback, connected }: the main app and the one tried when something is not on it are saved as
  // the app's settings; the house keeps the apps the family has signed in to, exactly as given. The main app or the fallback
  // may be one they have not signed in to yet: choosing an app is not signing in to it. Apps by name or id.
  write("/api/family/shopping-apps", async (b, by, c) => {
    const known = `${SHOP_APPS.join(", ")}`;
    const one = (v: unknown, what: string): GroceryApp => appOf(v) ?? refuse(`${what}: ${JSON.stringify(v)} is not a shopping app (${known})`);
    const main = one(b.main, "main");
    const fallback = b.fallback == null ? null : one(b.fallback, "fallback");
    if (fallback === main) refuse("fallback must be a different app from main");
    if (!Array.isArray(b.connected)) refuse(`connected must be a list of shopping apps (${known})`);
    const connected = new Set<GroceryApp>((b.connected as unknown[]).map((v) => one(v, "connected")));
    // Checked before anything is saved: a call with an app we do not know changes nothing.
    await patchSettings({ grocery_app: main, fallback_app: fallback ?? "none" }, c);
    saveHouse({ connected_apps: JSON.stringify(SHOP_APPS.filter((a) => connected.has(a))) }, by);
    return { body: { ...shoppingApps(db), house: houseView(getHouse(db)) } };
  });

  // set_cook { name, days?, arrival?, makes_well?, wont_make?, time_limit?, new_recipes?, note? }: the cook. A name is needed
  // every time; the cook's days and arrival time the first time. Only the fields given change; null clears a word field.
  // A cook who comes twice a day has a list of visits as arrival, each with the meals it makes when the family said.
  write("/api/family/cook", (b, by) => {
    const had = getHouse(db);
    const set: Partial<typeof house.$inferInsert> = { cook_name: name(b.name, "the cook's name") };
    if (b.days !== undefined || !had.cook_days) set.cook_days = JSON.stringify(weekdays(b.days, "days"));
    if (b.arrival !== undefined || !had.cook_arrival)
      set.cook_arrival = arrival(b.arrival, [...SLOTS, ...houseView(had).extra_slots.map((s) => s.name)]);
    for (const [field, column] of [["makes_well", "cook_makes_well"], ["wont_make", "cook_wont_make"], ["time_limit", "cook_time_limit"], ["note", "cook_note"]] as const)
      if (b[field] !== undefined) set[column] = words(b[field], field);
    if (b.new_recipes !== undefined) set.cook_new_recipes = b.new_recipes === null ? null : (COOK_NEW_RECIPES as readonly unknown[]).includes(b.new_recipes)
      ? (b.new_recipes as string) : refuse(`new_recipes must be one of: ${COOK_NEW_RECIPES.join(", ")} (open: tries new recipes from reels and the internet; set_menu: better with familiar dishes), or null`);
    return saveHouse(set, by);
  });

  // set_slots { extra_slots?, order_in?, add?: true }: each list given replaces the one there (the Family page's edits). With
  // add: true (the interview and the agent) the slots given are added to the ones there, a slot of the same name in place of
  // that one, and an order_in meal of the same day and slot in place of that one: what was said earlier is never wiped.
  // Answers the house and `said`, the meals a week is planned with in plain words (slotsSaid), which the setup reads back.
  write("/api/family/slots", (b, by) => {
    if (b.add !== undefined && b.add !== true) refuse("add is true, or left out to replace the lists");
    const had = houseView(getHouse(db));
    const set: Partial<typeof house.$inferInsert> = {};
    let extra = had.extra_slots;
    if (b.extra_slots !== undefined) {
      const given = extraSlots(b.extra_slots);
      extra = b.add === true ? [...had.extra_slots.filter((s) => !given.some((g) => g.name.toLowerCase() === s.name.toLowerCase())), ...given] : given;
      set.extra_slots = JSON.stringify(extra);
    }
    if (b.order_in !== undefined) {
      const given = orderIn(b.order_in, [...SLOTS, ...extra.map((s) => s.name)]);
      const kept = b.add === true ? had.order_in.filter((o) => !given.some((g) => g.day === o.day && g.slot.toLowerCase() === o.slot.toLowerCase())) : [];
      set.order_in = JSON.stringify([...kept, ...given]);
    }
    if (!Object.keys(set).length) refuse("give extra_slots or order_in");
    const saved = saveHouse(set, by);
    return { body: { ...saved.body, said: slotsSaid(saved.body.house) } };
  });
}
