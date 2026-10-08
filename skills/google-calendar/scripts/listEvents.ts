import {
  errorJson,
  requireBrowserSession,
  browserInteract,
} from "../../_shared/_google_helpers";
import { AGENDA_PARSE_JS } from "./agenda-parse";
import type { RawEventDetail } from "./event-detail-parse";
import { pickDetailRows, mergeDetails, detailScript, DETAIL_MS_PER_EVENT, DETAIL_BUDGET_CAP_MS, DETAIL_DEADLINE_MARGIN_MS } from "./detail-pick";

const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
const calendarId: string = params.calendarId || "primary";
const timeMin: string = params.timeMin || "";
const timeMax: string = params.timeMax || "";
const maxResults: number = params.maxResults ?? 25;
const details: { max: number; skipIds: string[] } | null =
  params.details && typeof params.details.max === "number" ? { max: params.details.max, skipIds: Array.isArray(params.details.skipIds) ? params.details.skipIds : [] } : null;

requireBrowserSession();

let agendaUrl = "https://calendar.google.com/calendar/r/agenda";
if (timeMin) {
  const datePart = timeMin.replace(/T.*/, "").replace(/-/g, "");
  if (/^\d{8}$/.test(datePart)) {
    const y = datePart.slice(0, 4);
    const m = datePart.slice(4, 6);
    const d = datePart.slice(6, 8);
    agendaUrl = `https://calendar.google.com/calendar/r/agenda/${y}/${m}/${d}`;
  }
}

const EXTRACT_EVENTS = `(function(){
  var events = [];
  var seen = {};
  var maxR = ${maxResults};
  ${AGENDA_PARSE_JS}
  var btns = document.querySelectorAll("div[role=\\"button\\"][data-eventid][aria-label]");
  Array.prototype.forEach.call(btns, function(b) {
    if (events.length >= maxR) return;
    var eventId = b.getAttribute("data-eventid") || "";
    if (!eventId || seen[eventId]) return;
    seen[eventId] = true;
    var p = parseAgendaAriaLabel(b.getAttribute("aria-label"), b.textContent);
    if (!p.title) return;
    events.push({eventId: eventId, title: p.title, time: p.time, date: p.date, allDay: p.allDay, location: p.location, calendar: p.calendar, attendees: p.attendees, monthDay: p.monthDay});
  });
  if (events.length > 0) {
    return JSON.stringify({ok: true, events: events, count: events.length});
  }

  // Fallback: no aria-label button rows on the page; use the older span-based reading.
  var rows = document.querySelectorAll("[data-eventid]");
  if (rows.length === 0) {
    rows = document.querySelectorAll("[data-eventchip]");
  }
  if (rows.length === 0) {
    rows = document.querySelectorAll("[role=\\"listitem\\"], [role=\\"button\\"][data-eventid], li[data-datekey]");
  }
  var dateHeaders = document.querySelectorAll("h2, [data-datekey], .K3Gpe");
  var dateMap = {};
  dateHeaders.forEach(function(h){
    var txt = h.textContent.trim();
    if (/\\w+,\\s|\\d{1,2}\\s\\w+|\\w+\\s\\d{1,2}/.test(txt)) dateMap[h.offsetTop] = txt;
  });
  var dateTops = Object.keys(dateMap).map(Number).sort(function(a,b){return a-b;});

  function getDateForY(y) {
    var best = "";
    for (var i = 0; i < dateTops.length; i++) {
      if (dateTops[i] <= y) best = dateMap[dateTops[i]];
      else break;
    }
    return best;
  }

  rows.forEach(function(row) {
    if (events.length >= maxR) return;
    var title = "";
    var time = "";
    var eventId = row.getAttribute("data-eventid") || "";
    if (eventId && seen[eventId]) return;

    var titleEl = row.querySelector("[data-key=\\"title\\"]") || row.querySelector("span[aria-hidden=\\"true\\"]") || row.querySelector("span");
    if (titleEl) title = titleEl.textContent.trim();

    var timeEl = row.querySelector("[data-key=\\"when\\"]") || row.querySelector("span[data-datekey]");
    if (timeEl) time = timeEl.textContent.trim();
    if (!time) {
      var cell = row.querySelector("div[role=\\"gridcell\\"]");
      if (cell) time = cell.textContent.trim();
    }
    if (!time) {
      var spans = row.querySelectorAll("span");
      for (var j = 0; j < spans.length; j++) {
        var t = spans[j].textContent.trim();
        if (/\\d{1,2}[:\\s]?\\d{2}/.test(t) || /all.day/i.test(t)) { time = t; break; }
      }
    }

    var date = getDateForY(row.offsetTop);
    if (title) { if (eventId) seen[eventId] = true; events.push({eventId: eventId, title: title, time: time, date: date, allDay: false, location: null, calendar: null, attendees: null}); }
  });

  return JSON.stringify({ok: true, events: events, count: events.length});
})()`;

const pageActions = [
  { action: "wait", delay: 3000 },
  { action: "evaluate", script: EXTRACT_EVENTS },
];

function parseContent(result: any): any {
  const content = result?.content || "{}";
  try {
    return typeof content === "string" ? JSON.parse(content) : content;
  } catch {
    return {};
  }
}

(async () => {
  const result = await browserInteract(agendaUrl, pageActions);
  const parsed = parseContent(result);
  if (!(parsed?.ok ?? false)) return errorJson("BROWSER_ERROR", "Failed to extract events from calendar agenda view");

  if (details && details.max > 0) {
    const ids = pickDetailRows(parsed.events, details.skipIds, details.max);
    // Each row's title (from the agenda read) tells the page script which dialog belongs to it.
    const titleOf = new Map<string, string>(parsed.events.map((e: { eventId: string; title: string }) => [e.eventId, e.title]));
    const rows = ids.map((id) => ({ id, title: titleOf.get(id) ?? "" }));
    if (ids.length) {
      try {
        // The evaluate action's delay bounds the in-page script; the script stops itself a margin earlier and
        // returns what it has. The call is soft: a server error here leaves the agenda result to print.
        const budget = Math.min(DETAIL_BUDGET_CAP_MS, 10_000 + ids.length * DETAIL_MS_PER_EVENT);
        const r = await browserInteract(
          agendaUrl,
          [{ action: "wait", delay: 3000 }, { action: "evaluate", script: detailScript(rows, budget - DETAIL_DEADLINE_MARGIN_MS), delay: budget }],
          undefined, undefined, { soft: true },
        );
        const rawById: Record<string, RawEventDetail> | null = r && typeof r.content === "string" ? JSON.parse(r.content) : null;
        mergeDetails(parsed.events, rawById);
      } catch { /* details are best-effort: the agenda read stands */ }
    }
  }
  console.log(JSON.stringify({ ...parsed, source: "browser_session" }));
})();
