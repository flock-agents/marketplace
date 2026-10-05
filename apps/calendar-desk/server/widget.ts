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
  return { id: e.eventKey, kind: "event", ...(e.accountId ? { accountId: e.accountId } : {}), title: e.title, date: e.localDate, calendar: e.calendar ?? undefined,
    startAt: e.startAt, endAt: e.endAt, allDay: e.allDay, state: p ? "prepped" : undefined, marks: fact ? ["memory", ...note] : note, link };
}

function eventItems(days: number) {
  const items = listEvents({ fromDate: daysAhead(0), toDate: daysAhead(days) }).map(eventItem);
  items.sort((a, b) => a.date.localeCompare(b.date) || Number(b.allDay) - Number(a.allDay) || (a.startAt ?? 0) - (b.startAt ?? 0));
  return items;
}

// Loopback-only, unauthenticated like every widget dataUrl: the platform's widget proxy is the only caller.
widgetRoutes.get("/api/widget/today", (c) => {
  const date = ymd(new Date());
  const inits = listInit();
  const fault = inits.map((i) => lastFault(i.accountId)).find(Boolean) ?? null;
  // A10: `connected` = the app answered; the Google link is a separate state.
  const connector = inits.length === 0 ? "none" : fault ? "attention" : inits.some((i) => i.outcome === "done") ? "ok" : "syncing";
  // A15: the rail is the week ahead — today through the next 7 days — each item carrying its own date.
  return c.json({ template: "schedule", date, connected: true, fault: null, connector, items: eventItems(RAIL_DAYS) });
});

// The platform's event planner reads the long horizon: same events, same items, 90 days.
widgetRoutes.get("/api/widget/horizon", (c) => c.json({ template: "horizon", date: ymd(new Date()), items: eventItems(HORIZON_DAYS) }));
