// Unit normalisation for the quantity engine: every amount ends up in one of three base units (g | ml | pc).
// Pure, no DB. An ingredient's own `unit_conversions` ({ "pc": 150, "bunch": 250 }: grams — or ml for a liquid —
// per unit) bridges a count or a kitchen measure to its weight; g and ml are treated as interchangeable (density
// ≈ 1) because the output is a rough range, never an exact weigh-out.
export type BaseUnit = "g" | "ml" | "pc";
export type UnitConversions = Record<string, number>;
export interface Amount { qty: number; unit: BaseUnit }

const MASS: Record<string, number> = { g: 1, gm: 1, gms: 1, gram: 1, grams: 1, kg: 1000, kgs: 1000, kilo: 1000 };
const VOLUME: Record<string, number> = {
  ml: 1, l: 1000, ltr: 1000, litre: 1000, liter: 1000, litres: 1000, liters: 1000,
  tsp: 5, teaspoon: 5, teaspoons: 5, tbsp: 15, tablespoon: 15, tablespoons: 15, cup: 240, cups: 240, glass: 250, glasses: 250,
};
const COUNT = new Set(["", "pc", "pcs", "piece", "pieces", "no", "nos", "unit", "units", "whole", "large", "medium", "small", "each"]);

export const normUnit = (unit: string | null | undefined): string => (unit ?? "").trim().toLowerCase().replace(/\.$/, "");

/** The kind of base unit an ingredient is bought in: its default_unit's kind, else grams when it has any
 *  weight conversions, else a plain count. */
export function baseKindOf(defaultUnit: string | null | undefined, conv: UnitConversions): BaseUnit {
  const u = normUnit(defaultUnit);
  if (u in MASS) return "g";
  if (u in VOLUME) return "ml";
  return Object.keys(conv).length ? "g" : "pc";
}

/** Converts a raw recipe amount into the ingredient's base unit. Never throws: an unknown unit with no conversion
 *  becomes a count, so a line is still bought rather than silently dropped. */
export function toBase(qty: number, unit: string | null | undefined, conv: UnitConversions, kind: BaseUnit): Amount {
  const u = normUnit(unit);
  const weighed = (n: number, fallback: BaseUnit): Amount => ({ qty: qty * n, unit: kind === "pc" ? fallback : kind });
  if (u in MASS) return weighed(MASS[u], "g");
  if (u in conv) return weighed(conv[u], "g");
  if (u in VOLUME) return weighed(VOLUME[u], "ml");
  const pc = conv.pc ?? conv.piece;
  if (COUNT.has(u) && pc && kind !== "pc") return weighed(pc, kind);
  return { qty, unit: "pc" };
}

/** Re-expresses `a` in `unit`, or null when the conversions can't bridge the two (a count with no weight per piece). */
export function convertTo(a: Amount, unit: BaseUnit, conv: UnitConversions): Amount | null {
  if (a.unit === unit) return a;
  const weightish = (u: BaseUnit) => u === "g" || u === "ml";
  if (weightish(a.unit) && weightish(unit)) return { qty: a.qty, unit };
  const pc = conv.pc ?? conv.piece;
  if (!pc) return null;
  if (a.unit === "pc") return { qty: a.qty * pc, unit };
  return { qty: a.qty / pc, unit };
}

export const round1 = (n: number): number => Math.round(n * 10) / 10;
