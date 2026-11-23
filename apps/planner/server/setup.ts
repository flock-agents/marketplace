// apply_setup { household, transcript }: the family's whole setup in one call, at the end of the interview ("model reads, code
// writes"). Flock keeps the replies word for word and sends them here with every household fact it holds; the app reads them
// with ONE balanced model call into a household profile (people, the cook, cooking days, extra meals, meals ordered in, food
// rules, the family's dishes, the shopping apps, subscriptions), checks and normalises that profile in code, and writes its own
// rows in a fixed order through its own routes: people, cook, cooking days, slots and meals ordered in, rules, dishes, shopping
// apps, subscriptions. Every write is add/upsert, one item at a time, so a thing the app cannot take is "noted, not enforced"
// and never costs the rest (12 simulated runs of the per-reply saves failed on one refused field sinking a whole batch, on
// wrong field names, on corrections that were never saved, and on rules copied from the help text's examples).
// Code's checks: every rule carries a quote of the family's own words, and a rule whose quote is not in what the family said
// (their replies or the household facts) is dropped; a rule's person must be on the Family page (a group word, "adults",
// is each of them); a slot word is the one meal it names ("Tiffin" is "Agastya's tiffin"); "everyone" is the whole house.
import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import { people as peopleTable } from "./db/schema";
import { appOf, GROUPS, RULE_KINDS, SLOTS } from "./db/constants";
import { WEEKDAYS, type Weekday } from "./dates";
import { closest } from "./agentOps";
import { CATEGORIES, CHECKED_KINDS, rulesSaid } from "./rules";
import { daysSaid, getHouse, houseView, isObject, refuse, slotsSaid, writeRoutes, type Db, type Emit } from "./family";
import type { ModelCall, ModelResult } from "./model";

// ── The model's answer ──

const STR = { type: "string" }, STRS = { type: "array", items: STR };
const OPT_STR = { type: ["string", "null"] };
export const SETUP_SCHEMA = {
  type: "object",
  required: ["people", "cook", "cookingDays", "homeCook", "slots", "orderIn", "rules", "dishes", "groceryApps", "subscriptions", "unplaced"],
  properties: {
    people: { type: "array", items: { type: "object", required: ["name", "group"], properties: {
      name: STR, group: { type: "string", enum: ["child", "adult", "elder"] }, age: { type: ["number", "null"] }, relationship: OPT_STR } } },
    cook: { anyOf: [{ type: "null" }, { type: "object", required: ["name", "days", "visits"], properties: {
      name: STR, days: STRS, visits: { type: "array", items: { type: "object", required: ["at", "meals"], properties: { at: STR, meals: STRS } } },
      timeLimit: OPT_STR, newRecipes: { type: ["string", "null"], enum: ["open", "set_menu", null] }, note: OPT_STR } }] },
    cookingDays: STRS,
    homeCook: { type: "array", items: { type: "object", required: ["day", "slots", "by"], properties: { day: STR, slots: STRS, by: STR, note: OPT_STR } } },
    slots: { type: "array", items: { type: "object", required: ["name", "days", "for", "quote"], properties: { name: STR, days: STRS, for: STRS, quote: STR } } },
    orderIn: { type: "array", items: { type: "object", required: ["day", "slot"], properties: { day: STR, slot: STR, note: OPT_STR } } },
    rules: { type: "array", items: { type: "object", required: ["kind", "quote"], properties: {
      kind: STR, who: OPT_STR, days: STRS, slots: STRS, items: STRS, to: OPT_STR, per_meal: { type: ["number", "null"] }, per_week: { type: ["number", "null"] },
      note: OPT_STR, quote: STR } } },
    dishes: { type: "array", items: { type: "object", required: ["name", "slots"], properties: { name: STR, slots: STRS, for: STRS } } },
    groceryApps: { type: "object", properties: { main: OPT_STR, fallback: OPT_STR } },
    subscriptions: { type: "array", items: { type: "object", required: ["item", "source"], properties: { item: STR, source: STR, note: OPT_STR } } },
    unplaced: { type: "array", items: { type: "object", required: ["text"], properties: { text: STR, quote: OPT_STR } } },
  },
};

const CATEGORY_LIST = Object.keys(CATEGORIES).map((c) => `@${c}`).join(", ");

/** The prompt. Its example family is not any test family's: an example copied into the answer is caught by the quote check. */
export const SETUP_SYSTEM = `You read an Indian family's setup chat with their meal planner and write down their household for the planner, as JSON. Code saves what you write; you only read.

You get:
- household: facts the family gave earlier (people, help at home, routines). Use them, but the transcript wins where it says something else. household.speaker is the name of the person writing the A lines: their "me", "I", "my" is that person.
- transcript: the planner's questions (Q:) and the family's replies (A1:, A2:, ... numbered), in order. Only A lines and household facts are the family's words. A Q: line is the app talking: never take a rule, a dish or a time from a question's examples or from the app's own read-back of what it understood.

Read it all first, then write. A later reply wins over an earlier one: "actually Sunita comes at 8" changes the cook's morning time to 08:00 even when the household facts say 7am; "almost right, X not Y" changes only X. "Looks right" / "no changes" adds nothing. "later", "busy", off-topic lines (reminders, school, jokes) add nothing.

Write:
- people: everyone who eats at home: name exactly as the family writes it, group child (under 18) | adult | elder (60 and over, or a grandparent), age when said, relationship to the speaker when said or clear ("my father": "father"; "my wife": "wife").
- cook: the paid cook, or null. days as Mon..Sun. visits: each time they come, "HH:MM" 24-hour, with the meals (Breakfast, Lunch, Dinner) that visit makes ("breakfast and lunch in the morning, dinner at 6pm" is two visits; times ["7am", "6pm"] with meals Breakfast, Lunch, Dinner is the same two visits). A corrected time ("actually she comes at 7:30") changes only the visit it is nearest to; the other visit stays. timeLimit: their time limit in the family's words. newRecipes: open (tries new recipes from reels, videos) or set_menu (sticks to familiar dishes, even if one new dish now and then). note: anything else about the cook (what they will not cook, what they are not good at).
- cookingDays: every weekday food is cooked at home, by the cook or by the family.
- homeCook: on days the cook does not come, who of the family cooks which meals ({ day, slots, by, note }).
- slots: only meals the family names besides Breakfast, Lunch and Dinner: a child's school tiffin ("<child>'s tiffin"; a tiffin named anywhere, even only in a rule, is a slot), an evening snack ("Evening snack"). Food eaten at home after school is that child's Lunch, not a slot. days: the weekdays it is eaten (empty: every day). for: who eats it, by name (empty: everyone). "We have an evening snack" in an answer about the adults' meals is the adults' snack. quote: the family's words that name it, from an A line (as for rules); a meal the family never named is no slot.
- orderIn: every regular meal not cooked at home, ordered in or eaten out: { day, slot, note: "eaten out" or "ordered from Swiggy" }. "Sunday lunch we eat out" is orderIn { Sun, Lunch, "eaten out" }, also when someone cooks Sunday's other meals.
- rules: the family's food rules, one per thing they said: what must or must not be eaten. What someone usually eats ("milk every morning", "curd rice when he's tired") is no rule: it is a dish, or nothing. kind is one of:
  veg (vegetarian home) | no_eggs ("vegetarian, no eggs" is two rules: veg and no_eggs) | avoid { items, who?, days?, slots? } (no dish with these) | swap { who, items, to } (who has "to" in place of items, e.g. less rice: items ["@white_rice"], to "millets or a small portion of rice") | only { who, items, slots? } | require { slots, items } | cap { per_meal, slots? } (at most per_meal dishes to cook in a meal: a cook's time limit) or cap { items, per_week } | fasting { who, days, slots } (who eats nothing at those meals on those days: "fasts Monday till evening" is slots ["Breakfast","Lunch"]) | other { note } (anything else: "less salt", "less spicy for the child", a cook's limit with no number).
  items are plain foods ("mushroom", "rice") or categories: ${CATEGORY_LIST}. "No sugar" is avoid ["@sweet"]; "nut-free" is avoid ["@nuts"]; "no rice at night" is avoid ["@white_rice"] at slots ["Dinner"].
  who is one person's name from people; leave it out for the whole house. days are Mon..Sun, left out for every day; slots are meal names (Breakfast, Lunch, Dinner, or a slot you wrote), left out for every meal.
  quote: the family's exact words this rule comes from, copied character for character from one A line or household fact (a short span, e.g. "no mushrooms"). Never from a Q: line, never your own words: when the app read a rule back ("Gowri eats no sugar, jaggery") and the family said it was right, quote the A line where the family first said it ("no sugar"). No quote, no rule.
- dishes: the family's own dishes from their answers about the past week: { name, slots, for }. for: the people it is theirs when only some eat it ("Father had ragi dosa" is for the father by name); empty when everyone at that meal eats it. A child's tiffin dishes go in the tiffin slot. Plain names ("Idli", "Rajma chawal"); no drinks.
- groceryApps: main and fallback, each one of zepto, swiggy-instamart, zomato-blinkit, bigbasket, amazon, or null.
- subscriptions: what comes on a subscription: { item, source, note } ("milk", "Country Delight", "1 litre every morning").
- unplaced: anything about food, meals or groceries the family said that fits nowhere above: { text, quote }.

Example (another family). household: people Arjun (adult), Divya (adult, wife), Tara (8), Lalitha (72, Divya's mother); help: cook Sunita Mon-Fri 8am.
Q: Sunita cooks Breakfast and Lunch at 8am. Is that right? A1: yes, and she comes back at 5 for dinner
Q: Is food cooked at home on weekends? A2: Saturday Divya cooks everything. Sunday we go to my in-laws for lunch, dinner we order from Zomato
A3: oh and Sunita comes at 8:30 actually
Q: Any food rules? A4: we're eggetarian, eggs fine but no meat. Amma doesn't eat onion or garlic, and she fasts on Saturdays till sunset.
Q: Tara's tiffin? A5: Mon-Fri, sandwiches or poha, school says no peanuts
gives cook { name "Sunita", days Mon..Fri, visits [{ at "08:30", meals [Breakfast, Lunch] }, { at "17:00", meals [Dinner] }] }, cookingDays Mon..Sat (Sunday dinner is ordered and lunch is out, so Sunday is no cooking day; and its two meals go in orderIn), homeCook [{ day Sat, slots [Breakfast, Lunch, Dinner], by "Divya" }], orderIn [{ Sun, Lunch, "eaten out" }, { Sun, Dinner, "ordered from Zomato" }], slots [{ "Tara's tiffin", Mon..Fri, ["Tara"] }], rules [{ egg, quote "eggs fine but no meat" }, { avoid, who "Lalitha", items ["onion","garlic"], quote "doesn't eat onion or garlic" }, { fasting, who "Lalitha", days [Sat], slots [Breakfast, Lunch], quote "fasts on Saturdays till sunset" }, { avoid, items ["@peanut"], slots ["Tara's tiffin"], quote "no peanuts" }], dishes [{ Sandwich, ["Tara's tiffin"] }, { Poha, ["Tara's tiffin"] }].
That family is only an example: write what THIS family said, nothing from the example.`;

// ── Reading the model's answer leniently ──

type Visit = { at: string; meals?: string[] };
export type Profile = {
  people: { name: string; group: string; age?: number; relationship?: string }[];
  cook: { name: string; days: Weekday[]; visits: Visit[]; timeLimit?: string; newRecipes?: "open" | "set_menu"; note?: string } | null;
  cookingDays: Weekday[];
  homeCook: { day: Weekday; slots: string[]; by: string; note?: string }[];
  slots: { name: string; days: Weekday[]; for: string[]; quote?: string }[];
  orderIn: { day: Weekday; slot: string; note?: string }[];
  rules: SetupRule[];
  dishes: { name: string; slots: string[]; for: string[] }[];
  groceryApps: { main: string | null; fallback: string | null };
  subscriptions: { item: string; source: string; note?: string }[];
  unplaced: { text: string; quote?: string }[];
};
export type SetupRule = { kind: string; who?: string; days?: string[]; slots?: string[]; items?: string[]; to?: string; per_meal?: number; per_week?: number; note?: string; quote: string };

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const strs = (v: unknown): string[] => (typeof v === "string" ? [v] : arr(v)).map(str).filter(Boolean);
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const DAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
/** Weekdays from however they were written: "Mon", "monday", "Mon-Fri", "weekdays", "every day", "daily". */
export function daysOf(v: unknown): Weekday[] {
  const out = new Set<Weekday>();
  for (const raw of strs(v)) {
    const w = raw.toLowerCase();
    if (/^(every ?day|daily|all|all days|everyday|all week)$/.test(w)) { WEEKDAYS.forEach((d) => out.add(d)); continue; }
    if (/^weekdays?$/.test(w)) { WEEKDAYS.slice(0, 5).forEach((d) => out.add(d)); continue; }
    if (/^weekends?$/.test(w)) { out.add("Sat"); out.add("Sun"); continue; }
    const range = /^([a-z]{3,})\s*(?:-|–|to)\s*([a-z]{3,})$/.exec(w);
    const one = (s: string) => { const i = DAY_NAMES.findIndex((d) => d.startsWith(s.slice(0, 3))); return i >= 0 ? i : null; };
    if (range) {
      const a = one(range[1]), b = one(range[2]);
      if (a !== null && b !== null) { for (let i = a; ; i = (i + 1) % 7) { out.add(WEEKDAYS[i]); if (i === b) break; } continue; }
    }
    const i = one(w);
    if (i !== null && w.length >= 3) out.add(WEEKDAYS[i]);
  }
  return WEEKDAYS.filter((d) => out.has(d));
}

/** A time as "HH:MM": "7", "7am", "7:30", "6pm", "18:00", "6.30 pm". */
export function clockOf(v: unknown): string | null {
  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i.exec(str(v));
  if (!m) return null;
  let h = Number(m[1]); const min = Number(m[2] ?? 0), ap = (m[3] ?? "").toLowerCase();
  if (ap.startsWith("p") && h < 12) h += 12;
  if (ap.startsWith("a") && h === 12) h = 0;
  return h < 24 && min < 60 ? `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}` : null;
}

const KIND_ALIASES: Record<string, string> = { vegetarian: "veg", vegetarian_home: "veg", no_egg: "no_eggs", eggs: "no_eggs", eggetarian: "egg",
  fast: "fasting", fasts: "fasting", limit: "cap", max: "cap", no: "avoid", exclude: "avoid", none: "avoid", note: "other", replace: "swap", instead: "swap" };
const kindOf = (v: unknown): string => {
  const k = str(v).toLowerCase().replace(/[\s-]+/g, "_");
  const kind = KIND_ALIASES[k] ?? k;
  return (RULE_KINDS as readonly string[]).includes(kind) ? kind : "other";
};

/** The model's JSON as a profile: every list a list, every field its type, nothing thrown away for being a little off. */
export function profileOf(json: unknown): Profile {
  const j = isObject(json) ? json : {};
  const cook = isObject(j.cook) && str(j.cook.name) ? j.cook : null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : undefined);
  const opt = <K extends string>(k: K, v: unknown): Partial<Record<K, string>> => (str(v) ? { [k]: str(v) } as Record<K, string> : {});
  return {
    people: arr(j.people).filter(isObject).filter((p) => str(p.name)).map((p) => ({ name: str(p.name), group: str(p.group).toLowerCase(),
      ...(num(p.age) !== undefined ? { age: num(p.age)! } : {}), ...opt("relationship", p.relationship) })),
    cook: cook ? { name: str(cook.name), days: daysOf(cook.days),
      visits: arr(cook.visits).flatMap((v): Visit[] => {
        const at = clockOf(isObject(v) ? v.at : v);
        return at ? [{ at, ...(isObject(v) && strs(v.meals).length ? { meals: strs(v.meals) } : {}) }] : [];
      }),
      ...opt("timeLimit", cook.timeLimit), ...(cook.newRecipes === "open" || cook.newRecipes === "set_menu" ? { newRecipes: cook.newRecipes } : {}), ...opt("note", cook.note) } : null,
    cookingDays: daysOf(j.cookingDays),
    homeCook: arr(j.homeCook).filter(isObject).flatMap((h) => daysOf(h.day).map((day) => ({ day, slots: strs(h.slots), by: str(h.by), ...opt("note", h.note) }))),
    slots: arr(j.slots).filter(isObject).filter((s) => str(s.name)).map((s) => ({ name: str(s.name), days: daysOf(s.days), for: strs(s.for), ...opt("quote", s.quote) })),
    orderIn: arr(j.orderIn).filter(isObject).flatMap((o) => daysOf(o.day).map((day) => ({ day, slot: str(o.slot), ...opt("note", o.note) }))),
    rules: arr(j.rules).filter(isObject).map((r) => ({ kind: kindOf(r.kind), ...opt("who", r.who), ...(strs(r.days).length ? { days: strs(r.days) } : {}),
      ...(strs(r.slots).length ? { slots: strs(r.slots) } : {}), ...(strs(r.items).length ? { items: strs(r.items) } : {}), ...opt("to", r.to),
      ...(num(r.per_meal) !== undefined ? { per_meal: num(r.per_meal) } : {}), ...(num(r.per_week) !== undefined ? { per_week: num(r.per_week) } : {}),
      ...opt("note", r.note), quote: str(r.quote) })),
    dishes: arr(j.dishes).filter(isObject).filter((d) => str(d.name)).map((d) => ({ name: str(d.name), slots: strs(d.slots), for: strs(d.for) })),
    groceryApps: { main: isObject(j.groceryApps) ? str(j.groceryApps.main) || null : null, fallback: isObject(j.groceryApps) ? str(j.groceryApps.fallback) || null : null },
    subscriptions: arr(j.subscriptions).filter(isObject).filter((s) => str(s.item)).map((s) => ({ item: str(s.item), source: str(s.source), ...opt("note", s.note) })),
    unplaced: arr(j.unplaced).filter(isObject).filter((u) => str(u.text)).map((u) => ({ text: str(u.text), ...opt("quote", u.quote) })),
  };
}

// ── What the family said: the quote check ──

/** Lower case, letters and digits only, one space between words. */
export const plainWords = (s: string): string => s.toLowerCase().replace(/[’']/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Every line the family said: the transcript's replies (A:) and every text value of the household facts. */
export function familyLines(transcript: string[], household: unknown): string[] {
  const out = transcript.filter((l) => /^A\d*:/i.test(l)).map((l) => l.replace(/^A\d*:\s*/i, ""));
  const walk = (v: unknown): void => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (isObject(v)) Object.values(v).forEach(walk);
  };
  walk(household);
  return out.map(plainWords).filter(Boolean);
}

const FILLER = new Set(["a", "an", "the", "has", "have", "had", "is", "are", "was", "be", "at", "to", "for", "of", "in", "on", "and", "or", "too", "also",
  "he", "she", "they", "his", "her", "their", "him", "them", "it", "its", "eats", "eat", "with", "we", "our", "us", "my", "i"]);
/** Is a quote the family's own words: inside one of their lines, or (a quote copied a little off) nearly all its words in one
 *  line in order. */
export function saidByFamily(quote: string, lines: string[]): boolean {
  const q = plainWords(quote);
  if (q.length < 3) return false;
  if (lines.some((l) => l.includes(q))) return true;
  // Words that carry nothing ("has", "at", "for"): a quote written "father has less rice" for "father is diabetic, less
  // rice" is the family's; "eats no rice at Dinner" (the app's read-back) is not, "Dinner" being nowhere in their line.
  const words = q.split(" ").filter((w) => !FILLER.has(w));
  if (words.length < 2) return false;
  return lines.some((l) => {
    const lw = new Set(l.split(" "));
    return words.filter((w) => lw.has(w)).length / words.length >= 0.8;
  });
}

/** The transcript as lines "Q: …" / "A: …": a string of lines, a list of lines, or a list of { q, a }. */
export function transcriptLines(v: unknown): string[] {
  if (typeof v === "string") return v.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return arr(v).flatMap((x) => (typeof x === "string" ? [x.trim()] : isObject(x)
    ? [...(str(x.q) ? [`Q: ${str(x.q)}`] : []), ...(str(x.a) ? [`A: ${str(x.a)}`] : [])] : [])).filter(Boolean);
}

/** The household facts' people, as { name, group, age, relationship }: whatever shape the record has them in. */
function householdPeople(h: unknown): Profile["people"] {
  const list = isObject(h) ? h["household.people"] ?? h.people : undefined;
  return arr(list).filter(isObject).filter((p) => str(p.name)).map((p) => ({ name: str(p.name), group: str(p.group).toLowerCase(),
    ...(typeof p.age === "number" ? { age: p.age } : {}), ...(str(p.relation ?? p.relationship) ? { relationship: str(p.relation ?? p.relationship) } : {}) }));
}

// ── Writing it ──

export type SetupResult =
  | { ok: true; said: string; noted: string[]; dropped: string[]; rules: (SetupRule & { saved_as: string })[]; profile: Profile; model: string }
  | { ok: false; reason: string; say: string };

/** One write through the app's own route: its answer, or its refusal's reason. */
type Post = (path: string, body: unknown) => Promise<{ ok: true; body: any } | { ok: false; reason: string }>;

/** A drink is not a dish the week is planned from (sim: "milk every morning" became a dish for everyone, fasting father too). */
const DRINKS = /^\s*(milk|warm milk|tea|chai|coffee|filter coffee|juice|water|buttermilk|lassi|horlicks|bournvita|boost)\s*$/i;

const GROUP_WORDS: Record<string, (p: { group: string }) => boolean> = {
  adults: (p) => p.group === "adult", adult: (p) => p.group === "adult", parents: (p) => p.group === "adult",
  children: (p) => p.group === "child", kids: (p) => p.group === "child", child: (p) => p.group === "child", kid: (p) => p.group === "child",
  elders: (p) => p.group === "elder", elder: (p) => p.group === "elder", grandparents: (p) => p.group === "elder",
};
const EVERYONE = /^(everyone|everybody|all|the house|the family|whole family|family|whole house|us|we|all of us)$/i;

/** Read the setup and write it. `post` writes through the app's own routes (validation, change events and the writer's stamp
 *  stay theirs). Never refuses the whole: what does not fit is in `noted` and what was not said is in `dropped`. */
export async function applySetup(deps: { db: Db; model: ModelCall; post: Post; household: unknown; transcript: string[]; log?: (l: string) => void }): Promise<SetupResult> {
  const log = deps.log ?? ((l: string) => console.log(`[planner] apply_setup: ${l}`));
  // The family's replies numbered (A1:, A2:, ...): the model quotes them, not the questions.
  let n = 0;
  const numbered = deps.transcript.map((l) => (/^A\d*:/i.test(l) ? `A${++n}: ${l.replace(/^A\d*:\s*/i, "")}` : l));
  const user = JSON.stringify({ household: deps.household ?? {}, transcript: numbered.join("\n") });
  const t0 = Date.now();
  const ask = () => deps.model({ tier: "balanced", purpose: "setup: read the interview", system: SETUP_SYSTEM, user, schema: SETUP_SCHEMA, maxTokens: 8000 });
  let r: ModelResult = await ask();
  // The setup is asked once per family: an answer that did not fit, or a model that did not answer, is asked once more.
  if (!r.ok && (r.code === "invalid_output" || r.code === "unavailable" || r.code === "timeout")) { log(`model ${r.code}: ${r.message.slice(0, 300)}; asking once more`); r = await ask(); }
  log(`model ${r.ok ? `ok (${r.model})` : `${r.code}: ${r.message.slice(0, 300)}`} in ${Date.now() - t0} ms`);
  if (!r.ok) return { ok: false, reason: r.code, say: "I couldn't save the setup just now. Tell me \"save my setup\" in a little while; nothing you told me is lost." };
  const p = profileOf(r.json);
  const noted: string[] = [], dropped: string[] = [];
  const said = familyLines(deps.transcript, deps.household);

  // 1. People: the model's, then anyone the household facts name that it left out. A group from the age when none fits.
  const fromFacts = householdPeople(deps.household);
  const everyone = [...p.people];
  for (const f of fromFacts) if (!everyone.some((x) => same(x.name, f.name))) everyone.push(f);
  for (const person of everyone) {
    // "Me" in a reply is the person writing: their own name.
    if (/^(me|i|myself|self)$/i.test(person.name)) {
      const own = isObject(deps.household) ? str(deps.household["household.speaker"] ?? deps.household.speaker) : "";
      if (!own || everyone.some((x) => same(x.name, own))) continue;
      person.name = own;
    }
    const fact = fromFacts.find((f) => same(f.name, person.name));
    let group = (GROUPS as readonly string[]).includes(person.group) ? person.group : fact && (GROUPS as readonly string[]).includes(fact.group) ? fact.group : "";
    const age = person.age ?? fact?.age;
    if (!group) group = age !== undefined ? (age < 18 ? "child" : age >= 60 ? "elder" : "adult") : "adult";
    const res = await deps.post("/api/family/people", { name: person.name, group,
      ...(person.relationship ?? fact?.relationship ? { relationship: person.relationship ?? fact?.relationship } : {}),
      ...(age !== undefined ? { note: `age ${age}` } : {}) });
    if (!res.ok) noted.push(`${person.name}: not saved (${res.reason})`);
  }
  const family = deps.db.select().from(peopleTable).where(eq(peopleTable.active, 1)).all().map((x) => ({ name: x.name, group: x.group ?? "adult", relationship: x.relationship ?? "" }));
  const names = family.map((x) => x.name);
  /** A name as on the Family page: exact, a first name ("Gowri"), a relationship ("father"), or close enough. */
  const speaker = isObject(deps.household) ? str(deps.household["household.speaker"] ?? deps.household.speaker) : "";
  const personOf = (w: string): string | null => {
    const t = w.trim().replace(/^(my|our)\s+/i, "");
    if (!t) return null;
    if (speaker && /^(me|i|myself|self)$/i.test(t)) return names.find((n) => same(n, speaker)) ?? null;
    return names.find((n) => same(n, t)) ?? names.find((n) => same(n.split(/\s+/)[0], t) || same(t.split(/\s+/)[0], n))
      ?? family.find((x) => x.relationship && same(x.relationship, t))?.name ?? closest(t, names);
  };
  /** Who a list names, as Family page names: a group word is its people; "everyone" is no one in particular (all). */
  const whoOf = (ws: string[]): { names: string[]; unknown: string[] } => {
    const out = new Set<string>(), unknown: string[] = [];
    for (const w of ws) {
      if (EVERYONE.test(w.trim())) return { names: [], unknown: [] };
      const g = GROUP_WORDS[w.trim().toLowerCase()];
      if (g) { family.filter(g).forEach((x) => out.add(x.name)); continue; }
      const n = personOf(w);
      if (n) out.add(n); else unknown.push(w);
    }
    return { names: [...out], unknown };
  };

  // 2. The cook. A visit's meals from Breakfast, Lunch and Dinner; two visits at one time are one.
  if (p.cook) {
    const visits: Visit[] = [];
    for (const v of p.cook.visits) {
      const meals = (v.meals ?? []).map((m) => SLOTS.find((s) => same(s, m)) ?? SLOTS.find((s) => m.toLowerCase().includes(s.toLowerCase()))).filter((m): m is (typeof SLOTS)[number] => !!m);
      const had = visits.find((x) => x.at === v.at);
      if (had) had.meals = [...new Set([...(had.meals ?? []), ...meals])];
      else visits.push({ at: v.at, ...(meals.length ? { meals } : {}) });
    }
    const fixed = cookVisits(visits, cookTimesOf(deps.household, p.cook.name), deps.transcript.filter((l) => /^A\d*:/i.test(l)));
    visits.splice(0, visits.length, ...fixed);
    const days = p.cook.days.length ? p.cook.days : p.cookingDays;
    const body = { name: p.cook.name, days, ...(visits.length ? { arrival: visits } : {}),
      ...(p.cook.timeLimit ? { time_limit: p.cook.timeLimit } : {}), ...(p.cook.newRecipes ? { new_recipes: p.cook.newRecipes } : {}), ...(p.cook.note ? { note: p.cook.note } : {}) };
    let res = await deps.post("/api/family/cook", body);
    if (!res.ok && visits.length) res = await deps.post("/api/family/cook", { ...body, arrival: visits.map((v) => v.at) });
    if (!res.ok) noted.push(`the cook ${p.cook.name}: not saved (${res.reason})`);
  }

  // 3. Cooking days: the days said, the cook's, and the days the family cooks.
  const cooking = WEEKDAYS.filter((d) => p.cookingDays.includes(d) || p.homeCook.some((h) => h.day === d) || (p.cook?.days ?? []).includes(d));
  if (cooking.length) {
    const res = await deps.post("/api/family/cooking-days", { days: cooking });
    if (!res.ok) noted.push(`cooking days: not saved (${res.reason})`);
  }

  // 4. Extra meals, then the meals ordered in or eaten out.
  for (const s of p.slots) {
    if (SLOTS.some((x) => same(x, s.name))) continue;
    // A meal the family never named is no slot (sim: an "Evening snack" in a family that never spoke of one).
    const kind = plainWords(s.name).split(" ").pop() ?? "";
    if (!saidByFamily(s.quote ?? "", said) && (!said.some((l) => ` ${l} `.includes(` ${kind} `) || ` ${l} `.includes(` ${kind}s `)))) {
      dropped.push(`the ${s.name} ("${s.quote ?? ""}"): not something the family said`); continue; }
    const who = whoOf(s.for);
    if (who.unknown.length) noted.push(`${s.name}: ${who.unknown.join(", ")} is not on the Family page, so it is for everyone`);
    const res = await deps.post("/api/family/slots", { add: true, extra_slots: [{ name: s.name, ...(s.days.length && s.days.length < 7 ? { days: s.days } : {}), ...(who.names.length && !who.unknown.length ? { for: who.names } : {}) }] });
    if (!res.ok) noted.push(`${s.name}: not saved (${res.reason})`);
  }
  const slotNames = (): string[] => [...SLOTS, ...houseView(getHouse(deps.db)).extra_slots.map((s) => s.name)];
  /** A meal's name as the app has it: exact, the one meal a word is in ("Tiffin"), or close enough. */
  const slotOf = (w: string): string | null => {
    const all = slotNames(), t = w.trim();
    const hit = all.find((s) => same(s, t));
    if (hit) return hit;
    const within = all.filter((s) => s.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(s.toLowerCase()));
    if (within.length === 1 && t.length >= 4) return within[0];
    const words = all.filter((s) => plainWords(t).split(" ").some((x) => x.length >= 4 && plainWords(s).split(" ").includes(x)));
    return words.length === 1 ? words[0] : closest(t, all);
  };
  // On a day the cook does not come, the family cooks only the meals said: a main meal nobody cooks that day is not
  // planned (sim: "Sunday lunch we eat out. Ankita makes a quick breakfast and dinner" came back with Sunday lunch nowhere).
  const orderIn = [...p.orderIn];
  // A home-cook entry that says the meal is eaten out or ordered is a meal ordered in (sim: { Sun, Lunch, by Ankita, "eaten out" }).
  for (const h of p.homeCook.filter((x) => /eat(en|ing)? out|order|outside|restaurant/i.test(x.note ?? "")))
    for (const slot of h.slots) if (!orderIn.some((o) => o.day === h.day && same(o.slot, slot))) orderIn.push({ day: h.day, slot, note: h.note });
  p.homeCook = p.homeCook.filter((x) => !/eat(en|ing)? out|order|outside|restaurant/i.test(x.note ?? ""));
  for (const day of WEEKDAYS) {
    const home = p.homeCook.filter((x) => x.day === day);
    if (!home.length || (p.cook?.days ?? []).includes(day) || home.some((x) => !x.slots.length)) continue;
    for (const slot of SLOTS) if (!home.some((x) => x.slots.some((s) => same(s, slot))) && !orderIn.some((o) => o.day === day && same(o.slot, slot)))
      orderIn.push({ day, slot, note: "not cooked at home" });
  }
  /** A child's tiffin a rule or a dish names that is no meal yet (sim: "agastya's tiffin nut-free" with no tiffin slot):
   *  made, school days Mon–Fri, and said. */
  const tiffinOf = async (w: string, who?: string): Promise<string | null> => {
    if (!/tiffin|lunch ?box/i.test(w)) return slotOf(w);
    const had = slotNames().filter((x) => /tiffin|lunch ?box/i.test(x));
    if (had.length) return had.length === 1 ? had[0] : slotOf(w);
    const kids = family.filter((x) => x.group === "child").map((x) => x.name);
    const child = (who && kids.find((k) => same(k, who))) ?? kids.find((k) => w.toLowerCase().includes(k.toLowerCase())) ?? (kids.length === 1 ? kids[0] : null);
    if (!child) return null;
    const name = `${child}'s tiffin`;
    const res = await deps.post("/api/family/slots", { add: true, extra_slots: [{ name, days: ["Mon", "Tue", "Wed", "Thu", "Fri"], for: [child] }] });
    if (!res.ok) return null;
    noted.push(`${name}: added Mon–Fri; its days were not said`);
    return name;
  };
  for (const o of orderIn) {
    const slot = slotOf(o.slot);
    if (!slot) { noted.push(`${o.day} ${o.slot} ordered in: no such meal`); continue; }
    const res = await deps.post("/api/family/slots", { add: true, order_in: [{ day: o.day, slot, ...(o.note ? { note: o.note } : {}) }] });
    if (!res.ok) noted.push(`${o.day} ${slot} ordered in: not saved (${res.reason})`);
  }

  const rescue = (quote: string, who: string): string | null => {
    const person = personOf(who);
    const fam = family.find((x) => x.name === person);
    if (!fam) return null;
    const refs = [...plainWords(fam.name).split(" "), ...(fam.relationship ? [plainWords(fam.relationship)] : [])].filter((w) => w.length >= 3);
    const words = plainWords(quote).split(" ").filter((w) => !FILLER.has(w));
    for (const l of said) {
      if (!refs.some((r) => ` ${l} `.includes(` ${r} `))) continue;
      for (let i = 0; i + 1 < words.length; i++) if (` ${l} `.includes(` ${words[i]} ${words[i + 1]} `)) return `${words[i]} ${words[i + 1]}`;
    }
    return null;
  };
  // 5. Rules: each one alone, so one the app cannot take costs nothing else. Not said by the family: dropped.
  const savedRules: (SetupRule & { saved_as: string })[] = [];
  const homeRules: SetupRule[] = p.homeCook.filter((h) => h.by).map((h) => ({ kind: "other", days: [h.day], ...(h.slots.length ? { slots: h.slots } : {}),
    note: `${h.by} cooks${h.note ? ` (${h.note})` : ""}`, quote: "" }));
  for (const rule of [...p.rules, ...homeRules]) {
    const fromHome = homeRules.includes(rule);
    // A person's rule quoted from the app's read-back ("Gowri Shankar eats no sugar, jaggery") is still theirs when one of the
    // family's lines that names them has two of its words together ("father is diabetic, less rice no sugar").
    const rescued = !fromHome && !saidByFamily(rule.quote, said) && rule.who ? rescue(rule.quote, rule.who) : null;
    if (rescued) rule.quote = rescued;
    if (!fromHome && !rescued && !saidByFamily(rule.quote, said)) { dropped.push(`${rule.kind}${rule.who ? ` for ${rule.who}` : ""}${rule.items ? ` ${rule.items.join(", ")}` : ""} ("${rule.quote}"): not something the family said`); continue; }
    const checked = (CHECKED_KINDS as readonly string[]).includes(rule.kind);
    // Who: one person; a group word is a rule for each of them; "everyone" or no one is the house.
    let whos: (string | undefined)[] = [undefined];
    if (rule.who) {
      const w = whoOf([rule.who]);
      if (w.unknown.length) { noted.push(`${rule.who} is not on the Family page: "${rule.quote}" is kept for the whole house`); }
      else if (w.names.length) whos = w.names;
    }
    const slots: (string | null)[] = [];
    for (const s of rule.slots ?? []) slots.push(await tiffinOf(s, rule.who));
    if (slots.some((s) => !s)) noted.push(`"${rule.quote}": ${(rule.slots ?? []).filter((_, i) => !slots[i]).join(", ")} is not a meal; the rule holds at every meal`);
    const okSlots = slots.filter((s): s is string => !!s);
    const days = rule.days?.length ? (rule.kind === "other" || rule.kind === "fasting" ? rule.days.map((d) => daysOf(d)[0] ?? d) : daysOf(rule.days)) : [];
    for (const who of whos) {
      const body: Record<string, unknown> = { kind: rule.kind, ...(who ? { who } : {}), ...(days.length ? { days } : {}),
        ...(okSlots.length && okSlots.length === slots.length ? { slots: okSlots } : {}), note: rule.note || rule.quote || undefined };
      if (checked) {
        if (rule.items?.length) body.items = rule.items;
        if (rule.kind === "swap") body.to = rule.to || rule.note || "less";
        if (rule.kind === "cap") { if (rule.per_meal) body.per_meal = Math.round(rule.per_meal); else if (rule.per_week !== undefined) body.per_week = Math.round(rule.per_week); }
      }
      // A fast is checked with its person, days and meals; "till evening" with no meals is breakfast and lunch.
      if (rule.kind === "fasting" && who && days.length && !body.slots && /till|until|evening|sunset/i.test(`${rule.quote} ${rule.note ?? ""}`)) body.slots = ["Breakfast", "Lunch"];
      if (!body.note) delete body.note;
      let res = await deps.post("/api/family/rules", { add: true, rules: [body] });
      let as = rule.kind;
      if (!res.ok) {
        // Kept in the family's words, as a note the planner reads, and said so.
        const reason = res.reason;
        res = await deps.post("/api/family/rules", { add: true, rules: [{ kind: "other", ...(who ? { who } : {}), note: rule.quote || rule.note || rule.kind }] });
        as = "other";
        noted.push(`"${rule.quote || rule.note}": kept as a note, not checked (${reason})`);
      }
      if (res.ok) savedRules.push({ ...rule, ...(who ? { who } : {}), saved_as: as });
    }
  }

  // 6. The family's dishes, each alone.
  for (const d of p.dishes) {
    if (DRINKS.test(d.name)) continue;
    const found: (string | null)[] = [];
    for (const s of d.slots) found.push(await tiffinOf(s, d.for[0]));
    const slots = [...new Set(found.filter((s): s is string => !!s))];
    if (!slots.length) { noted.push(`${d.name}: no meal for it (${d.slots.join(", ")})`); continue; }
    const who = whoOf(d.for);
    const res = await deps.post("/api/dish-book/family", { dishes: [{ name: d.name, slots, ...(who.names.length && !who.unknown.length ? { for: who.names } : {}) }] });
    if (!res.ok) noted.push(`${d.name}: not saved (${res.reason})`);
  }

  // 7. Shopping apps and subscriptions.
  const main = appOf(p.groceryApps.main ?? ""), fallback = appOf(p.groceryApps.fallback ?? "");
  if (main) {
    const res = await deps.post("/api/family/shopping-apps", { main, fallback: fallback && fallback !== main ? fallback : null, connected: houseView(getHouse(deps.db)).connected_apps });
    if (!res.ok) noted.push(`shopping apps: not saved (${res.reason})`);
  } else if (p.groceryApps.main) noted.push(`${p.groceryApps.main}: not a shopping app the planner orders on`);
  for (const s of p.subscriptions) {
    const res = await deps.post("/api/items/subscription", { item: s.item, source: s.source || "a subscription", active: true });
    if (!res.ok) noted.push(`${s.item} subscription: not saved (${res.reason})`);
  }
  for (const u of p.unplaced) noted.push(u.text);

  const back = readBack(deps.db, p);
  return { ok: true, said: noted.length ? `${back}\nNoted, not checked by the planner:\n${noted.map((n) => `- ${n}`).join("\n")}` : back, noted, dropped, rules: savedRules, profile: p, model: r.model };
}

const hourOf = (at: string) => Number(at.slice(0, 2));
/** The meals a visit at this time can make: no dinner before noon, no breakfast or lunch from 3 pm. */
const fitsTime = (at: string, meal: string) => (meal === "Dinner" ? hourOf(at) >= 12 : hourOf(at) < 15);

/** The cook's times in the household facts (help: { role: cook, name, times, meals }), each with the meals that fit it. */
export function cookTimesOf(household: unknown, cook: string): Visit[] {
  const help = isObject(household) ? arr(household["household.help"] ?? household.help) : [];
  const out: Visit[] = [];
  for (const h of help.filter(isObject)) {
    if (!/cook/i.test(str(h.role)) || (str(h.name) && !same(str(h.name), cook))) continue;
    const meals = strs(h.meals).map((m) => SLOTS.find((x) => same(x, m))).filter((m): m is (typeof SLOTS)[number] => !!m);
    for (const t of strs(h.times)) {
      const at = clockOf(t);
      if (at) out.push({ at, meals: meals.filter((m) => fitsTime(at, m)) });
    }
  }
  return out;
}

/** Where a time was last said in the family's replies (-1: never): "7:30", "07:30", "7am", "7 am", "6pm". */
function saidAt(at: string, replies: string[]): number {
  const h = hourOf(at), m = at.slice(3), h12 = h % 12 || 12, ap = h < 12 ? "am" : "pm";
  const forms = m === "00" ? [`${h12}${ap}`, `${h12} ${ap}`, `${h}:00`, at] : [`${h12}:${m}`, `${h}:${m}`, at, `${h12}.${m}`];
  let last = -1;
  replies.forEach((r, i) => { const t = r.toLowerCase(); if (forms.some((f) => new RegExp(`(^|[^\\d])${f.replace(".", "\\.")}(?![\\d])`).test(t))) last = i; });
  return last;
}

/** The cook's visits made sensible in code: a meal only at a time that fits it (no dinner at 7:30 in the morning); a meal the
 *  cook makes that no visit has left takes its time from the household facts; a meal two visits claim is the visit whose time
 *  the family said last (a correction: "actually she comes at 7:30" after the facts' 7am). */
export function cookVisits(given: Visit[], facts: Visit[], replies: string[]): Visit[] {
  const meals = new Set<string>([...given.flatMap((v) => v.meals ?? []), ...facts.flatMap((v) => v.meals ?? [])]);
  // "7:30" said without am or pm, read as 19:30, is 07:30 when the cook's facts have a morning time near it and no evening one.
  const near = (a: string, b: string) => Math.abs(hourOf(a) * 60 + Number(a.slice(3)) - hourOf(b) * 60 - Number(b.slice(3))) <= 60;
  given = given.map((v) => {
    if (hourOf(v.at) < 12) return v;
    const am = `${String(hourOf(v.at) - 12).padStart(2, "0")}:${v.at.slice(3)}`;
    return facts.some((f) => near(f.at, am)) && !facts.some((f) => near(f.at, v.at)) ? { ...v, at: am } : v;
  });
  // A visit left with no meal that fits its time is still a time the family gave: it makes the cook's meals that fit it.
  let visits = given.map((v) => {
    const fit = v.meals?.filter((m) => fitsTime(v.at, m));
    return { at: v.at, meals: fit && !fit.length ? [...meals].filter((m) => fitsTime(v.at, m)) : fit };
  });
  for (const meal of meals) {
    if (visits.some((v) => v.meals?.includes(meal))) continue;
    const f = facts.find((v) => v.meals?.includes(meal));
    if (!f) continue;
    const had = visits.find((v) => v.at === f.at);
    if (had) had.meals = [...(had.meals ?? []), meal]; else visits.push({ at: f.at, meals: [meal] });
  }
  for (const meal of meals) {
    const claim = visits.filter((v) => v.meals?.includes(meal));
    if (claim.length < 2) continue;
    // The one said last wins; never said: the later one in the model's list.
    const keep = claim.reduce((a, b) => (saidAt(b.at, replies) >= saidAt(a.at, replies) ? b : a));
    for (const v of claim) if (v !== keep) v.meals = v.meals!.filter((m) => m !== meal);
  }
  visits = visits.filter((v) => v.meals === undefined || v.meals.length);
  return visits.sort((a, b) => a.at.localeCompare(b.at)).map((v) => (v.meals?.length ? { at: v.at, meals: SLOTS.filter((s) => v.meals!.includes(s)) } : { at: v.at }));
}

const andWords = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** What was saved, in plain words, from the rows themselves. */
export function readBack(db: Db, p: Profile): string {
  const h = houseView(getHouse(db));
  const fam = db.select().from(peopleTable).where(eq(peopleTable.active, 1)).all();
  const lines: string[] = [];
  lines.push(`At home: ${andWords(fam.map((x) => `${x.name} (${x.group}${x.note?.startsWith("age ") ? `, ${x.note.slice(4)}` : ""})`))}.`);
  if (h.cook_name) lines.push(`${h.cook_name} cooks ${daysSaid(h.cook_days)}${h.cook_visits.length ? `: ${andWords(h.cook_visits.map((v) => `${v.meals?.length ? `${andWords(v.meals.map((m) => m.toLowerCase()))} ` : ""}at ${v.at}`))}` : ""}.`);
  lines.push(`Cooking at home ${daysSaid(h.cooking_days)}.`);
  lines.push(slotsSaid(h));
  const rules = rulesSaid(h.rules);
  if (rules) lines.push(`Food rules:\n${rules}`);
  const dishCount = p.dishes.length;
  if (dishCount) lines.push(`${dishCount} of your dishes noted to plan from.`);
  return lines.join("\n");
}

/** apply_setup { household, transcript }: answers { ok, said, noted, dropped, rules, profile } or { ok: false, reason, say }. */
export function mountSetupRoute(hono: Hono<any>, db: Db, _emit: Emit, opts: { model: ModelCall }) {
  const write = writeRoutes(hono);
  write("/api/family/setup", async (b, _by, c) => {
    const transcript = transcriptLines(b.transcript);
    if (!transcript.length) refuse("transcript is required: the planner's questions and the family's replies, word for word, as Q: / A: lines");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    for (const k of ["x-flock-agent", "x-flock-user"]) { const v = c.req.header(k); if (v) headers[k] = v; }
    const post: Post = async (path, body) => {
      const res = await hono.request(path, { method: "POST", headers, body: JSON.stringify(body) });
      const out = await res.json().catch(() => null) as any;
      return res.ok ? { ok: true, body: out } : { ok: false, reason: out?.reason ?? `refused (${res.status})` };
    };
    return { body: await applySetup({ db, model: opts.model, post, household: b.household, transcript }) };
  });
}
