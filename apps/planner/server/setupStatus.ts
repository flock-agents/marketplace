// The setup's checklist for Flock (agentInterface.setup, the `status` operation): what the app knows of the household, what
// it still needs and when, the first task and a hint for this turn. Deterministic and fast: rows read, no model.
//
//   Groups, in order (the setup-focus contract):
//     1. people   (blocks_first_task, no default): who eats at home, each person's diet, any allergy;
//     2. meals, cook, menu, shopping, plate (blocks_first_task, each with a default): the meals to plan, who cooks, who
//        decides what is cooked, who buys the groceries (separate facts: any may be someone who does not eat at home, the
//        cook, or shared), the usual food;
//     improves    fasting and day rules, visitors, goals, tastes, the cook's dishes (asked after the first plan);
//     later       grocery apps, past orders (only when they come up).
//   Stage: asking until ready; first_task until today is planned; feedback until the 7 days from the first plan's start are
//   planned and one round of feedback was saved; then done.
//
// Two small writes the setup needs beside the other operations: set_answered (a question answered with nothing to save:
// "no fasting days") and set_cuisine (the family's usual cuisine, in their words).
import type { Hono } from "hono";
import { and, asc, eq, gt, isNotNull, ne } from "drizzle-orm";
import { house as house_t, library as library_t, people as people_t, plan_feedback, rules as rules_t, slot_days } from "./db/schema";
import { FIRST_PLAN_DAYS, SETUP_PLAN_DAYS, SETUP_SETTLED_DAYS } from "./db/constants";
import { addDays, clockText, daysBetween, todayStr } from "./dates";
import { isAllergyRule } from "./allergy";
import { cookVisits, daysSaid, getHouse, houseView, list, refuse, writeRoutes, type Db, type Emit } from "./family";
import { CUISINE_NAMES, cuisinesOf, plainWords } from "./setup";
import { listLibrary, listRules, listSlots, type Rule } from "./slotStore";
import { targetsOf, targetsText, type Targets } from "./targets";

// ── The answer ──

export type Critical = "blocks_first_task" | "improves" | "later";
export type Missing = { id: string; what: string; critical: Critical; ask?: string; default?: string };
export type Stage = "asking" | "first_task" | "feedback" | "done";
export type SetupStatus = { ready: boolean; stage: Stage; known: string[]; missing: Missing[]; first_task: string; next?: string };

/** The ids a status item has, for set_answered (and the parts of the meals group the family may answer with nothing to save). */
export const STATUS_IDS = ["people", "allergies", "meals", "cook", "menu", "shopping", "plate", "fasting", "visitors", "goals", "tastes", "cook_dishes", "grocery", "orders", "feedback"] as const;
export type StatusId = (typeof STATUS_IDS)[number];

export const FIRST_TASK = `Make a ${FIRST_PLAN_DAYS}-day meal plan from today`;

// ── What it is read from ──

export type StatusPerson = { name: string; group: string | null; relationship: string | null; diet: string | null; allergies: string | null; dislikes: string | null; targets: Targets | null; home: boolean };
export type StatusCook = { name: string; days: string[]; arrival: string | null; makes_well: string | null; wont_make: string | null; new_recipes: string | null };
/** Who decides what is cooked, who cooks and who shops, in the family's words (set_roles); null: not said. */
export type Roles = { menu: string | null; cooking: string | null; shopping: string | null };
/** The household as the status reads it. `planned`: the dated slot-days' dates, sorted, once each; `feedback`: whether a
 *  round of feedback was saved since the first plan. */
export type Snapshot = { people: StatusPerson[]; rules: Rule[]; slots: string[]; dishes: Record<string, string[]>; cook: StatusCook | null; roles: Roles; cuisines: string[];
  answered: string[]; connected: string[]; historyRead: boolean; planned: string[]; feedback: boolean };

const andList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const DIET_WHATS = ["veg", "egg", "no_eggs"];

/** Does the family's word say a person's diet: their own diet words, or a hard diet rule for them or for everyone. */
const dietOf = (p: StatusPerson, rules: Rule[]): string | null => p.diet
  ?? rules.find((r) => r.hard && DIET_WHATS.includes(r.what) && !r.days?.length && !r.when_present?.length && (!r.who || same(r.who, p.name)))?.quote ?? null;

function personLine(p: StatusPerson, rules: Rule[]): string {
  const parts = [dietOf(p, rules), p.allergies && !/^(none|no|nil|nothing)\b/i.test(p.allergies) ? `allergy: ${p.allergies}` : null,
    targetsText(p.targets) || null, p.home ? null : "visits, not usually home"];
  return `${p.name}${p.relationship ? ` (${p.relationship})` : ""}: ${parts.filter(Boolean).join(", ") || "nothing said yet"}`;
}

// ── Group 1: who eats ──

const PEOPLE_ASK = "Who eats at home, and what does each person eat: veg, eggs, non-veg or Jain? Any allergy?";

function peopleGroup(s: Snapshot, known: string[], missing: Missing[]): void {
  if (!s.people.length) { missing.push({ id: "people", what: "Who eats at home, and what each person eats", critical: "blocks_first_task", ask: PEOPLE_ASK }); return; }
  for (const p of s.people) known.push(personLine(p, s.rules));
  const noDiet = s.people.filter((p) => !dietOf(p, s.rules)).map((p) => p.name);
  const allergies = s.people.some((p) => p.allergies) || s.rules.some(isAllergyRule) || s.answered.includes("allergies");
  if (!noDiet.length && allergies) return;
  const what = [noDiet.length ? `what ${andList(noDiet)} ${noDiet.length === 1 ? "eats" : "eat"}` : null, allergies ? null : "any allergy"].filter(Boolean).join(", and ");
  const ask = [noDiet.length ? `What does ${noDiet.length === 1 ? noDiet[0] : "each of " + andList(noDiet)} eat: veg, eggs, non-veg or Jain?` : null,
    allergies ? null : "Any allergy at home?"].filter(Boolean).join(" ");
  missing.push({ id: "people", what: what[0].toUpperCase() + what.slice(1), critical: "blocks_first_task", ask });
}

// ── Group 2: the meals, who cooks, who decides, who shops, the usual food (never blocks: each has a default) ──

/** One fact of group 2: known lines when said, else its question and its default. `answered`: set_answered may close it. */
type MealPart = { id: StatusId; what: string; default: string; ask: (s: Snapshot) => string; known: (s: Snapshot) => string[] };
const COOK_WAY: Record<string, string> = { set_menu: "sticks to familiar dishes", open: "tries new recipes" };
const cookLines = (s: Snapshot): string[] => {
  if (s.cook) return [`Cook: ${[s.cook.name, s.cook.days.length ? daysSaid(s.cook.days) : null, s.cook.arrival ? clockText(s.cook.arrival) : null,
    s.cook.new_recipes ? COOK_WAY[s.cook.new_recipes] : null].filter(Boolean).join(", ")}`, ...(s.roles.cooking ? [`Cooking: ${s.roles.cooking}`] : [])];
  if (s.roles.cooking) return [`Cooking: ${s.roles.cooking}`];
  return s.answered.includes("cook") ? ["Cooking: no cook, the family cooks"] : [];
};
const MEAL_PARTS: MealPart[] = [
  { id: "meals", what: "The meals to plan", default: "lunch and dinner",
    ask: (s) => `Which meals should I plan: breakfast, lunch, dinner${s.people.some((p) => p.group === "child") ? ", a school tiffin" : ""}?`,
    known: (s) => (s.slots.length ? [`Meals planned: ${andList(s.slots)}`] : []) },
  { id: "cook", what: "Who cooks", default: "not said: the plan is for whoever cooks", ask: () => "Who cooks: someone at home, a cook, or turns?", known: cookLines },
  { id: "menu", what: "Who decides what is cooked", default: "not said: the plan comes to this chat", ask: () => "Who decides what gets cooked?",
    known: (s) => (s.roles.menu ? [`Menu decided by: ${s.roles.menu}`] : []) },
  { id: "shopping", what: "Who buys the groceries", default: "not said: the shopping comes to this chat", ask: () => "Who buys the groceries?",
    known: (s) => (s.roles.shopping ? [`Groceries bought by: ${s.roles.shopping}`] : []) },
  { id: "plate", what: "The usual food", default: "a simple home plate (roti or rice, dal, sabzi), the cuisine guessed from the city or language",
    ask: () => "What does a usual plate look like, and which cuisine?",
    known: (s) => [...s.slots.filter((n) => s.dishes[n.toLowerCase()]?.length).map((n) => `${n}: ${s.dishes[n.toLowerCase()].slice(0, 6).join(", ")}`),
      ...(s.cuisines.length ? [`Kitchen: ${andList(s.cuisines.map((c) => CUISINE_NAMES[c] ?? c))}`] : [])] },
];

function mealsGroup(s: Snapshot, known: string[], missing: Missing[]): void {
  for (const part of MEAL_PARTS) {
    const lines = part.known(s);
    known.push(...lines);
    if (lines.length || s.answered.includes(part.id)) continue;
    missing.push({ id: part.id, what: part.what, critical: "blocks_first_task", default: part.default, ask: part.ask(s) });
  }
}

// ── Asked after the first plan, and only when it comes up ──

type Later = { id: StatusId; what: string; critical: Critical; ask?: string; known: (s: Snapshot) => string | null; when?: (s: Snapshot) => boolean };
const quotes = (rs: Rule[]) => rs.map((r) => r.quote).join("; ");
const AFTER: Later[] = [
  { id: "fasting", what: "Fasting days and day rules", critical: "improves", ask: "Any fasting days, or days without eggs or non-veg?",
    known: (s) => { const rs = s.rules.filter((r) => r.what === "fasting" || (r.hard && !!r.days?.length)); return rs.length ? `Day rules: ${quotes(rs)}` : null; } },
  { id: "visitors", what: "Visitors and their food", critical: "improves", ask: "Does anyone visit often, like grandparents, and does the food change when they come?",
    known: (s) => { const rs = s.rules.filter((r) => r.when_present?.length); const away = s.people.filter((p) => !p.home).map((p) => p.name);
      return rs.length ? `When visitors come: ${quotes(rs)}` : away.length ? `Visit: ${andList(away)}` : null; } },
  { id: "goals", what: "Food goals per person", critical: "improves", ask: "Anyone with a food goal, like more protein or less rice?",
    known: (s) => { const g = s.people.filter((p) => p.targets).map((p) => p.name); return g.length ? `Goals saved for ${andList(g)}` : null; } },
  { id: "tastes", what: "Favourites and dislikes", critical: "improves", ask: "Any favourite dishes, or ones someone doesn't like?",
    known: (s) => { const d = s.people.filter((p) => p.dislikes); return d.length ? `Dislikes: ${d.map((p) => `${p.name}: ${p.dislikes}`).join("; ")}` : null; } },
  { id: "cook_dishes", what: "What the cook makes", critical: "improves", ask: "What does the cook make well, and anything to skip?", when: (s) => !!s.cook,
    known: (s) => (s.cook?.makes_well || s.cook?.wont_make ? `${s.cook.name} makes well: ${s.cook.makes_well ?? "not said"}${s.cook.wont_make ? `; skips: ${s.cook.wont_make}` : ""}` : null) },
  { id: "grocery", what: "Grocery apps", critical: "later", known: (s) => (s.connected.length ? `Grocery apps: ${andList(s.connected)}` : null) },
  { id: "orders", what: "Past orders", critical: "later", known: (s) => (s.historyRead ? "Past orders: read" : null) },
];

function afterGroups(s: Snapshot, known: string[], missing: Missing[]): void {
  for (const x of AFTER) {
    if (x.when && !x.when(s)) continue;
    const line = x.known(s);
    if (line) { known.push(line); continue; }
    if (s.answered.includes(x.id)) continue;
    missing.push({ id: x.id, what: x.what, critical: x.critical, ...(x.ask ? { ask: x.ask } : {}) });
  }
}

// ── The stage ──

/** The dates from `start` for `n` days not planned yet. */
const unplanned = (s: Snapshot, start: string, n: number): string[] => Array.from({ length: n }, (_, i) => addDays(start, i)).filter((d) => !s.planned.includes(d));

function stageOf(s: Snapshot, ready: boolean, today: string): Stage {
  if (!ready) return "asking";
  const start = s.planned[0];
  if (start && daysBetween(start, today) >= SETUP_SETTLED_DAYS) return "done";
  if (start && s.feedback && !unplanned(s, start, SETUP_PLAN_DAYS).length) return "done";
  if (!s.planned.includes(today)) return "first_task";
  return "feedback";
}

function nextOf(s: Snapshot, stage: Stage, missing: Missing[], today: string): string | undefined {
  if (stage === "asking") return s.people.length ? `Ask only what is missing about the people: ${missing.find((m) => m.id === "people")!.what.toLowerCase()}`
    : "Ask the two groups as two short numbered messages (who eats and what each person eats; the meals, who cooks, who decides, who shops and the usual food), then invite a voice note";
  if (stage === "first_task") {
    const defaults = missing.filter((m) => m.critical === "blocks_first_task" && m.default).map((m) => `${m.what.toLowerCase()}: ${m.default}`);
    return `Do the first task now, in this turn: make_plan { from: "${today}", days: ${FIRST_PLAN_DAYS} }${defaults.length ? `, with the defaults for what was not said (${defaults.join("; ")})` : ""}`;
  }
  if (stage === "feedback") {
    if (!s.feedback) return "Ask one feedback question about the plan; save what they say, and plan again the days it changes";
    const gap = unplanned(s, s.planned[0], SETUP_PLAN_DAYS);
    return gap.length ? `Plan the rest of the week: make_plan { from: "${gap[0]}", days: ${daysBetween(gap[0], addDays(s.planned[0], SETUP_PLAN_DAYS - 1)) + 1} }, then ask for feedback once more` : undefined;
  }
  return undefined;
}

/** The status from a snapshot of the household: pure, for tests. */
export function setupStatus(s: Snapshot, today: string, person?: string): SetupStatus {
  const known: string[] = [], missing: Missing[] = [];
  peopleGroup(s, known, missing);
  // The person setting up may not eat at home at all (a manager from afar): never counted among those who do.
  if (person?.trim() && s.people.length && !s.people.some((p) => same(p.name, person))) known.push(`${person.trim()} does not eat at home`);
  mealsGroup(s, known, missing);
  afterGroups(s, known, missing);
  const ready = !missing.some((m) => m.critical === "blocks_first_task" && !m.default);
  const stage = stageOf(s, ready, today);
  const next = nextOf(s, stage, missing, today);
  return { ready, stage, known, missing, first_task: FIRST_TASK, ...(next ? { next } : {}) };
}

// ── Reading the household ──

/** Was something said about the plan since the first one was made: feedback kept, a rule, a person, a dish of theirs or a
 *  meal changed by the family or their agent (never the app's own re-plan), or the family's "all good" (set_answered). */
function feedbackSince(db: Db, firstAt: string | null, answered: string[]): boolean {
  if (answered.includes("feedback")) return true;
  if (!firstAt) return false;
  const byFamily = (t: typeof rules_t | typeof people_t | typeof library_t | typeof slot_days | typeof plan_feedback) => and(gt(t.updated_at, firstAt), ne(t.updated_by, "app"));
  return !!(db.select({ id: plan_feedback.id }).from(plan_feedback).limit(1).get()
    || db.select({ id: rules_t.id }).from(rules_t).where(byFamily(rules_t)).limit(1).get()
    || db.select({ id: people_t.id }).from(people_t).where(byFamily(people_t)).limit(1).get()
    || db.select({ id: library_t.id }).from(library_t).where(byFamily(library_t)).limit(1).get()
    || db.select({ id: slot_days.id }).from(slot_days).where(and(byFamily(slot_days), eq(slot_days.edited, 1))).limit(1).get());
}

export function readSnapshot(db: Db): Snapshot {
  const house = getHouse(db), view = houseView(house);
  const people = db.select().from(people_t).where(eq(people_t.active, 1)).orderBy(asc(people_t.created_at)).all()
    .map((p) => ({ name: p.name, group: p.group, relationship: p.relationship, diet: p.diet, allergies: p.allergies, dislikes: p.dislikes, targets: targetsOf(p.targets), home: p.usually_home !== 0 }));
  const dishes: Record<string, string[]> = {};
  for (const d of listLibrary(db).filter((x) => x.origin !== "planner_suggested" && !x.suggested && !x.disliked)) (dishes[d.slot.toLowerCase()] ??= []).push(d.name);
  const dated = db.select({ date: slot_days.date, created_at: slot_days.created_at }).from(slot_days).where(isNotNull(slot_days.date)).all();
  const planned = [...new Set(dated.map((r) => r.date!))].sort();
  const firstAt = dated.map((r) => r.created_at).filter((x): x is string => !!x).sort()[0] ?? null;
  const answered = list<string>(house.setup_answered);
  return {
    people, rules: listRules(db), slots: listSlots(db).map((s) => s.name), dishes,
    cook: house.cook_name ? { name: house.cook_name, days: view.cook_days, arrival: cookVisits(house.cook_arrival)[0]?.at ?? null, makes_well: house.cook_makes_well, wont_make: house.cook_wont_make, new_recipes: house.cook_new_recipes } : null,
    roles: { menu: house.menu_by, cooking: house.cooking_by, shopping: house.shopping_by },
    cuisines: view.cuisines ?? [], answered, connected: view.connected_apps, historyRead: Object.keys(view.history_synced).length > 0,
    planned, feedback: feedbackSince(db, firstAt, answered),
  };
}

// ── The routes ──

/** The cuisines the family's words name (their region or kitchen: "Punjabi", "south indian", a catalog id). */
export function cuisineWords(words: string[]): string[] {
  const named = words.flatMap((w) => Object.keys(CUISINE_NAMES).filter((id) => same(id, w) || same(CUISINE_NAMES[id], w)));
  return [...new Set([...cuisinesOf([], words.map(plainWords)), ...named])];
}

export function mountSetupStatusRoutes(hono: Hono<any>, db: Db, emit: Emit, opts: { now?: () => Date } = {}) {
  const write = writeRoutes(hono);
  const today = () => todayStr((opts.now ?? (() => new Date()))());
  const saveHouse = (set: Partial<typeof house_t.$inferInsert>, by: string) => {
    const row = db.update(house_t).set({ ...set, updated_at: new Date().toISOString(), updated_by: by }).where(eq(house_t.id, getHouse(db).id)).returning().get();
    emit("house", row.id, "update", by);
    return row;
  };

  // status { person? }: the setup's checklist (Flock's setup focus reads it every turn). `person`: who the agent is talking
  // to; the household's status is the same for everyone in it, and says so when that person does not eat at home.
  write("/api/setup/status", (b) => {
    if (b.person !== undefined && b.person !== null && typeof b.person !== "string") refuse("person must be a name");
    return { body: setupStatus(readSnapshot(db), today(), typeof b.person === "string" ? b.person : undefined) };
  });

  // set_answered { ids, remove? }: questions the family answered with nothing to save ("no fasting days", "we cook ourselves",
  // "all good"), so they are not asked again; remove: true takes them back.
  write("/api/setup/answered", (b, by) => {
    const ids = Array.isArray(b.ids) && b.ids.length && b.ids.every((x) => (STATUS_IDS as readonly unknown[]).includes(x)) ? b.ids as string[]
      : refuse(`ids must be a list of: ${STATUS_IDS.join(", ")}`);
    const had = list<string>(getHouse(db).setup_answered);
    const next = b.remove === true ? had.filter((x) => !ids.includes(x)) : [...new Set([...had, ...ids])];
    saveHouse({ setup_answered: JSON.stringify(next) }, by);
    return { body: { ok: true, answered: next, status: setupStatus(readSnapshot(db), today()) } };
  });

  // set_cuisine { cuisine }: the family's usual cuisine in their words ("Punjabi", "South Indian, mostly Tamil"); new dishes
  // keep to it. A word the app does not know is refused with the ones it does.
  write("/api/setup/cuisine", (b, by) => {
    const words = (Array.isArray(b.cuisine) ? b.cuisine : [b.cuisine]).filter((x): x is string => typeof x === "string" && !!x.trim())
      .flatMap((x) => x.split(/,|\band\b|\//).map((y) => y.replace(/\b(mostly|food|cuisine|kitchen|style)\b/gi, "").trim()).filter(Boolean));
    if (!words.length) refuse("cuisine is required: the family's usual cuisine in their words");
    const ids = cuisineWords(words);
    if (!ids.length) refuse(`${words.join(", ")}: not a cuisine the app knows. It knows: ${Object.values(CUISINE_NAMES).join(", ")}`);
    const row = saveHouse({ cuisines: JSON.stringify(ids) }, by);
    return { body: { ok: true, cuisines: houseView(row).cuisines } };
  });
}
