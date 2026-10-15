// Does a stored Google event still exist? (2026-10-06: a blank agenda read after a browser error looked like an
// empty week.) Opening calendar/event?eid=… redirects: to the event's date with the eid kept when Google has it,
// or home with ?msg=… and no eid when it can't find it — which a DIFFERENT signed-in account also gets, so a
// deletion counts only when the page is signed in as the calendar inside the eid. Pure; the page part is in getEvent.
import { selfOf } from "./event-detail-parse";

/** The calendar email inside an eid (base64 of "<eventId> <calendar email>"), or null. */
export function eidOwner(eid: string): string | null {
  if (!eid) return null;
  const decoded = Buffer.from(eid.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  const email = decoded.split(" ")[1]?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+$/.test(email)) return null;
  // Google shortens the domain inside eids: gmail.com → "m", group calendars → "g".
  return email.endsWith("@m") ? `${email.slice(0, -2)}@gmail.com` : email.endsWith("@g") ? `${email.slice(0, -2)}@group.calendar.google.com` : email;
}

export interface EventPageState { pathname: string; search: string; self: string | null }

/** "exists" | "gone" | "unknown" — anything short of Google saying so, as the event's own account, is unknown. */
export function classifyEventPage(page: EventPageState, eid: string): "exists" | "gone" | "unknown" {
  if (!/\/calendar\/(u\/\d+\/)?r(\/|$)/.test(page.pathname)) return "unknown"; // not redirected yet, or not Calendar
  const q = new URLSearchParams(page.search);
  if (q.get("eid")) return "exists";
  // Only Google's own "not found" counts; any other notice (or another language) says nothing.
  if (!/could not find/i.test(q.get("msg") ?? "")) return "unknown";
  const owner = eidOwner(eid), self = selfOf(page.self);
  return owner && self && owner === self ? "gone" : "unknown";
}

/** Page-side reader (ES5, spliced into an evaluate action): where the redirect landed and who is signed in. */
export const EVENT_PAGE_STATE_JS = `(function(){
  var self = null;
  var links = document.querySelectorAll("a[aria-label]");
  for (var j = 0; j < links.length; j++) {
    var lab = links[j].getAttribute("aria-label") || "";
    if (lab.indexOf("Google Account") === 0) { self = lab; break; }
  }
  return JSON.stringify({ pathname: location.pathname, search: location.search, self: self });
})()`;
