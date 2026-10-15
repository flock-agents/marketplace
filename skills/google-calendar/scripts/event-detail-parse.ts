// Google Calendar event detail popover (spike 2026-10-06). The collector runs in the page, so it is
// ES5 source with no backslashes, single quotes or template syntax (it is spliced into page scripts,
// like AGENDA_PARSE_JS). All judgement lives in parseEventDetail, which is pure and unit-tested.
export const DESCRIPTION_MAX = 1000;
/** Invite text is untrusted: a location longer than this is cut. */
export const LOCATION_MAX = 200;

export const EVENT_DETAIL_COLLECT_JS = `function collectEventDetail(dialog) {
  function txt(sel) { var el = dialog.querySelector(sel); return el ? String(el.innerText || "").trim() : null; }
  var guests = [];
  var els = dialog.querySelectorAll("[data-email]");
  for (var i = 0; i < els.length; i++) {
    guests.push({ email: els[i].getAttribute("data-email") || "", label: els[i].getAttribute("aria-label") || "", organiser: els[i].id === "xDtlDlgOrg" });
  }
  var head = dialog.querySelector("#rAECCd") || dialog.querySelector("[role=heading]");
  var self = null;
  var links = document.querySelectorAll("a[aria-label]");
  for (var j = 0; j < links.length; j++) {
    var lab = links[j].getAttribute("aria-label") || "";
    if (lab.indexOf("Google Account") === 0) { self = lab; break; }
  }
  return { heading: head ? String(head.innerText || "").trim() : "", text: String(dialog.innerText || ""), guests: guests,
    location: txt("#xDetDlgLoc"), description: txt("#xDetDlgDesc"), selfEmail: self };
}`;

export interface RawEventDetail { heading: string; text: string; guests: { email: string; label: string; organiser: boolean }[]; location: string | null; description: string | null; selfEmail: string | null }
export interface EventGuest { email: string; name?: string; rsvp?: "yes" | "no" | "maybe" | "awaiting"; organiser?: true }
/** `guests` absent = unknown (not read reliably): a consumer treats it like details never read for guests. */
export interface EventDetails { guests?: EventGuest[]; guestSummary?: string; location?: string; description?: string; meetLink?: string }

const RSVP: Record<string, EventGuest["rsvp"]> = { attending: "yes", "not attending": "no", declined: "no", maybe: "maybe", tentative: "maybe", awaiting: "awaiting" };
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
/** A multi-day event's agenda row reads "Title (Day 1 of 3)"; its popover heading is the bare title. */
const sameEventTitle = (a: string, b: string) => { const bare = (s: string) => norm(s).replace(/\s*\(day \d+ of \d+\)$/, ""); return bare(a) === bare(b); };

/** The account email inside "Google Account: Name (email)", or the value itself when it is already an email. */
export function selfOf(v: string | null): string | null {
  if (!v) return null;
  const m = /\(([^()\s]+@[^()\s]+)\)/.exec(v);
  return (m ? m[1] : /^[^\s@]+@[^\s@]+$/.test(v.trim()) ? v.trim() : null)?.toLowerCase() ?? null;
}

/** Non-empty lines of a popover field, minus the screen-reader label line ("Location:" / "Description:"). */
function fieldLines(v: string | null, label: string): string[] {
  const lines = (v ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines[0]?.toLowerCase() === label) lines.shift();
  return lines;
}

export function parseEventDetail(raw: RawEventDetail, rowTitle: string): EventDetails | null {
  // A dialog left over from another row would hand us that event's guests.
  if (!raw.heading || !sameEventTitle(raw.heading, rowTitle)) return null;
  const self = selfOf(raw.selfEmail);
  let guests: EventGuest[] | undefined = [];
  for (const g of raw.guests) {
    const email = g.email.trim().toLowerCase();
    if (!email || email === self || guests.some((x) => x.email === email)) continue;
    const parts = g.label.split(", ").map((p) => p.trim()).filter(Boolean);
    const name = parts[0] && parts[0].toLowerCase() !== email ? parts[0] : undefined;
    const rsvp = parts.slice(1).map((p) => RSVP[p.toLowerCase()]).find(Boolean);
    guests.push({ email, ...(name ? { name } : {}), ...(rsvp ? { rsvp } : {}), ...(g.organiser ? { organiser: true as const } : {}) });
  }
  const lines = raw.text.split("\n").map((l) => l.trim());
  const gi = lines.findIndex((l) => /^\d+ guests?$/.test(l));
  // Guests are unknown (never "none") when the owner's email is missing (the list may hold the owner) or when
  // the popover counts guests but no guest element was found (Google changed the markup).
  if (!self || (gi >= 0 && Number(lines[gi].split(" ")[0]) >= 1 && raw.guests.length === 0)) guests = undefined;
  const summary = gi < 0 ? undefined : [lines[gi], ...lines.slice(gi + 1).filter((l, i, a) => a.slice(0, i + 1).every((x) => /^\d+ (yes|no|maybe|awaiting)$/.test(x)))].join(" · ");
  const meet = /meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/.exec(raw.text);
  const location = fieldLines(raw.location, "location:").join(", ").slice(0, LOCATION_MAX);
  const description = fieldLines(raw.description, "description:").join("\n");
  return {
    ...(guests ? { guests } : {}),
    ...(summary ? { guestSummary: summary } : {}),
    ...(location ? { location } : {}),
    ...(description ? { description: description.slice(0, DESCRIPTION_MAX) } : {}),
    ...(meet ? { meetLink: `https://${meet[0]}` } : {}),
  };
}

/** The popover's "when" line: the first non-empty line after the heading (getEvent's fallback when the page
 *  has no [data-key=when]). */
export function whenFromText(text: string, heading: string): string {
  const lines = text.split("\n").map((l) => l.trim());
  const i = lines.findIndex((l) => l && norm(l) === norm(heading));
  return i < 0 ? "" : lines.slice(i + 1).find(Boolean) ?? "";
}
