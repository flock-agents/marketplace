// Engaged domains: the domains the person has actually written to, per account. POSITIVES ONLY: a row means "confirmed
// engaged", its absence means "not asked yet", never "not engaged". Ported from the built-in desk's
// routes/engaged-domains.ts (storage) and Flock's engaged-domains.ts / engaged-domain-search.ts (the read-through lookup).
//
// READ-THROUGH, PER DOMAIN, ON DEMAND (owner, 2026-09-08): a hit answers with no I/O; a miss runs ONE `in:sent to:@domain`
// search (gmail checkEngagedDomains) and records a yes. A no is never recorded (cheap to re-ask, and wrong the day the
// person first writes there). A failed search is UNRESOLVED: the cold-outreach check keeps the mail on it (fail open), and
// the drafting wake wakes nobody for it (fail closed, routines/gather.ts gateDraftingWake).
import type { Database } from "bun:sqlite";

function domainFromAddress(address: string): string | null {
  const email = (address || "").trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at === -1) return null;
  return email.slice(at + 1) || null;
}

/** Batch upsert. `seeded` MAX-merges: a later record never unseeds the person's own domain. */
export function recordEngagedDomains(db: Database, accountId: string, domains: string[], seeded = false): void {
  const stmt = db.query(
    `INSERT INTO engaged_domains (account_id, domain, count, last_sent_at, seeded, updated_at)
     VALUES (?,?,0,0,?,?)
     ON CONFLICT(account_id, domain) DO UPDATE SET
       seeded = MAX(engaged_domains.seeded, excluded.seeded),
       updated_at = excluded.updated_at`,
  );
  const now = Date.now();
  db.transaction(() => {
    for (const d of domains) {
      const norm = (d || "").trim().toLowerCase();
      if (norm) stmt.run(accountId, norm, seeded ? 1 : 0, now);
    }
  })();
}

/** Seed the mailbox's own domain(s): the lookup can never find them (nobody writes to their own domain from Sent). */
export function seedOwnerDomains(db: Database, accountId: string, ownerAddresses: string[]): void {
  const domains = [...new Set(ownerAddresses.map(domainFromAddress).filter((d): d is string => !!d))];
  recordEngagedDomains(db, accountId, domains, true);
}

export function listEngagedDomains(db: Database, accountId: string): string[] {
  try {
    return (db.query("SELECT domain FROM engaged_domains WHERE account_id = ?").all(accountId) as { domain: string }[]).map((r) => r.domain);
  } catch (err: any) {
    console.warn(`[engaged] domain list unreadable for ${accountId} (${err?.message}); treating as empty`);
    return [];
  }
}

function cachedEngaged(db: Database, accountId: string, domain: string): boolean {
  try {
    return !!db.query("SELECT 1 FROM engaged_domains WHERE account_id = ? AND domain = ?").get(accountId, domain);
  } catch {
    return false;
  }
}

/** Distinct missed domains one pass searches for, one call each (a call is one Gmail search, ~10-20 s, inside its own 90 s
 *  timeout). Six keeps a pass inside a few minutes of the read turn even when every search is slow. */
export const MAX_LOOKUPS_PER_PASS = 6;

export interface ResolveOptions {
  /** Waited between two searches (never before the first): a person's pace, not a crawler's. Default none. */
  pause?: () => Promise<void>;
  /** Asked before each search: true stops the pass, the rest stay unresolved (the mailbox was refused, say). */
  stop?: () => boolean;
}

export interface EngagementResolution {
  /** Confirmed engaged: cache hits plus this pass's confirmed lookups. */
  engaged: string[];
  /** Classified this pass, engaged AND confirmed not-engaged. Anything asked about and not here is unresolved. */
  resolved: string[];
}

/**
 * Resolve engagement for the domains a batch contains. `search` is called with ONE domain at a time and returns the engaged
 * subset of what it was given, or null when it could not run (null = that domain unresolved, never "not engaged").
 *
 * ONE DOMAIN PER CALL (live 2026-11-23): the gmail skill's checkEngagedDomains is all-or-nothing over the domains of a call,
 * by design (a partial list would read the unsearched rest as negatives). Handed six domains, one search that did not settle
 * failed the call after 61 s and threw away the answers already found. Asked one at a time, a slow search costs only its
 * own domain, and each confirmed positive is recorded as it comes.
 */
export async function resolveEngagement(
  db: Database,
  accountId: string,
  domains: string[],
  search: (misses: string[]) => Promise<string[] | null>,
  opts: ResolveOptions = {},
): Promise<EngagementResolution> {
  const wanted = [...new Set(domains.map((d) => (d || "").trim().toLowerCase()).filter(Boolean))];
  const engaged: string[] = [];
  const resolved: string[] = [];
  const misses: string[] = [];
  for (const domain of wanted) {
    if (cachedEngaged(db, accountId, domain)) { engaged.push(domain); resolved.push(domain); }
    else misses.push(domain);
  }
  if (misses.length === 0) return { engaged, resolved };

  const toSearch = misses.slice(0, MAX_LOOKUPS_PER_PASS);
  for (const [i, domain] of toSearch.entries()) {
    if (opts.stop?.()) break;
    if (i > 0 && opts.pause) await opts.pause();
    let found: string[] | null = null;
    try { found = await search([domain]); } catch { found = null; }
    if (found === null) continue; // unresolved: asked again next pass
    resolved.push(domain);
    if (!found.some((d) => (d || "").trim().toLowerCase() === domain)) continue;
    engaged.push(domain);
    try { recordEngagedDomains(db, accountId, [domain]); }
    catch (err: any) { console.warn(`[engaged] could not cache an engaged domain for ${accountId} (${err?.message})`); }
  }
  return { engaged, resolved };
}

/** The checkEngagedDomains answer → the engaged subset, or null when the call failed or answered something else. */
export function engagedFromSearch(r: { ok: boolean; data?: unknown }): string[] | null {
  if (!r.ok) return null;
  let d = r.data;
  if (typeof d === "string") { try { d = JSON.parse(d); } catch { return null; } }
  return Array.isArray(d) ? d.filter((x): x is string => typeof x === "string") : null;
}
