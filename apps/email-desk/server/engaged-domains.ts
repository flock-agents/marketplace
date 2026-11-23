// Engaged domains: the domains the person has actually written to, per account. POSITIVES ONLY: a row means "confirmed
// engaged", its absence means "not asked yet", never "not engaged". Ported from the built-in desk's
// routes/engaged-domains.ts (storage) and Flock's engaged-domains.ts / engaged-domain-search.ts (the read-through lookup).
//
// READ-THROUGH, PER DOMAIN, ON DEMAND (owner, 2026-09-08): a hit answers with no I/O; a miss runs ONE `in:sent to:@domain`
// search (gmail checkEngagedDomains) and records a yes. A no is never recorded (cheap to re-ask, and wrong the day the
// person first writes there). A failed search is UNRESOLVED, which every caller treats as fail-open.
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

/** Distinct missed domains one pass searches for: bounded by checkEngagedDomains' own 90s timeout (6 x ~10s). */
export const MAX_LOOKUPS_PER_PASS = 6;

export interface EngagementResolution {
  /** Confirmed engaged: cache hits plus this pass's confirmed lookups. */
  engaged: string[];
  /** Classified this pass, engaged AND confirmed not-engaged. Anything asked about and not here is unresolved. */
  resolved: string[];
}

/**
 * Resolve engagement for the domains a batch contains. `search` returns the engaged subset of the domains it was given, or
 * null when it could not run (null = unresolved for all of them, never "none engaged").
 */
export async function resolveEngagement(
  db: Database,
  accountId: string,
  domains: string[],
  search: (misses: string[]) => Promise<string[] | null>,
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
  let found: string[] | null = null;
  try { found = await search(toSearch); } catch { found = null; }
  if (found === null) return { engaged, resolved };

  const foundSet = new Set(found.map((d) => (d || "").trim().toLowerCase()).filter(Boolean));
  const confirmed: string[] = [];
  for (const domain of toSearch) {
    resolved.push(domain);
    if (foundSet.has(domain)) { engaged.push(domain); confirmed.push(domain); }
  }
  if (confirmed.length > 0) {
    try { recordEngagedDomains(db, accountId, confirmed); }
    catch (err: any) { console.warn(`[engaged] could not cache engaged domains for ${accountId} (${err?.message})`); }
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
