// apply_setup { household, transcript }: the family's whole setup in one call, at the end of the interview ("model reads, code
// writes"). Flock keeps the replies word for word and sends them here with every household fact it holds; the app reads them
// with three balanced model calls at once (the home, the food rules, the dishes) into a household profile (people, the cook,
// who cooks on the cook's days off, extra meals, meals ordered in, food rules, the family's dishes, the shopping apps,
// subscriptions), checks and normalises that profile in code,
// and writes its own rows in a fixed order through its own routes: people, cook, slots and meals ordered in, rules, dishes,
// shopping apps, subscriptions. Every day is planned (owner, 23 Nov: many families cook every day themselves): a day the cook
// does not come is cooked by the family, and only a meal the family says is eaten out or ordered in is not cooked. Every write is add/upsert, one item at a time, so a thing the app cannot take is "noted, not enforced"
// and never costs the rest (12 simulated runs of the per-reply saves failed on one refused field sinking a whole batch, on
// wrong field names, on corrections that were never saved, and on rules copied from the help text's examples).
// Code's checks: every rule carries a quote of the family's own words, and a rule whose quote is not in what the family said
// (their replies or the household facts) is dropped; a rule's person must be on the Family page (a group word, "adults",
// is each of them); a slot word is the one meal it names ("Tiffin" is "Kabir's tiffin"); "everyone" is the whole house, and an
// extra meal said without names is everyone's (owner, 23 Nov).
import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import { people as peopleTable } from "./db/schema";
import { appOf, GROUPS, OFTEN, RULE_KINDS, SLOTS, STAPLE_DISHES, type Often } from "./db/constants";
import { WEEKDAYS, type Weekday } from "./dates";
import { closest } from "./agentOps";
import { CATEGORIES, CHECKED_KINDS, rulesSaid, SOFT_KINDS } from "./rules";
import { daysSaid, getHouse, LONG_DAY, houseView, isObject, refuse, slotsSaid, writeRoutes, type Db, type Emit } from "./family";
import type { ModelCall, ModelResult } from "./model";

// ── The model's answer: three readers at once ──
// One call for the whole profile took 12–170 s on the Balanced tier's DeepSeek and, live, ran into its 8000-token cap with no
// JSON (sim 23 Nov). The setup is read by three calls IN PARALLEL over the same input, each with its own small schema: the
// home (people, the cook, who cooks on the cook's days off, extra meals, meals ordered in, shopping), the food rules, and the
// family's dishes. Their answers are merged into one profile; the checks and writes below are the same for it.

const STR = { type: "string" }, STRS = { type: "array", items: STR };
const OPT_STR = { type: ["string", "null"] };

const HOME_SCHEMA = {
  type: "object",
  required: ["people"],
  properties: {
    people: { type: "array", items: { type: "object", required: ["name", "group"], properties: {
      name: STR, group: { type: "string", enum: ["child", "adult", "elder"] }, age: { type: ["number", "null"] }, relationship: OPT_STR } } },
    cook: { anyOf: [{ type: "null" }, { type: "object", required: ["name"], properties: {
      name: STR, days: STRS, visits: { type: "array", items: { type: "object", required: ["at"], properties: { at: STR, meals: STRS } } },
      timeLimit: OPT_STR, newRecipes: { type: ["string", "null"], enum: ["open", "set_menu", null] }, note: OPT_STR } }] },
    homeCook: { type: "array", items: { type: "object", required: ["day", "slots", "by"], properties: { day: STR, slots: STRS, by: STR, note: OPT_STR } } },
    slots: { type: "array", items: { type: "object", required: ["name", "quote"], properties: { name: STR, days: STRS, for: STRS, quote: STR } } },
    orderIn: { type: "array", items: { type: "object", required: ["day", "slot"], properties: { day: STR, slot: STR, note: OPT_STR } } },
    groceryApps: { type: "object", properties: { main: OPT_STR, fallback: OPT_STR } },
    subscriptions: { type: "array", items: { type: "object", required: ["item"], properties: { item: STR, source: STR, note: OPT_STR } } },
    meals: { type: "array", items: { type: "object", required: ["slot", "words"], properties: { slot: STR, group: { type: ["string", "null"], enum: ["children", "adults", null] }, words: STR } } },
  },
};
const RULES_SCHEMA = {
  type: "object",
  required: ["rules"],
  properties: {
    rules: { type: "array", items: { type: "object", required: ["kind", "quote"], properties: {
      kind: STR, who: OPT_STR, days: STRS, slots: STRS, items: STRS, to: OPT_STR, per_meal: { type: ["number", "null"] }, per_week: { type: ["number", "null"] },
      often: { type: ["string", "null"], enum: ["usually", "sometimes", "rarely", null] }, note: OPT_STR, quote: STR } } },
    unplaced: { type: "array", items: { type: "object", required: ["text"], properties: { text: STR, quote: OPT_STR } } },
  },
};
/** A dish is a short row, [name, meals, who, how often]: the longest list in the answer, so the fewest tokens per item. */
const DISHES_SCHEMA = { type: "object", required: ["dishes"], properties: { dishes: { type: "array", items: { type: "array", items: STR } } } };

const CATEGORY_LIST = Object.keys(CATEGORIES).map((c) => `@${c}`).join(", ");

const COMMON = `You read an Indian family's setup chat with their meal planner and write down ONE PART of their household for the planner, as JSON. Code saves what you write; you only read. Other readers write the other parts at the same time: write only the part asked for here.

You get:
- household: facts the family gave earlier (people, help at home, routines). Use them, but the transcript wins where it says something else. household.speaker is the name of the person writing the A lines: their "me", "I", "my" is that person.
- transcript: the planner's questions (Q:) and the family's replies (A1:, A2:, ... numbered), in order. Only A lines and household facts are the family's words. A Q: line is the app talking: never take a rule, a dish or a time from a question's examples or from the app's own read-back of what it understood.

Read it all first, then write. A later reply wins over an earlier one: "actually Savita comes at 8" changes the cook's morning time to 08:00 even when the household facts say 7am; "almost right, X not Y" changes only X. "Looks right" / "no changes" adds nothing. "later", "busy", off-topic lines (reminders, school, jokes) add nothing.
Answer at once, compactly: no prose, no explanation, and leave out any field that is empty or null.`;

/** The example family, for every part. It is not any test family: an example copied into the answer is caught by the quote check. */
const EXAMPLE = `Example (another family). household: people Rahul (adult), Divya (adult, wife), Tara (8), Lalitha (72, Divya's mother); help: cook Savita Mon-Fri 8am.
Q: Savita cooks Breakfast and Lunch at 8am. Is that right? A1: yes, and she comes back at 5 for dinner
Q: Is food cooked at home on weekends? A2: Saturday Divya cooks everything. Sunday we go to my in-laws for lunch, dinner we order from Zomato. We all have a snack at 5
A3: oh and Savita comes at 8:30 actually
Q: Any food rules? A4: we're eggetarian, eggs fine but no meat. Amma doesn't eat onion or garlic, and she fasts on Saturdays till sunset. Brown rice is better for her, and less oil.
Q: Tara's tiffin? A5: Mon-Fri, sandwiches or poha, school says no peanuts. Divya has ragi malt for breakfast
Q: Which grocery app? A6: Blinkit. Milk comes from Country Delight every morning`;
const NOT_THE_EXAMPLE = "That family is only an example: write what THIS family said, nothing from the example.";

const HOME_PART = `Write this part: who eats at home, the cook, who cooks when the cook does not come, extra meals, meals ordered in, shopping.
- people: everyone who eats at home: name exactly as the family writes it, group child (under 18) | adult | elder (60 and over, or a grandparent), age when said, relationship to the speaker when said or clear ("my father": "father"; "my wife": "wife").
- cook: the paid cook, or null. days as Mon..Sun. visits: each time they come, "HH:MM" 24-hour, with the meals (Breakfast, Lunch, Dinner) that visit makes ("breakfast and lunch in the morning, dinner at 6pm" is two visits; times ["7am", "6pm"] with meals Breakfast, Lunch, Dinner is the same two visits). A corrected time ("actually she comes at 7:30") changes only the visit it is nearest to; the other visit stays. timeLimit: their time limit in the family's words. newRecipes: open (tries new recipes from reels, videos) or set_menu (sticks to familiar dishes, even if one new dish now and then). note: anything else about the cook (what they will not cook, what they are not good at).
- Every day of the week is planned and cooked at home: a day the cook does not come, the family cooks. Only a meal the family says is eaten out or ordered in is not cooked (orderIn). Never leave a day or a meal out because the cook is off or because the family did not mention it.
- homeCook: on days the cook does not come, who of the family cooks which meals ({ day, slots, by, note }), when said.
- slots: only meals the family names besides Breakfast, Lunch and Dinner: a child's school tiffin ("<child>'s tiffin", for that child; a tiffin named anywhere, even only in a rule, is a slot), an evening snack ("Evening snack"). Food eaten at home after school is that child's Lunch, not a slot. days: the weekdays it is eaten (empty: every day). for: the people the family names for it, by name ("Asha and Ravi have a snack at 5": for ["Asha", "Ravi"]); a meal said without names is everyone's ("we all have a snack"): for empty, even when it was said in an answer about the adults or the children. quote: the family's words that name it, copied from an A line; a meal the family never named is no slot.
- orderIn: every regular meal not cooked at home because it is ordered in or eaten out: { day, slot, note: "eaten out" or "ordered from Swiggy" }. "Sunday lunch we eat out" is orderIn { Sun, Lunch, "eaten out" } only: Sunday's other meals are still cooked. "We don't cook on Sunday, we go to my parents'" is all three Sunday meals.
- groceryApps: main and fallback, each one of zepto, swiggy-instamart, zomato-blinkit, bigbasket, amazon, or null.
- subscriptions: what comes on a subscription: { item, source, note } ("milk", "Country Delight", "1 litre every morning").
- meals: what each meal looks like in this home, in the family's own words, from their answers about what they eat: { slot, group, words }. slot: Breakfast, Lunch, Dinner, a child's tiffin as "<child>'s tiffin", "Evening snack". group: "children" or "adults" when the family described that meal for the two apart (one entry each), else left out. words: copied character for character from ONE A line, the part of it about that meal only, all of that part (what the meal is made of, what comes back on which days). Never your own words; a meal the family did not describe has no entry.
Food rules and dishes are not this part: other readers write them.`;
const HOME_EXAMPLE = `gives people [{ Rahul, adult }, { Divya, adult, wife }, { Tara, child, 8 }, { Lalitha, elder, 72, mother-in-law }], cook { name "Savita", days Mon..Fri, visits [{ at "08:30", meals [Breakfast, Lunch] }, { at "17:00", meals [Dinner] }] }, homeCook [{ day Sat, slots [Breakfast, Lunch, Dinner], by "Divya" }], orderIn [{ Sun, Lunch, "eaten out" }, { Sun, Dinner, "ordered from Zomato" }] (Sunday breakfast is still cooked at home: nobody said otherwise), slots [{ "Tara's tiffin", Mon..Fri, ["Tara"], quote "Tara's tiffin" }, { "Evening snack", quote "a snack at 5" (no names: everyone, for left out) }], groceryApps { main zomato-blinkit }, subscriptions [{ milk, Country Delight, every morning }], meals [{ "Tara's tiffin", words "sandwiches or poha" }].`;

const RULES_PART = `Write this part: the family's food rules.
- rules: the family's food rules, one per thing they said: what must or must not be eaten. What someone usually eats ("milk every morning", "khichdi when she's unwell") is no rule: it is a dish, or nothing. kind is one of:
  veg (vegetarian home) | no_eggs ("vegetarian, no eggs" is two rules: veg and no_eggs) | avoid { items, who?, days?, slots? } (no dish with these) | swap { who, items, to, often? } (who has "to" in place of items: "brown rice in place of rice", items ["@white_rice"], to "brown rice") | only { who, items, slots? } | require { slots, items, often? } | cap { per_meal, slots? } (at most per_meal dishes to cook in a meal: a cook's time limit) or cap { items, per_week } | fasting { who, days, slots } (who eats nothing at those meals on those days: "fasts Monday till evening" is slots ["Breakfast","Lunch"]) | other { note, often? } (anything else: "less salt", "less oil", "less spicy for the child", a cook's limit with no number). "Less rice" is other { who, note "less rice" } (a smaller portion of rice), not a swap.
  Hard or soft: a hard rule holds at every meal: allergies, vegetarian, no eggs, days without meat, fasts, avoid, "no sugar", "never". A soft wish, said loosely ("X is good for her", "X is better for him", "more fruit", "try to", "something light at night", "sometimes"), is kept some meals of the week, not every one: give it often (only on swap, require or other): usually (most days) | sometimes (a few times a week; any "good for" / "better" / "try to") | rarely (once in a while, occasionally); or per_week when the family gave a number ("fruit three times a week": 3). Never often on a hard rule.
  items are plain foods ("mushroom", "rice") or categories: ${CATEGORY_LIST}. "No sugar" / "no sweets" is always avoid ["@sweet"] (hard, also when said with "diabetic"); "no nuts" is avoid ["@nuts"]; "no rice at night" is avoid ["@white_rice"] at slots ["Dinner"].
  "Less X" ("less oil", "less salt", "less spicy", "not too spicy") and a diet ("high protein", "low carb", "soft food") are other { who, note }: never avoid, only or cap.
  A food that is good or better for someone ("millets are good for him") is a soft swap or require with often "sometimes": never unplaced.
  veg is vegetarian: no meat, fish or eggs. A family or person that eats eggs is egg; "eggs are fine" is no rule against eggs. One person's "pure vegetarian" is veg { who } (and no_eggs { who } when they also said no eggs).
  Meat on some days only: "chicken only on weekends" is avoid ["@meat", "@fish"] on days [Mon..Fri]; "non-veg only at Sunday lunch" is avoid ["@meat", "@fish"] on [Mon..Sat] plus avoid ["@meat", "@fish"] on [Sun] at slots ["Breakfast", "Dinner"]. Never veg for every day, never only.
  who is one person's name as the family writes it, someone who eats at home; leave it out for the whole house. What the cook or other help will not cook is no rule here: another reader writes it with the cook. days are Mon..Sun, left out for every day; slots are meal names (Breakfast, Lunch, Dinner, a child's school tiffin as "<child>'s tiffin", an evening snack as "Evening snack"), left out for every meal.
  quote: the family's exact words this rule comes from, copied character for character from one A line or household fact (a short span, e.g. "no mushrooms"). Never from a Q: line, never your own words: when the app read a rule back ("Nani eats no sugar, jaggery") and the family said it was right, quote the A line where the family first said it ("no sugar"). No quote, no rule.
- unplaced: a food wish of the family's that is no rule and is not about who eats, the cook, meal times, dishes, shopping apps or subscriptions (other readers take those): { text, quote }. Usually none.`;
const RULES_EXAMPLE = `gives rules [{ egg, quote "eggs fine but no meat" }, { avoid, who "Lalitha", items ["onion","garlic"], quote "doesn't eat onion or garlic" }, { fasting, who "Lalitha", days [Sat], slots [Breakfast, Lunch], quote "fasts on Saturdays till sunset" }, { swap, who "Lalitha", items ["@white_rice"], to "brown rice", often "sometimes", quote "Brown rice is better for her" }, { other, who "Lalitha", note "less oil", quote "less oil" }, { avoid, items ["@peanut"], slots ["Tara's tiffin"], quote "no peanuts" }].`;

const DISHES_PART = `Write this part: the family's own dishes, from their answers (the past week's meals, a child's tiffin, what someone has for a meal). No drinks (tea, coffee, milk, juice).
- dishes: each dish as a row [name, meals, who, how_often]:
  name: plain ("Idli", "Rajma chawal"). A meal told as its parts ("rice, dal, a dry sabzi, curd") is each part a dish of that meal: ["Rice", "Lunch", ""], ["Dal", "Lunch", ""], ["Dry sabzi", "Lunch", ""], ["Curd", "Lunch", ""]; "sambar or dal" is two dishes.
  meals: the meal it is eaten at: Breakfast, Lunch, Dinner, a child's school tiffin as "<child>'s tiffin", an evening snack as "Evening snack"; two meals as "Breakfast, Dinner".
  who: the people it is theirs, by their name in household.people, ONLY when the reply itself says it is one person's or some people's ("Father had ragi dosa", "jowar roti for my mother", "oats for Papa", "khichdi when she's unwell" said of a child: that person; two as "Asha, Ravi"). A family word is the person of that relationship in household.people: Amma, Ma, Mummy, "my mother" is the mother; Appa, Papa, Baba, Nanna is the father; Nani, Dadi, Paati, Ajji is the grandmother (the speaker's mother or mother-in-law). Otherwise "": the whole house eats it.
  how_often: how often the family has it, from their own words about that dish, else "": "usually" (most days, most nights, daily, every morning), "sometimes" (sometimes, "when she's unwell", "when he's tired", now and then), "rarely" (once in a while, occasionally), the number of days a week when they gave a count ("twice": "2", "once": "1", "three times": "3"), the weekdays when they named days ("on Friday" / "Fridays": "Fri", "weekends" / "weekend X" / "on Saturday and Sunday": "Sat, Sun", "Mon-Fri": "Mon, Tue, Wed, Thu, Fri"); a count and days together as "1, Sat". A dish named in two answers with different days is every day named. Only words said with that dish: a dish said with no such word is "".
  A question about the children or about the adults only splits the asking: a dish named in the answer about the adults is not the adults' only, and one in the answer about a child is not that child's only, unless the reply names who. "Same as us" / "same as the adults" means the same dishes for everyone. A dish named in two answers is one dish for everyone, unless every reply that names it names who.`;
const DISHES_EXAMPLE = `More of that family's answers (Q: What do the adults eat for lunch? A7: rice, rasam or dal, a poriyal, curd. Pulao twice, and puri on Sundays. Amma has the same, less rice, and bajra roti at night. Q: Tara's dinner? A8: same as us, roti with dal or a sabzi most nights, less spicy. Khichdi when she's unwell.)
gives dishes [["Sandwich", "Tara's tiffin", "", ""], ["Poha", "Tara's tiffin", "", ""], ["Ragi malt", "Breakfast", "Divya", ""], ["Rice", "Lunch", "", ""], ["Rasam", "Lunch", "", ""], ["Dal", "Lunch, Dinner", "", ""], ["Poriyal", "Lunch", "", ""], ["Curd", "Lunch", "", ""], ["Pulao", "Lunch", "", "2"], ["Puri", "Lunch", "", "Sun"], ["Roti", "Dinner", "", "usually"], ["Sabzi", "Dinner", "", ""], ["Khichdi", "Dinner", "Tara", "sometimes"], ["Bajra roti", "Dinner", "Lalitha", ""]] (no milk: a drink; the lunch in the answer about the adults names no one, so it is everyone's; "less rice" is a rule, not a dish; "Amma" is Lalitha, Divya's mother).`;

const systemOf = (part: string, example: string) => `${COMMON}\n\n${part}\n\n${EXAMPLE}\n${example}\n${NOT_THE_EXAMPLE}`;

/** The three readers. `need`: the setup fails without this part; a part not needed may come back empty (said, not saved). */
export const SETUP_PARTS = [
  { id: "home", purpose: "setup: the home", system: systemOf(HOME_PART, HOME_EXAMPLE), schema: HOME_SCHEMA, maxTokens: 6000, need: true },
  { id: "rules", purpose: "setup: the food rules", system: systemOf(RULES_PART, RULES_EXAMPLE), schema: RULES_SCHEMA, maxTokens: 6000, need: true },
  { id: "dishes", purpose: "setup: the dishes", system: systemOf(DISHES_PART, DISHES_EXAMPLE), schema: DISHES_SCHEMA, maxTokens: 6000, need: false },
] as const;
/** Every reader's prompt, for the checks on model-facing text. */
export const SETUP_SYSTEM = SETUP_PARTS.map((p) => p.system).join("\n\n");

/** The whole read's wall clock, both tries of every part included: under Flock's wait for the op (runner/setup-apply.ts,
 *  3 min), so a slow read is said as failed by the app, never cut off by Flock. A part's second try starts only with at
 *  least RETRY_FLOOR_MS left. */
export const SETUP_BUDGET_MS = 150_000;
const RETRY_FLOOR_MS = 30_000;
/** How long the whole dishes read goes alone before the reads by halves start beside it. */
const DISHES_HEDGE_MS = 45_000;
/** The dishes' second try: two reads at once, each for these meals. */
const DISH_HALVES = ["Breakfast, a child's school tiffin and an evening snack", "Lunch and Dinner"];
const DISH_HALF_TOKENS = 4000;

// ── Reading the model's answer leniently ──

type Visit = { at: string; meals?: string[] };
export type Profile = {
  meals: { slot: string; group?: "children" | "adults"; words: string }[];
  people: { name: string; group: string; age?: number; relationship?: string }[];
  cook: { name: string; days: Weekday[]; visits: Visit[]; timeLimit?: string; newRecipes?: "open" | "set_menu"; note?: string } | null;
  homeCook: { day: Weekday; slots: string[]; by: string; note?: string }[];
  slots: { name: string; days: Weekday[]; for: string[]; quote?: string }[];
  orderIn: { day: Weekday; slot: string; note?: string }[];
  rules: SetupRule[];
  dishes: { name: string; slots: string[]; for: string[]; often?: string }[];
  groceryApps: { main: string | null; fallback: string | null };
  subscriptions: { item: string; source: string; note?: string }[];
  unplaced: { text: string; quote?: string }[];
};
export type SetupRule = { kind: string; who?: string; days?: string[]; slots?: string[]; items?: string[]; to?: string; per_meal?: number; per_week?: number; often?: string; note?: string; quote: string };

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

/** A list written as one string ("Breakfast, Dinner"; "" is none) or as a list. */
const listOf = (v: unknown): string[] => (typeof v === "string" ? v.split(/\s*[,;/|]\s*|\s+and\s+/) : strs(v)).map(str).filter(Boolean);
/** The dish rows of a reader's answer: its `dishes`, or (an answer a little off) its one list under another name, or the
 *  answer itself when it is a list. */
export function dishRowsOf(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (!isObject(json)) return [];
  if (Array.isArray(json.dishes)) return json.dishes;
  const lists = Object.values(json).filter(Array.isArray);
  return lists.length === 1 ? lists[0] : [];
}
/** A dish as its row [name, meals, who, how often], or as an object { name, slots, for, often }. */
function dishOf(d: unknown): Profile["dishes"][number] | null {
  const [name, slots, who, often] = Array.isArray(d) ? d : isObject(d) ? [d.name, d.slots ?? d.meals, d.for ?? d.who, d.often ?? d.how_often] : [];
  return str(name) ? { name: str(name), slots: listOf(slots), for: listOf(who), ...(str(often) ? { often: str(often) } : {}) } : null;
}

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
    homeCook: arr(j.homeCook).filter(isObject).flatMap((h) => daysOf(h.day).map((day) => ({ day, slots: strs(h.slots), by: str(h.by), ...opt("note", h.note) }))),
    slots: arr(j.slots).filter(isObject).filter((s) => str(s.name)).map((s) => ({ name: str(s.name), days: daysOf(s.days), for: strs(s.for), ...opt("quote", s.quote) })),
    orderIn: arr(j.orderIn).filter(isObject).flatMap((o) => daysOf(o.day).map((day) => ({ day, slot: str(o.slot), ...opt("note", o.note) }))),
    rules: arr(j.rules).filter(isObject).map((r) => ({ kind: kindOf(r.kind), ...opt("who", r.who), ...(strs(r.days).length ? { days: strs(r.days) } : {}),
      ...(strs(r.slots).length ? { slots: strs(r.slots) } : {}), ...(strs(r.items).length ? { items: strs(r.items) } : {}), ...opt("to", r.to),
      ...(num(r.per_meal) !== undefined ? { per_meal: num(r.per_meal) } : {}), ...(num(r.per_week) !== undefined ? { per_week: num(r.per_week) } : {}),
      ...opt("often", str(r.often).toLowerCase()), ...opt("note", r.note), quote: str(r.quote) })),
    dishes: arr(j.dishes).map(dishOf).filter((d): d is Profile["dishes"][number] => !!d),
    groceryApps: { main: isObject(j.groceryApps) ? str(j.groceryApps.main) || null : null, fallback: isObject(j.groceryApps) ? str(j.groceryApps.fallback) || null : null },
    subscriptions: arr(j.subscriptions).filter(isObject).filter((s) => str(s.item)).map((s) => ({ item: str(s.item), source: str(s.source), ...opt("note", s.note) })),
    unplaced: arr(j.unplaced).filter(isObject).filter((u) => str(u.text)).map((u) => ({ text: str(u.text), ...opt("quote", u.quote) })),
    meals: arr(j.meals).filter(isObject).filter((m) => str(m.slot) && str(m.words)).map((m) => {
      const g = str(m.group).toLowerCase();
      return { slot: str(m.slot), ...(g === "children" || g === "adults" ? { group: g as "children" | "adults" } : {}), words: str(m.words) };
    }),
  };
}

// ── What the family said: the quote check ──

/** Lower case, letters and digits only, one space between words. */
export const plainWords = (s: string): string => s.toLowerCase().replace(/[’']/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Every line the family said, as written: the transcript's replies (A:) and every text value of the household facts. */
function familyText(transcript: string[], household: unknown): string[] {
  const out = transcript.filter((l) => /^A\d*:/i.test(l)).map((l) => l.replace(/^A\d*:\s*/i, ""));
  const walk = (v: unknown): void => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (isObject(v)) Object.values(v).forEach(walk);
  };
  walk(household);
  return out;
}
/** Every line the family said, in plain words. */
export function familyLines(transcript: string[], household: unknown): string[] {
  return familyText(transcript, household).map(plainWords).filter(Boolean);
}
/** Every sentence or clause the family said, in plain words: "Same as Ravi most days - idli, dosa" is two, so a dish is not
 *  taken as the person named in the clause before it. */
export function familyClauses(transcript: string[], household: unknown): string[] {
  return familyText(transcript, household).flatMap((l) => l.split(/[.;:!?\n—–]+|\s-\s/)).map(plainWords).filter(Boolean);
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

const RETRY_CODES: string[] = ["invalid_output", "unavailable", "timeout"];
/** A model call that answers by `ms` or is a timeout. The call itself is not stopped (the SDK takes no signal): its answer,
 *  if it comes, is not waited for. */
async function withDeadline(call: Promise<ModelResult>, ms: number): Promise<ModelResult> {
  if (ms <= 0) return { ok: false, code: "timeout", message: "no time left for the setup" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<ModelResult>((resolve) => { timer = setTimeout(() => resolve({ ok: false, code: "timeout", message: `no answer in ${Math.round(ms / 1000)} s` }), ms); });
  try { return await Promise.race([call, late]); } finally { clearTimeout(timer); }
}

/** One write through the app's own route: its answer, or its refusal's reason. */
type Post = (path: string, body: unknown) => Promise<{ ok: true; body: any } | { ok: false; reason: string }>;

/** A drink is not a dish the week is planned from (sim: "milk every morning" became a dish for everyone, fasting father too). */
/** Dishes served with most meals: never one person's because a reply about them named it ("father has two phulkas"). */
const STAPLES = new Set<string>(STAPLE_DISHES);
const DRINKS = /^\s*(milk|warm milk|tea|chai|coffee|filter coffee|juice|water|buttermilk|lassi|horlicks|bournvita|boost)\s*$/i;

const GROUP_WORDS: Record<string, (p: { group: string }) => boolean> = {
  adults: (p) => p.group === "adult", adult: (p) => p.group === "adult", parents: (p) => p.group === "adult",
  children: (p) => p.group === "child", kids: (p) => p.group === "child", child: (p) => p.group === "child", kid: (p) => p.group === "child",
  elders: (p) => p.group === "elder", elder: (p) => p.group === "elder", grandparents: (p) => p.group === "elder",
};
const EVERYONE = /^(everyone|everybody|all|the house|the family|whole family|family|whole house|us|we|all of us)$/i;

/** What a family calls its people (eval 23 Nov: "ragi dosa for Amma", "dalia for Papa" saved as everyone's, the word
 *  matching no one): each word, plain, with the relationships to the speaker it may be, nearest first. A grandparent word is
 *  also the speaker's own parent or parent-in-law (the children's grandparent). */
const KIN: Record<string, string[]> = {};
const kin = (words: string, rels: string[]) => { for (const w of words.split(" ")) KIN[w] = rels; };
kin("amma ma maa mummy mumma mummyji mom mommy mum mother aai ammi mataji", ["mother", "mother in law"]);
kin("appa papa pappa nanna baba bapu pitaji dad daddy father achan abba babuji", ["father", "father in law"]);
kin("nani dadi paati patti ajji ammamma nanamma aaji thakuma dida grandma granny grandmother", ["grandmother", "mother", "mother in law"]);
kin("nana dada thatha tata thata ajja ajoba aajoba dadu thakurda grandpa grandfather", ["grandfather", "father", "father in law"]);
kin("wife biwi patni missus", ["wife"]);
kin("husband pati hubby", ["husband"]);
kin("son beta", ["son"]);
kin("daughter beti", ["daughter"]);
kin("saasu saasuma", ["mother in law"]);
kin("sasur", ["father in law"]);
const BASE_RELS = new Set(["mother", "father", "wife", "husband", "son", "daughter", "grandmother", "grandfather"]);
/** A relationship however it was written ("Mother-in-law", "mom"), plain: "mother in law", "mother". */
const relOf = (r: string): string => { const p = plainWords(r); return !p.includes(" ") && KIN[p] && BASE_RELS.has(KIN[p][0]) ? KIN[p][0] : p; };

/** The family words that may name a person of this relationship: "mother" is amma, mummy, ma... and grandmother words too. */
function kinWordsOf(relationship: string): string[] {
  const r = relOf(relationship);
  if (!r) return [];
  return [r, ...Object.entries(KIN).filter(([, rels]) => rels.includes(r)).map(([w]) => w)];
}

/** The person a family word names, by relationship (nearest first), or for a grandparent word the one elder when no
 *  relationship says. Never a guess between two. */
export function personByKin(word: string, family: { name: string; group: string; relationship?: string }[]): string | null {
  let w = plainWords(word).replace(/^(my|our) /, "");
  if (!KIN[w] && w.endsWith("s") && KIN[w.slice(0, -1)]) w = w.slice(0, -1);   // "Ammas" (Amma's)
  const rels = KIN[w] ?? (Object.values(KIN).some((x) => x.includes(w)) ? [w] : null);
  if (!rels) return null;
  for (const r of rels) {
    const hit = family.filter((p) => p.relationship && relOf(p.relationship) === r);
    if (hit.length === 1) return hit[0].name;
    if (hit.length > 1) return null;
  }
  if (rels[0] === "grandmother" || rels[0] === "grandfather") {
    const elders = family.filter((p) => p.group === "elder");
    return elders.length === 1 ? elders[0].name : null;
  }
  return null;
}

/** Read the setup and write it. `post` writes through the app's own routes (validation, change events and the writer's stamp
 *  stay theirs). Never refuses the whole: what does not fit is in `noted` and what was not said is in `dropped`. */
export async function applySetup(deps: { db: Db; model: ModelCall; post: Post; household: unknown; transcript: string[]; log?: (l: string) => void; budgetMs?: number }): Promise<SetupResult> {
  const log = deps.log ?? ((l: string) => console.log(`[planner] apply_setup: ${l}`));
  // The family's replies numbered (A1:, A2:, ...): the model quotes them, not the questions.
  let n = 0;
  const numbered = deps.transcript.map((l) => (/^A\d*:/i.test(l) ? `A${++n}: ${l.replace(/^A\d*:\s*/i, "")}` : l));
  const user = JSON.stringify({ household: deps.household ?? {}, transcript: numbered.join("\n") });
  // The three readers at once, each tried once more on its own when it did not answer or did not fit, while time is left.
  const t0 = Date.now(), until = t0 + (deps.budgetMs ?? SETUP_BUDGET_MS);
  let dishesHalf = "";
  /** The dishes are the longest answer (eval 23 Nov: 0 of 23 dishes once, at the whole budget; an answer with no rows once):
   *  when the whole read has given no rows after DISHES_HEDGE_MS, or failed, two shorter reads start at once, each for half
   *  the meals, and the first usable answer is taken (the whole, or the halves joined). */
  const readDishes = async (part: (typeof SETUP_PARTS)[number]): Promise<ModelResult> => {
    const call = (system: string, maxTokens: number, purpose: string) => withDeadline(deps.model({ tier: "balanced", purpose, system, user, schema: part.schema, maxTokens }), until - Date.now())
      .then((r): ModelResult => (!r.ok || dishRowsOf(r.json).length ? r : { ok: false, code: "invalid_output", message: "no dishes in the answer" }));
    const whole = call(part.system, part.maxTokens, part.purpose);
    const first = await Promise.race([whole, new Promise<null>((res) => setTimeout(() => res(null), Math.max(0, Math.min(DISHES_HEDGE_MS, until - Date.now() - RETRY_FLOOR_MS))))]);
    if (first?.ok) return first;
    if (first && (!RETRY_CODES.includes(first.code) || until - Date.now() < RETRY_FLOOR_MS)) return first;
    log(`dishes: ${first ? `model ${first.code}: ${first.message.slice(0, 300)}` : "no answer yet"}; reading by halves`);
    const halves = Promise.all(DISH_HALVES.map((meals) => call(`${part.system}\n\nWrite only the dishes of ${meals} now: another reader writes the other meals' dishes.`, DISH_HALF_TOKENS, `${part.purpose} (${meals})`)))
      .then((hs): ModelResult => {
        const ok = hs.filter((h): h is Extract<ModelResult, { ok: true }> => h.ok);
        if (!ok.length) return hs[0];
        if (ok.length < hs.length) dishesHalf = DISH_HALVES[hs.findIndex((h) => !h.ok)];
        return { ok: true, json: { dishes: ok.flatMap((h) => dishRowsOf(h.json)) }, model: ok[0].model };
      });
    // The first usable answer; both failed: the halves' failure.
    return new Promise<ModelResult>((resolve) => {
      let left = 2;
      for (const pr of [whole, halves]) pr.then((r) => { if (r.ok) { if (pr === whole) dishesHalf = ""; resolve(r); } else if (--left === 0) resolve(r); });
    });
  };
  const results = await Promise.all(SETUP_PARTS.map(async (part): Promise<ModelResult> => {
    let r: ModelResult;
    if (part.id === "dishes") r = await readDishes(part);
    else {
      const ask = () => withDeadline(deps.model({ tier: "balanced", purpose: part.purpose, system: part.system, user, schema: part.schema, maxTokens: part.maxTokens }), until - Date.now());
      r = await ask();
      if (!r.ok && RETRY_CODES.includes(r.code) && until - Date.now() >= RETRY_FLOOR_MS) {
        log(`${part.id}: model ${r.code}: ${r.message.slice(0, 300)}; asking once more`);
        r = await ask();
      }
    }
    log(`${part.id}: model ${r.ok ? `ok (${r.model})` : `${r.code}: ${r.message.slice(0, 300)}`} in ${Date.now() - t0} ms`);
    return r;
  }));
  const failed = SETUP_PARTS.map((part, i) => ({ part, r: results[i] })).filter((x) => x.part.need && !x.r.ok);
  if (failed.length) {
    const r = failed[0].r as Extract<ModelResult, { ok: false }>;
    return { ok: false, reason: r.code, say: "I couldn't save the setup just now. Tell me \"save my setup\" in a little while; nothing you told me is lost." };
  }
  const jsonOf = (id: string) => { const r = results[SETUP_PARTS.findIndex((x) => x.id === id)]; return r.ok && isObject(r.json) ? r.json : null; };
  const home = jsonOf("home") ?? {}, rulesRead = jsonOf("rules") ?? {}, dishesRead = jsonOf("dishes");
  const model = (results[0] as Extract<ModelResult, { ok: true }>).model;
  const p = profileOf({ ...home, rules: rulesRead.rules, unplaced: rulesRead.unplaced, dishes: dishesRead ? dishRowsOf(dishesRead) : [] });
  const noted: string[] = [], dropped: string[] = [];
  // The dishes are the one part the setup goes on without: the plan then starts from common dishes, and that is said.
  if (!dishesRead) noted.push("your dishes could not be read just now: tell me a few you like and I'll add them");
  else if (dishesHalf) noted.push(`your dishes of ${dishesHalf} could not be read just now: tell me a few you like and I'll add them`);
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
  /** A name as on the Family page: exact, a first name ("Gowri"), a relationship ("father"), a family word ("Amma", "my
   *  mother", "Nani": by relationship, eval 23 Nov), or close enough. */
  const speaker = isObject(deps.household) ? str(deps.household["household.speaker"] ?? deps.household.speaker) : "";
  const strictPerson = (w: string): string | null => {
    const t = w.trim().replace(/^(my|our)\s+/i, "");
    if (!t) return null;
    if (speaker && /^(me|i|myself|self)$/i.test(t)) return names.find((n) => same(n, speaker)) ?? null;
    return names.find((n) => same(n, t)) ?? names.find((n) => same(n.split(/\s+/)[0], t) || same(t.split(/\s+/)[0], n))
      ?? family.find((x) => x.relationship && relOf(x.relationship) === relOf(t))?.name ?? personByKin(t, family);
  };
  const personOf = (w: string): string | null => strictPerson(w) ?? closest(w.trim().replace(/^(my|our)\s+/i, ""), names);
  /** The words (plain) a line may name this person by: their name, first name, relationship, the family's words for that
   *  relationship (Amma, Papa, Nani), and "I"/"me" for the speaker. */
  const refsOf = (name: string): string[] => {
    const fam = family.find((x) => x.name === name);
    if (!fam) return [];
    const kinWords = fam.relationship && relOf(fam.relationship) !== "self" ? kinWordsOf(fam.relationship).filter((w) => personByKin(w, family) === fam.name) : [];
    return [...new Set([plainWords(fam.name), plainWords(fam.name).split(" ")[0], ...kinWords,
      ...(speaker && same(fam.name, speaker) ? ["i", "me", "my", "myself", "im", "ive", "id"] : [])])].filter(Boolean);
  };
  // "Ammas" (Amma's) names Amma; "is" never names "I".
  const has = (l: string, r: string) => ` ${l} `.includes(` ${r} `) || (r.length >= 3 && ` ${l} `.includes(` ${r}s `));
  /** The person last named in a stretch of plain words: who a "he"/"she" after it is. */
  const lastNamed = (text: string): string | null => {
    let best: { at: number; name: string } | null = null;
    for (const f of family) for (const r of refsOf(f.name)) {
      const m = [...` ${text} `.matchAll(new RegExp(` ${r}${r.length >= 3 ? "s?" : ""} `, "g"))].pop();
      if (m && (!best || m.index! > best.at)) best = { at: m.index!, name: f.name };
    }
    return best?.name ?? null;
  };
  const PRONOUN = / (he|hes|him|his|she|shes|her) /;
  /** Each reply in plain words after the question it answers, and its sentences. */
  const askedClauses: { reply: string; clauses: string[] }[] = [];
  { let q = ""; for (const l of deps.transcript) {
    if (/^Q:/i.test(l)) { q = plainWords(l.slice(2)); continue; }
    if (!/^A\d*:/i.test(l)) continue;
    const raw = l.replace(/^A\d*:\s*/i, "");
    askedClauses.push({ reply: `${q} ${plainWords(raw)}`.trim(), clauses: raw.split(/[.;:!?\n—–]+|\s-\s/).map(plainWords).filter(Boolean) });
  } }
  const asked = askedClauses.map((x) => x.reply);
  /** Does one of `lines` (plain words) name this person: their name, first name, relationship, family word or group word,
   *  "I"/"me" for the speaker, and with `pronouns` a "he"/"she" whose person, the one named last before it in the family's
   *  reply, is them ("Only one child, Rahul. He had idli", "curd rice when he's tired"). */
  const namedIn = (lines: string[], w: string, pronouns = false): boolean => {
    const t = plainWords(w);
    if (GROUP_WORDS[t]) return lines.some((l) => has(l, t));
    const n = personOf(w);
    const refs = [...new Set([t, ...(n ? refsOf(n) : [])])].filter(Boolean);
    if (lines.some((l) => refs.some((r) => has(l, r)))) return true;
    if (!pronouns || !n) return false;
    return lines.some((l) => {
      const at = PRONOUN.exec(` ${l} `);
      if (!at) return false;
      // The reply with the question before it ("What does Ishaan eat for dinner?" names who "he" is).
      const reply = asked.find((x) => x.includes(l)) ?? l;
      return lastNamed(`${reply.slice(0, Math.max(0, reply.indexOf(l)))} ${l.slice(0, at.index)}`) === n;
    });
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
    const days = p.cook.days.length ? p.cook.days : cookDaysOf(deps.household, p.cook.name);
    const body = { name: p.cook.name, ...(days.length ? { days } : {}), ...(visits.length ? { arrival: visits } : {}),
      ...(p.cook.timeLimit ? { time_limit: p.cook.timeLimit } : {}), ...(p.cook.newRecipes ? { new_recipes: p.cook.newRecipes } : {}), ...(p.cook.note ? { note: p.cook.note } : {}) };
    let res = await deps.post("/api/family/cook", body);
    if (!res.ok && visits.length) res = await deps.post("/api/family/cook", { ...body, arrival: visits.map((v) => v.at) });
    if (!res.ok) noted.push(`the cook ${p.cook.name}: not saved (${res.reason})`);
  }

  // 3. Extra meals, then the meals ordered in or eaten out. Every day is planned: there are no cooking days to save.
  for (const s of p.slots) {
    if (SLOTS.some((x) => same(x, s.name))) continue;
    // A meal the family never named is no slot (sim: an "Evening snack" in a family that never spoke of one).
    const kind = plainWords(s.name).split(" ").pop() ?? "";
    const hasKind = (l: string) => ` ${l} `.includes(` ${kind} `) || ` ${l} `.includes(` ${kind}s `);
    if (!saidByFamily(s.quote ?? "", said) && !said.some(hasKind)) {
      dropped.push(`the ${s.name} ("${s.quote ?? ""}"): not something the family said`); continue; }
    // Unnamed is everyone (owner, 23 Nov): a meal is only some people's when the family's line that names it names them too
    // (sim: "we have an evening snack", said in the answer about the adults, was saved as the adults' snack). A tiffin is the
    // school child's.
    const q = plainWords(s.quote ?? "");
    const lines = q.length >= 3 && said.some((l) => l.includes(q)) ? said.filter((l) => l.includes(q)) : said.filter(hasKind);
    const named = /tiffin|lunch ?box/i.test(s.name) ? s.for : s.for.filter((w) => namedIn(lines, w));
    if (named.length < s.for.length) noted.push(`${s.name}: no names said with it, so it is for everyone`);
    const who = whoOf(named.length === s.for.length ? s.for : []);
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
  // Only a meal the family says is eaten out or ordered in is not cooked: a day the cook does not come is cooked by the family,
  // every meal of it (owner, 23 Nov: "Needs to have a plan for Sunday"). A home-cook entry that says the meal is eaten out
  // or ordered is a meal ordered in (sim: { Sun, Lunch, by Ankita, "eaten out" }).
  const orderIn = [...p.orderIn];
  for (const h of p.homeCook.filter((x) => /eat(en|ing)? out|order|outside|restaurant/i.test(x.note ?? "")))
    for (const slot of h.slots) if (!orderIn.some((o) => o.day === h.day && same(o.slot, slot))) orderIn.push({ day: h.day, slot, note: h.note });
  p.homeCook = p.homeCook.filter((x) => !/eat(en|ing)? out|order|outside|restaurant/i.test(x.note ?? ""));
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
  // 4. Rules: each one alone, so one the app cannot take costs nothing else. Not said by the family: dropped.
  // First put right in code what readers get wrong (rulesFixed), and add what the family said that no reader wrote down.
  const fixedRules = rulesFixed(p.rules);
  p.rules = fixedRules.rules;
  for (const f of fixedRules.fixed) log(`rule fixed: ${f}`);
  /** Who a sentence of the family's is about: the one person it names, else (for "less rice, no sugar" after "Father is
   *  diabetic") the person named last before it in the reply or its question; "we"/"everyone" is the house (""). */
  const aboutWhom = (clause: string, reply: string): string | null => {
    let named = family.filter((f) => refsOf(f.name).some((r) => has(clause, r)));
    // "My father … he eats less rice": the "my" is not the speaker's own rule.
    if (named.length > 1 && speaker) named = named.filter((f) => !same(f.name, speaker));
    if (named.length === 1) return named[0].name;
    if (named.length > 1) return null;
    if (/(^| )(we|us|everyone|everybody|all of us|the house|at home)( |$)/.test(clause)) return "";
    return lastNamed(reply.slice(0, Math.max(0, reply.indexOf(clause)))) ;
  };
  // What a rule is about: its own note, items and swap, not the rest of the sentence it was quoted from ("no sweets, less
  // oil" quoted on the no-sweets avoid is no "less oil" rule).
  const ruleFor = (who: string, re: RegExp) => p.rules.some((r) => (who ? !!r.who && personOf(r.who) === who : !r.who)
    && re.test(plainWords(`${r.kind === "other" || r.kind === "fasting" ? r.note ?? r.quote : ""} ${(r.items ?? []).join(" ")} ${r.to ?? ""}`)));
  // A wish the rules reader left unplaced ("millets are good for father"): a soft rule for its person, some meals a week.
  for (const u of [...p.unplaced]) {
    const t = plainWords(u.text);
    if (!LOOSE_WISH.test(t) || !saidByFamily(u.quote ?? u.text, said)) continue;
    const reply = asked.find((x) => x.includes(plainWords(u.quote ?? u.text))) ?? t;
    const who = aboutWhom(t, reply);
    if (who === null) continue;
    const food = /^(?:more )?(.+?) (?:is|are) (?:good|better|healthy|healthier)\b/.exec(t)?.[1];
    p.rules.push(food ? { kind: "require", ...(who ? { who } : {}), items: [food], often: "sometimes", quote: u.quote ?? u.text }
      : { kind: "other", ...(who ? { who } : {}), note: u.text, often: "sometimes", quote: u.quote ?? u.text });
    p.unplaced = p.unplaced.filter((x) => x !== u);
    log(`unplaced wish kept as a soft rule: "${u.text}"`);
  }
  // What the family said and no reader wrote down (eval 23 Nov: "I'm on high protein", "less spicy" for a child, dropped;
  // "no sugar" once kept only as a plain note): a note for its person, and "no sugar" an avoid.
  const SOFT_SAID: [RegExp, RegExp][] = [[/\bhigh protein\b/, /protein/], [/\blow carbs?\b/, /carb/], [/\b(less|low) salt\b/, /salt/], [/\bless oil\b/, /oil/],
    [/\b(less|not too|mildly) spicy\b|\bless spice\b/, /spic|chilli|mild/], [/\bsoft food\b/, /soft|chew/], [/\bless ghee\b/, /ghee/], [/\bless rice\b/, /less rice|portion/]];
  for (const { reply, clauses: cs } of askedClauses) for (const clause of cs) {
    for (const [re, key] of SOFT_SAID) {
      const m = re.exec(clause);
      if (!m) continue;
      const who = aboutWhom(clause, reply);
      if (who === null || ruleFor(who, key)) continue;
      p.rules.push({ kind: "other", ...(who ? { who } : {}), note: m[0], quote: m[0] });
      log(`said, not read: "${m[0]}"${who ? ` for ${who}` : ""}`);
    }
    if (NO_SUGAR.test(clause)) {
      const who = aboutWhom(clause, reply);
      if (who !== null && !p.rules.some((r) => r.kind === "avoid" && r.items?.includes("@sweet") && (who ? !!r.who && personOf(r.who) === who : !r.who))) {
        const m = NO_SUGAR.exec(clause)![0];
        p.rules.push({ kind: "avoid", ...(who ? { who } : {}), items: ["@sweet"], quote: m });
        log(`said, not read: "${m}"${who ? ` for ${who}` : ""}`);
      }
    }
  }
  // The same avoid said for several people ("the three of us eat chicken only at Sunday lunch") is the house's when everyone
  // else already never eats those foods (the grandparents are vegetarian): one rule, as the family means it.
  const covers = (r: SetupRule, items: string[]) => {
    const c = r.kind === "veg" ? ["@meat", "@fish", "@egg"] : r.kind === "no_meat" || r.kind === "egg" ? ["@meat", "@fish"] : r.kind === "avoid" && !r.days?.length && !r.slots?.length ? r.items ?? [] : [];
    return items.every((i) => c.includes(i));
  };
  const avoidKey = (r: SetupRule) => JSON.stringify([r.items ?? [], r.days ?? [], r.slots ?? [], r.quote]);
  for (const key of new Set(p.rules.filter((r) => r.kind === "avoid" && r.who).map(avoidKey))) {
    const group = p.rules.filter((r) => r.kind === "avoid" && r.who && avoidKey(r) === key);
    if (group.length < 2) continue;
    const whos = new Set(group.map((r) => personOf(r.who!)));
    const rest = family.filter((f) => !whos.has(f.name));
    if (!rest.length || !rest.every((f) => p.rules.some((r) => r.who && personOf(r.who) === f.name && covers(r, group[0].items ?? [])))) continue;
    const { who: _, ...house } = group[0];
    p.rules = [...p.rules.filter((r) => !group.includes(r)), house];
    log(`"${house.quote}": one rule for the house (everyone else never eats ${(house.items ?? []).join(", ")})`);
  }
  const savedRules: (SetupRule & { saved_as: string })[] = [];
  // Who cooks on the cook's days off goes to the menu as a note on those meals (a family member cooking may want simpler dishes).
  const homeRules: SetupRule[] = p.homeCook.filter((h) => h.by).map((h) => ({ kind: "other", days: [h.day], ...(h.slots.length ? { slots: h.slots } : {}),
    note: homeCookNote(h), quote: "" }));
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
      // A soft wish is kept as often as the family said it (owner, 23 Nov): a frequency the family's words do not carry is
      // dropped, and the rule is kept every time (as said); a hard rule never has one.
      if ((SOFT_KINDS as readonly string[]).includes(rule.kind)) {
        const f = ruleOftenSaid(rule, said);
        if (f.per_week !== undefined) body.per_week = f.per_week; else if (f.often) body.often = f.often;
        if (f.dropped) dropped.push(`how often for "${rule.quote}" (${f.dropped}): not in the family's words, kept every time`);
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

  // 5. The family's dishes: one row a dish (a dish sent again takes the meals and eaters sent), then each alone. A dish of
  // Breakfast, Lunch or Dinner is someone's only when the family's sentence that names it names them (owner, 23 Nov: the
  // question's group only splits the asking; live run: the dishes of the answer about the adults saved as two people's).
  // A dish named in no sentence as read (renamed) keeps who the reader gave.
  const clauses = familyClauses(deps.transcript, deps.household);
  const replies = repliesWithQuestion(deps.transcript);
  // What a meal was is said in the answers about meals; a rule or a diet that names a food is no word on who eats a dish.
  const mealReplies = replies.some((r) => r.meal) ? replies.filter((r) => r.meal) : replies;
  const mealClauses = mealReplies.flatMap((r) => r.clauses);
  /** Who a reply says a dish is for, when the reader gave no one: "dalia for Papa", "jowar roti for Amma" (a "for" after the
   *  dish), or a reply about someone outside the question's group ("Amma had ragi dosa twice, ragi java thrice" in the answer
   *  about the adults; not "Riya had toast" in the answer about the children, and never a staple like roti). Only when every
   *  sentence naming the dish says whose it is (eval 23 Nov: four one-person dishes saved as everyone's). */
  const eatersSaid = (name: string): string[] => {
    const key = plainWords(name);
    const out = new Set<string>();
    let any = false;
    for (const r of mealReplies) for (const c of r.clauses) {
      if (!has(c, key)) continue;
      any = true;
      const forList = new RegExp(`(?:^| )${key}s?(?: [a-z]+){0,3}? for ((?:[a-z]+ ?)+)`).exec(c);
      const listed = forList ? peopleListed(forList[1]) : [];
      if (listed.length) { listed.forEach((x) => out.add(x)); continue; }
      const subj = /^([a-z]+(?: [a-z]+)?) (?:had|has|have|eats|ate|takes|took|gets|got)\b/.exec(c);
      const person = subj ? (strictPerson(subj[1]) ?? strictPerson(subj[1].split(" ")[0])) : null;
      const fam = family.find((x) => x.name === person);
      if (!fam || (speaker && same(fam.name, speaker)) || (r.group && fam.group === r.group) || STAPLES.has(key)) return [];
      out.add(fam.name);
    }
    return any && out.size < family.length ? [...out] : [];
  };
  /** A sentence in the answer about the children whose subject is a child ("Kabir had…", "He had…" after the child's
   *  name): the question's group answering, which says nothing of whose the dishes are. */
  const childAnswer = (r: { group: string | null; clauses: string[] }, c: string): boolean => {
    if (r.group !== "child" || / for [a-z]+/.test(c)) return false;
    const subj = /^([a-z]+(?: [a-z]+)?) (?:had|has|have|eats|ate|takes|took|gets|got)\b/.exec(c)?.[1];
    if (!subj) return false;
    const person = /^(he|she)$/.test(subj) ? lastNamed(r.clauses.slice(0, r.clauses.indexOf(c)).join(" ")) : strictPerson(subj) ?? strictPerson(subj.split(" ")[0]);
    return family.find((f) => f.name === person)?.group === "child";
  };
  /** The people a run of words names, in order, until a word that names no one: "me padma and arjun". */
  const peopleListed = (words: string): string[] => {
    const out: string[] = [];
    const ws = words.split(" ");
    for (let i = 0; i < ws.length; i++) {
      if (ws[i] === "and" || ws[i] === "my" || ws[i] === "our") continue;
      // A two-word name ("Gowri Shankar") first, then one word.
      const two = family.find((f) => plainWords(f.name) === `${ws[i]} ${ws[i + 1] ?? ""}`);
      const n = two?.name ?? strictPerson(ws[i]);
      if (!n) break;
      if (two) i++;
      out.push(n);
    }
    return [...new Set(out)];
  };
  const daysLines = familyText(deps.transcript, deps.household).map((l) => plainWords(rangesSpelled(l))).filter(Boolean);
  const daysClauses = familyText(deps.transcript, deps.household).flatMap((l) => rangesSpelled(l).split(/[.;:!?\n—–]+|\s-\s/)).map(plainWords).filter(Boolean);
  const rows: DishRow[] = [];
  for (const d of p.dishes) {
    if (DRINKS.test(d.name)) continue;
    const key = plainWords(d.name), withDish = clauses.filter((l) => has(l, key));
    if (d.for.length && withDish.length && d.slots.every((s) => SLOTS.some((x) => same(x, s)))) {
      const kept = d.for.filter((w) => EVERYONE.test(w.trim()) || namedIn(withDish, w, true));
      // A dish named in two answers about meals is everyone's unless every sentence naming it names who (the readers' own
      // rule); a staple (roti, rice) is never one person's because a reply about them named it ("father has two phulkas").
      const inMeals = mealReplies.flatMap((r) => r.clauses.filter((c) => has(c, key)).map((c) => ({ r, c })));
      if (kept.length < d.for.length) d.for = kept;
      else if (inMeals.some(({ c }) => !d.for.some((w) => namedIn([c], w, true)))) d.for = [];
      // "Kabir had poha and cornflakes" in the answer about the children is that answer, not Kabir's own dishes.
      else if (inMeals.length && inMeals.every(({ r, c }) => childAnswer(r, c))) d.for = [];
    }
    if (d.for.length && (STAPLES.has(key) || STAPLES.has(key.replace(/s$/, ""))) && d.slots.every((s) => SLOTS.some((x) => same(x, s)))) d.for = [];
    if (!d.for.length) d.for = eatersSaid(d.name);
    const found: (string | null)[] = [];
    for (const s of d.slots) found.push(await tiffinOf(s, d.for[0]));
    const slots = [...new Set(found.filter((s): s is string => !!s))];
    if (!slots.length) { noted.push(`${d.name}: no meal for it (${d.slots.join(", ")})`); continue; }
    const who = whoOf(d.for);
    // How often, as the family said it of this dish: each part kept only when a line naming the dish (or, for its days, its
    // last word: "weekend parathas" for Aloo paratha) carries its words; what the reader left out, read in code from the
    // family's own words next to the dish ("lemon rice on Friday", "sometimes uthappam", "chapati most nights").
    const head = headWord(key);
    const lines = daysLines.filter((l) => has(l, key) || (!!head && has(l, head)));
    const f = d.often ? dishOftenSaid(d.often, lines) : {};
    if (f.dropped) dropped.push(`how often for ${d.name} (${f.dropped}): not in the family's words`);
    const days = [...new Set([...(f.days ?? []), ...daysNextTo(key, head, daysClauses)])];
    if (!f.often && f.per_week === undefined) { const o = oftenNextTo(key, deps.transcript); if (o) f.often = o; }
    rows.push({ name: d.name, slots, who: who.names.length && !who.unknown.length ? who.names : null, ...(f.often ? { often: f.often } : {}),
      ...(f.per_week !== undefined ? { per_week: f.per_week } : {}), ...(days.length ? { days: WEEKDAYS.filter((x) => days.includes(x)) } : {}) });
  }
  // No dishes from a chat that told them is never silent: the plan would start from common dishes without saying so.
  if (dishesRead && !rows.length && deps.transcript.some((l) => /^Q:.*\b(breakfast|lunch|dinner|tiffin|dishes?)\b/i.test(l)))
    noted.push("no dishes could be read from your replies just now: tell me a few you like and I'll add them");
  for (const d of mergeDishes(rows, names)) {
    const res = await deps.post("/api/dish-book/family", { dishes: [{ name: d.name, slots: d.slots, ...(d.who ? { for: d.who } : {}),
      ...(d.often ? { often: d.often } : {}), ...(d.per_week !== undefined ? { per_week: d.per_week } : {}), ...(d.days?.length ? { days: d.days } : {}) }] });
    if (!res.ok) noted.push(`${d.name}: not saved (${res.reason})`);
  }

  // 5b. What each meal looks like here, in the family's own words (owner, 23 Nov: the week is planned in the family's own
  // shape of a meal; live run: every lunch one light dish where the family said "rice, sambar or dal, one dry sabzi, curd").
  // Only words the family said are kept.
  const examples: { slot: string; group?: string; words: string }[] = [];
  for (const m of p.meals) {
    if (!saidByFamily(m.words, said)) { dropped.push(`what ${m.slot} looks like ("${m.words}"): not the family's words`); continue; }
    const slot = await tiffinOf(m.slot);
    if (!slot) continue;
    examples.push({ slot, ...(m.group ? { group: m.group } : {}), words: m.words });
  }
  if (examples.length) {
    const res = await deps.post("/api/family/meal-examples", { examples });
    if (!res.ok) noted.push(`what your meals look like: not saved (${res.reason})`);
  }

  // 6. Shopping apps and subscriptions.
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
  return { ok: true, said: noted.length ? `${back}\nNoted, not checked by the planner:\n${noted.map((n) => `- ${n}`).join("\n")}` : back, noted, dropped, rules: savedRules, profile: p, model };
}

// ── Rules made right in code ──
// The rules reader is a model: these are the readings it has got wrong (Eval 1, 23 Nov), put right from the family's own
// words in the rule's quote.

/** "Eggs are fine", "we eat eggs": a no-eggs reading of these words is wrong, and vegetarian here means no meat, eggs fine. */
const EGGS_FINE = /\b(eggs? (?:are |is )?(?:also )?(?:fine|ok|okay|allowed)|(?:eat|have|take) eggs|eggetarian)\b/;
/** "No sugar", "no sweets at all", "sugar-free": a hard rule, whatever the reader made of it. */
const NO_SUGAR = /\b(no (?:sugar|sweets?|mithai|desserts?)|sugar free|without sugar|(?:never|not|doesnt|cant|dont) (?:eat |have |take )?(?:any )?(?:sugar|sweets?))\b/;
/** Words that make a wish soft ("less oil", "not too spicy"), and words that make it hard. */
const SOFT_WORDS = /\b(less|low|lower|reduce|reduced|lighter|light|not too|mild|little|cut down)\b/;
const HARD_WORDS = /\b(no|never|nothing|allergic|allergy|avoid|without|dont|doesnt|wont|cant)\b/;
/** Words a category is said by, for "less spicy" read as avoid @chilli. */
const ITEM_WORDS: Record<string, string> = { "@chilli": "chilli|chili|spicy|spice|spices|mirchi|masala", "@sweet": "sugar|sweet|sweets", "@white_rice": "rice", "@dairy": "dairy|milk|ghee" };
const NON_VEG = /\b(non ?veg|meat|chicken|mutton|fish|prawns?|seafood|eggs?)\b/;
const RED_MEAT = ["mutton", "lamb", "goat", "beef", "pork"];
/** Is a "wish" rule said loosely: "X is good for her", "better for him", "try to". */
const LOOSE_WISH = /\b(good for|better for|is good|are good|is better|are better|healthy for|healthier|try to)\b/;

/** The family's rules as read, put right in code: "less X" stays a note (never "never X"); "no sugar" is always a hard
 *  avoid; "eggs are fine" is never a no-eggs rule; non-veg "only on" some days is no non-veg on the other days (and at the
 *  day's other meals: "chicken only at Sunday lunch"); "red meat" is not chicken; a wish said loosely ("ragi is good for
 *  her") is kept some meals of the week. `fixed` says what changed, for the log. */
export function rulesFixed(rules: SetupRule[]): { rules: SetupRule[]; fixed: string[] } {
  const out: SetupRule[] = [], fixed: string[] = [];
  const say = (r: SetupRule, what: string) => fixed.push(`"${r.quote}": ${what}`);
  for (const r0 of rules) {
    let r: SetupRule = { ...r0 };
    const q = plainWords(`${r.quote} ${r.note ?? ""}`), quote = plainWords(r.quote);
    // Eggs fine.
    if (EGGS_FINE.test(quote) && (r.kind === "no_eggs" || (r.kind === "avoid" && (r.items ?? []).every((i) => i === "@egg" || /^eggs?$/.test(i))))) { say(r, "eggs are fine: no rule"); continue; }
    if (r.kind === "veg" && EGGS_FINE.test(quote)) { r = { ...r, kind: "egg" }; say(r, "vegetarian with eggs"); }
    // Non-veg only on some days or at one meal.
    const only = /\bonly\b/.test(quote) && NON_VEG.test(quote) && !/\b(only veg|veg only|pure veg)\b/.test(quote) ? daysIn(quote) : [];
    if (only.length && only.length < 7 && r.kind !== "fasting") {
      const items = /\b(non ?veg|meat|chicken|mutton|fish|prawns?|seafood)\b/.test(quote) ? ["@meat", "@fish"] : ["@egg"];
      const slots = SLOTS.filter((s) => new RegExp(`\\b${s.toLowerCase()}\\b`).test(quote));
      const off = WEEKDAYS.filter((d) => !only.includes(d));
      const base = { kind: "avoid", ...(r.who ? { who: r.who } : {}), items, quote: r.quote };
      if (off.length) out.push({ ...base, days: off });
      if (slots.length && slots.length < SLOTS.length) out.push({ ...base, days: only, slots: SLOTS.filter((s) => !slots.includes(s)) });
      say(r, `no ${items.join(", ")} on ${off.join(", ")}${slots.length ? ` (on ${only.join(", ")} only at ${slots.join(", ")})` : ""}`);
      continue;
    }
    // No sugar: a hard avoid. A rule about something else that also says it keeps its own and gains the avoid.
    if (NO_SUGAR.test(quote) && !(r.kind === "avoid" && r.items?.includes("@sweet"))) {
      const other = (r.items ?? []).some((i) => i !== "@sweet" && !/sugar|sweet/.test(i)) || !!r.to;
      const sweet: SetupRule = { kind: "avoid", ...(r.who ? { who: r.who } : {}), items: ["@sweet"], quote: r.quote };
      if (r.kind === "avoid" && !other) r = { ...r, items: [...(r.items ?? []), "@sweet"] };
      else if (other) { out.push(sweet); }
      else { r = sweet; }
      say(r0, "no sugar: avoid sweet things");
    }
    // Less X: a note, never "never X".
    if (["avoid", "only", "cap"].includes(r.kind) && SOFT_WORDS.test(quote)) {
      const words = (r.items ?? []).map((i) => ITEM_WORDS[i] ?? plainWords(i.replace(/^@/, "")).replace(/_/g, " ")).join("|");
      const softRe = new RegExp(`\\b(?:less|low|lower|reduce|reduced|lighter|not too|mild|little)(?: [a-z]+)? (?:${words || "-"})\\b`);
      const hardRe = new RegExp(`\\b(?:no|never|avoid|without|nothing)(?: [a-z]+)? (?:${words || "-"})\\b`);
      if (words ? softRe.test(quote) && !hardRe.test(quote) : !HARD_WORDS.test(quote)) {
        const phrase = softRe.exec(quote)?.[0] || r.note || r.quote;
        say(r, `"${phrase}" kept as a note, not a rule at every meal`);
        r = { kind: "other", ...(r.who ? { who: r.who } : {}), ...(r.days?.length ? { days: r.days } : {}), ...(r.slots?.length ? { slots: r.slots } : {}), note: phrase, quote: r.quote };
      }
    }
    // Red meat is not chicken.
    if (r.kind === "avoid" && r.items?.some((i) => /^red meats?$/i.test(i))) {
      r = { ...r, items: [...new Set([...r.items!.filter((i) => !/^red meats?$/i.test(i)), ...RED_MEAT])] };
      say(r, "red meat: mutton, lamb, goat, beef, pork");
    }
    if (r.kind === "avoid" && /\bred meat\b/.test(quote) && r.items?.includes("@meat") && !/\b(no|never|dont|doesnt) (?:eat )?(?:any )?meat\b/.test(quote.replace(/red meat/g, ""))) {
      r = { ...r, items: [...new Set([...r.items.filter((i) => i !== "@meat"), ...RED_MEAT])] };
      say(r, "red meat: not chicken");
    }
    // A wish said loosely is kept some meals of the week.
    if ((SOFT_KINDS as readonly string[]).includes(r.kind) && !r.often && r.per_week === undefined && LOOSE_WISH.test(q)) { r = { ...r, often: "sometimes" }; say(r, "a wish: sometimes"); }
    out.push(r);
  }
  return { rules: out, fixed };
}

/** A dish as read, its meals and eaters on the app's names; `who` null: everyone at those meals; how often, when said. */
export type DishRow = { name: string; slots: string[]; who: string[] | null; often?: Often; per_week?: number; days?: Weekday[] };

// ── How often, in the family's words ──
// The readers map the family's frequency words ("most nights", "when he's tired", "twice", "weekend parathas") to often,
// per_week and days; code keeps each only when a line the family said carries such words (like the quote check), else the
// default holds (a dish: two days a week at most; a rule: every time).

/** The words that say each often. "when ..." / "if ..." is a condition: sometimes. */
const OFTEN_WORDS: Record<Often, RegExp> = {
  usually: /\b(most (days|nights|mornings|evenings|times)|daily|every ?day|every (morning|night|evening|lunch|dinner)|usually|mostly|always|regularly|often|all the time)\b/,
  sometimes: /\b(sometimes|some days|at times|now and then|when|whenever|if|on and off|few times|busy days?|rushed days?|in a rush)\b/,
  rarely: /\b(once in a while|occasionally|rarely|seldom|now and again|once a month|special occasions?|sometimes only)\b/,
};
/** A soft wish said loosely, which is "sometimes" when no other word says how often. */
const WISH_WORDS = /\b(good|better|healthy|healthier|try to|should|prefer|more|less often)\b/;
const COUNT_WORDS: Record<string, number> = { once: 1, twice: 2, thrice: 3, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
/** The counts a line gives: "once", "twice", "3 times", "two days a week". */
function countsIn(line: string): number[] {
  const out: number[] = [];
  for (const m of line.matchAll(/\b(once|twice|thrice)\b/g)) out.push(COUNT_WORDS[m[1]]);
  for (const m of line.matchAll(/\b(\d+|one|two|three|four|five|six|seven) (times|days|meals|nights|mornings)\b/g)) out.push(/^\d+$/.test(m[1]) ? Number(m[1]) : COUNT_WORDS[m[1]]);
  return out;
}
const DAY_WORD = "(?:(?:mon|tues?|wednes|thurs?|fri|satur|sun)days?|mon|tues?|wed|thur?s?|fri|sat|sun|weekends?|weekdays?)";
const DAYS_RUN = `${DAY_WORD}(?: (?:and|or|to|till|through|until|n) ${DAY_WORD})*`;
/** The weekday a word is ("fridays", "thurs", "sat"), or null. */
const dayIndex = (w: string): number | null => {
  const i = DAY_NAMES.findIndex((d) => w.length >= 3 && d.startsWith(w.slice(0, 3)) && new RegExp(`^${DAY_WORD}$`).test(w));
  return i >= 0 ? i : null;
};
/** The weekdays a line names: "friday", "fri", "weekends", "weekend parathas", "weekdays", "monday to friday". */
function daysIn(line: string): Weekday[] {
  const out = new Set<Weekday>();
  const w = ` ${line} `;
  if (/ weekends? /.test(w)) { out.add("Sat"); out.add("Sun"); }
  if (/ weekdays? /.test(w)) WEEKDAYS.slice(0, 5).forEach((d) => out.add(d));
  WEEKDAYS.forEach((d, i) => { if (new RegExp(` (${DAY_NAMES[i]}s?|${d.toLowerCase()}) `).test(w)) out.add(d); });
  for (const m of w.matchAll(new RegExp(` (${DAY_WORD}) (?:to|till|through|until) (${DAY_WORD}) `, "g"))) {
    const a = dayIndex(m[1]), b = dayIndex(m[2]);
    if (a !== null && b !== null) for (let i = a; ; i = (i + 1) % 7) { out.add(WEEKDAYS[i]); if (i === b) break; }
  }
  return WEEKDAYS.filter((d) => out.has(d));
}
/** "Mon-Fri", "Monday – Friday" written as "Mon to Fri", so a range keeps its days once the dash is gone. */
export const rangesSpelled = (raw: string): string =>
  raw.replace(/\b(mon(?:day)?|tues?(?:day)?|wed(?:nesday)?|thu(?:rs?)?(?:day)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\s*[-–]\s*(mon(?:day)?|tues?(?:day)?|wed(?:nesday)?|thu(?:rs?)?(?:day)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/gi, "$1 to $2");

/** The family's replies, each with the group its question asked about ("What did the children have…": child), whether it
 *  asked what a meal was (a rule's "chicken, fish, eggs are fine" is no dish said), and its sentences in plain words. */
export function repliesWithQuestion(transcript: string[]): { group: string | null; meal: boolean; clauses: string[] }[] {
  let group: string | null = null, meal = false;
  const out: { group: string | null; meal: boolean; clauses: string[] }[] = [];
  for (const l of transcript) {
    if (/^Q:/i.test(l)) {
      group = /\b(children|child|kids?)\b/i.test(l) ? "child" : /\belders?\b/i.test(l) ? "elder" : /\badults?\b/i.test(l) ? "adult" : null;
      meal = /\b(breakfast|lunch|dinner|tiffin|snacks?)\b/i.test(l);
      continue;
    }
    if (!/^A\d*:/i.test(l)) continue;
    out.push({ group, meal, clauses: l.replace(/^A\d*:\s*/i, "").split(/[.;:!?\n—–]+|\s-\s/).map(plainWords).filter(Boolean) });
  }
  return out;
}

/** A dish name's last word when it can stand for the dish ("Aloo paratha": paratha, said as "weekend parathas"); not a word
 *  many dishes end in (rice, curry, dal). */
const GENERIC_HEADS = new Set(["rice", "curry", "dal", "daal", "sabzi", "sabji", "roti", "fry", "chutney", "sambar", "rasam", "bath", "salad", "raita", "curd",
  "masala", "gravy", "soup", "dosa", "idli", "paneer", "chicken", "fish", "egg", "eggs", "toast", "bhaji", "poriyal", "kootu", "pulao", "khichdi"]);
export const headWord = (key: string): string | null => {
  const ws = key.split(" ");
  const last = ws[ws.length - 1];
  return ws.length >= 2 && last.length >= 4 && !GENERIC_HEADS.has(last) ? last : null;
};

/** The days the family's own words put next to a dish (`key`, or its `head` word), in sentences that are no day-by-day diary
 *  (three or more weekdays named: "poha on Monday, upma Tuesday" is last week, not a rule): "lemon rice on Friday",
 *  "khichdi on Saturday night", "chicken curry on Saturday and Sunday", "weekend parathas", "Sunday luchi". */
export function daysNextTo(key: string, head: string | null, clauses: string[]): Weekday[] {
  const out = new Set<Weekday>();
  for (const c of clauses) {
    const named = WEEKDAYS.filter((d, i) => new RegExp(` (${DAY_NAMES[i]}s?|${d.toLowerCase()}) `).test(` ${c} `));
    if (named.length >= 3) continue;
    for (const name of [key, head].filter((x): x is string => !!x)) {
      if (!` ${c} `.includes(` ${name} `) && !` ${c} `.includes(` ${name}s `)) continue;
      const after = new RegExp(`(?:^| )${name}s?(?:(?: [a-z]+)? (?:on|every))? (?:the )?(${DAYS_RUN})(?= |$)`).exec(c);
      const before = after ? null : new RegExp(`(?:^| )(?:on )?(?:the )?(${DAY_WORD}) ${name}s?(?= |$)`).exec(c);
      const m = after ?? before;
      if (m) { daysIn(m[1]).forEach((d) => out.add(d)); break; }
    }
  }
  return WEEKDAYS.filter((d) => out.has(d));
}

/** How often the family's own words next to a dish say they have it, in one part of a reply (between commas): "sometimes
 *  uthappam", "rasam rice if it's late", "cornflakes on busy days", "chapati most nights", "biryani once in a while". */
export function oftenNextTo(key: string, transcript: string[]): Often | undefined {
  const k = `${key}s?`;
  const parts = transcript.filter((l) => /^A\d*:/i.test(l)).flatMap((l) => l.replace(/^A\d*:\s*/i, "").split(/[.;:!?,\n—–]+|\s-\s/)).map(plainWords);
  const tests: [Often, RegExp][] = [
    ["rarely", new RegExp(`(?:^| )(?:${k}(?: [a-z]+)? (?:once in a while|occasionally|rarely)|(?:occasionally|rarely) ${k})(?= |$)`)],
    ["sometimes", new RegExp(`(?:^| )(?:${k}(?: [a-z]+)? (?:sometimes|when|whenever|if|on busy days|on rushed days|in a rush|now and then|at times)|(?:sometimes|at times) (?:a |an |some )?${k})(?= |$)`)],
    ["usually", new RegExp(`(?:^| )${k} (?:on |for )?(?:most days|most nights|most mornings|every day|every morning|every night|daily|everyday)(?= |$)`)],
  ];
  for (const part of parts) for (const [o, re] of tests) if (re.test(part)) return o;
  return undefined;
}

/** A dish's how-often as read ("sometimes", "2", "Sat, Sun", "1, Fri") checked against the lines that name the dish (plain
 *  words): what those lines carry is kept, the rest is `dropped` (in words, for the log). */
export function dishOftenSaid(read: string, lines: string[]): { often?: Often; per_week?: number; days?: Weekday[]; dropped?: string } {
  const t = read.toLowerCase();
  const out: { often?: Often; per_week?: number; days?: Weekday[] } = {}, gone: string[] = [];
  const often = OFTEN.find((o) => new RegExp(`\\b${o}\\b`).test(t));
  if (often) { if (lines.some((l) => OFTEN_WORDS[often].test(l))) out.often = often; else gone.push(often); }
  const n = /\b(\d+)\b/.exec(t)?.[1] ?? Object.keys(COUNT_WORDS).find((w) => new RegExp(`\\b${w}\\b`).test(t));
  const count = n === undefined ? undefined : /^\d+$/.test(n) ? Number(n) : COUNT_WORDS[n];
  if (count !== undefined && count >= 1 && count <= 7) { if (lines.some((l) => countsIn(l).includes(count))) out.per_week = count; else gone.push(String(count)); }
  const days = daysOf(t.split(/\s*[,;/]\s*|\s+and\s+|\s+/).filter((x) => x && !/^\d+$/.test(x)));
  if (days.length) {
    const named = new Set(lines.flatMap(daysIn));
    const kept = days.filter((d) => named.has(d));
    if (kept.length) out.days = kept;
    if (kept.length < days.length) gone.push(days.filter((d) => !named.has(d)).join(", "));
  }
  return { ...out, ...(gone.length ? { dropped: gone.join("; ") } : {}) };
}

/** A soft rule's how-often checked against its quote and the family's lines that have the quote: often kept when those words
 *  say it (a wish said loosely, "good for him", is sometimes), per_week when they give that count. */
export function ruleOftenSaid(rule: Pick<SetupRule, "often" | "per_week" | "quote">, said: string[]): { often?: Often; per_week?: number; dropped?: string } {
  if (!rule.often && rule.per_week === undefined) return {};
  const q = plainWords(rule.quote);
  const lines = [q, ...(q.length >= 3 ? said.filter((l) => l.includes(q)) : [])].filter(Boolean);
  if (rule.per_week !== undefined) {
    const n = Math.round(rule.per_week);
    if (n >= 1 && lines.some((l) => countsIn(l).includes(n))) return { per_week: n };
    if (!rule.often) return { dropped: `${n} a week` };
  }
  const often = (OFTEN as readonly string[]).includes(rule.often ?? "") ? rule.often as Often : undefined;
  // The quote first: its own words; then the line it is in.
  const says = (o: Often) => (l: string) => OFTEN_WORDS[o].test(l) || (o === "sometimes" && WISH_WORDS.test(l));
  if (often && (says(often)(q) || lines.some(says(often)))) return { often };
  // A wish said loosely ("millets are good for him") read as another often is still a wish: sometimes (eval 23 Nov: read
  // as "usually", dropped, and kept at every meal).
  if (says("sometimes")(q)) return { often: "sometimes" };
  return { dropped: String(rule.often ?? "") };
}
/** The dishes read, one row a dish (live run 2026-11-23: "Curd" read once in the adults' answer and once in the child's,
 *  the last row saved won and the dish became one person's): rows of the same dish (its name lower case, single spaces) are
 *  one, its meals the union of theirs; its eaters the union of theirs, or everyone when any row is everyone's. A dish whose
 *  eaters are the whole family (`family`) is everyone's. A child's tiffin dish keeps its child: a dish of one person's is
 *  never taken to fill another meal. */
export function mergeDishes(rows: DishRow[], family: string[]): DishRow[] {
  const byKey = new Map<string, DishRow>();
  for (const r of rows) {
    const key = r.name.trim().toLowerCase().replace(/\s+/g, " ");
    const had = byKey.get(key);
    if (!had) { byKey.set(key, { ...r, slots: [...r.slots], who: r.who ? [...r.who] : null }); continue; }
    for (const s of r.slots) if (!had.slots.includes(s)) had.slots.push(s);
    had.who = had.who && r.who ? [...new Set([...had.who, ...r.who])] : null;
    // How often: the first row that says it.
    if (!had.often && r.often) had.often = r.often;
    if (had.per_week === undefined && r.per_week !== undefined) had.per_week = r.per_week;
    // Days: every day any row names (eval 23 Nov: chicken "on Saturday" in one answer and "on Saturday and Sunday" in the
    // next was saved as Saturday only).
    if (r.days?.length) had.days = WEEKDAYS.filter((d) => had.days?.includes(d) || r.days!.includes(d));
  }
  return [...byKey.values()].map((d) => (d.who && family.length && family.every((p) => d.who!.some((w) => same(w, p))) ? { ...d, who: null } : d));
}

/** The note a day-off cooking entry is saved with: the menu reads it, and the read-back finds it by it. */
const homeCookNote = (h: { by: string; note?: string }) => `${h.by} cooks${h.note ? ` (${h.note})` : ""}`;

/** The cook's days in the household facts (help: { role: cook, name, days }), for a cook whose days the transcript left out. */
function cookDaysOf(household: unknown, cook: string): Weekday[] {
  const help = isObject(household) ? arr(household["household.help"] ?? household.help) : [];
  const h = help.filter(isObject).find((x) => /cook/i.test(str(x.role)) && (!str(x.name) || same(str(x.name), cook)));
  return h ? daysOf(h.days) : [];
}

const hourOf = (at: string) => Number(at.slice(0, 2));

/** The cook's times in the household facts (help: { role: cook, name, times, meals }), each with the meals the facts give it.
 *  Times are reminder data (owner, 23 Nov: the cook matters to the plan as who cooks which meals on which days, and their
 *  limits; the exact time is for reminders and shopping): a time never decides which meals the cook makes. */
export function cookTimesOf(household: unknown, cook: string): Visit[] {
  const help = isObject(household) ? arr(household["household.help"] ?? household.help) : [];
  const out: Visit[] = [];
  for (const h of help.filter(isObject)) {
    if (!/cook/i.test(str(h.role)) || (str(h.name) && !same(str(h.name), cook))) continue;
    const meals = strs(h.meals).map((m) => SLOTS.find((x) => same(x, m))).filter((m): m is (typeof SLOTS)[number] => !!m);
    for (const t of strs(h.times)) {
      const at = clockOf(t);
      // One time: the facts' meals are its own; several times with one list of meals: which visit makes which is not said.
      if (at) out.push({ at, ...(meals.length && strs(h.times).length === 1 ? { meals } : {}) });
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

/** The cook's visits made sensible in code, the times kept as said: a "7:30" read as 19:30 is 07:30 when the facts have a
 *  morning time near it and no evening one; a meal the cook makes that no visit has left takes its visit from the household
 *  facts; a meal two visits claim is the visit whose time the family said last (a correction: "actually she comes at 7:30"
 *  after the facts' 7am). Which meals a visit makes is never decided by its time (eval 23 Nov: one 11 am visit that makes
 *  lunch and dinner lost dinner to a "no dinner before noon" check). */
export function cookVisits(given: Visit[], facts: Visit[], replies: string[]): Visit[] {
  const meals = new Set<string>([...given.flatMap((v) => v.meals ?? []), ...facts.flatMap((v) => v.meals ?? [])]);
  const near = (a: string, b: string) => Math.abs(hourOf(a) * 60 + Number(a.slice(3)) - hourOf(b) * 60 - Number(b.slice(3))) <= 60;
  given = given.map((v) => {
    if (hourOf(v.at) < 12) return v;
    const am = `${String(hourOf(v.at) - 12).padStart(2, "0")}:${v.at.slice(3)}`;
    return facts.some((f) => near(f.at, am)) && !facts.some((f) => near(f.at, v.at)) ? { ...v, at: am } : v;
  });
  // A corrected time ("actually she comes at 7:30", said in a reply) changes the time of the facts' visit it is near, not
  // that visit's meals; a visit said with no meals takes the meals of the facts' visit near it.
  const factNear = (at: string) => facts.find((f) => near(f.at, at) && f.meals?.length);
  let visits = given.map((v) => {
    const f = factNear(v.at);
    const corrected = !!f && f.at !== v.at && saidAt(v.at, replies) >= 0 && !!v.meals?.some((m) => !f.meals!.includes(m));
    return { at: v.at, meals: f && (!v.meals?.length || corrected) ? [...f.meals!] : v.meals ? [...v.meals] : undefined };
  });
  for (const meal of meals) {
    if (visits.some((v) => v.meals?.includes(meal))) continue;
    const f = facts.find((v) => v.meals?.includes(meal));
    if (!f) continue;
    // To the visit at that time, or the one whose corrected time it is.
    const had = visits.find((v) => v.at === f.at) ?? visits.find((v) => near(v.at, f.at));
    if (had) had.meals = [...(had.meals ?? []), meal]; else visits.push({ at: f.at, meals: [meal] });
  }
  for (const meal of meals) {
    const claim = visits.filter((v) => v.meals?.includes(meal));
    if (claim.length < 2) continue;
    // The one said last wins; never said: the one near the facts' visit for that meal, else the later one in the list.
    const said = claim.filter((v) => saidAt(v.at, replies) >= 0);
    const keep = said.length ? said.reduce((a, b) => (saidAt(b.at, replies) >= saidAt(a.at, replies) ? b : a))
      : claim.find((v) => factNear(v.at)?.meals?.includes(meal)) ?? claim[claim.length - 1];
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
  // Every day is planned: the days the cook does not come, the family cooks (by whom, when said).
  const off = h.cook_name && h.cook_days.length ? WEEKDAYS.filter((d) => !h.cook_days.includes(d)) : h.cook_name ? [] : [...WEEKDAYS];
  if (off.length === 7) lines.push("The family cooks every day.");
  else if (off.length) {
    const by = (d: Weekday) => [...new Set(p.homeCook.filter((x) => x.day === d && x.by).map((x) => x.by))];
    const groups = new Map<string, Weekday[]>();
    for (const d of off) { const k = andWords(by(d)) || "the family"; groups.set(k, [...(groups.get(k) ?? []), d]); }
    lines.push([...groups].map(([who, days]) => `${days.length === 1 ? `On ${LONG_DAY[days[0]]}` : `On ${andWords(days.map((d) => LONG_DAY[d]))}`} ${who} cooks.`).join(" "));
  }
  lines.push(slotsSaid(h));
  const homeNotes = new Set(p.homeCook.filter((x) => x.by).map(homeCookNote));
  const rules = rulesSaid(h.rules.filter((r) => !(r.kind === "other" && !r.who && r.note && homeNotes.has(r.note))));
  if (rules) lines.push(`Food rules:\n${rules}`);
  const dishCount = p.dishes.length;
  if (dishCount) lines.push(`${dishCount} of your dishes noted to plan from.`);
  return lines.join("\n");
}

/** apply_setup { household, transcript }: answers { ok, said, noted, dropped, rules, profile } or { ok: false, reason, say }. */
export function mountSetupRoute(hono: Hono<any>, db: Db, _emit: Emit, opts: { model: ModelCall; budgetMs?: number }) {
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
    return { body: await applySetup({ db, model: opts.model, post, household: b.household, transcript, budgetMs: opts.budgetMs }) };
  });
}
