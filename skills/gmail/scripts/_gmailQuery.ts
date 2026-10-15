// Pure Gmail-query builder for the getThreads intent tool. No browser, no side effects — turns
// a caller's DECLARATIVE filters into a single Gmail search string, so the connector (not the
// caller) owns how intent maps to Gmail. The same string drives either backend: the browser
// search (searchEmails.ts) or IMAP (gmail-imap.py cmd_search).
//
// WHY THE CONNECTOR OWNS THIS. The caller says WHAT it wants ("15 recent sent threads, not from
// these senders, not spam/promotions"); the connector decides HOW. Exclusions matter most here:
// they become NEGATIVE Gmail operators (-from:, -label:), so excluded mail is filtered
// server-side by Gmail and never fetched at all — the caller pays nothing for what it doesn't
// want. That is strictly better than reading everything and dropping some after.

/** Gmail's built-in tab categories, addressable with `category:`. Anything else is a `label:`. */
const CATEGORIES = new Set(["primary", "social", "promotions", "updates", "forums", "reservations", "purchases"]);

export interface ThreadExclusions {
  /** Exact senders to drop → `-from:x@y.com`. */
  senders?: string[];
  /** Whole domains to drop → `-from:@spam.com`. */
  domains?: string[];
  /** Labels/categories/folders to drop → `-category:promotions`, `-label:x`, `-in:spam`. */
  labels?: string[];
  /** Raw negative fragment appended verbatim (escape hatch). */
  raw?: string;
}

export interface ThreadFilters {
  /** Folder → `in:sent` / `in:inbox` / `in:anywhere` / … */
  in?: string;
  /** Categories or labels to REQUIRE → `category:primary`, `label:x`. */
  labels?: string[];
  /** Freshness → `newer_than:30d`. Accepts "30d" / "6m" / "1y". */
  since?: string;
  /** Age floor → `older_than:1y`. */
  before?: string;
  /** Require senders → `from:a` (OR-grouped when several). */
  from?: string[];
  /** Require recipients → `to:a`. */
  to?: string[];
  /** Only threads with attachments. */
  hasAttachment?: boolean;
  /** Free-form Gmail query appended verbatim (escape hatch). */
  query?: string;
  /** What to LEAVE OUT — the caller's deny-list, applied server-side as negative operators. */
  exclude?: ThreadExclusions;
}

const clean = (s: unknown): string => String(s ?? "").trim();
const labelTerm = (l: string, neg: boolean): string => {
  const v = clean(l).toLowerCase();
  if (!v) return "";
  const op = CATEGORIES.has(v) ? "category" : (v === "spam" || v === "trash") ? "in" : "label";
  return `${neg ? "-" : ""}${op}:${v}`;
};
// A domain deny-entry may arrive as "spam.com" or "@spam.com"; Gmail wants `from:@spam.com`.
const domainTerm = (d: string): string => {
  const v = clean(d).replace(/^@/, "");
  return v ? `-from:@${v}` : "";
};

/**
 * Build the Gmail search string. Deterministic term order (folder → labels → recency → people →
 * attachments → free-form → exclusions) so the same filters always produce the same query — good
 * for caching and for tests. OR-groups multiple `from:` (a thread from ANY of them), because that
 * is what "these senders" means; exclusions AND together (drop if ANY matches), which is what a
 * deny-list means.
 */
export function buildThreadsQuery(f: ThreadFilters = {}): string {
  const terms: string[] = [];

  if (clean(f.in)) terms.push(`in:${clean(f.in).toLowerCase()}`);

  for (const l of f.labels ?? []) { const t = labelTerm(l, false); if (t) terms.push(t); }

  if (clean(f.since)) terms.push(`newer_than:${clean(f.since)}`);
  if (clean(f.before)) terms.push(`older_than:${clean(f.before)}`);

  const froms = (f.from ?? []).map(clean).filter(Boolean).map((s) => `from:${s}`);
  if (froms.length === 1) terms.push(froms[0]!);
  else if (froms.length > 1) terms.push(`(${froms.join(" OR ")})`);

  for (const t of f.to ?? []) { const v = clean(t); if (v) terms.push(`to:${v}`); }

  if (f.hasAttachment) terms.push("has:attachment");
  if (clean(f.query)) terms.push(clean(f.query));

  // Exclusions — negative operators, ANDed, so a thread matching ANY is dropped server-side.
  const ex = f.exclude ?? {};
  for (const s of ex.senders ?? []) { const v = clean(s); if (v) terms.push(`-from:${v}`); }
  for (const d of ex.domains ?? []) { const t = domainTerm(d); if (t) terms.push(t); }
  for (const l of ex.labels ?? []) { const t = labelTerm(l, true); if (t) terms.push(t); }
  if (clean(ex.raw)) terms.push(clean(ex.raw));

  return terms.join(" ");
}
