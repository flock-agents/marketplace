// The ONLY file of the evals that touches the planner. It boots the app in-process (server/testkit.ts), calls its ops and
// reads its tables into result.ts shapes; the scorers read nothing else. Written against spec §2.1 table and column names
// and the ops of §4 / §5 / §6 (apply_setup, make_plan, set_slot_day, add_dish) before those exist: when lanes A–D land,
// this is the one file to adjust if a name differs.
//
// What it needs from the app:
//   tables  slots, library, rules, slot_days (+ seed rows: date null, status confirmed), slot_dishes, house (cook_*),
//           settings.new_dishes_per_week — column names as spec §2.1
//   ops     apply_setup { household, transcript } → { ok, said, noted?, unplaced?, lunch_unclear?, family_cooks?, attendance? }
//           make_plan { week_start, household } → { ok, message, unmet?, asked?, relaxed? }
//           set_slot_day { date, slot, guests, occasion }   (Eval 2 guests)
//           add_dish { name, slot }                          (Eval 1 contains accuracy: the contains read of one dish)
import type { ModelCall } from "../../server/model";
import type { PlanOut, SavedDish, SavedRule, SavedSlot, SetupOut } from "./result";
import { WEEK, dateOf, type Household, type WeekEvent } from "./truth";

type Kit = Awaited<ReturnType<typeof import("../../server/testkit").boot>>;

const json = <T>(v: unknown, d: T): T => { if (v == null || v === "") return d; if (typeof v !== "string") return v as T; try { return JSON.parse(v) as T; } catch { return d; } };
const bool = (v: unknown) => v === 1 || v === true || v === "1";
const has = (k: Kit, table: string) => { try { k.rows(table); return true; } catch { return false; } };

/** A fresh planner on its own data directory. */
export async function bootPlanner(o: { dataDir: string; model: ModelCall }): Promise<Kit> {
  const { boot } = await import("../../server/testkit");
  return boot({ dataDir: o.dataDir, model: o.model });
}

/** The household facts Flock sends, with the speaker and (Eval 2) the week's dated facts. */
export function householdFacts(h: Household, events: WeekEvent[] = []): Record<string, unknown> {
  const dated = events.filter((e) => e.kind !== "guests").map((e) => (e as { dated: Record<string, unknown> }).dated);
  return { ...h.household, "household.speaker": h.owner, ...(dated.length ? { "household.dated": dated } : {}) };
}

// ── Eval 1 ──

export async function runSetup(k: Kit, h: Household, transcript: string[]): Promise<{ res: any; setup: SetupOut }> {
  const res = await k.op("apply_setup", { household: householdFacts(h), transcript });
  return { res, setup: readSetup(k, res) };
}

/** What the planner saved, in spec shapes. `res`: apply_setup's answer, for what is not a table (lunch_unclear, noted). */
export function readSetup(k: Kit, res: any = {}): SetupOut {
  const slots: SavedSlot[] = has(k, "slots") ? k.rows("slots").filter((r) => r.active === undefined || r.active === null || bool(r.active)).map((r) => ({
    name: r.name, kind: r.kind, addon_of: r.addon_of ?? null, usual_people: json(r.usual_people, []), days: json(r.days, []), skip_days: json(r.skip_days, []), order: r.order,
  })) : [];
  const library: SavedDish[] = has(k, "library") ? k.rows("library").filter((r) => !bool(r.suggested)).map((r) => ({
    slot: r.slot, name: r.name, frequency: r.frequency ?? null, days: json(r.days, null), contains: json(r.contains, []), contains_read: json(r.contains_read, []),
    origin: r.origin, quote: r.quote ?? null,
  })) : [];
  const rules: SavedRule[] = has(k, "rules") ? k.rows("rules").map((r) => ({
    hard: bool(r.hard), what: r.what, who: r.who ?? null, slots: json(r.slots, null), days: json(r.days, null), items: json(r.items, null), to: r.to ?? null,
    frequency: r.frequency ?? null, per_meal: r.per_meal ?? null, fasting_food: json(r.fasting_food, null), quote: r.quote ?? "",
  })) : [];
  const days = has(k, "slot_days") ? k.rows("slot_days") : [];
  const dishes = has(k, "slot_dishes") ? k.rows("slot_dishes") : [];
  const seed = days.filter((d) => !d.date).map((d) => ({ slot: d.slot, dishes: dishesOf(dishes, d.id) }));
  const house = has(k, "house") ? k.rows("house")[0] ?? {} : {};
  const visits = json<any>(house.cook_arrival, null);
  const state = json<any>(house.setup_state, {}) ?? {};
  return {
    ok: res?.ok !== false,
    slots, library, rules, seed,
    cook: house.cook_name ? { name: house.cook_name, days: json(house.cook_days, []), visits: Array.isArray(visits) ? visits : visits ? [{ at: String(visits) }] : typeof house.cook_arrival === "string" ? [{ at: house.cook_arrival }] : [] } : null,
    family_cooks: json(res?.family_cooks ?? res?.read?.family_cooks ?? state.family_cooks ?? house.family_cooks, []),
    unplaced: [...json<any[]>(res?.unplaced ?? res?.read?.unplaced, []), ...json<any[]>(res?.noted, []).map((n) => (typeof n === "string" ? { text: n } : n))],
    lunch_unclear: json(res?.lunch_unclear ?? res?.read?.lunch_unclear ?? state.lunch_unclear, []),
    ...(res?.attendance ? { attendance: res.attendance } : {}),
    said: res?.said ?? res?.say,
    settings: { new_dishes_per_week: settingOf(k, "new_dishes_per_week") ?? 2 },
  };
}

const dishesOf = (rows: any[], id: string) => rows.filter((x) => x.slot_day_id === id).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((x) => x.dish as string);
function settingOf(k: Kit, key: string): number | undefined {
  for (const t of ["settings", "kit_settings"]) if (has(k, t)) { const r = k.rows(t).find((x) => x.key === key); if (r) return Number(json(r.value, r.value)); }
  return undefined;
}

/** Eval 1's contains accuracy: each labelled dish added to the library (add_dish reads its contains), then read back.
 *  null when the app has no add_dish op yet. */
export async function readContains(k: Kit, dishes: string[]): Promise<Record<string, Record<string, boolean>> | null> {
  const out: Record<string, Record<string, boolean>> = {};
  for (const name of dishes) {
    let r: any;
    try { r = await k.op("add_dish", { name, slot: "Lunch" }); } catch { return null; }
    if (r?.ok === false && /unknown|no such op/i.test(String(r?.reason ?? ""))) return null;
  }
  for (const row of has(k, "library") ? k.rows("library") : []) {
    if (!dishes.some((d) => d.toLowerCase() === String(row.name).toLowerCase())) continue;
    const yes = new Set(json<string[]>(row.contains, []).map((t) => t.replace(/^@/, "")));
    out[row.name] = Object.fromEntries(json<string[]>(row.contains_read, []).map((t) => t.replace(/^@/, "")).map((t) => [t, yes.has(t)]));
  }
  return out;
}

// ── Eval 2 ──

/** The household's people as rows (in a live run apply_setup writes them from household.people; Eval 2 skips setup). */
export function loadPeople(k: Kit, h: Household): string[] {
  const refused: string[] = [];
  const people = (h.household as any)["household.people"];
  if (!Array.isArray(people)) return ["people: household.people is not a list"];
  const now = new Date().toISOString();
  for (const p of people) {
    try { k.kit.sqlite.query(`INSERT INTO "people" (id, created_at, updated_at, updated_by, name, "group", relationship, active) VALUES (?, ?, ?, 'eval', ?, ?, ?, 1)`)
      .run(crypto.randomUUID(), now, now, p.name, p.group ?? null, p.relationship ?? null); }
    catch (e) { refused.push(`people: ${String(e).slice(0, 160)}`); }
  }
  return refused;
}

/** Load a setup into a fresh planner as rows (no model, no route): slots, library, rules, seed history, cook, setting.
 *  Returns what could not be written (a missing table or column), so a run says what it planned from. */
export function loadSetup(k: Kit, s: SetupOut): string[] {
  const refused: string[] = [];
  const db = k.kit.sqlite;
  const now = new Date().toISOString();
  const insert = (table: string, row: Record<string, unknown>) => {
    const r: Record<string, unknown> = { id: crypto.randomUUID(), created_at: now, updated_at: now, updated_by: "eval", ...row };
    const cols = Object.keys(r), vals = cols.map((c) => { const v = r[c]; return v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : Array.isArray(v) || (v && typeof v === "object") ? JSON.stringify(v) : v; });
    try { db.query(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...(vals as any[])); return r.id as string; }
    catch (e) { refused.push(`${table}: ${String(e).slice(0, 160)}`); return null; }
  };
  const order = (sl: SetupOut["slots"][number]) => sl.kind === "addon" ? 60 : sl.name === "Breakfast" ? 10 : sl.name === "Lunch" ? 30 : sl.name === "Dinner" ? 50 : /breakfast/i.test(sl.addon_of ?? "") ? 20 : 20;
  for (const sl of s.slots) insert("slots", { name: sl.name, kind: sl.kind, addon_of: sl.addon_of, usual_people: sl.usual_people, days: sl.days, skip_days: sl.skip_days, order: sl.order ?? order(sl), active: 1 });
  for (const d of s.library) insert("library", { key: d.name.toLowerCase(), slot: d.slot, name: d.name, frequency: d.frequency, days: d.days, contains: d.contains, contains_read: d.contains_read,
    origin: d.origin ?? "setup_named", suggested: 0, untried: 0, offers: 0, disliked: 0 });
  for (const r of s.rules) insert("rules", { hard: r.hard ? 1 : 0, what: r.what, who: r.who, slots: r.slots, days: r.days, items: r.items, to: r.to, frequency: r.frequency, per_meal: r.per_meal, fasting_food: r.fasting_food, quote: r.quote });
  for (const row of s.seed) {
    const id = insert("slot_days", { date: null, slot: row.slot, people: [], guests: [], status: "confirmed", edited: 0 });
    if (id) row.dishes.forEach((dish, position) => insert("slot_dishes", { slot_day_id: id, position, dish, new: 0, feedback_asked: 0 }));
  }
  if (s.cook) {
    try { db.query(`UPDATE "house" SET cook_name = ?, cook_days = ?, cook_arrival = ?`).run(s.cook.name, JSON.stringify(s.cook.days), JSON.stringify(s.cook.visits)); }
    catch (e) { refused.push(`house cook: ${String(e).slice(0, 120)}`); }
  }
  return refused;
}

/** make_plan for one week (the household facts with the week's dated facts), then the week's guests as one-off changes
 *  (set_slot_day re-plans only that slot-day), then the week read back. */
export async function runPlan(k: Kit, h: Household, weekStart: string, events: WeekEvent[] = []): Promise<{ res: any; plan: PlanOut; refused: string[] }> {
  const refused: string[] = [];
  const res = await k.op("make_plan", { week_start: weekStart, household: householdFacts(h, events) });
  for (const e of events) if (e.kind === "guests") {
    try {
      const r = await k.op("set_slot_day", { date: dateOf(weekStart, e.day), slot: e.slot, guests: [{ count: e.count, ...(e.rules ? { rules: e.rules } : {}) }], ...(e.occasion ? { occasion: e.occasion } : {}) });
      if (r?.ok === false) refused.push(`set_slot_day ${e.day} ${e.slot}: ${r.reason ?? r.say ?? "refused"}`);
    } catch (err) { refused.push(`set_slot_day ${e.day} ${e.slot}: ${String(err).slice(0, 120)}`); }
  }
  return { res, plan: readPlan(k, weekStart, res), refused };
}

export function readPlan(k: Kit, weekStart: string, res: any = {}): PlanOut {
  const end = dateOf(weekStart, WEEK[6]);
  const days = (has(k, "slot_days") ? k.rows("slot_days") : []).filter((d) => d.date && d.date >= weekStart && d.date <= end);
  const dishes = has(k, "slot_dishes") ? k.rows("slot_dishes") : [];
  const library = readSetup(k).library.concat(has(k, "library") ? k.rows("library").filter((r) => bool(r.suggested)).map((r) => ({
    slot: r.slot, name: r.name, frequency: r.frequency ?? null, days: json(r.days, null), contains: json(r.contains, []), contains_read: json(r.contains_read, []), origin: r.origin, suggested: true, untried: bool(r.untried),
  })) : []);
  return {
    ok: res?.ok === true, week_start: weekStart,
    slotDays: days.map((d) => ({
      date: d.date, slot: d.slot, people: json(d.people, []), guests: json(d.guests, []), skip: d.skip ?? null, occasion: d.occasion ?? null, note: d.note ?? null,
      dishes: dishes.filter((x) => x.slot_day_id === d.id).sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((x) => ({ name: x.dish, new: bool(x.new), note: x.note ?? null })),
    })),
    library, unmet: json(res?.unmet, []), message: res?.message ?? res?.say, asked: json(res?.asked, []), ...(res?.relaxed ? { relaxed: res.relaxed } : {}),
  };
}
