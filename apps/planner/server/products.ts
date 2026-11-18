// The product an item is bought as on a grocery app: its id there, its name, pack and price. The agent picks it once
// (remember_product, or from the order history) and the next order reuses it without searching. Amounts and packs are compared
// in one base unit each (grams, millilitres, pieces), so "1.2 kg" of an item sold in 500 g packs is 3 packs.
import type { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { products } from "./db/schema";
import { GROCERY_APPS, type GroceryApp } from "./db/constants";
import { name, refuse, words, writeRoutes, type Db, type Emit } from "./family";

export type ProductRow = typeof products.$inferSelect;
export type ProductInput = { item: string; app: string; product_id: string; name_on_app: string; pack?: string | null;
  pack_amount?: number | null; pack_unit?: string | null; price?: number | null; image?: string | null };

/** An item's name as it is matched: lowercase, trimmed, single spaces. */
export function normItem(item: string): string { return item.trim().toLowerCase().replace(/\s+/g, " "); }

const BASE: Record<string, { unit: "g" | "ml" | "pc"; times: number }> = {
  g: { unit: "g", times: 1 }, gm: { unit: "g", times: 1 }, gram: { unit: "g", times: 1 }, grams: { unit: "g", times: 1 },
  kg: { unit: "g", times: 1000 },
  ml: { unit: "ml", times: 1 },
  l: { unit: "ml", times: 1000 }, ltr: { unit: "ml", times: 1000 }, litre: { unit: "ml", times: 1000 }, litres: { unit: "ml", times: 1000 },
  pc: { unit: "pc", times: 1 }, pcs: { unit: "pc", times: 1 }, piece: { unit: "pc", times: 1 }, pieces: { unit: "pc", times: 1 },
};

/** An amount in its base unit (grams, millilitres or pieces), or null when the unit is not one the app can compare. */
export function toBase(amount: number, unit: string | null | undefined): { amount: number; unit: "g" | "ml" | "pc" } | null {
  const base = BASE[(unit ?? "").trim().toLowerCase()];
  if (!base || !Number.isFinite(amount)) return null;
  // Rounded to a millionth: 1.1 kg is 1100 g, not 1100.0000000000002.
  return { amount: Math.round(amount * base.times * 1e6) / 1e6, unit: base.unit };
}

/** How many packs cover an amount, or null when the two cannot be compared (a weight against pieces, an unknown unit). */
export function packsFor(amount: number, unit: string | null | undefined, packAmount: number | null | undefined, packUnit: string | null | undefined): number | null {
  const need = toBase(amount, unit), pack = packAmount == null ? null : toBase(packAmount, packUnit);
  if (!need || !pack || need.unit !== pack.unit || pack.amount <= 0) return null;
  return Math.ceil(need.amount / pack.amount);
}

export function productFor(db: Db, item: string, app: string): ProductRow | null {
  return db.select().from(products).where(and(eq(products.item, normItem(item)), eq(products.app, app))).get() ?? null;
}

/** A pack written as one number and a measure the app can compare ("500 ml", "5 kg", "6 pcs"), read; null for anything
 *  else ("1 pack", "2 x 500 ml"). */
export function parsePack(pack: string | null | undefined): { amount: number; unit: string } | null {
  const m = /^(\d+(?:\.\d+)?)\s*([a-z]+)$/i.exec((pack ?? "").trim());
  if (!m) return null;
  const amount = Number(m[1]), unit = m[2].toLowerCase();
  return amount > 0 && toBase(amount, unit) ? { amount, unit } : null;
}

const DETAILS = ["pack", "pack_amount", "pack_unit", "price", "image"] as const;

/** Remember the product an item is bought as on one app: one row per item and app. For the same product only the details
 *  given change; another product takes its place whole, so the details not given are cleared, never the old product's.
 *  A pack given as text alone is read into its amount and measure when it is plain ("500 ml"). */
export function rememberProduct(db: Db, p: ProductInput, by = "app"): ProductRow {
  const had = productFor(db, p.item, p.app);
  const same = !!had && had.product_id === p.product_id;
  const set: Partial<typeof products.$inferInsert> = { product_id: p.product_id, name_on_app: p.name_on_app };
  for (const k of DETAILS) {
    if (p[k] !== undefined) (set as Record<string, unknown>)[k] = p[k];
    else if (had && !same) (set as Record<string, unknown>)[k] = null;
  }
  if (typeof p.pack === "string" && p.pack_amount === undefined && p.pack_unit === undefined) {
    const read = parsePack(p.pack);
    // A pack text that cannot be read leaves no size; the size stays only when the same product's pack text did not change.
    if (read || !same || had!.pack !== p.pack) { set.pack_amount = read?.amount ?? null; set.pack_unit = read?.unit ?? null; }
  }
  return had
    ? db.update(products).set({ ...set, updated_at: new Date().toISOString(), updated_by: by }).where(eq(products.id, had.id)).returning().get()
    : db.insert(products).values({ ...set, item: normItem(p.item), app: p.app, product_id: p.product_id, name_on_app: p.name_on_app, updated_by: by }).returning().get();
}

// ── What was sent, checked ──

export const groceryAppOf = (v: unknown): GroceryApp =>
  (GROCERY_APPS as readonly unknown[]).includes(v) ? (v as GroceryApp) : refuse(`app must be one of: ${GROCERY_APPS.join(", ")}`);
/** A number above 0, or null to clear it. */
export const positive = (v: unknown, what: string): number | null =>
  v === null ? null : typeof v === "number" && Number.isFinite(v) && v > 0 ? v : refuse(`${what} must be a number above 0`);
/** A product's id on the grocery app, as text. */
export const productId = (v: unknown, what = "product_id"): string =>
  typeof v === "number" && Number.isFinite(v) ? String(v) : name(v, what);

/** A product as it was sent, checked. `item` is what the family calls it; the rest is the grocery app's. */
export function productOf(b: Record<string, unknown>, app: GroceryApp, what = ""): ProductInput {
  const p: ProductInput = { item: name(b.item, `${what}item`), app, product_id: productId(b.product_id, `${what}product_id`), name_on_app: name(b.name_on_app, `${what}name_on_app`) };
  for (const k of ["pack", "pack_unit", "image"] as const) if (b[k] !== undefined) p[k] = words(b[k], `${what}${k}`);
  if (b.pack_amount !== undefined) p.pack_amount = positive(b.pack_amount, `${what}pack_amount`);
  if (b.price !== undefined) p.price = b.price === null ? null : typeof b.price === "number" && Number.isFinite(b.price) && b.price >= 0 ? b.price : refuse(`${what}price must be a number, 0 or more`);
  return p;
}

export function mountProductRoutes(hono: Hono<any>, db: Db, emit: Emit) {
  const write = writeRoutes(hono);

  // remember_product { item, app, product_id, name_on_app, pack?, pack_amount?, pack_unit?, price?, image? }: the product an
  // item is bought as on one grocery app. Sent again for the same item and app, it takes the place of the one remembered.
  write("/api/products", (b, by) => {
    const p = productOf(b, groceryAppOf(b.app));
    const had = productFor(db, p.item, p.app);
    const product = rememberProduct(db, p, by);
    emit("products", product.id, had ? "update" : "insert", by);
    return { body: { product } };
  });
}
