// Plain constants, no imports: every nutrient a meal carries beyond the headline three (kcal, protein, fiber), tracked in the
// background for review. The key is the column on events and meal_plan_items, its unit in its name, like protein_g.

export type NutrientGroup = "Headline" | "Macros" | "Vitamins" | "Minerals";
export interface Nutrient { key: string; label: string; unit: "kcal" | "g" | "mg" | "mcg"; group: NutrientGroup }

/** The headline numbers every meal already carries, first in a review. */
export const HEADLINE = [
  { key: "kcal", label: "Calories", unit: "kcal", group: "Headline" },
  { key: "protein_g", label: "Protein", unit: "g", group: "Headline" },
  { key: "fiber_g", label: "Fiber", unit: "g", group: "Headline" },
] as const satisfies readonly Nutrient[];

/** The full breakdown estimated for every meal, alongside the headline three. */
export const NUTRIENTS = [
  { key: "carbs_g", label: "Carbohydrates", unit: "g", group: "Macros" },
  { key: "sugar_g", label: "Sugars", unit: "g", group: "Macros" },
  { key: "fat_g", label: "Fat", unit: "g", group: "Macros" },
  { key: "sat_fat_g", label: "Saturated fat", unit: "g", group: "Macros" },
  { key: "mufa_g", label: "Monounsaturated fat", unit: "g", group: "Macros" },
  { key: "pufa_g", label: "Polyunsaturated fat", unit: "g", group: "Macros" },
  { key: "omega3_g", label: "Omega-3", unit: "g", group: "Macros" },
  { key: "cholesterol_mg", label: "Cholesterol", unit: "mg", group: "Macros" },
  { key: "vitamin_a_mcg", label: "Vitamin A (RAE)", unit: "mcg", group: "Vitamins" },
  { key: "vitamin_c_mg", label: "Vitamin C", unit: "mg", group: "Vitamins" },
  { key: "vitamin_d_mcg", label: "Vitamin D", unit: "mcg", group: "Vitamins" },
  { key: "vitamin_e_mg", label: "Vitamin E", unit: "mg", group: "Vitamins" },
  { key: "vitamin_k_mcg", label: "Vitamin K", unit: "mcg", group: "Vitamins" },
  { key: "thiamin_mg", label: "Thiamin (B1)", unit: "mg", group: "Vitamins" },
  { key: "riboflavin_mg", label: "Riboflavin (B2)", unit: "mg", group: "Vitamins" },
  { key: "niacin_mg", label: "Niacin (B3)", unit: "mg", group: "Vitamins" },
  { key: "pantothenic_acid_mg", label: "Pantothenic acid (B5)", unit: "mg", group: "Vitamins" },
  { key: "vitamin_b6_mg", label: "Vitamin B6", unit: "mg", group: "Vitamins" },
  { key: "biotin_mcg", label: "Biotin (B7)", unit: "mcg", group: "Vitamins" },
  { key: "folate_mcg", label: "Folate (B9)", unit: "mcg", group: "Vitamins" },
  { key: "vitamin_b12_mcg", label: "Vitamin B12", unit: "mcg", group: "Vitamins" },
  { key: "choline_mg", label: "Choline", unit: "mg", group: "Vitamins" },
  { key: "calcium_mg", label: "Calcium", unit: "mg", group: "Minerals" },
  { key: "iron_mg", label: "Iron", unit: "mg", group: "Minerals" },
  { key: "magnesium_mg", label: "Magnesium", unit: "mg", group: "Minerals" },
  { key: "phosphorus_mg", label: "Phosphorus", unit: "mg", group: "Minerals" },
  { key: "potassium_mg", label: "Potassium", unit: "mg", group: "Minerals" },
  { key: "sodium_mg", label: "Sodium", unit: "mg", group: "Minerals" },
  { key: "zinc_mg", label: "Zinc", unit: "mg", group: "Minerals" },
  { key: "copper_mg", label: "Copper", unit: "mg", group: "Minerals" },
  { key: "manganese_mg", label: "Manganese", unit: "mg", group: "Minerals" },
  { key: "selenium_mcg", label: "Selenium", unit: "mcg", group: "Minerals" },
  { key: "iodine_mcg", label: "Iodine", unit: "mcg", group: "Minerals" },
] as const satisfies readonly Nutrient[];

export type NutrientKey = (typeof NUTRIENTS)[number]["key"];
export type Nutrients = Record<NutrientKey, number | null>;
export const NUTRIENT_KEYS: readonly NutrientKey[] = NUTRIENTS.map((n) => n.key);
/** Every number a review adds up: the headline three, then the full breakdown. */
export const REVIEWED: readonly Nutrient[] = [...HEADLINE, ...NUTRIENTS];

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A row's nutrient columns, each a number or null. */
export const pickNutrients = (row: Record<string, unknown>): Nutrients =>
  Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, num(row[k])])) as Nutrients;

/** The nutrients a row does not carry as a number. */
export const missingNutrients = (row: Record<string, unknown>): NutrientKey[] => NUTRIENT_KEYS.filter((k) => num(row[k]) === null);
