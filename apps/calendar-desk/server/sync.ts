import type { PlatformContext } from "@flock/app-sdk";
import { getCursor, setCursor, upsertEvents, markEventsMissing, unmissedEvents, getEvent, saveEventDetails, detailPlan, detailMissCursor, _db } from "./store";
import { withdrawStepsOf, retryPendingWithdrawals, refreshRenamedSteps } from "./step-upkeep";
import { normalizeScrape, ymd, type ScrapedEvent } from "./events";

export interface SyncDeps { platform: PlatformContext; now?: () => Date }
export const DAILY_SCRAPE_CAP = 8;
/** Per read, at most this many missing events are opened one by one to ask Google whether they still exist. */
export const ABSENCE_CHECK_MAX = 10;
const EXISTS_CHECK_TIMEOUT_MS = 30_000;
export const KEEP_DAYS_AHEAD = 7;
const FRESH_MS = 2 * 3600_000;
const SCRAPE_TIMEOUT_MS = 45_000;
export const MAX_RESULTS = 200;
// A scrape that reads details can take the agenda read, a second agenda navigation (up to 30s + 3s) and
// the skill's 110s detail budget. Mirrors flock-app/skills/google-calendar/manifest.json
// functions.listEvents.timeoutMs (200s) minus 5s, so the skill's own limit fires first.
const DETAIL_SCRAPE_TIMEOUT_MS = 195_000;

export function scrapesToday(accountId: string, day: string): number { return Number(getCursor(`scrapes:${accountId}:${day}`) ?? 0); }
export function lastSyncAt(accountId: string): number | null { const v = getCursor(`last_sync:${accountId}`); return v ? Number(v) : null; }
export function lastFault(accountId: string): string | null { return getCursor(`fault:${accountId}`) || null; }

export type SyncReason = "scheduled" | "pre-prep" | "init" | "light" | "forced";

/** Every scrape takes the Google browser lease Gmail also needs: scheduled, init and forced runs always
 *  go (within the cap, which nothing bypasses); a pre-prep or light refresh only when the last scrape is
 *  older than FRESH_MS. */
export function shouldScrape(accountId: string, now: Date, reason: SyncReason): boolean {
  if (scrapesToday(accountId, ymd(now)) >= DAILY_SCRAPE_CAP) return false;
  if (reason !== "pre-prep" && reason !== "light") return true;
  const last = Math.max(lastSyncAt(accountId) ?? 0, Number(getCursor(`last_attempt:${accountId}`) ?? 0)) || null;
  return last == null || now.getTime() - last > FRESH_MS;
}

function dateRange(now: Date): string[] {
  const out: string[] = [];
  for (let i = 0; i <= KEEP_DAYS_AHEAD; i++) { const d = new Date(now); d.setDate(d.getDate() + i); out.push(ymd(d)); }
  return out;
}

const inFlight = new Set<string>();
/** One scrape per account at a time: an overlapping call is skipped "busy" and costs nothing against the cap. */
/** `forceDetailIds`: Google event ids whose details are re-read this pass even when fresh (pre-prep). */
export async function syncAccount(accountId: string, deps: SyncDeps, reason: SyncReason, opts: { forceDetailIds?: string[] } = {}) {
  if (inFlight.has(accountId)) return { ok: true, events: 0, fault: null, skipped: "busy" as const };
  inFlight.add(accountId);
  try { return await runSync(accountId, deps, reason, opts); } finally { inFlight.delete(accountId); }
}

/**
 * Owner 2026-10-06: the agenda read can come back blank or half-drawn, so an event missing from it is not taken as
 * deleted. Its own page is opened (≤ ABSENCE_CHECK_MAX per read): only Google saying it can't find the event, as
 * that calendar's account, marks it missing (a confirmed removal: its steps go). Found, unsure, no id, or over the
 * limit → nothing changes and the next read asks again. A rename or move keeps the Google id, which is the key, so
 * it is never absent.
 */
async function checkAbsences(accountId: string, deps: SyncDeps, dates: string[], rows: { eventKey: string }[], at: number): Promise<void> {
  const presentKeys = new Set(rows.map((r) => r.eventKey));
  const absent = unmissedEvents(accountId, dates).filter((e) => !presentKeys.has(e.eventKey));
  const gone: string[] = [];
  let checks = 0, kept = 0;
  for (const e of absent) {
    if (!e.googleEventId || checks >= ABSENCE_CHECK_MAX) continue;
    checks++;
    const r = await deps.platform.connectors.exec<{ ok?: boolean; exists?: boolean }>({
      skillId: "google-calendar", functionName: "getEvent", accountHint: accountId,
      params: { eid: e.googleEventId, check: true }, timeoutMs: EXISTS_CHECK_TIMEOUT_MS,
    });
    if (r.ok && r.data?.ok === true && r.data.exists === false) gone.push(e.eventKey); else kept++;
  }
  const titles = new Map(gone.map((k) => [k, getEvent(accountId, k)?.title ?? ""]));
  markEventsMissing(accountId, gone, at, true);
  for (const k of gone) await withdrawStepsOf(deps.platform, accountId, k, titles.get(k) || "An event");
  if (absent.length) console.log(`[calendar-desk] ${absent.length} event(s) missing from the read for ${accountId}: ${checks} checked — ${gone.length} gone, ${kept} kept`);
}

async function runSync(accountId: string, deps: SyncDeps, reason: SyncReason, opts: { forceDetailIds?: string[] }) {
  const now = (deps.now ?? (() => new Date()))();
  const day = ymd(now);
  if (!deps.platform.configured) return { ok: false, events: 0, fault: "not configured" };
  if (scrapesToday(accountId, day) >= DAILY_SCRAPE_CAP) return { ok: false, events: 0, fault: null, skipped: "cap" as const };
  if (!shouldScrape(accountId, now, reason)) return { ok: true, events: 0, fault: null, skipped: "fresh" as const };

  setCursor(`scrapes:${accountId}:${day}`, String(scrapesToday(accountId, day) + 1));
  setCursor(`last_attempt:${accountId}`, String(now.getTime()));
  const plan = detailPlan(accountId, now, { forceIds: opts.forceDetailIds });
  const res = await deps.platform.connectors.exec<{ ok?: boolean; events?: ScrapedEvent[] }>({
    skillId: "google-calendar", functionName: "listEvents", accountHint: accountId,
    params: { timeMin: day, maxResults: MAX_RESULTS, details: plan },
    timeoutMs: plan.max > 0 ? DETAIL_SCRAPE_TIMEOUT_MS : SCRAPE_TIMEOUT_MS,
  });
  if (!res.ok || !res.data || res.data.ok === false || !Array.isArray(res.data.events)) {
    // A refused or faulted read says NOTHING about the calendar: keep what we had.
    const fault = !res.ok ? res.reason : "scrape returned no event list";
    setCursor(`fault:${accountId}`, fault);
    console.warn(`[calendar-desk] sync ${accountId} (${reason}) failed: ${fault}`);
    return { ok: false, events: 0, fault };
  }
  const norm = normalizeScrape(res.data.events, { calendar: "primary", now });
  if (res.data.events.length > 0 && norm.rows.length === 0 && norm.skipped > 0) {
    // Every non-noise row was unreadable (filtered noise proves nothing): a parser fault, not an empty calendar.
    const fault = "agenda unreadable";
    setCursor(`fault:${accountId}`, fault);
    console.warn(`[calendar-desk] sync ${accountId} (${reason}) failed: ${fault} (skipped=${norm.skipped})`);
    return { ok: false, events: 0, fault };
  }
  const rows = norm.rows.filter((r) => r.localDate >= day && dateRange(now).includes(r.localDate));
  const at = now.getTime();
  const renamed = rows.filter((r) => { const was = getEvent(accountId, r.eventKey)?.title; return was != null && was !== r.title; }).map((r) => r.eventKey);
  upsertEvents(accountId, rows, at);
  // An event without details (not asked, or its popover failed) keeps what was stored.
  for (const r of rows) if (r.details) saveEventDetails(accountId, r.eventKey, r.details, at, r.location);
  // A pass that was asked for details, had a timed event it could read, and got none back: back off to a
  // probe for a day (detailPlan). Any details clear it. Events in skipIds were not asked for, so they don't count.
  if (rows.some((r) => r.details)) setCursor(detailMissCursor(accountId), "");
  else if (plan.max > 0 && rows.some((r) => !r.allDay && !(r.googleEventId && plan.skipIds.includes(r.googleEventId)))) setCursor(detailMissCursor(accountId), String(at));
  // A read cut off at maxResults says nothing about the events past the cut; any other read is followed by
  // asking Google about each stored event it didn't show.
  // Steps whose withdrawal failed on an earlier read are retried first, so a failure just now waits for the next read.
  await retryPendingWithdrawals(deps.platform, accountId);
  if (renamed.length) await refreshRenamedSteps(deps.platform, accountId, renamed);
  if (res.data.events.length < MAX_RESULTS) await checkAbsences(accountId, deps, dateRange(now), rows, at);
  _db.query("DELETE FROM events WHERE account_id = ? AND source = 'google' AND (local_date < ? OR (missing_since IS NOT NULL AND missing_since < ?))").run(accountId, ymd(new Date(at - 86_400_000)), at - 2 * 86_400_000);
  setCursor(`last_sync:${accountId}`, String(at));
  setCursor(`fault:${accountId}`, "");
  console.log(`[calendar-desk] sync ${accountId} (${reason}): ${rows.length} event(s), skipped=${norm.skipped}, filtered=${norm.filtered}`);
  return { ok: true, events: rows.length, fault: null, skippedRows: norm.skipped };
}
