import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { meals, recipes, groceries, SLOTS } from "./schema";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The Monday on or before `from`, as an ISO date. */
export const mondayOf = (from = new Date()): string => {
  const back = (from.getDay() + 6) % 7;
  return iso(new Date(from.getFullYear(), from.getMonth(), from.getDate() - back));
};
const plusDays = (monday: string, n: number): string => {
  const [y, m, d] = monday.split("-").map(Number);
  return iso(new Date(y, m - 1, d + n));
};

// Monday to Sunday; each day is [breakfast, lunch, dinner], each a meal's dishes ([] when nobody is cooking).
// A meal is usually several dishes, and each dish is its own row: "Bhindi fry" is three rows, never one.
const WEEK: string[][][] = [
  [["Poha"], ["Dal", "Rice", "Bhindi fry"], ["Palak paneer", "Phulka"]],
  [["Idli", "Sambar"], ["Rajma chawal", "Salad"], ["Lemon chicken", "Salad"]],
  [["Upma"], ["Curd rice", "Pickle"], ["Kadhi", "Rice"]],
  [["Paratha", "Curd"], ["Leftover rajma"], ["Pasta", "Garlic bread"]],
  [["Besan chilla"], ["Veg pulao", "Raita"], ["Pizza night"]],
  [["Dosa brunch"], [], ["Eating out"]],
  [["Aloo puri"], ["Chole", "Jeera rice"], ["Biryani", "Raita"]],
];

/** The family's recipe book: what they cook often, with the ingredients one per line and how they like it made. */
export const sampleRecipes = () => [
  {
    name: "Poha",
    ingredients: "Thick poha, 2 cups\nOnion, 1 large\nPotato, 1 small\nPeanuts, 2 tbsp\nGreen chillies, 2\nCurry leaves, 1 sprig\nMustard seeds, 1 tsp\nTurmeric, 1/2 tsp\nLemon, 1\nCoriander, a handful",
    method: "Rinse the poha in a sieve and leave it to soften while the pan heats. Fry the peanuts first and keep them aside. Mustard seeds, curry leaves and chillies, then the onion and potato until soft. Turmeric and salt, fold in the poha on low heat and cover for two minutes. Lemon, coriander and the peanuts on top; Maya adds a pinch of sugar.",
    notes: null,
  },
  {
    name: "Rajma chawal",
    ingredients: "Rajma, 1 cup (soaked overnight)\nOnions, 2\nTomatoes, 3\nGinger-garlic paste, 1 tbsp\nGreen chillies, 2\nRajma masala, 2 tsp\nKashmiri chilli powder, 1 tsp\nBasmati rice, 1.5 cups\nGhee, 2 tbsp",
    method: "Pressure cook the soaked rajma for six whistles. Brown the onions slowly, then ginger-garlic and the tomatoes until the oil comes away. Add the rajma with its water, mash a few beans to thicken it and simmer for twenty minutes. The children's portion comes out before the chilli powder goes in. Plain basmati on the side, a spoon of ghee on top.",
    notes: "Jain version: no onion or garlic, a pinch of hing instead.",
  },
  {
    name: "Palak paneer",
    ingredients: "Palak (spinach), 2 bunches\nPaneer, 250 g\nOnion, 1\nTomato, 1\nGarlic, 6 cloves\nGreen chillies, 2\nJeera, 1 tsp\nFresh cream, 2 tbsp\nKasuri methi, 1 tsp",
    method: "Blanch the palak for two minutes, straight into cold water so it stays green, then blend it with the chillies. Jeera and garlic in hot oil, then onion and tomato until soft. Stir in the palak and simmer five minutes. Paneer cubes go in last, lightly fried, with the cream and crushed kasuri methi. Eaten with jeera rice or phulkas.",
    notes: null,
  },
  {
    name: "Chole",
    ingredients: "Kabuli chana, 1 cup (soaked overnight)\nTea bags, 2\nOnions, 2\nTomatoes, 3\nGinger, 1 inch\nChole masala, 2 tbsp\nAmchur, 1 tsp\nBay leaf, 1",
    method: "Pressure cook the chana with the tea bags and the bay leaf for the dark colour, then take the tea bags out. Onions until deep brown, ginger, then the tomatoes and chole masala. Add the chana with some of its water and simmer until thick. Amchur at the end. Sunday lunch with kulchas or puris.",
    notes: "Soak the chana on Saturday night.",
  },
  {
    name: "Veg pulao",
    ingredients: "Basmati rice, 1.5 cups\nCarrot, 1\nBeans, a handful\nPeas, 1/2 cup\nOnion, 1\nBay leaf, cloves, cardamom\nGhee, 2 tbsp\nCurd, for the raita",
    method: "Wash the rice and soak it for twenty minutes. Whole spices in ghee, then sliced onion until golden, then the vegetables for a few minutes. Add the rice and twice its water with salt, cook covered on low until done and leave it shut for five more minutes. A quick cucumber raita with it.",
    notes: null,
  },
];
const RECIPE_NAMES = new Set(sampleRecipes().map((r) => r.name));

/**
 * An Indian household's meals from the Monday of the week containing `from` to the Sunday after, so the Schedule view always
 * has today and tomorrow filled, even when the app is created on a Sunday. A dish from the recipe book names its recipe.
 * The second week is the first one shifted by three days, so it is not a copy. One row per dish; a meal is the rows on one date and slot.
 */
export const sampleMeals = (from = new Date()) => {
  const monday = mondayOf(from);
  const rows: { date: string; slot: string; dish: string; recipe: string | null }[] = [];
  for (let i = 0; i < 14; i++) {
    const day = WEEK[i < 7 ? i : (i - 7 + 3) % 7];
    day.forEach((dishes, j) => {
      for (const dish of dishes) rows.push({ date: plusDays(monday, i), slot: SLOTS[j], dish, recipe: RECIPE_NAMES.has(dish) ? dish : null });
    });
  }
  return rows;
};

export const sampleGroceries = () => [
  { item: "Palak (spinach), 3 bunches", aisle: "Vegetables", done: false, for_dish: "Palak paneer" },
  { item: "Bhindi, 500 g", aisle: "Vegetables", done: true, for_dish: "Bhindi fry" },
  { item: "Lemons, 6", aisle: "Vegetables", done: false, for_dish: "Lemon chicken" },
  { item: "Paneer, 400 g", aisle: "Dairy", done: false, for_dish: "Palak paneer" },
  { item: "Curd, 1 kg", aisle: "Dairy", done: true, for_dish: "Curd rice" },
  { item: "Amul butter, 100 g", aisle: "Dairy", done: false, for_dish: "Paratha" },
  { item: "Rajma, 1 kg", aisle: "Staples", done: true, for_dish: "Rajma chawal" },
  { item: "Basmati rice, 5 kg", aisle: "Staples", done: false, for_dish: null },
  { item: "Besan, 1 kg", aisle: "Staples", done: false, for_dish: "Besan chilla" },
  { item: "Penne pasta, 500 g", aisle: "Staples", done: false, for_dish: "Pasta" },
  { item: "Jeera, 100 g", aisle: "Spices", done: false, for_dish: "Palak paneer" },
  { item: "Biryani masala", aisle: "Spices", done: false, for_dish: "Biryani" },
];

/** One second apart and all in the past, so the rows keep this order instead of tying on created_at. */
export const staggered = <T extends object>(rows: T[], from = new Date()) =>
  rows.map((r, i) => ({ ...r, created_at: new Date(from.getTime() - (rows.length - i) * 1000).toISOString() }));

export async function seed(db: BunSQLiteDatabase<any>) {
  const book = await db.insert(recipes).values(staggered(sampleRecipes())).returning();
  const idOf = new Map(book.map((r) => [r.name, r.id]));
  await db.insert(meals).values(staggered(sampleMeals().map(({ recipe, ...m }) => ({ ...m, recipe_id: recipe ? idOf.get(recipe) ?? null : null }))));
  await db.insert(groceries).values(staggered(sampleGroceries()));
}
