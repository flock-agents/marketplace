import { Hono } from "hono";
import { listEvents, getPrep, getEventNote, listInit } from "./store";
import { lastFault } from "./sync";
import { ymd } from "./events";

export const widgetRoutes = new Hono();
export const RAIL_DAYS = 7;
export const HORIZON_DAYS = 90;

const daysAhead = (n: number) => { const d = new Date(); return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)); };

// One item shape for every feed: the rail (today) and the planner's horizon read the same events through this.
function eventItem(e: ReturnType<typeof listEvents>[number]) {
  const p = getPrep(e.accountId, e.eventKey);
  const note = getEventNote(e.accountId, e.eventKey) ? ["note"] : [];
  const fact = e.source === "fact";
  const link = p?.sessionId ? { kind: "chat", sessionId: p.sessionId }
    : fact && e.sourceLink && /^https:\/\//.test(e.sourceLink) ? { kind: "url", href: e.sourceLink } : null;
  // Guests, location and Meet are context for the planner and the rail; the description never leaves the store.
  const guests = e.guests ?? [];
  const extra = {
    ...(guests.length ? { guests: guests.slice(0, 8).map(({ email, name, rsvp }) => ({ email, ...(name ? { name } : {}), ...(rsvp ? { rsvp } : {}) })) } : {}),
    ...(guests.length > 8 ? { moreGuests: guests.length - 8 } : {}),
    ...(e.location ? { location: e.location } : {}),
    ...(e.meetLink ? { meetLink: e.meetLink } : {}),
    // Never read yet (guests null, no detail pass): the planner may wait a little for them (bounded in Flock).
    ...(e.source === "google" && e.guests == null && e.detailsAt == null ? { detailsPending: true } : {}),
  };
  return { id: e.eventKey, kind: "event", ...(e.accountId ? { accountId: e.accountId } : {}), title: e.title, date: e.localDate, calendar: e.calendar ?? undefined,
    startAt: e.startAt, endAt: e.endAt, allDay: e.allDay, state: p ? "prepped" : undefined, marks: fact ? ["memory", ...note] : note, link, ...extra };
}

function eventItems(days: number) {
  const items = listEvents({ fromDate: daysAhead(0), toDate: daysAhead(days) }).map(eventItem);
  items.sort((a, b) => a.date.localeCompare(b.date) || Number(b.allDay) - Number(a.allDay) || (a.startAt ?? 0) - (b.startAt ?? 0));
  return items;
}

// A10: `connected` = the app answered; the Google link is a separate state, and both feeds report it the same way.
function connectorState() {
  const inits = listInit();
  const fault = inits.map((i) => lastFault(i.accountId)).find(Boolean) ?? null;
  return inits.length === 0 ? "none" : fault ? "attention" : inits.some((i) => i.outcome === "done") ? "ok" : "syncing";
}

// Loopback-only, unauthenticated like every widget dataUrl: the platform's widget proxy is the only caller.
widgetRoutes.get("/api/widget/today", (c) => {
  const date = ymd(new Date());
  const connector = connectorState();
  // A15: the rail is the week ahead — today through the next 7 days — each item carrying its own date.
  return c.json({ template: "schedule", date, connected: true, fault: null, connector, items: eventItems(RAIL_DAYS) });
});

// Google events a clean read that saw rows found gone (markMissingEvents, confirmed), today onward: the planner drops their steps on the
// first read instead of waiting out a second one (owner 2026-10-06). Rows stay missing ≤2 days before sync deletes them.
function removedItems(days: number) {
  return listEvents({ fromDate: daysAhead(0), toDate: daysAhead(days), source: "google", includeMissing: true })
    .filter((e) => e.missingSince != null && e.missingConfirmed).map((e) => ({ id: e.eventKey, date: e.localDate }));
}

// The platform's event planner reads the long horizon: same events, same items, 90 days.
widgetRoutes.get("/api/widget/horizon", (c) => c.json({ template: "horizon", date: ymd(new Date()), connector: connectorState(), fault: null, items: eventItems(HORIZON_DAYS), removed: removedItems(HORIZON_DAYS) }));
