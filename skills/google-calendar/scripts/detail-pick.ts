import { parseEventDetail, EVENT_DETAIL_COLLECT_JS, type RawEventDetail, type EventDetails } from "./event-detail-parse";

/** Budget per row: a row whose dialog never opens costs ~2.2s (150ms + 20 x 100ms), a good one ~1s. */
export const DETAIL_MS_PER_EVENT = 3500;
/** Ceiling on the in-page detail script. Worst case: the agenda call (30s goto + 3s wait + agenda eval, itself
 *  bounded at 30s) plus the detail call (30s goto + 3s wait + 110s) is 206s in theory, ~177s in practice (the
 *  agenda eval takes seconds). Calendar Desk's 195s exec timeout would fire first in the theoretical case, and
 *  a timed-out scrape keeps the stored events. */
export const DETAIL_BUDGET_CAP_MS = 110_000;
/** The page script stops this long before its bound so partial results come back instead of a kill. */
export const DETAIL_DEADLINE_MARGIN_MS = 6000;
/** A row is not started with less than this left before the page script's own deadline (one row's worst cost). */
const DETAIL_ROW_GUARD_MS = 3000;
export const DETAIL_MAX_CEILING = 60;
/** Which agenda rows get their detail popover read: timed first (meetings), then all-day, in page order. */
export function pickDetailRows(rows: { eventId: string; allDay: boolean }[], skipIds: string[], max: number): string[] {
  const cap = Math.max(0, Math.min(DETAIL_MAX_CEILING, Math.floor(max)));
  const skip = new Set(skipIds);
  const seen = new Set<string>();
  const ordered = [...rows.filter((r) => !r.allDay), ...rows.filter((r) => r.allDay)];
  const out: string[] = [];
  for (const r of ordered) {
    if (out.length >= cap) break;
    if (!r.eventId || skip.has(r.eventId) || seen.has(r.eventId)) continue;
    seen.add(r.eventId); out.push(r.eventId);
  }
  return out;
}

/** Attach parsed details where the raw read parses; null or garbage leaves the events unchanged. */
export function mergeDetails<E extends { eventId: string; title: string; details?: EventDetails }>(events: E[], rawById: Record<string, RawEventDetail> | null): E[] {
  if (!rawById || typeof rawById !== "object") return events;
  for (const ev of events) {
    const raw = rawById[ev.eventId];
    let d: EventDetails | null = null;
    try { d = raw ? parseEventDetail(raw, ev.title) : null; } catch { d = null; }
    if (d) ev.details = d;
  }
  return events;
}

/** The in-page loop: opens each row's detail popover in turn and returns {eventId: RawEventDetail} as JSON.
 *  It reads only a dialog whose heading is the row's title (a dialog left from another row is never read),
 *  closes it with its close button (Escape when there is none) and waits for it to go before the next row. */
export function detailScript(rows: { id: string; title: string }[], deadlineMs: number): string {
  return `(async function(){
  ${EVENT_DETAIL_COLLECT_JS}
  var rows = ${JSON.stringify(rows.map((r) => ({ id: r.id, title: r.title })))};
  var out = {};
  var stopAt = Date.now() + ${Math.floor(deadlineMs)};
  function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
  // A multi-day row reads "Title (Day 1 of 3)"; its popover heading is the bare title.
  function norm(s) { return String(s || "").replace(/\\s+/g, " ").trim().toLowerCase().replace(/\\s*\\(day \\d+ of \\d+\\)$/, ""); }
  function headingOf(d) { var h = d.querySelector("#rAECCd") || d.querySelector("[role=heading]"); return h ? norm(h.innerText) : ""; }
  function dialogFor(want) {
    var ds = document.querySelectorAll("[role=dialog]");
    for (var k = 0; k < ds.length; k++) if (headingOf(ds[k]) === want) return ds[k];
    return null;
  }
  async function closeDialog(d) {
    var want = headingOf(d);
    var b = d.querySelector("#xDetDlgCloseBu");
    if (b) b.click(); else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    for (var t = 0; t < 10 && dialogFor(want); t++) await sleep(100);
  }
  for (var i = 0; i < rows.length; i++) {
    if (Date.now() > stopAt - ${DETAIL_ROW_GUARD_MS}) break;
    var want = norm(rows[i].title);
    var row = document.querySelector("div[role=button][data-eventid=" + JSON.stringify(rows[i].id) + "]");
    if (!row || !want) continue;
    var stale = document.querySelector("[role=dialog]");
    if (stale) await closeDialog(stale);
    row.click();
    var d = null;
    for (var t = 0; t < 20 && !d; t++) { await sleep(100); d = dialogFor(want); }
    if (!d) continue;
    await sleep(300);
    try { out[rows[i].id] = collectEventDetail(d); } catch (e) {}
    await closeDialog(d);
  }
  return JSON.stringify(out);
})()`;
}
