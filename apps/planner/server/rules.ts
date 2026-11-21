// The food rules the app checks (docs/specs/2026-11-21-planner-food-rules-check.md). The model writes the plan; the app refuses
// a plan that breaks a rule the family stated, naming each break so the agent fixes it before anyone sees it. Pure: no
// database here, and nothing the pages cannot import (the Family page writes a rule in words with ruleText).
import { RULE_LABELS } from "./db/constants";
import { WEEKDAYS, weekdayOf, type Weekday } from "./dates";

/** A house rule as it is kept. `days` empty: every day; no `who`: everyone; no `slots`: every meal. */
export type Rule = { kind: string; who?: string; days: string[]; slots?: string[]; items?: string[]; to?: string; per_week?: number; per_meal?: number; note?: string };
export type RuleDish = { name: string; for_people: string[] | null; portion_note: string | null; ingredients: (string | { item: string })[] };
export type RuleMeal = { date: string; slot: string; ordered_in?: boolean; dishes: RuleDish[] };
/** A week as the checks read it: a WeekView is one. */
export type RuleWeek = { days: { date: string; meals: RuleMeal[] }[] };
/** One break: the meal ("Mon 2026-11-23 Breakfast"), the dish when it is one dish, whose rule, the rule in words, and the fix. */
export type RuleBreak = { meal: string; dish?: string; who?: string; rule: string; fix: string };

/** The kinds the app checks, and what each needs besides its kind. A cap takes exactly one of per_week (then it needs items) or
 *  per_meal (items optional: without them every dish to cook counts); the Family page's check says so. */
export const CHECKED_KINDS = ["avoid", "only", "swap", "require", "cap"] as const;
export const KIND_NEEDS: Record<(typeof CHECKED_KINDS)[number], string[]> = {
  avoid: ["items"], only: ["who", "items"], swap: ["who", "items", "to"], require: ["slots", "items"], cap: [],
};

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
  baked: ["bake", "baked", "cake", "muffin", "pizza", "bread loaf", "garlic bread", "oven"],
  chilli: ["chilli", "chili", "chillies", "chilies", "mirchi", "red chilli", "green chilli", "chilli powder", "kashmiri chilli", "sambar powder", "rasam powder",
    "curry powder", "garam masala", "pickle", "achaar", "achar", "schezwan", "chilli flakes"],
  sweet: ["sugar", "jaggery", "gur", "honey", "sheera", "halwa", "kheer", "payasam", "ladoo", "laddu", "jamun", "barfi", "mithai", "jalebi", "condensed milk"],
  soy: ["soy", "soya", "soya chunks", "tofu", "soy sauce", "edamame"],
  gluten: ["wheat", "atta", "maida", "rava", "sooji", "semolina", "bread", "roti", "chapati", "phulka", "paratha", "naan", "pasta", "noodle", "barley", "dalia", "seitan"],
  dairy: ["milk", "curd", "dahi", "paneer", "ghee", "butter", "cream", "cheese", "khoa", "raita", "lassi", "buttermilk", "chaas", "malai"],
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
/** Lower case, words only, each without its plural. */
const wordsOf = (text: string): string[] => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(singular);

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
    case "swap": return `${r.who ?? "everyone"} has ${r.to} in place of ${listText(r.items)}${scope}`;
    case "require": return `${r.who ?? "everyone"} has ${listText(r.items, " or ")}${scope}`;
    case "cap": {
      if (r.per_meal != null) { const n = r.per_meal; return `at most ${n} dish${n === 1 ? "" : "es"}${r.items?.length ? ` with ${listText(r.items)}` : ""} a meal${r.who ? ` for ${r.who}` : ""}${scope}`; }
      const n = r.per_week ?? 0; return `${listText(r.items)} in at most ${n} meal${n === 1 ? "" : "s"} a week${r.who ? ` for ${r.who}` : ""}${scope}`;
    }
    default: return `${RULE_LABELS[r.kind as keyof typeof RULE_LABELS] ?? r.kind}${r.who ? ` for ${r.who}` : ""}${scope}`;
  }
}

/** An older kind as the checked rule it is (spec: veg, no_meat and egg avoid meat and fish; no_eggs avoids eggs;
 *  no_onion_garlic avoids onion and garlic). fasting and other are a note only. */
function checkedAs(r: Rule): Rule | null {
  if ((CHECKED_KINDS as readonly string[]).includes(r.kind)) return r;
  const items = r.kind === "veg" || r.kind === "no_meat" || r.kind === "egg" ? ["@meat", "@fish"]
    : r.kind === "no_eggs" ? ["@egg"] : r.kind === "no_onion_garlic" ? ["onion", "garlic"] : null;
  return items ? { ...r, kind: "avoid", items } : null;
}

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
  const add = (m: RuleMeal, b: Omit<RuleBreak, "meal" | "rule">, about = [mealLabel(m)]) =>
    out.push({ meal: mealLabel(m), ...(b.dish ? { dish: b.dish } : {}), ...(b.who ? { who: b.who } : {}), rule, fix: b.fix, about });
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
    case "swap":
      for (const m of inScope) for (const d of eaten(m, r.who!)) {
        const h = firstHit(d), note = d.portion_note ?? "";
        if (h && !(matches(note, r.who!) && matches(note, r.to!)))
          add(m, { dish: d.name, who: r.who, fix: `it has ${h}: say "${r.to} for ${r.who}" in its portion_note, or give ${r.who} a dish of their own` });
      }
      break;
    case "require":
      for (const m of inScope) for (const who of r.who ? (eatsAt(m, r.who) ? [r.who] : []) : diners(m))
        if (!eaten(m, who).some((d) => firstHit(d))) add(m, { who, fix: `add a dish with ${listText(items, " or ")} that ${who} eats` });
      break;
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

function found(week: RuleWeek, house: RuleHouse, people: { name: string }[]): Found[] {
  const meals = week.days.flatMap((d) => d.meals).sort((a, b) => a.date.localeCompare(b.date) || slotRank(a.slot) - slotRank(b.slot) || a.slot.localeCompare(b.slot));
  const all = house.rules.flatMap((r) => breaksOf(r, meals, people, house.extra_slots ?? []));
  const order = new Map(meals.map((m, i) => [mealLabel(m), i]));
  // By meal, in the week's order; within a meal, in the order of the rules.
  return all.map((b, i) => ({ b, i })).sort((x, y) => (order.get(x.b.meal) ?? 0) - (order.get(y.b.meal) ?? 0) || x.i - y.i).map((x) => x.b);
}

const plain = ({ about: _about, ...b }: Found): RuleBreak => b;

/** Every break of the house's rules in a week. */
export function ruleBreaks(week: RuleWeek, house: RuleHouse, people: { name: string }[]): RuleBreak[] {
  return found(week, house, people).map(plain);
}

/** The breaks a change to some meals of the week is answerable for: the breaks in those meals, and a cap over the week that
 *  one of them counts towards. `meals`: their labels, as mealLabel writes them. */
export function ruleBreaksIn(week: RuleWeek, house: RuleHouse, people: { name: string }[], meals: string[]): RuleBreak[] {
  const mine = new Set(meals);
  return found(week, house, people).filter((b) => b.about.some((m) => mine.has(m))).map(plain);
}

/** Every break in one message: "Mon 2026-11-23 Breakfast: Rava idli — Meera eats only … (add a dish for Meera)". */
export const breaksText = (breaks: RuleBreak[]): string =>
  breaks.map((b) => `${b.meal}: ${b.dish ? `${b.dish} — ` : ""}${b.rule} (${b.fix})`).join("; ");
