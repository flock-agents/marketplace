// Plain functions for the header search: what /api/search returns, read tolerantly, and where each hit opens.

export type HitKind = "dish" | "recipe" | "ingredient" | "pantry" | "order";
export interface SearchHit { kind: HitKind; id: string; title: string; meta: string | null }

const KINDS: Record<string, HitKind> = {
  dish: "dish", meal: "dish", meals: "dish", recipe: "recipe", recipes: "recipe", ingredient: "ingredient", ingredients: "ingredient",
  pantry: "pantry", staple: "pantry", staples: "pantry", order: "order", orders: "order", cart: "order", carts: "order",
};
export const KIND_LABELS: Record<HitKind, string> = { dish: "Dishes", recipe: "Recipes", ingredient: "Ingredients", pantry: "Pantry", order: "Orders" };
const ORDER: HitKind[] = ["recipe", "dish", "ingredient", "pantry", "order"];

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : typeof v === "number" ? String(v) : null);

/** Accepts `{ results: [...] }`, a bare array, or `{ recipes: [...], ingredients: [...] }` grouped by kind. */
export function readHits(body: unknown): SearchHit[] {
  const raw: { kind?: unknown; row: Record<string, unknown> }[] = [];
  if (Array.isArray(body)) raw.push(...body.map((row) => ({ row })));
  else if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (Array.isArray(b.results)) raw.push(...b.results.map((row) => ({ row })));
    else for (const [k, list] of Object.entries(b)) if (Array.isArray(list)) raw.push(...list.map((row) => ({ kind: k, row })));
  }
  const hits: SearchHit[] = [];
  for (const { kind, row } of raw) {
    if (!row || typeof row !== "object") continue;
    const k = KINDS[String(row.kind ?? row.type ?? row.table ?? kind ?? "").toLowerCase()];
    const id = str(row.id), title = str(row.title ?? row.label ?? row.name ?? row.dish ?? row.item);
    if (!k || !id || !title) continue;
    hits.push({ kind: k, id, title, meta: str(row.meta ?? row.subtitle ?? row.matched ?? row.date ?? row.status) });
  }
  return hits;
}

/** Hits grouped in a fixed order, each kind once; the flat index each group starts at is for keyboard navigation. */
export function groupHits(hits: SearchHit[]): { kind: HitKind; hits: SearchHit[]; start: number }[] {
  const out: { kind: HitKind; hits: SearchHit[]; start: number }[] = [];
  let start = 0;
  for (const kind of ORDER) {
    const mine = hits.filter((h) => h.kind === kind);
    if (mine.length) { out.push({ kind, hits: mine, start }); start += mine.length; }
  }
  return out;
}

/** The hash route a hit opens. */
export function routeFor(hit: SearchHit): string {
  switch (hit.kind) {
    case "recipe": return `recipe/${hit.id}`;
    case "ingredient": return `ingredient/${hit.id}`;
    case "pantry": return "pantry";
    case "order": return "groceries";
    default: return "week";
  }
}
