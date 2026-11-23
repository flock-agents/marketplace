// The food rules the app checks (docs/specs/2026-11-21-planner-food-rules-check.md). The model writes the plan; the app refuses
// a plan that breaks a rule the family stated, naming each break so the agent fixes it before anyone sees it. Pure: no
// database here, and nothing the pages cannot import (the Family page writes a rule in words with ruleText).
import { RULE_LABELS, RULE_TIMES, type Often } from "./db/constants";
import { WEEKDAYS, weekdayOf, type Weekday } from "./dates";

/** A house rule as it is kept. `days` empty: every day; no `who`: everyone; no `slots`: every meal. A soft rule (a swap,
 *  require or other with `often` or `per_week`) is kept that many times a week, not at every meal ("millets are good for him":
 *  sometimes, 2 to 3 meals a week); a cap's per_week is its most meals a week. */
export type Rule = { kind: string; who?: string; days: string[]; slots?: string[]; items?: string[]; to?: string; per_week?: number; per_meal?: number; often?: Often; note?: string };
export type RuleDish = { name: string; for_people: string[] | null; portion_note: string | null; ingredients: (string | { item: string })[] };
export type RuleMeal = { date: string; slot: string; ordered_in?: boolean; dishes: RuleDish[] };
/** A week as the checks read it: a WeekView is one. */
export type RuleWeek = { days: { date: string; meals: RuleMeal[] }[] };
/** One break: the meal ("Mon 2026-11-23 Breakfast"), the dish when it is one dish, whose rule, the rule in words, and the fix.
 *  `soft`: a soft rule kept too many times this week ("over") or too few ("under", a softer problem); `to`: a soft swap's. */
export type RuleBreak = { meal: string; dish?: string; who?: string; rule: string; fix: string; soft?: "over" | "under"; to?: string };

/** The kinds the app checks, and what each needs besides its kind. A cap takes exactly one of per_week (then it needs items) or
 *  per_meal (items optional: without them every dish to cook counts); the Family page's check says so. */
export const CHECKED_KINDS = ["avoid", "only", "swap", "require", "cap"] as const;
export const KIND_NEEDS: Record<(typeof CHECKED_KINDS)[number], string[]> = {
  avoid: ["items"], only: ["who", "items"], swap: ["who", "items", "to"], require: ["slots", "items"], cap: [],
};

/** The kinds a rule may be soft in: kept some times a week (`often` or `per_week`), not every time. Every other rule is hard. */
export const SOFT_KINDS = ["swap", "require", "other"] as const;
export const isSoft = (r: Pick<Rule, "kind" | "often" | "per_week">): boolean =>
  (SOFT_KINDS as readonly string[]).includes(r.kind) && (!!r.often || r.per_week != null);
/** The meals a week a soft rule is kept at, least and most: per_week exactly, else by how often (constants.ts RULE_TIMES). */
export const timesOf = (r: Pick<Rule, "often" | "per_week">): [number, number] =>
  r.per_week != null ? [r.per_week, r.per_week] : RULE_TIMES[r.often ?? "sometimes"];
/** A number of times a week, in words: "once a week", "twice a week", "2–3 times a week", "at most once a week". */
export function timesText([lo, hi]: [number, number]): string {
  const n = (x: number) => (x === 1 ? "once" : x === 2 ? "twice" : `${x} times`);
  if (lo === hi) return `${n(lo)} a week`;
  if (lo === 0) return `at most ${n(hi)} a week`;
  return `${lo}–${hi} times a week`;
}
/** How often a soft rule is kept, in words (" 2–3 times a week"), or "" for a hard rule. */
const oftenText = (r: Rule) => (isSoft(r) ? ` ${timesText(timesOf(r))}` : "");

/** What a per_meal cap does not count as a dish to cook: a side. A dish is a side when its name has one of SIDE_WORDS, or its
 *  whole name is one of SIDE_NAMES ("Curd", but not "Curd rice"). */
export const SIDE_WORDS = ["chutney", "podi", "gunpowder", "pickle", "achaar", "achar", "papad", "raita", "salad"];
export const SIDE_NAMES = ["curd", "plain curd", "dahi", "yogurt", "fruit", "fruits", "cut fruit", "seasonal fruit", "fruit bowl", "banana", "buttermilk", "chaas", "ghee"];

/** The categories a rule's items may name as `@name`: each is the words that put a dish in it. */
export const CATEGORIES: Record<string, string[]> = {
  meat: ["meat", "chicken", "mutton", "lamb", "goat", "beef", "pork", "bacon", "ham", "keema", "kheema", "sausage", "salami", "pepperoni", "turkey", "duck", "liver"],
  fish: ["fish", "prawn", "shrimp", "crab", "lobster", "squid", "calamari", "seafood", "pomfret", "surmai", "rohu", "bangda", "mackerel", "sardine", "tuna",
    "salmon", "hilsa", "ilish", "anchovy", "clam", "mussel", "oyster", "katla", "basa", "tilapia"],
  egg: ["egg", "omelette", "omelet", "anda"],
  nuts: ["nut", "almond", "badam", "cashew", "kaju", "walnut", "akhrot", "pistachio", "pista", "peanut", "groundnut", "moongphali", "hazelnut", "pecan", "macadamia"],
  peanut: ["peanut", "groundnut", "moongphali", "peanut butter", "groundnut oil"],
  root_veg: ["onion", "garlic", "potato", "carrot", "beetroot", "radish", "sweet potato", "ginger", "yam", "arbi", "turnip"],
  green_leafy: ["palak", "spinach", "methi", "coriander", "dill", "curry leaves", "beans", "peas", "capsicum", "broccoli", "cucumber", "lettuce", "spring onion",
    "zucchini", "okra", "bhindi"],
  white_rice: ["rice", "basmati", "sona masoori", "idli rice", "dosa rice", "ponni", "raw rice", "boiled rice", "poha", "rice flour", "idli", "dosa", "appam", "neer dosa"],
  protein: ["paneer", "dal", "daal", "toor", "moong", "masoor", "urad", "chana", "chole", "rajma", "soya", "soy", "tofu", "sprouts", "curd", "dahi", "yogurt", "lobia",
    "besan", "egg", "chicken", "fish", "mutton", "lentil", "chickpea", "kidney bean", "prawn"],
  mushroom: ["mushroom", "shiitake", "khumb", "guchhi", "morel"],
  // What needs an oven to make at home: a cook's "no baking, no oven". Not bread, pav or buns, which are bought (a pav bhaji
  // or a bread upma needs no oven), and not tandoori food (a tawa or a tandoor, not an oven at home).
  baked: ["bake", "baked", "oven", "cake", "cupcake", "muffin", "pizza", "bread loaf", "garlic bread", "focaccia", "brownie", "cookie", "biscuit",
    "puff", "pie", "tart", "quiche", "croissant", "lasagna", "lasagne", "casserole", "gratin", "souffle", "nankhatai", "khari"],
  chilli: ["chilli", "chili", "chillies", "chilies", "mirchi", "red chilli", "green chilli", "chilli powder", "kashmiri chilli", "sambar powder", "rasam powder",
    "curry powder", "garam masala", "pickle", "achaar", "achar", "schezwan", "chilli flakes"],
  sweet: ["sugar", "jaggery", "gur", "honey", "sheera", "halwa", "kheer", "payasam", "ladoo", "laddu", "jamun", "barfi", "mithai", "jalebi", "condensed milk"],
  soy: ["soy", "soya", "soya chunks", "tofu", "soy sauce", "edamame"],
  gluten: ["wheat", "atta", "maida", "rava", "sooji", "semolina", "bread", "roti", "chapati", "phulka", "paratha", "naan", "pasta", "noodle", "barley", "dalia", "seitan", "vermicelli", "semiya", "sevai", "seviyan"],
  dairy: ["milk", "curd", "dahi", "paneer", "ghee", "butter", "cream", "cheese", "khoa", "raita", "lassi", "buttermilk", "chaas", "malai", "makhani", "kadhi"],
  dal: ["dal", "toor", "arhar", "moong", "masoor", "urad", "chana dal"],
  pickle: ["pickle", "achaar", "achar", "papad"],
  vegan_protein: ["tofu", "soya", "chana", "chole", "rajma", "dal", "toor", "moong", "masoor", "urad", "sprouts", "lobia", "besan"],
};
/** How a category reads in a rule. */
export const CATEGORY_LABELS: Record<string, string> = { meat: "meat", fish: "fish", egg: "eggs", nuts: "nuts", peanut: "peanuts", root_veg: "root vegetables",
  green_leafy: "green leafy vegetables", white_rice: "white rice", protein: "protein", mushroom: "mushrooms", baked: "baked food",
  chilli: "chilli", sweet: "sweet things", soy: "soy", gluten: "gluten", dairy: "dairy", dal: "dal", pickle: "pickle", vegan_protein: "vegan protein" };
/** A word before rice (or idli, dosa…) that says it is not white rice: millet, brown, red or ragi rice, a millet idli, a rava dosa. */
const NOT_WHITE = new Set(["millet", "brown", "red", "black", "wild", "ragi", "jowar", "bajra", "oat", "wheat", "rava", "sooji", "suji", "semolina", "quinoa",
  "cauliflower", "foxtail", "kodo", "barnyard", "little", "samai", "saamai", "varagu", "thinai", "kambu", "moong", "dal"]);

/** A word before milk, cream, butter or curd that says it is not dairy: coconut milk, peanut butter. */
const NOT_DAIRY = new Set(["coconut", "almond", "oat", "soy", "soya", "rice", "cashew", "peanut", "cocoa"]);
/** A dish name that says it has no sugar is not sweet by its name ("Banana sheera (no sugar)"); its ingredients still count. */
const NO_SUGAR = /\b(?:no|without|minus)\s+(?:added\s+)?sugar\b|\bsugar[\s-]*free\b|\bunsweetened\b/i;

// ── Matching ──

/** A word without its trailing plural: "potatoes" potato, "peanuts" peanut, "radishes" radish, "cheeses" cheese. */
const singular = (w: string): string =>
  w.length <= 3 ? w : /(ss|x|z|ch|sh|o)es$/.test(w) ? w.slice(0, -2) : w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
/** Indian food words as the English one the rules and categories use, so a rule never needs each spelling: "Aloo matar" has
 *  potato and peas, "Suji sheera" semolina. A word, not a dish: what a dish is made of stays in its ingredients. */
export const SAME_AS: Record<string, string> = {
  aloo: "potato", alu: "potato", batata: "potato", urulai: "potato", pyaz: "onion", pyaaz: "onion", kanda: "onion", vengayam: "onion",
  lehsun: "garlic", lahsun: "garlic", lasun: "garlic", poondu: "garlic", adrak: "ginger", inji: "ginger", gajar: "carrot", mooli: "radish",
  shakarkandi: "sweet potato", arbi: "colocasia", suran: "yam", jimikand: "yam", chukandar: "beetroot",
  matar: "pea", mutter: "pea", palak: "spinach", keerai: "spinach", gobi: "cauliflower", phool: "cauliflower", bhindi: "okra", vendakkai: "okra",
  baingan: "brinjal", vankaya: "brinjal", kathirikai: "brinjal", lauki: "bottle gourd", karela: "bitter gourd", kumbh: "mushroom", khumb: "mushroom",
  suji: "semolina", sooji: "semolina", rava: "semolina", ravva: "semolina", maida: "refined wheat flour", gehun: "wheat", godhuma: "wheat",
  dahi: "curd", thayir: "curd", mosaru: "curd", yogurt: "curd", yoghurt: "curd", doodh: "milk", paal: "milk", makhan: "butter", malai: "cream",
  anda: "egg", ande: "egg", muttai: "egg", murgh: "chicken", murg: "chicken", kozhi: "chicken", machli: "fish", machchi: "fish", meen: "fish",
  gosht: "mutton", jhinga: "prawn", kaju: "cashew", badam: "almond", akhrot: "walnut", pista: "pistachio", moongphali: "peanut",
  shengdana: "peanut", kadalai: "peanut", nilakadalai: "peanut", chawal: "rice", chaawal: "rice", akki: "rice", cheeni: "sugar", gud: "jaggery", shahad: "honey",
};
/** Lower case, words only, each without its plural, an Indian food word as its English one (SAME_AS). */
const wordsOf = (text: string): string[] => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(singular)
  .flatMap((w) => (SAME_AS[w] ?? w).split(" "));

/** A dish's name with what it says it is without taken out: "(no peanuts)", "[minus groundnut]", "without onion and garlic",
 *  "no onion" up to the next comma, bracket or "with". */
export const stripNegations = (name: string): string => name
  .replace(/[([]\s*(?:no|without|minus)\b[^)\]]*[)\]]?/gi, " ")
  .replace(/\b(?:without|no|minus)[\s-]+[^,;()[\]]*?(?=\s+(?:with|served|topped)\b|[,;()[\]]|$)/gi, " ");

/** Where `needle` stands in `hay` as consecutive words. */
function at(hay: string[], needle: string[]): number[] {
  const out: number[] = [];
  if (!needle.length) return out;
  for (let i = 0; i + needle.length <= hay.length; i++) if (needle.every((w, j) => hay[i + j] === w)) out.push(i);
  return out;
}

/** The words of an item: a category's own, or the item itself. */
const termsOf = (item: string): string[] => {
  const t = item.trim();
  return t.startsWith("@") ? CATEGORIES[t.slice(1).toLowerCase()] ?? [] : [t];
};

/** The word of `item` that `text` has, or null. `name`: the text is a dish's name, so its negations are dropped first. */
export function hit(text: string, item: string, opts: { name?: boolean } = {}): string | null {
  const cat = item.trim().toLowerCase();
  if (opts.name && cat === "@sweet" && NO_SUGAR.test(text)) return null;
  const hay = wordsOf(opts.name ? stripNegations(text) : text);
  for (const term of termsOf(item)) {
    const needle = wordsOf(term);
    for (const i of at(hay, needle)) {
      if (cat === "@white_rice" && (NOT_WHITE.has(hay[i - 1]) || hay[i + needle.length] === "bran")) continue;
      if (cat === "@dairy" && NOT_DAIRY.has(hay[i - 1])) continue;
      return term;
    }
  }
  return null;
}
export const matches = (text: string, item: string, opts: { name?: boolean } = {}): boolean => hit(text, item, opts) !== null;

/** What a swap gives, each way it may be given: "millets or a small portion of rice" is "millets" and "a small portion of rice". */
export const alternatives = (to: string): string[] => to.split(/\s*(?:,|\bor\b|\/)\s*/i).map((x) => x.trim()).filter(Boolean);

const ingredientName = (i: string | { item: string }) => (typeof i === "string" ? i : i.item);
/** The word of `item` a dish has, in its name (negations dropped) or in one of its ingredients (as given), or null. */
export function dishHit(d: { name: string; ingredients?: (string | { item: string })[] }, item: string): string | null {
  return hit(d.name, item, { name: true }) ?? (d.ingredients ?? []).map((i) => hit(ingredientName(i), item)).find((h) => h !== null) ?? null;
}
export const dishHas = (d: { name: string; ingredients?: (string | { item: string })[] }, item: string): boolean => dishHit(d, item) !== null;

/** Is a dish a side, which a per_meal cap does not count: "Coconut chutney", "Curd", "Fruit". */
export const isSide = (name: string): boolean => {
  const n = wordsOf(stripNegations(name)).join(" ");
  return SIDE_WORDS.some((w) => at(n.split(" "), wordsOf(w)).length > 0) || SIDE_NAMES.some((s) => wordsOf(s).join(" ") === n);
};

/** Is a dish one the family's own `only` rules name ("Meera eats only plain idli, plain dosa…")? Such a dish has to come
 *  back in the week, so the weekly plan's repeat check lets it. */
export const namedInOnlyRule = (name: string, rules: { kind: string; items?: string[] }[]): boolean =>
  rules.some((r) => r.kind === "only" && (r.items ?? []).some((i) => matches(name, i, { name: true })));

/** A side, which comes back on many days of a week (owner 2026-11-22): any side a per_meal cap leaves out, and a plain dal,
 *  boiled eggs. Sambar and rasam are mains (owner 2026-11-22: "sambar, rasam is not sides. Its the main"). */
const REPEAT_SIDE_NAMES = ["dal", "plain dal", "dal tadka", "dal fry", "toor dal", "moong dal", "boiled egg", "boiled eggs"];
export const isRepeatableSide = (name: string): boolean => {
  if (isSide(name)) return true;
  const n = wordsOf(stripNegations(name));
  return REPEAT_SIDE_NAMES.some((x) => wordsOf(x).join(" ") === n.join(" "));
};

// ── Who eats what ──

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/** The word a dish's eaters use for everyone who eats that meal. */
export const EVERYONE = "everyone";
/** Is a dish for everyone who eats its meal: `["everyone"]`, or no eaters at all (a family's own dish, a row from before
 *  every dish named its eaters). */
export const forEveryone = (who: string[] | null | undefined): boolean => !who?.length || who.some((w) => same(w, EVERYONE));
/** An extra slot as the checks read it: a slot with `for` is eaten by those people only. */
export type RuleSlot = { name: string; for?: string[] };
/** Who eats a meal: an extra slot's own people (a child's tiffin), else everyone at home. */
export function dinersOf(slot: string, people: { name: string }[], slots: RuleSlot[] = []): string[] {
  const own = slots.find((s) => same(s.name, slot))?.for;
  return own?.length ? own : people.map((p) => p.name);
}
/** The dishes of a meal a person eats, as written: the ones naming them, and the ones for everyone while they eat that meal. */
export function eatenBy(meal: RuleMeal, person: string, diners: string[]): RuleDish[] {
  const eats = diners.some((d) => same(d, person));
  return meal.dishes.filter((d) => d.for_people?.some((p) => same(p, person)) || (eats && forEveryone(d.for_people)));
}

// ── A rule in words ──

const itemText = (i: string) => (i.startsWith("@") ? CATEGORY_LABELS[i.slice(1).toLowerCase()] ?? i.slice(1) : i);
const listText = (items: string[] = [], join = ", ") => items.map(itemText).join(join);
const isWeekday = (d: string): d is Weekday => (WEEKDAYS as readonly string[]).includes(d);
/** Where and when the rule holds, in words: " at Breakfast on Tue". `days`: false leaves the days out (the Family page shows
 *  them as the chip's label). */
const scopeText = (r: Rule, days = true) =>
  `${r.slots?.length ? ` at ${r.slots.join(", ")}` : ""}${days && r.days.length ? ` on ${r.days.join(", ")}` : ""}`;

/** What a rule says, in plain words: "Meera eats only plain idli, plain dosa at Breakfast", "no root vegetables on Tue". */
export function ruleText(r: Rule, opts: { days?: boolean } = {}): string {
  const scope = scopeText(r, opts.days !== false);
  switch (r.kind) {
    case "avoid": return `${r.who ? `${r.who} eats ` : ""}no ${listText(r.items)}${scope}`;
    case "only": return `${r.who ?? "everyone"} eats only ${listText(r.items)}${scope}`;
    case "swap": return `${r.who ?? "everyone"} has ${r.to} in place of ${listText(r.items)}${scope}${oftenText(r)}`;
    case "require": return `${r.who ?? "everyone"} has ${listText(r.items, " or ")}${scope}${oftenText(r)}`;
    case "cap": {
      if (r.per_meal != null) { const n = r.per_meal; return `at most ${n} dish${n === 1 ? "" : "es"}${r.items?.length ? ` with ${listText(r.items)}` : ""} a meal${r.who ? ` for ${r.who}` : ""}${scope}`; }
      const n = r.per_week ?? 0; return `${listText(r.items)} in at most ${n} meal${n === 1 ? "" : "s"} a week${r.who ? ` for ${r.who}` : ""}${scope}`;
    }
    case "fasting":
      // A fast the app checks (who, days, slots): no meal for that person then.
      if (r.who && r.slots?.length) return `${r.who} fasts${scope}`;
      return `${RULE_LABELS.fasting}${r.who ? ` for ${r.who}` : ""}${scope}`;
    default: return `${RULE_LABELS[r.kind as keyof typeof RULE_LABELS] ?? r.kind}${r.who ? ` for ${r.who}` : ""}${scope}`;
  }
}

/** The rules in plain words, as read back to the family: one line for everyone, then one line per person, in the order they
 *  first come ("Everyone: no root vegetables on Tue" / "Meera: eats only plain idli at Breakfast"). An other or fasting rule is
 *  its note. "" when there are none. */
export function rulesSaid(list: readonly Rule[]): string {
  const groups = new Map<string, string[]>();
  for (const r of list) {
    const key = r.who ?? "";
    let text = isCheckedFast(r) ? `${ruleText(r)}${r.note ? ` (${r.note})` : ""}`
      : (r.kind === "other" || r.kind === "fasting") && r.note ? `${r.note}${scopeText(r)}${oftenText(r)}` : ruleText(r);
    if (r.who && text.startsWith(`${r.who} `)) text = text.slice(r.who.length + 1);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(text);
  }
  const order = [...(groups.has("") ? [""] : []), ...[...groups.keys()].filter((k) => k)];
  return order.map((k) => `${k || "Everyone"}: ${groups.get(k)!.join("; ")}`).join("\n");
}

/** An older kind as the checked rule it is (spec: veg, no_meat and egg avoid meat and fish; no_eggs avoids eggs;
 *  no_onion_garlic avoids onion and garlic). A fast with who, days and slots is checked (isCheckedFast); one without slots,
 *  and other, are a note only. */
export function checkedAs(r: Rule): Rule | null {
  if ((CHECKED_KINDS as readonly string[]).includes(r.kind) || isCheckedFast(r)) return r;
  const items = r.kind === "veg" || r.kind === "no_meat" || r.kind === "egg" ? ["@meat", "@fish"]
    : r.kind === "no_eggs" ? ["@egg"] : r.kind === "no_onion_garlic" ? ["onion", "garlic"] : null;
  return items ? { ...r, kind: "avoid", items } : null;
}

/** A fast the app checks: a person (who), the weekdays (days) and the meals (slots) they eat nothing at. A fast without
 *  slots ("fasts on Ekadashi") stays a note; a fast with foods allowed is an `only` rule. */
export const isCheckedFast = (r: Rule): boolean =>
  r.kind === "fasting" && !!r.who && !!r.slots?.length && r.days.length > 0 && r.days.every((d) => isWeekday(d));

const LONG_DAYS: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
const andList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

// ── The checks ──

const SLOT_ORDER = ["breakfast", "lunch", "dinner"];
const slotRank = (slot: string) => { const i = SLOT_ORDER.indexOf(slot.toLowerCase()); return i < 0 ? SLOT_ORDER.length : i; };
export const mealLabel = (m: { date: string; slot: string }) => `${weekdayOf(m.date)} ${m.date} ${m.slot}`;
const shortLabel = (m: { date: string; slot: string }) => `${weekdayOf(m.date)} ${m.slot}`;

/** A break, with the meals it is about: for a cap, every meal that counts towards it. */
type Found = RuleBreak & { about: string[] };

function breaksOf(shown: Rule, meals: RuleMeal[], people: { name: string }[], slots: RuleSlot[]): Found[] {
  const r = checkedAs(shown);
  if (!r) return [];
  // A day in the family's own words ("Ekadashi") is not one the app can place: a rule with only such days is a note.
  const days = r.days.filter(isWeekday);
  if (r.days.length && !days.length) return [];
  const inScope = meals.filter((m) => !m.ordered_in && m.dishes.length
    && (!days.length || days.includes(weekdayOf(m.date))) && (!r.slots?.length || r.slots.some((s) => same(s, m.slot))));
  const rule = ruleText(shown);
  const items = r.items ?? [];
  const diners = (m: RuleMeal) => dinersOf(m.slot, people, slots);
  /** Does a person eat this meal at all: one named on a dish, or one of its diners. */
  const eatsAt = (m: RuleMeal, who: string) => diners(m).some((d) => same(d, who)) || m.dishes.some((d) => d.for_people?.some((p) => same(p, who)));
  const eaten = (m: RuleMeal, who: string) => eatenBy(m, who, diners(m));
  const firstHit = (d: RuleDish) => items.map((i) => dishHit(d, i)).find((h) => h !== null) ?? null;
  const out: Found[] = [];
  const add = (m: RuleMeal, b: Omit<RuleBreak, "meal" | "rule">, about = [mealLabel(m)]): void => void
    out.push({ meal: mealLabel(m), ...(b.dish ? { dish: b.dish } : {}), ...(b.who ? { who: b.who } : {}), rule, fix: b.fix, about,
      ...(b.soft ? { soft: b.soft } : {}), ...(b.to ? { to: b.to } : {}) });
  /** A soft rule's count: the meals past its most (in the week's order, the last ones) are breaks ("over"); too few, the first
   *  meals that could keep it and do not are softer breaks ("under"). */
  const overUnder = <K extends { m: RuleMeal; d: RuleDish }, O extends { m: RuleMeal; d?: RuleDish }>(kept: K[], open: O[], over: (x: K) => string,
    under: (x: O) => string, who?: string, to?: string) => {
    const [lo, hi] = timesOf(r);
    const about = kept.map((x) => mealLabel(x.m));
    for (const x of kept.slice(hi)) add(x.m, { dish: x.d.name, who, fix: over(x), soft: "over", ...(to ? { to } : {}) }, about);
    for (const x of open.slice(0, Math.max(0, lo - kept.length))) add(x.m, { ...(x.d ? { dish: x.d.name } : {}), who, fix: under(x), soft: "under", ...(to ? { to } : {}) });
  };
  switch (r.kind) {
    case "avoid":
      for (const m of inScope) for (const d of r.who ? eaten(m, r.who) : m.dishes) {
        const h = firstHit(d);
        if (h) add(m, { dish: d.name, who: r.who, fix: `it has ${h}: ${r.who ? `give ${r.who} a dish without it` : "plan a dish without it"}` });
      }
      break;
    case "only":
      for (const m of inScope.filter((m) => eatsAt(m, r.who!))) {
        const ate = eaten(m, r.who!);
        if (!ate.length) add(m, { who: r.who, fix: `add a dish for ${r.who}: one of ${listText(items)}` });
        for (const d of ate) if (!items.some((i) => matches(d.name, i, { name: true }))) add(m, { dish: d.name, who: r.who, fix: `add a dish for ${r.who}` });
      }
      break;
    case "swap": {
      if (isSoft(r)) {
        // Kept some times a week: a meal keeps it with a portion_note that says so, or a dish of the person's own that is what
        // the swap gives ("Millet roti" for them). Too many is a break; too few a softer one, on meals that could keep it.
        const who = r.who!, tos = alternatives(r.to!);
        const said = (d: RuleDish) => matches(d.portion_note ?? "", who) && tos.some((t) => matches(d.portion_note ?? "", t));
        const own = (d: RuleDish) => !forEveryone(d.for_people) && !!d.for_people?.some((p) => same(p, who)) && tos.some((t) => matches(d.name, t, { name: true }));
        const kept: { m: RuleMeal; d: RuleDish }[] = [], open: { m: RuleMeal; d: RuleDish }[] = [];
        for (const m of inScope) {
          const ate = eaten(m, who);
          // Any dish of theirs whose portion_note says the swap keeps it at this meal, rice in its name or not (eval 23 Nov:
          // "millet in place of rice" on sambar and bisi bele bath went uncounted, and the swap stayed at every lunch).
          const k = ate.find((d) => said(d) || own(d));
          if (k) kept.push({ m, d: k });
          else { const d = ate.find((x) => firstHit(x)); if (d) open.push({ m, d }); }
        }
        overUnder(kept, open, (x) => `${r.to} for ${who} is ${timesText(timesOf(r))}, now in ${kept.length} meals (${kept.map((y) => shortLabel(y.m)).join(", ")}): here ${who} has ${x.d.name} as it is (no "${r.to}" portion_note, no dish of their own for it)`,
          (x) => `say "${r.to} for ${who}" in its portion_note here: ${timesText(timesOf(r))}, now ${kept.length}`, who, r.to);
        break;
      }
      for (const m of inScope) for (const d of eaten(m, r.who!)) {
        const h = firstHit(d), note = d.portion_note ?? "";
        if (h && !(matches(note, r.who!) && matches(note, r.to!)))
          add(m, { dish: d.name, who: r.who, fix: `it has ${h}: say "${r.to} for ${r.who}" in its portion_note, or give ${r.who} a dish of their own` });
      }
      break;
    }
    case "require":
      if (isSoft(r)) {
        const kept: { m: RuleMeal; d: RuleDish }[] = [], open: { m: RuleMeal; d?: RuleDish }[] = [];
        for (const m of inScope) {
          if (r.who && !eatsAt(m, r.who)) continue;
          const d = (r.who ? eaten(m, r.who) : m.dishes).find((x) => firstHit(x));
          if (d) kept.push({ m, d }); else open.push({ m });
        }
        const whom = r.who ?? "everyone";
        overUnder(kept, open, () => `${listText(items, " or ")} for ${whom} is ${timesText(timesOf(r))}, now in ${kept.length} meals (${kept.map((y) => shortLabel(y.m)).join(", ")}): plan this meal without it`,
          () => `add a dish with ${listText(items, " or ")} that ${whom} eats: ${timesText(timesOf(r))}, now ${kept.length}`, r.who);
        break;
      }
      for (const m of inScope) for (const who of r.who ? (eatsAt(m, r.who) ? [r.who] : []) : diners(m))
        if (!eaten(m, who).some((d) => firstHit(d))) add(m, { who, fix: `add a dish with ${listText(items, " or ")} that ${who} eats` });
      break;
    case "fasting": {
      // Every dish the person would eat at a meal they fast at: one naming them, or one for everyone not leaving them out.
      const fasts = `${r.who}, who fasts at ${andList(r.slots!)} on ${andList(days.map((d) => LONG_DAYS[d]))}`;
      for (const m of inScope) for (const d of eaten(m, r.who!)) {
        const all = forEveryone(d.for_people);
        add(m, { dish: d.name, who: r.who, fix: all ? `${d.name} is for everyone, which includes ${fasts}: make it for everyone except ${r.who} (except: ["${r.who}"])`
          : `${d.name} is for ${fasts}: plan nothing for ${r.who} at this meal` });
      }
      break;
    }
    case "cap": {
      if (r.per_meal != null) {
        const cap = r.per_meal;
        for (const m of inScope) {
          if (r.who && !eatsAt(m, r.who)) continue;
          const cooked = [...new Map((r.who ? eaten(m, r.who) : m.dishes).filter((d) => !isSide(d.name) && (!items.length || firstHit(d)))
            .map((d) => [wordsOf(d.name).join(" "), d.name])).values()];
          if (cooked.length > cap)
            add(m, { who: r.who, fix: `now ${cooked.length} dishes (${cooked.join(", ")}): serve one dish to more people, or a swap as a portion_note` });
        }
        break;
      }
      const counted = inScope.map((m) => ({ m, d: (r.who ? eaten(m, r.who) : m.dishes).find((d) => firstHit(d)) })).filter((x) => x.d);
      const cap = r.per_week ?? 0;
      if (counted.length <= cap) break;
      const about = counted.map((x) => mealLabel(x.m));
      const fix = `now in ${counted.length} meals (${counted.map((x) => shortLabel(x.m)).join(", ")}): plan something else in ${counted.length - cap} of them`;
      for (const x of counted.slice(cap)) add(x.m, { dish: x.d!.name, fix }, about);
      break;
    }
  }
  return out;
}

/** The house as the checks read it: its rules, and its extra slots (who eats each). */
export type RuleHouse = { rules: Rule[]; extra_slots?: RuleSlot[] };

function found(week: RuleWeek, house: RuleHouse, people: { name: string }[], opts: { under?: boolean } = {}): Found[] {
  const meals = week.days.flatMap((d) => d.meals).sort((a, b) => a.date.localeCompare(b.date) || slotRank(a.slot) - slotRank(b.slot) || a.slot.localeCompare(b.slot));
  const all = house.rules.flatMap((r) => breaksOf(r, meals, people, house.extra_slots ?? [])).filter((b) => opts.under || b.soft !== "under");
  const order = new Map(meals.map((m, i) => [mealLabel(m), i]));
  // By meal, in the week's order; within a meal, in the order of the rules.
  return all.map((b, i) => ({ b, i })).sort((x, y) => (order.get(x.b.meal) ?? 0) - (order.get(y.b.meal) ?? 0) || x.i - y.i).map((x) => x.b);
}

const plain = ({ about: _about, ...b }: Found): RuleBreak => b;

/** Every break of the house's rules in a week. A soft rule kept too few times is left out unless `under` (the stepped plan
 *  asks for it, as a softer problem; plan_menu and the closing call never refuse a week for it). */
export function ruleBreaks(week: RuleWeek, house: RuleHouse, people: { name: string }[], opts: { under?: boolean } = {}): RuleBreak[] {
  return found(week, house, people, opts).map(plain);
}

/** The breaks a change to some meals of the week is answerable for: the breaks in those meals, and a cap over the week that
 *  one of them counts towards. `meals`: their labels, as mealLabel writes them. */
export function ruleBreaksIn(week: RuleWeek, house: RuleHouse, people: { name: string }[], meals: string[]): RuleBreak[] {
  const mine = new Set(meals);
  const short = (label: string) => label.replace(/ \d{4}-\d{2}-\d{2}/, "");
  return found(week, house, people).filter((b) => b.about.some((m) => mine.has(m))).map((b) => {
    // A cap over the week already used up by meals not being written now: those stay, this meal is the one to change.
    const kept = b.about.filter((m) => !mine.has(m));
    if (b.soft || !b.fix.startsWith("now in ") || !kept.length || !mine.has(b.meal)) return plain(b);
    return { ...plain(b), fix: `${kept.map(short).join(", ")} already ${kept.length === 1 ? "has" : "have"} it, as many as the rule allows: plan ${short(b.meal)} without it` };
  });
}

/** Every break in one message: "Mon 2026-11-23 Breakfast: Rava idli — Meera eats only … (add a dish for Meera)". */
export const breaksText = (breaks: RuleBreak[]): string =>
  breaks.map((b) => `${b.meal}: ${b.dish ? `${b.dish} — ` : ""}${b.rule} (${b.fix})`).join("; ");
