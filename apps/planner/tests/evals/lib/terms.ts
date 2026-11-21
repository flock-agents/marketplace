// The eval's OWN word lists, written as a parent would judge a plate. Deliberately independent of the app's rule module:
// the evals score the app (and the model), so they must not share its notion of what "peanut" or "root veg" covers.

export const CATEGORIES: Record<string, string[]> = {
  meat: ["chicken", "mutton", "lamb", "goat", "pork", "beef", "keema", "kheema", "bacon", "ham", "sausage", "salami", "pepperoni", "turkey", "duck"],
  fish: ["fish", "prawn", "shrimp", "crab", "squid", "mackerel", "bangda", "pomfret", "surmai", "rohu", "hilsa", "sardine", "tuna", "salmon", "lobster", "meen", "chepala"],
  egg: ["egg", "eggs", "omelette", "omelet", "anda", "mayonnaise", "mayo", "frittata", "egg bhurji", "scrambled egg", "boiled egg"],
  peanut: ["peanut", "groundnut", "moongphali", "mungfali", "shengdana", "singdana", "verkadalai", "kadlekai", "chikki", "groundnut oil", "peanut oil", "peanut butter"],
  nuts: ["cashew", "kaju", "almond", "badam", "walnut", "akhrot", "pista", "pistachio", "hazelnut", "pine nut", "macadamia", "chironji", "nut", "nuts", "dry fruit", "mixed nuts"],
  root_veg: ["onion", "garlic", "potato", "aloo", "alu", "carrot", "gajar", "beetroot", "beet", "radish", "mooli", "sweet potato", "shakarkand", "ginger", "adrak", "yam", "suran", "jimikand", "arbi", "colocasia", "turnip", "shalgam", "shallot", "spring onion", "leek", "tapioca", "kappa"],
  potato: ["potato", "aloo", "alu", "batata"],
  green_veg: ["palak", "spinach", "methi", "fenugreek leaves", "dill", "suva", "sabsige", "beans", "french beans", "cluster beans", "gawar", "peas", "matar", "green peas", "capsicum", "bell pepper", "broccoli", "okra", "bhindi", "lady finger", "drumstick leaves", "moringa", "keerai", "soppu", "sarson", "bathua", "amaranth", "chauli", "zucchini", "tindora", "kovakkai", "ivy gourd", "snake gourd", "green moong", "edamame", "kale", "lettuce", "cucumber", "pudina chutney", "green chutney", "hara bhara"],
  green_garnish: ["coriander", "coriander leaves", "cilantro", "dhania", "kothimbir", "curry leaves", "kadi patta", "mint", "pudina", "spring onion"],
  white_rice: ["rice", "basmati", "sona masoori", "ponni", "idli", "idly", "dosa", "dosai", "uttapam", "uthappam", "appam", "neer dosa", "poha", "avalakki", "aval", "pulao", "biryani", "pongal", "bisi bele", "puttu", "idiyappam", "rice flour", "akki", "chawal", "kozhukattai", "paniyaram", "set dosa", "curd rice", "lemon rice", "jeera rice", "sambar rice", "full meals"],
  millet: ["ragi", "jowar", "bajra", "millet", "foxtail", "kodo", "little millet", "samai", "varagu", "thinai", "korra", "saame", "navane", "barnyard", "sanwa", "quinoa", "oats", "nachni"],
  sugar: ["sugar", "jaggery", "gud", "honey", "condensed milk", "sheera", "kesari", "halwa", "kheer", "payasam", "ladoo", "laddu", "jalebi", "gulab jamun"],
  protein: ["paneer", "dal", "daal", "dhal", "toor", "tuvar", "moong", "masoor", "urad", "chana", "chole", "chickpea", "rajma", "kidney bean", "soya", "soy", "tofu", "sprouts", "curd", "dahi", "yogurt", "yoghurt", "lobia", "chawli", "besan", "sambar", "kadhi", "raita", "pesarattu", "adai", "cheese", "egg", "omelette", "chicken", "fish", "mutton", "prawn", "lentil", "peanut", "kootu", "usal", "misal", "matki", "horse gram", "kulthi", "chilla", "cheela", "dhokla", "thayir", "mor kuzhambu", "pappu", "paruppu", "bele", "keema"],
  vegan_protein: ["dal", "daal", "dhal", "toor", "tuvar", "moong", "masoor", "urad", "chana", "chole", "chickpea", "rajma", "kidney bean", "soya", "tofu", "sprouts", "lobia", "chawli", "besan", "sambar", "lentil", "pesarattu", "adai", "chilla", "cheela", "usal", "misal", "matki", "horse gram", "kulthi", "pappu", "paruppu", "bele", "peanut", "tempeh", "edamame"],
  dal: ["dal", "daal", "dhal", "toor", "tuvar", "arhar", "moong dal", "masoor", "urad dal", "chana dal", "sambar", "pappu", "paruppu", "bele", "lentil", "rasam", "saaru", "dal khichdi", "moong khichdi", "kootu", "dal makhani", "dal tadka", "dal fry"],
  soy: ["soy", "soya", "soybean", "tofu", "soy sauce", "soy milk", "soya chunks", "nutrela", "edamame", "tempeh", "miso"],
  dairy: ["milk", "curd", "dahi", "yogurt", "yoghurt", "paneer", "ghee", "butter", "cream", "malai", "cheese", "khoa", "khoya", "mawa", "buttermilk", "chaas", "mor", "raita", "lassi", "kheer", "payasam", "condensed milk", "thayir", "kadhi", "shrikhand", "basundi", "rabri", "makhani", "butter masala"],
  gluten: ["wheat", "atta", "maida", "rava", "sooji", "suji", "semolina", "bread", "biscuit", "roti", "chapati", "chapathi", "phulka", "paratha", "parantha", "puri", "poori", "naan", "kulcha", "bhatura", "pav", "bun", "pasta", "noodle", "maggi", "vermicelli", "sevai", "semiya", "seviyan", "dalia", "daliya", "broken wheat", "barley", "jau", "thepla", "khakhra", "rusk", "toast", "sandwich", "cake", "cookie", "muffin", "pizza", "burger", "samosa", "kachori", "mathri", "seitan", "couscous", "lapsi", "bulgur"],
  hard_food: ["roti", "chapati", "chapathi", "phulka", "paratha", "parantha", "puri", "poori", "papad", "appalam", "vada", "pakoda", "pakora", "bajji", "bhaji fry", "fryums", "chips", "kurkure", "murukku", "chakli", "mathri", "khakhra", "toast", "rusk", "cutlet", "tikki", "samosa", "kachori", "bhatura", "naan", "fries", "aloo fry", "bhindi fry", "potato fry", "crispy", "thalipeeth", "bhakri", "jowar roti", "bajra roti", "ragi roti", "akki roti", "kurkuri", "chikki", "nuts"],
  pickle: ["pickle", "achar", "achaar", "avakaya", "uppinakayi", "oorugai", "thokku"],
  chilli: ["chilli", "chili", "chilly", "mirchi", "mirch", "green chilli", "red chilli", "chilli powder", "red chilli powder", "cayenne", "kashmiri chilli", "byadgi", "guntur", "chilli flakes", "sambar powder", "rasam powder", "pav bhaji masala", "chole masala"],
  bitter_gourd: ["bitter gourd", "karela", "pavakkai", "hagalkai", "kakarakaya", "bitter melon"],
  brinjal: ["brinjal", "baingan", "eggplant", "aubergine", "vangi", "kathirikai", "badanekai", "vankaya", "bharta", "begun"],
  baked: ["bake", "baked", "oven", "cake", "muffin", "cookie", "brownie", "pizza", "bread loaf", "garlic bread", "lasagna", "lasagne", "focaccia", "pie", "tart", "souffle", "gratin", "roasted vegetables", "baked beans"],
  south_indian_breakfast: ["idli", "idly", "dosa", "dosai", "dose", "uttapam", "uthappam", "pongal", "upma", "uppittu", "pesarattu", "appam", "adai", "paniyaram", "paddu", "puttu", "idiyappam", "neer dosa", "set dosa", "akki roti", "kozhukattai", "sevai", "semiya upma", "khara bath", "chow chow bath", "avalakki", "vada", "rava idli", "ragi dosa", "ragi idli", "kesari bath", "bisi bele"],
  slow_breakfast: ["puri", "poori", "paratha", "parantha", "chole", "bhature", "bhatura", "vada", "medu vada", "kachori", "misal", "pav bhaji", "idiyappam", "dhokla", "biryani", "pulao", "bisi bele", "halwa", "puttu"],
  slow_dish: ["biryani", "pulao", "bisi bele", "rajma", "chole", "chana masala", "dal makhani", "paratha", "parantha", "puri", "poori", "kofta", "butter masala", "makhani", "dum", "korma", "kurma", "sambar", "avial", "bhature", "halwa", "kheer", "payasam", "dhokla", "pav bhaji", "undhiyu", "kadhi", "kootu", "gatte", "malai", "full meals"],
  wet: ["gravy", "curry", "sambar", "rasam", "saaru", "dal", "kadhi", "curd rice", "dahi", "raita", "soup", "stew", "kurma", "korma", "masala curry", "makhani", "dal khichdi", "moong dal khichdi", "pongal", "payasam", "kheer", "chole", "rajma", "kootu", "huli", "kuzhambu", "bisi bele"],
  /** A dish that is a side when its name holds one of these. */
  side: ["chutney", "podi", "gunpowder", "pickle", "achar", "raita", "salad", "papad", "thokku", "kosambari"],
  /** A dish that is a side when its whole name is one of these. */
  side_exact: ["curd", "dahi", "yogurt", "plain curd", "fruit", "fruits", "seasonal fruit", "fruit bowl", "sliced fruit", "cut fruit", "banana", "milk", "tea", "coffee", "ghee", "butter", "buttermilk", "chaas", "sambar"].filter((w) => w !== "sambar"),
};

// The contract's category names that the lists above spell differently.
CATEGORIES.green_leafy = [...CATEGORIES.green_veg, ...CATEGORIES.green_garnish];
CATEGORIES.mushroom = ["mushroom", "button mushroom", "shiitake"];
CATEGORIES.sweet = CATEGORIES.sugar;

const STOP = new Set<string>();
/** Words of a text: lower case, letters and digits only, a trailing plural s/es dropped. */
export function words(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean).filter((w) => !STOP.has(w)).map(single);
}
function single(w: string): string {
  if (w.length > 4 && /(ches|shes|xes|ses|oes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}
/** Does `text` hold `term` as consecutive words? */
export function hasPhrase(text: string, term: string): boolean {
  const t = words(text), p = words(term);
  if (!p.length) return false;
  for (let i = 0; i + p.length <= t.length; i++) if (p.every((w, j) => t[i + j] === w)) return true;
  return false;
}
/** Terms with `@category` opened up; `lenient`: an unknown category stands for its own name (a model's own category). */
export function expandLenient(terms: string[]): string[] {
  return terms.flatMap((t) => (t.startsWith("@") ? [...(CATEGORIES[t.slice(1)] ?? []), t.slice(1).replace(/_/g, " ")] : [t]));
}
/** Terms with `@category` opened up. */
export function expand(terms: string[]): string[] {
  return terms.flatMap((t) => (t.startsWith("@") ? CATEGORIES[t.slice(1)] ?? (() => { throw new Error(`unknown category ${t}`); })() : [t]));
}
/** A dish name with what it says it leaves out removed: "(no peanuts)", "without onion", "no-garlic". The whole list goes:
 *  "no onion garlic", "no onion, garlic", "no onion or garlic"; in brackets, from the negation to the bracket's end
 *  ("Moong dal (Jain, no onion garlic)"). */
export function positiveName(name: string): string {
  return name
    .replace(/\(\s*(no|without|minus|skip|less|zero|free of)\b[^)]*\)/gi, " ")
    .replace(/([(,;]\s*)(no|without|minus|sans)\s+[^)]*\)/gi, "$1)")
    // A list running to the end of the name or a comma/bracket may be joined by spaces too ("no onion garlic"); else as before.
    .replace(/\b(without|no|minus|sans)\s+(?:[a-z]+(?:(?:\s*,\s*|\s+(?:or|and|&)\s+|\s+)(?!(?:with|served|topped)\b)[a-z]+)*(?=\s*(?:[,;)\]]|$))|[a-z]+(?:\s+(?:or|and|&|,)\s*[a-z]+)*)/gi, " ")
    .replace(/\b[a-z]+[- ]free\b/gi, " ");
}
/** A name that says it has no sugar ("Banana sheera (no sugar)", "sugar-free halwa") is not sweet by its name. */
export const saysNoSugar = (name: string): boolean => /\b(no|without|minus|zero)\s+(added\s+)?sugar\b|\bsugar[\s-]*free\b|\bunsweetened\b/i.test(name);
/** Plant milks are not milk: "coconut milk" must not read as dairy. */
const PLANT_MILK = /\b(coconut|almond|oat|soy|soya|rice|cashew)\s+(milk|cream|curd|yogurt|yoghurt|butter)\b/gi;
/** The first of `terms` the text holds, or null. */
export function firstHit(text: string, terms: string[]): string | null {
  text = text.replace(PLANT_MILK, "$1 plant$2");
  for (const t of terms) if (hasPhrase(text, t)) return t;
  return null;
}
