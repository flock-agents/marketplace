// The dish-kinds catalog as the evals read it: server/kinds.json imported as DATA (no server code), with the eval's own way of
// placing a dish name in it. Kinds are the catalog's by definition, so the data is shared with the app; the matching is not
// (a bug in the app's matchDish must not be graded by itself). Used by the scorers (no_new_kind, no_early_repeat, real_dish,
// templates) and by truth-setup.ts to load TRUTH's library with kinds.
import catalogJson from "../../server/kinds.json";

type CItem = { name: string; aka?: string[]; cuisines?: string[]; sub: string; suggest: boolean; regional?: boolean; contains: string[] };
type CSub = { name: string; aka: string[]; cuisines: string[] };
type CKind = { name: string; aka: string[]; cuisines: string[]; staple: boolean; part: string; diet: string; subs: CSub[]; items: CItem[] };
const CAT = catalogJson as unknown as { kinds: CKind[] };

/** Words as the catalog is matched: lowercase letters and digits, single spaces. */
export const cnorm = (s: string): string => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const singular = (w: string) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);
const key = (s: string) => cnorm(s).split(" ").map(singular).join(" ");

export const catalogKindNamed = (name: string): CKind | null => CAT.kinds.find((k) => cnorm(k.name) === cnorm(name)) ?? null;
/** A staple kind (Roti, Rice, Curd, Bhakri, Mudde): its item comes every time, never rotated. */
export const isStapleKind = (kind: string | null | undefined): boolean => !!kind && !!catalogKindNamed(kind)?.staple;
/** Kinds that are a meat, fish or egg dish. */
const PROTEIN = new Set(CAT.kinds.filter((k) => k.diet === "nonveg" || k.diet === "egg").map((k) => k.name));
/** The kinds whose own words are not a dish (owner, 25 Nov: "Sabzi", "Dal", "Curry", "Poriyal"): the coarse lunch and dinner
 *  kinds with sub-kinds (Dal, Rice curry, Sabzi, Gravy, Egg, Chicken, Mutton, Fish & seafood). A breakfast dish family
 *  ("Idli", "Upma"), a whole-plate kind ("Khichdi") and a staple ("Rice", "Roti") are dishes by their own word. */
const COARSE = new Set(CAT.kinds.filter((k) => k.part === "main" && k.subs.length > 1).map((k) => k.name));

export type KindHit = { kind: string; sub: string | null; item: string | null; by: "item" | "sub" | "kind" };
type Entry = { words: string; hit: KindHit };

const entries: Entry[] = [];
for (const k of CAT.kinds) {
  for (const w of [k.name, ...k.aka]) entries.push({ words: key(w), hit: { kind: k.name, sub: null, item: null, by: "kind" } });
  if (k.subs.length > 1) for (const sb of k.subs) for (const w of [...sb.name.split("/"), sb.name, ...sb.aka]) entries.push({ words: key(w), hit: { kind: k.name, sub: sb.name, item: null, by: "sub" } });
  for (const it of k.items) for (const w of [it.name, ...(it.aka ?? [])]) entries.push({ words: key(w), hit: { kind: k.name, sub: it.sub, item: it.name, by: "item" } });
}

/** One place for a set of hits: one kind (and one sub-kind / item where they agree), else null. */
function one(hits: KindHit[]): KindHit | null {
  if (new Set(hits.map((h) => h.kind)).size !== 1) return null;
  const subs = new Set(hits.map((h) => h.sub)), items = new Set(hits.map((h) => h.item));
  return { kind: hits[0].kind, sub: subs.size === 1 ? hits[0].sub : null, item: items.size === 1 ? hits[0].item : null, by: hits[0].by };
}

/** Where a dish name sits in the catalog. The whole name first (an item, then a sub-kind, then a kind, by name or other name);
 *  else the longest catalog names held in it as whole words ("Bhindi sabzi" → Sabzi, "Rui fish curry" → Fish & seafood).
 *  When those name more than one kind: a meat, fish or egg kind wins (the protein makes the dish: "Chicken rassa"), then a
 *  non-staple one (the dish, not its rice: "Kadhi chawal"), then items before sub-kinds before kinds. Still more than one
 *  kind: null (unmapped). */
export function kindOf(name: string): KindHit | null {
  const n = key(name);
  if (!n) return null;
  for (const lv of ["item", "sub", "kind"] as const) {
    const hit = one(entries.filter((e) => e.hit.by === lv && e.words === n).map((e) => e.hit));
    if (hit) return hit;
  }
  const padded = ` ${n} `;
  const inside = entries.filter((e) => e.words && padded.includes(` ${e.words} `));
  const len = Math.max(0, ...inside.map((e) => e.words.split(" ").length));
  let hits = inside.filter((e) => e.words.split(" ").length === len).map((e) => e.hit);
  if (!hits.length) return null;
  const narrow = (keep: (h: KindHit) => boolean) => { const k = hits.filter(keep); if (k.length) hits = k; };
  if (new Set(hits.map((h) => h.kind)).size > 1) narrow((h) => PROTEIN.has(h.kind));
  if (new Set(hits.map((h) => h.kind)).size > 1) narrow((h) => !isStapleKind(h.kind));
  for (const lv of ["item", "sub", "kind"] as const) {
    const at = hits.filter((h) => h.by === lv);
    if (!at.length) continue;
    const hit = one(at);
    // A name that holds an item is a variant of it, not the item: its kind and sub-kind only.
    return hit ? { ...hit, item: null, by: lv === "kind" ? "kind" : "sub" } : null;
  }
  return null;
}

/** The whole name is only a coarse kind's or one of its sub-kinds' words, and no item's: not a dish. */
export function isBareKindWord(name: string): boolean {
  const n = key(name);
  if (!n) return false;
  const exact = entries.filter((e) => e.words === n);
  return exact.length > 0 && !exact.some((e) => e.hit.by === "item") && exact.every((e) => COARSE.has(e.hit.kind));
}

/** The catalog's cuisine words. */
export const CUISINES: string[] = [...new Set(CAT.kinds.flatMap((k) => [...k.cuisines, ...k.subs.flatMap((s) => s.cuisines), ...k.items.flatMap((i) => i.cuisines ?? [])]))].sort();
