// Plain functions and types for the ingredient catalog (no React): the pickers, the Ingredients page and their tests use them.

export type PriceChoice = "cheapest" | "balanced" | "premium";
export type SubstitutionChoice = "allowed" | "ask" | "never";

/** Per-ingredient shopping preferences (docs/V2-SPEC.md ShoppingPrefs). Every field is optional: unset falls back to the category default. */
export interface ShoppingPrefs {
  pack_min?: number | null; pack_max?: number | null; pack_unit?: string | null; stock_days?: number | null;
  price?: PriceChoice | null; brands_preferred?: string[]; brands_avoid?: string[];
  substitutions?: SubstitutionChoice | null; service?: string | null; never_auto_add?: boolean;
}

export interface Ingredient {
  id: string; name: string; default_unit: string | null; category: string | null;
  last_ordered_at: string | null; last_ordered_qty: number | null;
  aliases?: string | null; unit_conversions?: string | null; shelf_life_days?: number | null; prefs?: string | null; notes?: string | null;
}

export const PRICE_CHOICES: PriceChoice[] = ["cheapest", "balanced", "premium"];
export const SUBSTITUTION_CHOICES: SubstitutionChoice[] = ["allowed", "ask", "never"];

/** A JSON column read safely: malformed or empty text gives the fallback. */
export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try { const v = JSON.parse(text); return v ?? fallback; } catch { return fallback; }
}

/** A JSON string[] column (aliases, tags, substitutes) as a clean list. */
export function stringList(text: string | null | undefined): string[] {
  const v = parseJson<unknown>(text, []);
  return Array.isArray(v) ? v.filter((a): a is string => typeof a === "string") : [];
}

export const aliasesOf = (i: Pick<Ingredient, "aliases">): string[] => stringList(i.aliases);

/** "palak, spinach , ,Spinach" → ["palak", "spinach"]: trimmed, blanks and case-duplicates dropped. */
export function splitList(text: string | null | undefined): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (const raw of (text ?? "").split(",")) {
    const t = raw.trim(), k = t.toLowerCase();
    if (t && !seen.has(k)) { seen.add(k); out.push(t); }
  }
  return out;
}

/** { pc: 150, bunch: 250 } ↔ "pc=150, bunch=250", the editable form of unit_conversions. */
export const formatConversions = (c: Record<string, number>): string => Object.entries(c).map(([u, g]) => `${u}=${g}`).join(", ");
export function parseConversions(text: string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of (text ?? "").split(",")) {
    const m = part.match(/^\s*([^=\s]+)\s*=\s*(\d+(?:\.\d+)?)\s*$/);
    if (m) out[m[1].toLowerCase()] = Number(m[2]);
  }
  return out;
}

/** Levenshtein distance, stopping early once it exceeds `max` (enough for typo tolerance on short names). */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** How well `q` matches one name: 0 exact, 1 prefix, 2 word prefix, 3 substring, 4 typo; null for no match. */
export function nameScore(name: string, q: string): number | null {
  const n = name.toLowerCase().trim(), s = q.toLowerCase().trim();
  if (!s) return null;
  if (n === s) return 0;
  if (n.startsWith(s)) return 1;
  if (n.split(/[\s,()/-]+/).some((w) => w.startsWith(s))) return 2;
  if (n.includes(s)) return 3;
  const tolerance = s.length >= 7 ? 2 : s.length >= 4 ? 1 : 0;
  if (tolerance && n.split(/[\s,()/-]+/).concat(n).some((w) => editDistance(w, s, tolerance) <= tolerance)) return 4;
  return null;
}

export interface IngredientMatch<T> { row: T; via: string | null }   // via: the alias that matched, when not the name

/** Ingredients matching typed text by name or alias (typo-tolerant), best first, then by name. */
export function matchIngredients<T extends Pick<Ingredient, "name" | "aliases">>(rows: T[], q: string, limit = 6): IngredientMatch<T>[] {
  const scored: { row: T; via: string | null; score: number }[] = [];
  for (const row of rows) {
    let best = nameScore(row.name, q), via: string | null = null;
    for (const a of aliasesOf(row)) {
      const s = nameScore(a, q);
      if (s !== null && (best === null || s < best)) { best = s; via = a; }
    }
    if (best !== null) scored.push({ row, via, score: best });
  }
  return scored.sort((a, b) => a.score - b.score || a.row.name.localeCompare(b.row.name)).slice(0, limit).map(({ row, via }) => ({ row, via }));
}

/** One line for a list row: "250–500 g packs · 7 days' stock · cheapest · never auto-add". */
export function prefsSummary(p: ShoppingPrefs): string {
  const pack = p.pack_min || p.pack_max
    ? `${[p.pack_min, p.pack_max].filter((x) => x).join("–")}${p.pack_unit ? ` ${p.pack_unit}` : ""} packs` : null;
  return [
    pack, p.stock_days ? `${p.stock_days} days' stock` : null, p.price && p.price !== "balanced" ? p.price : null,
    p.brands_preferred?.length ? `prefers ${p.brands_preferred.join(", ")}` : null,
    p.substitutions === "never" ? "no substitutes" : null, p.service && p.service !== "any" ? p.service : null,
    p.never_auto_add ? "never auto-add" : null,
  ].filter(Boolean).join(" · ");
}

/** Drops unset fields so the stored JSON stays small and "unset" keeps meaning "use the category default". */
export function cleanPrefs(p: ShoppingPrefs): ShoppingPrefs {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v === null || v === undefined || v === "" || v === false || (Array.isArray(v) && !v.length)) continue;
    out[k] = v;
  }
  return out as ShoppingPrefs;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The Ingredients editor's flat form values from a row (lists as comma text, conversions as "pc=150"). */
export function ingredientFormValues(i: Ingredient): Record<string, unknown> {
  const p = parseJson<ShoppingPrefs>(i.prefs, {});
  return {
    name: i.name, category: i.category, default_unit: i.default_unit, aliases: aliasesOf(i).join(", "),
    unit_conversions: formatConversions(parseJson<Record<string, number>>(i.unit_conversions, {})), shelf_life_days: i.shelf_life_days ?? null,
    notes: i.notes ?? null, pack_min: p.pack_min ?? null, pack_max: p.pack_max ?? null, pack_unit: p.pack_unit ?? null, stock_days: p.stock_days ?? null,
    price: p.price ?? null, brands_preferred: (p.brands_preferred ?? []).join(", "), brands_avoid: (p.brands_avoid ?? []).join(", "),
    substitutions: p.substitutions ?? null, service: p.service ?? null, never_auto_add: p.never_auto_add === true,
  };
}

/** The columns to write back from the editor's values: JSON columns re-encoded, prefs cleaned of unset fields. */
export function ingredientPatch(v: Record<string, unknown>): Partial<Ingredient> {
  const prefs = cleanPrefs({
    pack_min: num(v.pack_min), pack_max: num(v.pack_max), pack_unit: txt(v.pack_unit), stock_days: num(v.stock_days),
    price: (PRICE_CHOICES as string[]).includes(String(v.price)) ? v.price as PriceChoice : null,
    brands_preferred: splitList(txt(v.brands_preferred)), brands_avoid: splitList(txt(v.brands_avoid)),
    substitutions: (SUBSTITUTION_CHOICES as string[]).includes(String(v.substitutions)) ? v.substitutions as SubstitutionChoice : null,
    service: txt(v.service), never_auto_add: v.never_auto_add === true,
  });
  const conversions = parseConversions(txt(v.unit_conversions));
  return {
    name: txt(v.name) ?? "", category: txt(v.category), default_unit: txt(v.default_unit),
    aliases: JSON.stringify(splitList(txt(v.aliases))), unit_conversions: Object.keys(conversions).length ? JSON.stringify(conversions) : null,
    shelf_life_days: num(v.shelf_life_days), notes: txt(v.notes), prefs: Object.keys(prefs).length ? JSON.stringify(prefs) : null,
  };
}
