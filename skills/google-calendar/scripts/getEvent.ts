import {
  errorJson,
  requireBrowserSession,
  validateId,
  browserInteract,
} from "../../_shared/_google_helpers";
import { EVENT_DETAIL_COLLECT_JS, parseEventDetail, whenFromText } from "./event-detail-parse";
import { classifyEventPage, EVENT_PAGE_STATE_JS } from "./event-exists";

// Agents ask for one event's details. Calendar Desk uses only `check` (after a blank agenda read): does a stored
// event still exist? `{ eid, check: true }` → `{ ok: true, exists }`, exists:false only when Google says it can't
// find the event while signed in as that event's calendar; anything uncertain is an UNKNOWN error.

const params = JSON.parse(process.env.SKILL_PARAMS || "{}");
const eventId: string = params.eventId || "";
const calendarId: string = params.calendarId || "primary";
/** Google's own eid (as the agenda's data-eventid carries it); preferred over eventId + calendarId. */
const eidParam: string = typeof params.eid === "string" ? params.eid : "";

if (!eventId && !eidParam) {
  errorJson("MISSING_PARAM", "eventId or eid is required");
}

requireBrowserSession();
if (eidParam) validateId(eidParam, "eid"); else validateId(eventId, "eventId");

const eidB64 = eidParam || Buffer.from(`${eventId} ${calendarId}`).toString("base64");
const eventUrl = `https://calendar.google.com/calendar/event?eid=${eidB64}`;

if (params.check === true) {
  (async () => {
    const result = await browserInteract(eventUrl, [{ action: "wait", delay: 3500 }, { action: "evaluate", script: EVENT_PAGE_STATE_JS }]);
    let page: any = {};
    try { page = typeof result?.content === "string" ? JSON.parse(result.content) : result?.content ?? {}; } catch { page = {}; }
    const verdict = classifyEventPage({ pathname: String(page.pathname ?? ""), search: String(page.search ?? ""), self: typeof page.self === "string" ? page.self : null }, eidB64);
    if (verdict === "unknown") errorJson("UNKNOWN", "Could not tell whether the event exists");
    console.log(JSON.stringify({ ok: true, exists: verdict === "exists", source: "browser_session" }));
  })();
} else {

// The event page shows the same fields as the agenda popover, either in a dialog or in the page body.
const EXTRACT_SCRIPT = `(function(){
  ${EVENT_DETAIL_COLLECT_JS}
  var raw = collectEventDetail(document.querySelector("[role=dialog]") || document.body);
  if (!raw.heading) return JSON.stringify({ok:false, message:"Could not extract event details. The event page may not have loaded correctly."});
  var w = (document.querySelector('[data-key=when]') || {}).innerText;
  return JSON.stringify({ok:true, raw:raw, when:String(w || '').trim()});
})()`;

const pageActions = [
  { action: "wait", delay: 3000 },
  { action: "evaluate", script: EXTRACT_SCRIPT },
];

(async () => {
  const result = await browserInteract(eventUrl, pageActions);
  const content = result?.content || "{}";
  let parsed: any;
  try {
    parsed = typeof content === "string" ? JSON.parse(content) : content;
  } catch {
    parsed = {};
  }
  const eventOk = parsed?.ok ?? false;

  if (eventOk) {
    const d = parseEventDetail(parsed.raw, parsed.raw.heading);
    console.log(JSON.stringify({ ok: true, eventId, title: parsed.raw.heading, when: parsed.when || whenFromText(String(parsed.raw.text || ""), parsed.raw.heading), location: d?.location ?? "", description: d?.description ?? "", guests: d?.guests ?? null /* null = could not be read */, source: "browser_session" }));
  } else {
    const eventMsg = parsed?.message || "unknown error";
    errorJson("BROWSER_ERROR", `Failed to get event: ${eventMsg}`);
  }
})();
}
