// The food rules the app checks (docs/specs/2026-11-21-planner-food-rules-check.md). The model writes the plan; the app refuses
// a plan that breaks a rule the family stated, naming each break so the agent fixes it before anyone sees it. Pure: no
// database here, and nothing the pages cannot import (the Family page writes a rule in words with ruleText).
import { RULE_LABELS } from "./db/constants";
import { WEEKDAYS, weekdayOf, type Weekday } from "./dates";

/** A house rule as it is kept. `days` empty: every day; no `who`: everyone; no `slots`: every meal. */
export type Rule = { kind: string; who?: string; days: string[]; slots?: string[]; items?: string[]; to?: string; per_week?: number; note?: string };
export type RuleDish = { name: string; for_people: string[] | null; portion_note: string | null; ingredients: (string | { item: string })[] };
export type RuleMeal = { date: string; slot: string; ordered_in?: boolean; dishes: RuleDish[] };
/** A week as the checks read it: a WeekView is one. */
export type RuleWeek = { days: { date: string; meals: RuleMeal[] }[] };
/** One break: the meal ("Mon 2026-11-23 Breakfast"), the dish when it is one dish, whose rule, the rule in words, and the fix. */
export type RuleBreak = { meal: string; dish?: string; who?: string; rule: string; fix: string };

/** The kinds the app checks, and what each needs besides its kind. */
export const CHECKED_KINDS = ["avoid", "only", "swap", "require", "cap"] as const;
export const KIND_NEEDS: Record<(typeof CHECKED_KINDS)[number], string[]> = {
  avoid: ["items"], only: ["who", "items"], swap: ["who", "items", "to"], require: ["slots", "items"], cap: ["items", "per_week"],
};

/** The categories a rule's items may name as `@name`: each is the words that put a dish in it. */
export const CATEGORIES: Record<string, string[]> = {
  meat: ["meat", "chicken", "mutton", "lamb", "goat", "beef", "pork", "bacon", "ham", "keema", "kheema", "sausage", "salami", "pepperoni", "turkey", "duck", "liver"],
  fish: ["fish", "prawn", "shrimp", "crab", "lobster", "squid", "calamari", "seafood", "pomfret", "surmai", "rohu", "bangda", "mackerel", "sardine", "tuna",
    "salmon", "hilsa", "ilish", "anchovy", "clam", "mussel", "oyster", "katla", "basa", "tilapia"],
  egg: ["egg", "omelette", "omelet", "anda"],
  nuts: ["nut", "almond", "badam", "cashew", "kaju", "walnut", "akhrot", "pistachio", "pista", "peanut", "groundnut", "moongphali", "hazelnut", "pecan", "macadamia"],
  peanut: ["peanut", "groundnut", "moongphali", "peanut butter", "groundnut oil"],
  root_veg: ["onion", "garlic", "potato", "carrot", "beetroot", "radish", "sweet potato", "ginger", "yam", "arbi", "turnip"],
  green_leafy: ["palak", "spinach", "methi", "coriander", "dill", "curry leaves", "beans", "peas", "capsicum", "broccoli"],
  white_rice: ["rice", "basmati", "sona masoori", "idli rice", "dosa rice", "ponni", "raw rice", "boiled rice", "poha", "rice flour", "idli", "dosa", "appam", "neer dosa"],
  protein: ["paneer", "dal", "daal", "toor", "moong", "masoor", "urad", "chana", "chole", "rajma", "soya", "soy", "tofu", "sprouts", "curd", "dahi", "yogurt", "lobia",
    "besan", "egg", "chicken", "fish", "mutton", "lentil", "chickpea", "kidney bean", "prawn"],
  mushroom: ["mushroom", "shiitake", "khumb", "guchhi", "morel"],
  baked: ["bake", "baked", "cake", "muffin", "pizza", "bread loaf", "garlic bread", "oven"],
};
/** How a category reads in a rule. */
export const CATEGORY_LABELS: Record<string, string> = { meat: "meat", fish: "fish", egg: "eggs", nuts: "nuts", peanut: "peanuts", root_veg: "root vegetables",
  green_leafy: "green leafy vegetables", white_rice: "white rice", protein: "protein", mushroom: "mushrooms", baked: "baked food" };
/** A word before rice (or idli, dosa…) that says it is not white rice: millet, brown, red or ragi rice, a millet idli, a rava dosa. */
const NOT_WHITE = new Set(["millet", "brown", "red", "black", "wild", "ragi", "jowar", "bajra", "oat", "wheat", "rava", "sooji", "suji", "semolina", "quinoa",
  "cauliflower", "foxtail", "kodo", "barnyard", "little", "samai", "saamai", "varagu", "thinai", "kambu", "moong", "dal"]);

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
  const hay = wordsOf(opts.name ? stripNegations(text) : text);
  const whiteRice = item.trim().toLowerCase() === "@white_rice";
  for (const term of termsOf(item)) {
    const needle = wordsOf(term);
    for (const i of at(hay, needle)) {
      if (whiteRice && (NOT_WHITE.has(hay[i - 1]) || hay[i + needle.length] === "bran")) continue;
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

// ── Who eats what ──

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/** The dishes of a meal a person eats: the ones naming them, else every dish for no one in particular. */
export function eatenBy(meal: RuleMeal, person: string): RuleDish[] {
  const named = meal.dishes.filter((d) => d.for_people?.some((p) => same(p, person)));
  return named.length ? named : meal.dishes.filter((d) => !d.for_people?.length);
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
    case "cap": { const n = r.per_week ?? 0; return `${listText(r.items)} in at most ${n} meal${n === 1 ? "" : "s"} a week${r.who ? ` for ${r.who}` : ""}${scope}`; }
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

function breaksOf(shown: Rule, meals: RuleMeal[], people: { name: string }[]): Found[] {
  const r = checkedAs(shown);
  if (!r) return [];
  // A day in the family's own words ("Ekadashi") is not one the app can place: a rule with only such days is a note.
  const days = r.days.filter(isWeekday);
  if (r.days.length && !days.length) return [];
  const inScope = meals.filter((m) => !m.ordered_in && m.dishes.length
    && (!days.length || days.includes(weekdayOf(m.date))) && (!r.slots?.length || r.slots.some((s) => same(s, m.slot))));
  const rule = ruleText(shown);
  const items = r.items ?? [];
  const firstHit = (d: RuleDish) => items.map((i) => dishHit(d, i)).find((h) => h !== null) ?? null;
  const out: Found[] = [];
  const add = (m: RuleMeal, b: Omit<RuleBreak, "meal" | "rule">, about = [mealLabel(m)]) =>
    out.push({ meal: mealLabel(m), ...(b.dish ? { dish: b.dish } : {}), ...(b.who ? { who: b.who } : {}), rule, fix: b.fix, about });
  switch (r.kind) {
    case "avoid":
      for (const m of inScope) for (const d of r.who ? eatenBy(m, r.who) : m.dishes) {
        const h = firstHit(d);
        if (h) add(m, { dish: d.name, who: r.who, fix: `it has ${h}: ${r.who ? `give ${r.who} a dish without it` : "plan a dish without it"}` });
      }
      break;
    case "only":
      for (const m of inScope) {
        const eaten = eatenBy(m, r.who!);
        if (!eaten.length) add(m, { who: r.who, fix: `add a dish for ${r.who}: one of ${listText(items)}` });
        for (const d of eaten) if (!items.some((i) => matches(d.name, i, { name: true }))) add(m, { dish: d.name, who: r.who, fix: `add a dish for ${r.who}` });
      }
      break;
    case "swap":
      for (const m of inScope) for (const d of eatenBy(m, r.who!)) {
        const h = firstHit(d), note = d.portion_note ?? "";
        if (h && !(matches(note, r.who!) && matches(note, r.to!)))
          add(m, { dish: d.name, who: r.who, fix: `it has ${h}: say "${r.to} for ${r.who}" in its portion_note, or give ${r.who} a dish of their own` });
      }
      break;
    case "require":
      for (const m of inScope) for (const who of r.who ? [r.who] : people.map((p) => p.name))
        if (!eatenBy(m, who).some((d) => firstHit(d))) add(m, { who, fix: `add a dish with ${listText(items, " or ")} that ${who} eats` });
      break;
    case "cap": {
      const counted = inScope.map((m) => ({ m, d: (r.who ? eatenBy(m, r.who) : m.dishes).find((d) => firstHit(d)) })).filter((x) => x.d);
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

function found(week: RuleWeek, house: { rules: Rule[] }, people: { name: string }[]): Found[] {
  const meals = week.days.flatMap((d) => d.meals).sort((a, b) => a.date.localeCompare(b.date) || slotRank(a.slot) - slotRank(b.slot) || a.slot.localeCompare(b.slot));
  const all = house.rules.flatMap((r) => breaksOf(r, meals, people));
  const order = new Map(meals.map((m, i) => [mealLabel(m), i]));
  // By meal, in the week's order; within a meal, in the order of the rules.
  return all.map((b, i) => ({ b, i })).sort((x, y) => (order.get(x.b.meal) ?? 0) - (order.get(y.b.meal) ?? 0) || x.i - y.i).map((x) => x.b);
}

const plain = ({ about: _about, ...b }: Found): RuleBreak => b;

/** Every break of the house's rules in a week. */
export function ruleBreaks(week: RuleWeek, house: { rules: Rule[] }, people: { name: string }[]): RuleBreak[] {
  return found(week, house, people).map(plain);
}

/** The breaks a change to some meals of the week is answerable for: the breaks in those meals, and a cap over the week that
 *  one of them counts towards. `meals`: their labels, as mealLabel writes them. */
export function ruleBreaksIn(week: RuleWeek, house: { rules: Rule[] }, people: { name: string }[], meals: string[]): RuleBreak[] {
  const mine = new Set(meals);
  return found(week, house, people).filter((b) => b.about.some((m) => mine.has(m))).map(plain);
}

/** Every break in one message: "Mon 2026-11-23 Breakfast: Rava idli — Meera eats only … (add a dish for Meera)". */
export const breaksText = (breaks: RuleBreak[]): string =>
  breaks.map((b) => `${b.meal}: ${b.dish ? `${b.dish} — ` : ""}${b.rule} (${b.fix})`).join("; ");
