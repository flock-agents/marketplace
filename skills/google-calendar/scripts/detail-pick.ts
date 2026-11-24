import { parseEventDetail, EVENT_DETAIL_COLLECT_JS, type RawEventDetail, type EventDetails } from "./event-detail-parse";
import { MARK_JS, clickTarget } from "../../_shared/_realInput";

/** Budget per row: a row whose dialog never opens costs ~2.2s (150ms + 20 x 100ms), a good one ~1s. */
export const DETAIL_MS_PER_EVENT = 3500;
/** Ceiling on the popover walk (detailActions). Worst case: the agenda call (30s goto + 3s wait + agenda eval, itself
 *  bounded at 30s) plus the detail call (30s goto + 3s wait + 110s) is 206s in theory, ~177s in practice (the
 *  agenda eval takes seconds). Calendar Desk's 195s exec timeout would fire first in the theoretical case, and
 *  a timed-out scrape keeps the stored events. */
export const DETAIL_BUDGET_CAP_MS = 110_000;
/** The walk's deadline is this long before its budget, so partial results come back instead of a kill. */
export const DETAIL_DEADLINE_MARGIN_MS = 6000;
/** A row is not started with less than this left before the walk's own deadline (one row's worst cost). */
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

/** Bound on each page script of the walk: the longest (waiting for a row's dialog) takes ~2.3s. */
const DETAIL_STEP_MS = 5000;

/** Shared by every page script of the walk: the walk's state lives on the page between steps. */
const DETAIL_PRELUDE = `${MARK_JS}
  var st = window.__flockDetail;
  function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
  // A multi-day row reads "Title (Day 1 of 3)"; its popover heading is the bare title.
  function norm(s) { return String(s || "").replace(/\\s+/g, " ").trim().toLowerCase().replace(/\\s*\\(day \\d+ of \\d+\\)$/, ""); }
  function headingOf(d) { var h = d.querySelector("#rAECCd") || d.querySelector("[role=heading]"); return h ? norm(h.innerText) : ""; }
  function dialogFor(want) {
    var ds = document.querySelectorAll("[role=dialog]");
    for (var k = 0; k < ds.length; k++) if (headingOf(ds[k]) === want) return ds[k];
    return null;
  }
  function markClose(d) { st.closing = d ? headingOf(d) : ""; flockMark("detail-close", d ? d.querySelector("#xDetDlgCloseBu") : null); }`;

const pageStep = (body: string, async = false) =>
  ({ action: "evaluate", script: `(${async ? "async " : ""}function(){\n  ${DETAIL_PRELUDE}\n  ${body}\n})()`, delay: DETAIL_STEP_MS });

/** Before a row: stop when its deadline is near; mark the row, and a dialog left open (to close first). */
function prepRowStep(row: { id: string; title: string }) {
  return pageStep(`st.want = ""; st.closing = ""; flockClear("detail-");
  if (st.stop || Date.now() > st.stopAt - ${DETAIL_ROW_GUARD_MS}) { st.stop = true; return; }
  var want = norm(${JSON.stringify(row.title)});
  var row = document.querySelector("div[role=button][data-eventid=" + ${JSON.stringify(JSON.stringify(row.id))} + "]");
  if (!want || !flockMark("detail-row", row)) return;
  st.want = want;
  markClose(document.querySelector("[role=dialog]"));`);
}

/** After the row's click: wait for the dialog headed with its title, read it, and mark its close button. */
function readRowStep(rowId: string) {
  return pageStep(`${EVENT_DETAIL_COLLECT_JS}
  if (!st.want) { markClose(null); return; }
  var d = null;
  for (var t = 0; t < 20 && !d; t++) { await sleep(100); d = dialogFor(st.want); }
  markClose(d);
  if (!d) return;
  await sleep(300);
  try { st.out[${JSON.stringify(rowId)}] = collectEventDetail(d); } catch (e) {}`, true);
}

/** Flock's real click on the marked close button, then a wait for that dialog to go. */
const closeDialogSteps = () => [
  clickTarget("detail-close", true),
  pageStep(`for (var t = 0; t < 10 && st.closing && dialogFor(st.closing); t++) await sleep(100);`, true),
];

/** The popover walk as page actions: each row's detail popover is opened in turn with a real click, and the
 *  run's content is {eventId: RawEventDetail} as JSON. A page script only finds and marks (row, close button)
 *  and reads; every click is Flock's real input. It reads only a dialog whose heading is the row's title (a
 *  dialog left from another row is never read), closes it with its close button and waits for it to go
 *  before the next row. */
export function detailActions(rows: { id: string; title: string }[], deadlineMs: number): any[] {
  const actions: any[] = [{
    action: "evaluate",
    script: `(function(){ window.__flockDetail = { out: {}, stopAt: Date.now() + ${Math.floor(deadlineMs)}, stop: false, want: "", closing: "" }; })()`,
  }];
  for (const row of rows) {
    actions.push(
      prepRowStep(row),
      ...closeDialogSteps(),
      clickTarget("detail-row", true),
      readRowStep(row.id),
      ...closeDialogSteps(),
    );
  }
  actions.push({ action: "evaluate", script: `JSON.stringify(window.__flockDetail.out)` });
  return actions;
}
