import type { PlatformContext } from "@flock/app-sdk";
import { getCursor, setCursor, upsertEvents, markMissingEvents, _db } from "./store";
import { normalizeScrape, ymd, type ScrapedEvent } from "./events";

export interface SyncDeps { platform: PlatformContext; now?: () => Date }
export const DAILY_SCRAPE_CAP = 8;
export const KEEP_DAYS_AHEAD = 7;
const FRESH_MS = 2 * 3600_000;
const SCRAPE_TIMEOUT_MS = 45_000;

export function scrapesToday(accountId: string, day: string): number { return Number(getCursor(`scrapes:${accountId}:${day}`) ?? 0); }
export function lastSyncAt(accountId: string): number | null { const v = getCursor(`last_sync:${accountId}`); return v ? Number(v) : null; }
export function lastFault(accountId: string): string | null { return getCursor(`fault:${accountId}`) || null; }

/** Every scrape takes the Google browser lease Gmail also needs: scheduled and init runs always go
 *  (within the cap); a pre-prep refresh only when the last scrape is older than FRESH_MS. */
export function shouldScrape(accountId: string, now: Date, reason: "scheduled" | "pre-prep" | "init"): boolean {
  if (scrapesToday(accountId, ymd(now)) >= DAILY_SCRAPE_CAP) return false;
  if (reason !== "pre-prep") return true;
  const last = lastSyncAt(accountId);
  return last == null || now.getTime() - last > FRESH_MS;
}

function dateRange(now: Date): string[] {
  const out: string[] = [];
  for (let i = 0; i <= KEEP_DAYS_AHEAD; i++) { const d = new Date(now); d.setDate(d.getDate() + i); out.push(ymd(d)); }
  return out;
}

export async function syncAccount(accountId: string, deps: SyncDeps, reason: "scheduled" | "pre-prep" | "init") {
  const now = (deps.now ?? (() => new Date()))();
  const day = ymd(now);
  if (!deps.platform.configured) return { ok: false, events: 0, fault: "not configured" };
  if (scrapesToday(accountId, day) >= DAILY_SCRAPE_CAP) return { ok: false, events: 0, fault: null, skipped: "cap" as const };
  if (!shouldScrape(accountId, now, reason)) return { ok: true, events: 0, fault: null, skipped: "fresh" as const };

  setCursor(`scrapes:${accountId}:${day}`, String(scrapesToday(accountId, day) + 1));
  const res = await deps.platform.connectors.exec<{ ok?: boolean; events?: ScrapedEvent[] }>({
    skillId: "google-calendar", functionName: "listEvents", accountHint: accountId,
    params: { timeMin: day, maxResults: 100 }, timeoutMs: SCRAPE_TIMEOUT_MS,
  });
  if (!res.ok || !res.data || res.data.ok === false || !Array.isArray(res.data.events)) {
    // A refused or faulted read says NOTHING about the calendar: keep what we had.
    const fault = !res.ok ? res.reason : "scrape returned no event list";
    setCursor(`fault:${accountId}`, fault);
    console.warn(`[calendar-desk] sync ${accountId} (${reason}) failed: ${fault}`);
    return { ok: false, events: 0, fault };
  }
  const rows = normalizeScrape(res.data.events, { calendar: "primary", fallbackDate: day, now })
    .filter((r) => r.localDate >= day && dateRange(now).includes(r.localDate));
  const at = now.getTime();
  upsertEvents(accountId, rows, at);
  markMissingEvents(accountId, dateRange(now), rows.map((r) => r.eventKey), at);
  _db.query("DELETE FROM events WHERE account_id = ? AND (local_date < ? OR (missing_since IS NOT NULL AND missing_since < ?))").run(accountId, ymd(new Date(at - 86_400_000)), at - 2 * 86_400_000);
  setCursor(`last_sync:${accountId}`, String(at));
  setCursor(`fault:${accountId}`, "");
  console.log(`[calendar-desk] sync ${accountId} (${reason}): ${rows.length} event(s)`);
  return { ok: true, events: rows.length, fault: null };
}
