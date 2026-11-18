// The family profile: who eats at home, the house rules, the cook, the extra slots and the meals ordered in. The agent writes
// it during the interview through these routes (its set_person, set_house_rules, set_cook and set_slots operations) and the
// Family page reads it. Everything a person said is kept in their own words; only what the app itself reads later (a group,
// a weekday, the cook's arrival time) is checked.
import type { Context, Hono } from "hono";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { asc, eq } from "drizzle-orm";
import { _settings } from "@flock/app-kit";
import { house, people } from "./db/schema";
import { GROCERY_APPS, GROUPS, RULE_KINDS, SETTINGS, SLOTS, type GroceryApp } from "./db/constants";
import { WEEKDAYS, type Weekday } from "./dates";

export type Db = BunSQLiteDatabase<any>;
/** Tell live pages a row changed, and who changed it (the kit's emitChange). */
export type Emit = (table: string, id: string, op: "insert" | "update" | "delete", by: string) => void;

export type PersonRow = typeof people.$inferSelect;
export type HouseRow = typeof house.$inferSelect;
export type HouseRule = { kind: (typeof RULE_KINDS)[number]; days: string[]; note?: string };
export type ExtraSlot = { name: string; days?: Weekday[]; for?: string[] };
export type OrderIn = { day: Weekday; slot: string; note?: string };
/** The house row with its lists read: what the routes answer with. */
export type HouseView = Omit<HouseRow, "rules" | "cook_days" | "extra_slots" | "order_in"> &
  { rules: HouseRule[]; cook_days: Weekday[]; extra_slots: ExtraSlot[]; order_in: OrderIn[] };

/** The household's one row, made the first time anything asks for it. */
export function getHouse(db: Db): HouseRow {
  const row = db.select().from(house).orderBy(asc(house.created_at)).limit(1).get();
  return row ?? db.insert(house).values({ updated_by: "app" }).returning().get();
}

export const list = <T>(json: string | null): T[] => { try { const v = json ? JSON.parse(json) : []; return Array.isArray(v) ? v : []; } catch { return []; } };

export function houseView(row: HouseRow): HouseView {
  return { ...row, rules: list(row.rules), cook_days: list(row.cook_days), extra_slots: list(row.extra_slots), order_in: list(row.order_in) };
}

/** The grocery app orders go to: the owner's setting, else its default. */
export function groceryApp(db: Db): GroceryApp {
  const fallback = SETTINGS[0].default as GroceryApp;
  try {
    const row = db.select({ value: _settings.value }).from(_settings).where(eq(_settings.key, "grocery_app")).get();
    const v = row?.value ? JSON.parse(row.value) : null;
    return (GROCERY_APPS as readonly unknown[]).includes(v) ? (v as GroceryApp) : fallback;
  } catch { return fallback; }
}

/** A write the app will not make: the route answers 400 with the reason, and with a code when the agent acts on the kind of
 *  refusal (NEEDS_NAME: ask the family for a name). */
export class Refused extends Error {
  constructor(reason: string, readonly code?: string) { super(reason); }
}
export const refuse = (reason: string, code?: string): never => { throw new Refused(reason, code); };

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

function rules(v: unknown): HouseRule[] {
  if (!Array.isArray(v)) return refuse("rules must be a list of { kind, days, note? }");
  return v.map((r) => {
    if (!isObject(r) || !(RULE_KINDS as readonly unknown[]).includes(r.kind)) return refuse(`a rule's kind must be one of: ${RULE_KINDS.join(", ")}`);
    if (!Array.isArray(r.days) || !r.days.length || !r.days.every((d) => typeof d === "string" && d.trim()))
      return refuse(`the ${r.kind} rule needs its days: weekdays, or the family's own words for a day ("Ekadashi")`);
    return { kind: r.kind as HouseRule["kind"], days: r.days.map((d: string) => weekday(d) ?? d.trim()), ...optionalNote(r.note, "a rule's note") };
  });
}

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

/** Who is writing: the agent Flock relayed, the person on the page, or the app itself. */
const writer = (c: Context): string => {
  const agent = c.req.header("x-flock-agent")?.trim(); if (agent) return `agent:${agent}`;
  const user = c.req.header("x-flock-user")?.trim(); return user ? `user:${user}` : "app";
};
type Answer = { status?: 404; body: Record<string, unknown> };
/** The app's write routes: a JSON body in, the answer out, a refusal as a 400 with the reason. */
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
        if (e instanceof Refused) return c.json({ ok: false, reason: e.message, ...(e.code ? { code: e.code } : {}) }, 400);
        throw e;
      }
    });

export function mountFamilyRoutes(hono: Hono<any>, db: Db, emit: Emit) {
  const write = writeRoutes(hono);
  const saveHouse = (set: Partial<typeof house.$inferInsert>, by: string) => {
    const row = db.update(house).set({ ...set, updated_at: new Date().toISOString(), updated_by: by }).where(eq(house.id, getHouse(db).id)).returning().get();
    emit("house", row.id, "update", by);
    return { body: { house: houseView(row) } };
  };

  hono.get("/api/family", (c) => c.json({
    people: db.select().from(people).where(eq(people.active, 1)).orderBy(asc(people.created_at)).all(),
    house: houseView(getHouse(db)),
    grocery_app: groceryApp(db),
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

  // set_house_rules { rules?, notes?, structured?: true }: the rules given replace the ones there. `structured: true` says the
  // profile carried over from Meal Planner 2.0 (gate.ts) is now in the app's own rows, and clears it.
  write("/api/family/rules", (b, by) => {
    const set: Partial<typeof house.$inferInsert> = {};
    if (b.rules !== undefined) set.rules = JSON.stringify(rules(b.rules));
    if (b.notes !== undefined) set.notes = words(b.notes, "notes");
    if (b.structured === true) set.profile_to_structure = null;
    if (!Object.keys(set).length) refuse("give rules, notes or structured: true");
    return saveHouse(set, by);
  });

  // set_cook { name, days, arrival, makes_well?, note? }
  write("/api/family/cook", (b, by) => {
    const set: Partial<typeof house.$inferInsert> = {
      cook_name: name(b.name, "the cook's name"),
      cook_days: JSON.stringify(weekdays(b.days, "days")),
      cook_arrival: typeof b.arrival === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(b.arrival) ? b.arrival : refuse('arrival must be a time as "HH:MM", like "07:30"'),
    };
    if (b.makes_well !== undefined) set.cook_makes_well = words(b.makes_well, "makes_well");
    if (b.note !== undefined) set.cook_note = words(b.note, "note");
    return saveHouse(set, by);
  });

  // set_slots { extra_slots?, order_in? }: each list given replaces the one there.
  write("/api/family/slots", (b, by) => {
    const set: Partial<typeof house.$inferInsert> = {};
    const extra = b.extra_slots !== undefined ? extraSlots(b.extra_slots) : houseView(getHouse(db)).extra_slots;
    if (b.extra_slots !== undefined) set.extra_slots = JSON.stringify(extra);
    if (b.order_in !== undefined) set.order_in = JSON.stringify(orderIn(b.order_in, [...SLOTS, ...extra.map((s) => s.name)]));
    if (!Object.keys(set).length) refuse("give extra_slots or order_in");
    return saveHouse(set, by);
  });
}
