// GET /api/search: one typo-tolerant search over dishes (meals), recipes, ingredients (incl. aliases), pantry
// (staples) and orders (carts). `fuzzyScore` is pure and unit-tested; `searchAll` reads the DB.
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { carts, groceries, ingredients, meals, recipes, staples } from "./db/schema";
import { parseJson } from "./quantity";

export type SearchType = "dish" | "recipe" | "ingredient" | "pantry" | "order";
/** The UI contract: {results: [{kind, id, title, meta?}]}; `matched` (the name or alias that hit) and `score` are extras. */
export interface SearchResult { kind: SearchType; id: string; title: string; meta?: string; matched: string; score: number }

const norm = (s: string): string => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

/** Optimal-string-alignment distance (Levenshtein + adjacent transposition), capped early at `max + 1`. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

const allowedTypos = (len: number): number => (len <= 2 ? 0 : len <= 5 ? 1 : 2);

/** 0 (no match) to 100 (exact). Exact > prefix > word prefix > substring > every query word typo-close to a word
 *  (or word prefix) of the candidate. */
export function fuzzyScore(query: string, candidate: string): number {
  const q = norm(query), c = norm(candidate);
  if (!q || !c) return 0;
  if (c === q) return 100;
  if (c.startsWith(q)) return 90;
  const words = c.split(" ");
  if (words.some((w) => w.startsWith(q))) return 80;
  if (c.includes(q)) return 70;
  let total = 0;
  for (const qw of q.split(" ")) {
    const max = allowedTypos(qw.length);
    const best = Math.min(...words.map((w) => Math.min(editDistance(qw, w, max), editDistance(qw, w.slice(0, qw.length), max))));
    if (best > max) return 0;
    total += best;
  }
  return Math.max(1, 60 - total * 10);
}

interface Candidate { type: SearchType; id: string; label: string; sub: string | null; names: string[] }

/** Best-scoring candidates, de-duplicated by (type, label) — a dish planned on many days is one result. */
export function rankCandidates(q: string, candidates: Candidate[], limit = 30): SearchResult[] {
  const best = new Map<string, SearchResult>();
  for (const c of candidates) {
    let top = 0, matched = c.label;
    for (const n of c.names) { const s = fuzzyScore(q, n); if (s > top) { top = s; matched = n; } }
    if (!top) continue;
    const key = `${c.type}|${norm(c.label)}`;
    const prev = best.get(key);
    if (!prev || top > prev.score) best.set(key, { kind: c.type, id: c.id, title: c.label, ...(c.sub ? { meta: c.sub } : {}), matched, score: top });
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}

export function searchAll(db: BunSQLiteDatabase<any>, q: string, limit = 30): SearchResult[] {
  if (!norm(q)) return [];
  const candidates: Candidate[] = [];
  for (const m of db.select({ id: meals.id, dish: meals.dish, date: meals.date, slot: meals.slot }).from(meals).all() as { id: string; dish: string; date: string; slot: string }[])
    candidates.push({ type: "dish", id: m.id, label: m.dish, sub: `${m.date} ${m.slot}`, names: [m.dish] });
  for (const r of db.select({ id: recipes.id, name: recipes.name, tags: recipes.tags, cuisine: recipes.cuisine }).from(recipes).all() as { id: string; name: string; tags: string | null; cuisine: string | null }[])
    candidates.push({ type: "recipe", id: r.id, label: r.name, sub: r.cuisine, names: [r.name, ...parseJson<string[]>(r.tags, [])] });
  for (const i of db.select({ id: ingredients.id, name: ingredients.name, aliases: ingredients.aliases, category: ingredients.category }).from(ingredients).all() as { id: string; name: string; aliases: string | null; category: string | null }[])
    candidates.push({ type: "ingredient", id: i.id, label: i.name, sub: i.category, names: [i.name, ...parseJson<string[]>(i.aliases, [])] });
  for (const s of db.select({ id: staples.id, item: staples.item, category: staples.category }).from(staples).all() as { id: string; item: string; category: string }[])
    candidates.push({ type: "pantry", id: s.id, label: s.item, sub: s.category, names: [s.item] });

  const cartRows = db.select({ id: carts.id, status: carts.status, buy_at: carts.buy_at, chosen_service: carts.chosen_service, order_ref: carts.order_ref }).from(carts).all() as
    { id: string; status: string; buy_at: string; chosen_service: string | null; order_ref: string | null }[];
  const itemsByCart = new Map<string, string[]>();
  for (const g of db.select({ cart_id: groceries.cart_id, item: groceries.item }).from(groceries).all() as { cart_id: string | null; item: string }[]) {
    if (!g.cart_id) continue;
    const arr = itemsByCart.get(g.cart_id) ?? []; arr.push(g.item); itemsByCart.set(g.cart_id, arr);
  }
  for (const c of cartRows) {
    const label = `${c.chosen_service ?? "Order"} · ${c.buy_at.slice(0, 10)}`;
    candidates.push({ type: "order", id: c.id, label: `${label} (${c.id.slice(0, 4)})`, sub: c.status, names: [c.chosen_service ?? "", c.order_ref ?? "", ...(itemsByCart.get(c.id) ?? [])].filter(Boolean) });
  }
  return rankCandidates(q, candidates, limit);
}
