// What a rule is about (docs/2026-11-26-one-meaning-model-design.md §5.2): exactly one target. One of the three places that match a
// family's words to the catalog (with kinds.ts and the interview's resolver): a rule's words are resolved here once, when the rule
// is written, and read back typed everywhere else. Pure: no db.
import { BASE_TAGS, TAG_PARENT } from "./db/constants";
import { bareDish, catalogItem, CATALOG, matchDish, norm } from "./kinds";
import type { Rule } from "./slotStore";

export type RuleTarget =
  | { type: "kind"; kind: string }
  | { type: "sub"; kind: string; sub: string }
  | { type: "item"; item: string; kind: string | null }
  | { type: "ingredient"; tag: string };

const canon = (t: string): string => t.trim().toLowerCase().replace(/^@/, "").replace(/[\s-]+/g, "_");
const TAGS = new Set<string>([...BASE_TAGS, ...Object.keys(TAG_PARENT), ...Object.values(TAG_PARENT), ...CATALOG.tags.map(canon)]);

/** The known tag a word is ("eggs" → egg), else null. */
function tagOf(word: string): string | null {
  const c = canon(word);
  if (TAGS.has(c)) return c;
  return c.endsWith("s") && c.length > 3 && TAGS.has(c.slice(0, -1)) ? c.slice(0, -1) : null;
}

/** A rule word to its one target: a known tag (BASE_TAGS, TAG_PARENT keys/values, catalog tags, singular of a plural) → ingredient;
 *  else matchDish: item → item, sub → sub, kind → kind; else an ingredient of that word (canonTag). */
export function resolveTarget(word: string): RuleTarget {
  const tag = tagOf(word);
  if (tag) return { type: "ingredient", tag };
  const m = matchDish(word);
  if (m?.by === "item" && m.item) return { type: "item", item: m.item, kind: m.kind };
  if (m?.by === "sub" && m.sub) return { type: "sub", kind: m.kind, sub: m.sub };
  if (m) return { type: "kind", kind: m.kind };
  return { type: "ingredient", tag: canon(word) };
}

const sentence = (w: string): string => { const s = w.trim().replace(/_/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); };

/** A swap's `to`: as resolveTarget, except a kind or sub word whose bareDish exists gives that item; a word the catalog does not know
 *  is the family's own item (kind null). Never an ingredient. */
export function resolveGives(word: string): Exclude<RuleTarget, { type: "ingredient" }> {
  const m = matchDish(word);
  if (m?.by === "item" && m.item) return { type: "item", item: m.item, kind: m.kind };
  if (m) {
    // A kind or sub-kind word whose bare dish is decided gives that item (spec §5.1); one without stays a kind or sub.
    const bare = bareDish(m.kind, m.sub);
    if (bare) return { type: "item", item: bare, kind: catalogItem(bare)?.kind.name ?? m.kind };
    return m.sub ? { type: "sub", kind: m.kind, sub: m.sub } : { type: "kind", kind: m.kind };
  }
  return { type: "item", item: sentence(word), kind: null };
}

/** A rule's targets as saved, else derived from what/items (veg → meat, fish + items; no_eggs → egg + items; egg → items or meat, fish). */
export function targetsOf(r: Pick<Rule, "what" | "items" | "targets">): RuleTarget[] {
  if (r.targets) return r.targets;
  const items = (r.items ?? []).map(resolveTarget);
  const ing = (...tags: string[]): RuleTarget[] => tags.map((tag) => ({ type: "ingredient", tag }));
  const out = r.what === "veg" ? [...ing("meat", "fish"), ...items]
    : r.what === "no_eggs" ? [...ing("egg"), ...items]
    : r.what === "egg" ? (items.length ? items : ing("meat", "fish"))
    : items;
  const seen = new Set<string>();
  return out.filter((t) => { const k = JSON.stringify(t); return seen.has(k) ? false : (seen.add(k), true); });
}

export type DishPlace = { kind: string | null; sub: string | null; item: string | null };

/** true/false for a kind, sub or item target against a dish's saved place; null for an ingredient target (facts decide). */
export function hitsTarget(t: RuleTarget, p: DishPlace): boolean | null {
  const same = (a: string | null, b: string | null): boolean => !!a && !!b && norm(a) === norm(b);
  switch (t.type) {
    case "kind": return same(t.kind, p.kind);
    case "sub": return same(t.kind, p.kind) && same(t.sub, p.sub);
    case "item": return same(t.item, p.item);
    default: return null;
  }
}

/** The target in the family's words for read-back and questions: "egg", "salad", "upma", "Pancakes". */
export function targetText(t: RuleTarget): string {
  switch (t.type) {
    case "kind": return t.kind.toLowerCase();
    case "sub": return t.sub.toLowerCase();
    case "item": return t.item;
    default: return t.tag.replace(/_/g, " ");
  }
}
