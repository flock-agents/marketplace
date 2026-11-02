// Idempotent data migration: fills aliases / unit_conversions / shelf_life_days for common Indian ingredients the
// catalog already has (matched by name or any known alias), and creates the household shopping_prefs row. Only
// ever fills a NULL — a value the family or the agent wrote is never overwritten.
import { eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { ingredients, shopping_prefs } from "./schema";
import { normalizeIngredientName } from "../ingredients";

interface Known { aliases: string[]; conv?: Record<string, number>; shelf: number }

/** name → English/Hindi aliases, grams (or ml) per unit, shelf life in days. */
export const KNOWN_INGREDIENTS: Record<string, Known> = {
  onion: { aliases: ["pyaz", "pyaaz", "kanda", "onions"], conv: { pc: 150 }, shelf: 21 },
  tomato: { aliases: ["tamatar", "tomatoes"], conv: { pc: 100 }, shelf: 6 },
  potato: { aliases: ["aloo", "alu", "batata", "potatoes"], conv: { pc: 150 }, shelf: 21 },
  spinach: { aliases: ["palak"], conv: { bunch: 250, cup: 30 }, shelf: 2 },
  coriander: { aliases: ["dhania", "dhaniya", "cilantro", "coriander leaves", "kothimbir"], conv: { bunch: 100, handful: 15, sprig: 5 }, shelf: 3 },
  "curry leaves": { aliases: ["kadi patta", "kari patta", "curry leaf"], conv: { sprig: 2, bunch: 25, handful: 5 }, shelf: 5 },
  "green chilli": { aliases: ["hari mirch", "green chillies", "green chili", "mirchi"], conv: { pc: 5 }, shelf: 7 },
  ginger: { aliases: ["adrak"], conv: { inch: 10, pc: 10 }, shelf: 14 },
  garlic: { aliases: ["lahsun", "lehsun", "garlic cloves"], conv: { clove: 5, pod: 40, pc: 5 }, shelf: 30 },
  lemon: { aliases: ["nimbu", "lime", "limbu"], conv: { pc: 60 }, shelf: 10 },
  cauliflower: { aliases: ["gobi", "phool gobi"], conv: { pc: 600 }, shelf: 5 },
  cabbage: { aliases: ["patta gobi", "bandh gobi"], conv: { pc: 800 }, shelf: 10 },
  okra: { aliases: ["bhindi", "lady finger", "ladies finger"], conv: { pc: 12 }, shelf: 3 },
  brinjal: { aliases: ["baingan", "eggplant", "aubergine"], conv: { pc: 250 }, shelf: 5 },
  carrot: { aliases: ["gajar"], conv: { pc: 80 }, shelf: 14 },
  peas: { aliases: ["matar", "green peas"], conv: { cup: 145 }, shelf: 3 },
  capsicum: { aliases: ["shimla mirch", "bell pepper"], conv: { pc: 150 }, shelf: 7 },
  cucumber: { aliases: ["kheera", "kakdi"], conv: { pc: 300 }, shelf: 6 },
  "bottle gourd": { aliases: ["lauki", "dudhi", "ghiya"], conv: { pc: 800 }, shelf: 7 },
  drumstick: { aliases: ["moringa", "sahjan", "drumsticks"], conv: { pc: 50 }, shelf: 5 },
  fenugreek: { aliases: ["methi", "methi leaves"], conv: { bunch: 150 }, shelf: 2 },
  mint: { aliases: ["pudina"], conv: { bunch: 50, handful: 10 }, shelf: 3 },
  banana: { aliases: ["kela", "bananas"], conv: { pc: 120 }, shelf: 4 },
  milk: { aliases: ["doodh"], conv: { cup: 240, glass: 250, packet: 500 }, shelf: 2 },
  curd: { aliases: ["dahi", "yogurt", "yoghurt"], conv: { cup: 245, katori: 150 }, shelf: 4 },
  paneer: { aliases: ["cottage cheese"], conv: { cup: 200 }, shelf: 4 },
  butter: { aliases: ["makhan"], conv: { tbsp: 14 }, shelf: 30 },
  ghee: { aliases: ["clarified butter", "desi ghee"], conv: { tbsp: 13, tsp: 4 }, shelf: 180 },
  cream: { aliases: ["malai", "fresh cream"], conv: { tbsp: 15 }, shelf: 5 },
  egg: { aliases: ["anda", "eggs", "ande"], conv: { pc: 50 }, shelf: 14 },
  chicken: { aliases: ["murgh", "murg"], shelf: 1 },
  bread: { aliases: ["pav", "double roti"], conv: { slice: 25, pc: 400 }, shelf: 4 },
  rice: { aliases: ["chawal", "basmati", "basmati rice"], conv: { cup: 185 }, shelf: 365 },
  atta: { aliases: ["wheat flour", "gehun atta", "whole wheat flour"], conv: { cup: 120 }, shelf: 90 },
  besan: { aliases: ["gram flour", "chickpea flour"], conv: { cup: 90, tbsp: 8 }, shelf: 120 },
  "toor dal": { aliases: ["arhar dal", "tuvar dal", "pigeon pea"], conv: { cup: 200 }, shelf: 365 },
  "moong dal": { aliases: ["mung dal", "yellow moong"], conv: { cup: 200 }, shelf: 365 },
  rajma: { aliases: ["kidney beans", "red kidney beans"], conv: { cup: 185 }, shelf: 365 },
  chole: { aliases: ["chana", "kabuli chana", "chickpeas"], conv: { cup: 200 }, shelf: 365 },
  poha: { aliases: ["flattened rice", "beaten rice", "thick poha"], conv: { cup: 100 }, shelf: 180 },
  sooji: { aliases: ["suji", "rava", "semolina"], conv: { cup: 170 }, shelf: 180 },
  peanuts: { aliases: ["moongphali", "groundnut", "shengdana"], conv: { cup: 145, tbsp: 9 }, shelf: 120 },
  oil: { aliases: ["tel", "cooking oil", "sunflower oil", "mustard oil"], conv: { tbsp: 14, tsp: 5, cup: 220 }, shelf: 180 },
  sugar: { aliases: ["cheeni", "shakkar"], conv: { tsp: 4, tbsp: 12, cup: 200 }, shelf: 730 },
  salt: { aliases: ["namak"], conv: { tsp: 6, pinch: 0.5 }, shelf: 1095 },
  turmeric: { aliases: ["haldi", "turmeric powder"], conv: { tsp: 3, pinch: 0.3 }, shelf: 365 },
  "cumin seeds": { aliases: ["jeera", "cumin"], conv: { tsp: 2 }, shelf: 365 },
  "mustard seeds": { aliases: ["rai", "sarson", "mustard"], conv: { tsp: 3 }, shelf: 365 },
  "garam masala": { aliases: [], conv: { tsp: 2 }, shelf: 180 },
  "red chilli powder": { aliases: ["lal mirch", "chilli powder", "kashmiri chilli powder", "mirchi powder"], conv: { tsp: 3 }, shelf: 365 },
  hing: { aliases: ["asafoetida"], conv: { pinch: 0.2, tsp: 3 }, shelf: 730 },
};

export const aliasIndex = (): Map<string, string> => {
  const idx = new Map<string, string>();
  for (const [name, k] of Object.entries(KNOWN_INGREDIENTS)) for (const n of [name, ...k.aliases]) idx.set(normalizeIngredientName(n), name);
  return idx;
};

interface Row { id: string; name: string; aliases: string | null; unit_conversions: string | null; shelf_life_days: number | null; shelf_life_source?: string | null }

/** The null-only fill for one catalog row, or null when nothing is known or nothing is missing. Pure. */
export function seedFillFor(row: Row, idx = aliasIndex()): Partial<Row> | null {
  const known = KNOWN_INGREDIENTS[idx.get(normalizeIngredientName(row.name)) ?? ""];
  if (!known) return null;
  const fill: Partial<Row> = {};
  if (row.aliases == null) fill.aliases = JSON.stringify(known.aliases);
  if (row.unit_conversions == null && known.conv) fill.unit_conversions = JSON.stringify(known.conv);
  if (row.shelf_life_days == null) { fill.shelf_life_days = known.shelf; fill.shelf_life_source = "default"; }
  return Object.keys(fill).length ? fill : null;
}

export function seedIngredientKnowledge(db: BunSQLiteDatabase<any>, emit?: (table: string, id: string, op: "insert" | "update") => void): number {
  const idx = aliasIndex();
  let changed = 0;
  for (const row of db.select({ id: ingredients.id, name: ingredients.name, aliases: ingredients.aliases, unit_conversions: ingredients.unit_conversions, shelf_life_days: ingredients.shelf_life_days }).from(ingredients).all() as Row[]) {
    const fill = seedFillFor(row, idx);
    if (!fill) continue;
    db.update(ingredients).set({ ...fill, updated_by: "app" }).where(eq(ingredients.id, row.id)).run();
    emit?.("ingredients", row.id, "update");
    changed++;
  }
  if (!db.select({ id: shopping_prefs.id }).from(shopping_prefs).where(eq(shopping_prefs.id, "household")).get()) {
    db.insert(shopping_prefs).values({ id: "household", combine_orders: 1, updated_by: "app" }).run();
    emit?.("shopping_prefs", "household", "insert");
  }
  return changed;
}
