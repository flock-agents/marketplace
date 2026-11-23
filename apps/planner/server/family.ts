// The family profile: who eats at home, the cook and the shopping apps (the slots, the rules and the dishes are their own
// tables: slotStore.ts). The agent writes it through these routes (its set_person, set_cook and set_shopping_apps operations)
// and the Family page reads it. Everything a person said is kept in their own words; only what the app itself reads later (a group,
// a weekday, the cook's arrival times) is checked.
import type { Context, Hono } from "hono";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { asc, eq } from "drizzle-orm";
import { _settings } from "@flock/app-kit";
import { house, people } from "./db/schema";
import { appOf, COOK_NEW_RECIPES, GROUPS, SETTINGS, SHOP_APPS, SLOTS, type GroceryApp } from "./db/constants";
import { WEEKDAYS, type Weekday } from "./dates";
import { listRules, listSlots } from "./slotStore";

export type Db = BunSQLiteDatabase<any>;
/** Tell live pages a row changed, and who changed it (the kit's emitChange). */
export type Emit = (table: string, id: string, op: "insert" | "update" | "delete", by: string) => void;

export type PersonRow = typeof people.$inferSelect;
export type HouseRow = typeof house.$inferSelect;
/** The old house shapes, for the code lanes B and C rewrite (legacy.ts). */
export type { ExtraSlot, HouseRule, MealExample, OrderIn } from "./legacy";
/** One visit of the cook: when they come, and the meals that visit makes when the family said. */
export type CookVisit = { at: string; meals?: string[] };
/** The house row with its lists read: what the routes answer with. Every day is planned; a meal not cooked at home is a slot's
 *  skip_days (slotStore.ts). */
export type HouseView = Omit<HouseRow, "cook_days" | "connected_apps" | "history_synced"> &
  { cook_days: Weekday[]; cook_visits: CookVisit[]; connected_apps: GroceryApp[]; history_synced: HistorySynced };
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
  const visits = cookVisits(row.cook_arrival);
  // cook_arrival stays one time for whoever reads it as before (the first visit); cook_visits is every visit.
  return { ...row, cook_arrival: visits[0]?.at ?? null, cook_visits: visits, cook_days: list(row.cook_days),
    connected_apps: list<GroceryApp>(row.connected_apps), history_synced: historySynced(row.history_synced) };
}

/** The names of the meals a cook's visit may make: the active slots, else the main ones before any slot is saved. */
export function slotNames(db: Db): string[] {
  const names = listSlots(db).map((s) => s.name);
  return names.length ? names : [...SLOTS];
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
const PERSON_WORDS = ["relationship", "portions", "diet", "allergies", "dislikes", "targets", "note"] as const;

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

export const LONG_DAY: Record<Weekday, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
/** Weekdays as a person says them: "every day", "Mon–Fri" (three or more in a row), "Mon, Wed and Fri". */
export function daysSaid(days: readonly string[] | undefined): string {
  const set = WEEKDAYS.filter((d) => days?.includes(d));
  if (!set.length || set.length === 7) return "every day";
  const at = set.map((d) => WEEKDAYS.indexOf(d));
  if (set.length >= 3 && at[at.length - 1] - at[0] === set.length - 1) return `${set[0]}–${set[set.length - 1]}`;
  return set.length === 1 ? `on ${LONG_DAY[set[0]]}s` : `${set.slice(0, -1).join(", ")} and ${set[set.length - 1]}`;
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
    // The slots a week is planned with (planning order) and the food rules: the slot model's own tables (slotStore.ts).
    slots: listSlots(db),
    rules: listRules(db),
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
    // visits: the interview's own name for the times (planner.cook.visits), the same shape as arrival (sim runs 9-11:
    // every 7:30 correction was sent as visits and lost).
    if (b.arrival === undefined && b.visits !== undefined) b = { ...b, arrival: b.visits };
    const had = getHouse(db);
    const set: Partial<typeof house.$inferInsert> = { cook_name: name(b.name, "the cook's name") };
    if (b.days !== undefined || !had.cook_days) set.cook_days = JSON.stringify(weekdays(b.days, "days"));
    if (b.arrival !== undefined || !had.cook_arrival)
      set.cook_arrival = arrival(b.arrival, slotNames(db));
    for (const [field, column] of [["makes_well", "cook_makes_well"], ["wont_make", "cook_wont_make"], ["time_limit", "cook_time_limit"], ["note", "cook_note"]] as const)
      if (b[field] !== undefined) set[column] = words(b[field], field);
    if (b.new_recipes !== undefined) set.cook_new_recipes = b.new_recipes === null ? null : (COOK_NEW_RECIPES as readonly unknown[]).includes(b.new_recipes)
      ? (b.new_recipes as string) : refuse(`new_recipes must be one of: ${COOK_NEW_RECIPES.join(", ")} (open: tries new recipes from reels and the internet; set_menu: better with familiar dishes), or null`);
    return saveHouse(set, by);
  });
}
