import { Hono } from "hono";
import { listEvents, getPrep, getEventNote, listInit } from "./store";
import { lastFault } from "./sync";
import { ymd } from "./events";

export const widgetRoutes = new Hono();
// Loopback-only, unauthenticated like every widget dataUrl: the platform's widget proxy is the only caller.
widgetRoutes.get("/api/widget/today", (c) => {
  const date = ymd(new Date());
  // A15: the rail is the week ahead — today through the next 7 days — each item carrying its own date.
  const endDate = ymd(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + 7));
  const inits = listInit();
  const fault = inits.map((i) => lastFault(i.accountId)).find(Boolean) ?? null;
  // A10: `connected` = the app answered; the Google link is a separate state.
  const connector = inits.length === 0 ? "none" : fault ? "attention" : inits.some((i) => i.outcome === "done") ? "ok" : "syncing";
  const items: any[] = [];
  for (const e of listEvents({ fromDate: date, toDate: endDate })) {
    const p = getPrep(e.accountId, e.eventKey);
    items.push({ id: e.eventKey, kind: "event", accountId: e.accountId, title: e.title, date: e.localDate, calendar: e.calendar ?? undefined, startAt: e.startAt, endAt: e.endAt, allDay: e.allDay,
      state: p ? "prepped" : undefined, marks: getEventNote(e.accountId, e.eventKey) ? ["note"] : [], link: p?.sessionId ? { kind: "chat", sessionId: p.sessionId } : null });
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || Number(b.allDay) - Number(a.allDay) || (a.startAt ?? 0) - (b.startAt ?? 0));
  return c.json({ template: "schedule", date, connected: true, fault: null, connector, items });
});
