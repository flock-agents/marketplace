// The eval's own food vocabulary: which tags a dish has by its name, and when a saved rule item covers a truth one. It is
// deliberately the eval's (not server code's), so the planner is never scored by its own word list. Used for TRUTH dishes
// (with a household's per-dish overrides) and as a backstop for dishes the planner invents: a tag found here counts even
// when the planner read it as absent.

/** The base tags (spec §4.1 contains read) plus the narrower ones the eval households' rules name. */
export const BASE_TAGS = ["egg", "meat", "fish", "onion_garlic", "nuts", "peanut", "sugar", "white_rice", "dairy", "root_veg", "millet", "mushroom"] as const;

/** Narrower tags under a broader one: a rule on the broad tag catches a dish with the narrow one. */
export const PARENT: Record<string, string> = { chicken: "meat", red_meat: "meat", beef: "red_meat", pork: "red_meat", mutton: "red_meat", peanut: "nuts", brinjal: "veg_item" };

/** Words in a dish name that mean a tag. Whole-word, lower case; a phrase may hold spaces. */
const WORDS: Record<string, string[]> = {
  egg: ["egg", "eggs", "omelette", "omelet", "anda", "bhurji egg", "egg roll"],
  chicken: ["chicken", "murgh", "kozhi"],
  mutton: ["mutton", "lamb", "goat", "mangsho", "gosht", "keema", "rogan josh"],
  beef: ["beef"], pork: ["pork", "bacon", "ham"],
  meat: ["meat"],
  fish: ["fish", "maach", "maacher", "machher", "prawn", "prawns", "shrimp", "rui", "katla", "hilsa", "ilish", "pomfret", "surmai", "bangda", "chingri", "meen"],
  nuts: ["nut", "nuts", "kaju", "cashew", "badam", "almond", "walnut", "pista", "chikki"],
  peanut: ["peanut", "peanuts", "groundnut", "moongphali", "shengdana"],
  sugar: ["sugar", "sweet", "sheera", "halwa", "kheer", "payasam", "ladoo", "laddu", "jalebi", "gulab jamun", "barfi", "mishti", "rasgulla", "jaggery", "gur", "shrikhand", "basundi", "malpua", "custard"],
  white_rice: ["rice", "chawal", "bhaat", "pulao", "biryani", "idli", "dosa", "pongal", "khichdi", "khichuri", "bisi bele bath", "uthappam", "uttapam", "appam", "poha", "chire", "muri", "lemon rice", "curd rice", "tamarind rice", "varan bhaat"],
  dairy: ["paneer", "curd", "dahi", "raita", "kadhi", "lassi", "chaas", "buttermilk", "kheer", "cheese", "milk", "ghee", "butter", "shrikhand", "basundi", "malai", "rabri", "doi", "mor", "payasam"],
  root_veg: ["aloo", "potato", "alur", "alu", "carrot", "gajar", "beetroot", "radish", "mooli", "arbi", "yam", "sweet potato", "shakarkandi", "suran"],
  onion_garlic: ["onion", "garlic", "pyaz", "pyaaz", "lahsun", "lehsun", "do pyaza"],
  millet: ["ragi", "jowar", "bajra", "millet", "nachni", "foxtail", "kodo", "samai", "thinai", "varagu", "korra", "bhakri", "kambu"],
  mushroom: ["mushroom", "mushrooms", "khumb"],
  brinjal: ["brinjal", "baingan", "baigan", "eggplant", "vankaya", "kathirikai", "begun", "bharta", "bhartha"],
};
/** A word that undoes a tag in front of the dish ("millet rice" is not white rice; "eggless cake" has no egg). */
const UNDO: Record<string, RegExp> = {
  white_rice: /\b(millet|ragi|jowar|bajra|brown|red|foxtail|kodo|samai|oats?|quinoa|rava|wheat|moong|cauliflower)\s+(rice|idli|dosa|pongal|khichdi|upma|pulao)\b/i,
  egg: /\beggless\b/i,
  mutton: /\b(chicken|soya|soy|veg|vegetable|paneer|egg|fish|prawn)\s+keema\b/i,
  sugar: /\b(no|without|sugar[- ]?free)\s*sugar\b|\bsugar[- ]?free\b/i,
};
/** Dishes that are of a tag whatever their wording (a vegetarian kitchen's "rice" in a word list misses "bisi bele"). */
const IMPLIES: Record<string, string[]> = { biryani: ["white_rice"], "chicken rassa": ["chicken"], "kosha mangsho": ["mutton"] };

const norm = (s: string) => ` ${s.toLowerCase().replace(/[’']/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;

/** The tags a dish name says, the broad tags of narrow ones included (chicken → meat). */
export function tagsOfName(name: string): Set<string> {
  const n = norm(name), out = new Set<string>();
  for (const [tag, words] of Object.entries(WORDS)) if (words.some((w) => n.includes(` ${w} `))) out.add(tag);
  for (const [phrase, tags] of Object.entries(IMPLIES)) if (n.includes(` ${phrase} `)) tags.forEach((t) => out.add(t));
  for (const [tag, re] of Object.entries(UNDO)) {
    // Undo only when every hit of the tag is undone: "millet rice and dosa" still has white rice from the dosa.
    if (!re.test(name)) continue;
    const rest = name.replace(new RegExp(re.source, "gi"), " ");
    if (!(WORDS[tag] ?? []).some((w) => norm(rest).includes(` ${w} `))) out.delete(tag);
  }
  return withParents(out);
}

/** The tag set with every broader tag of each tag added. */
export function withParents(tags: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (let t of tags) { t = canonTag(t); out.add(t); for (let p = PARENT[t]; p; p = PARENT[p]) out.add(p); }
  return out;
}

/** A rule item or contains tag in one spelling: "@nuts" → "nuts", "Eggs" → "egg", "onion" → "onion_garlic". */
export function canonTag(item: string): string {
  const t = item.trim().toLowerCase().replace(/^@/, "").replace(/[\s-]+/g, "_");
  const map: Record<string, string> = {
    eggs: "egg", sweet: "sugar", sweets: "sugar", jaggery: "sugar", onion: "onion_garlic", garlic: "onion_garlic", onions: "onion_garlic",
    onion_and_garlic: "onion_garlic", onion_or_garlic: "onion_garlic", peanuts: "peanut", groundnut: "peanut", groundnuts: "peanut",
    mushrooms: "mushroom", millets: "millet", ragi: "millet", jowar: "millet", bajra: "millet", rice: "white_rice",
    red_meat: "red_meat", lamb: "mutton", goat: "mutton", seafood: "fish", nut: "nuts", tree_nuts: "nuts", root_vegetables: "root_veg",
    potato: "root_veg", potatoes: "root_veg", milk: "dairy", baingan: "brinjal", eggplant: "brinjal",
  };
  return map[t] ?? t;
}

/** Does a saved rule item cover a truth item: the same tag, or a broader one ("meat" covers "chicken"). */
export function itemCovers(saved: string, truth: string): boolean {
  const s = canonTag(saved), t = canonTag(truth);
  if (s === t) return true;
  for (let p = PARENT[t]; p; p = PARENT[p]) if (p === s) return true;
  return false;
}

/** Does a dish with these tags break a rule item ("meat" is broken by a chicken dish). */
export const hasItem = (dishTags: Set<string>, item: string): boolean => dishTags.has(canonTag(item)) || [...dishTags].some((t) => itemCovers(item, t));
