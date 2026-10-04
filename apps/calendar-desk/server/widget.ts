import { Hono } from "hono";
import { listEvents, listActiveReminders, listFiresOn, listRowFiresPublishedBetween, listRowFires, getPrep, getEventNote, listInit, getFire } from "./store";
import { lastFault } from "./sync";
import { rowSourceRef } from "./scheduler";
import { ymd } from "./events";
import { titleForLead } from "./rules";

export const widgetRoutes = new Hono();
// Loopback-only, unauthenticated like every widget dataUrl: the platform's widget proxy is the only caller.
widgetRoutes.get("/api/widget/today", (c) => {
  const date = ymd(new Date());
  // A15: the rail is the week ahead — today through the next 7 days — each item carrying its own date.
  const endDate = ymd(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + 7));
  const inWindow = (d: string) => d >= date && d <= endDate;
  const inits = listInit();
  const fault = inits.map((i) => lastFault(i.accountId)).find(Boolean) ?? null;
  // A10: reminders never needed Google. `connected` = the app answered; the Google link is a separate state.
  const connector = inits.length === 0 ? "none" : fault ? "attention" : inits.some((i) => i.outcome === "done") ? "ok" : "syncing";
  const items: any[] = [];
  for (const e of listEvents({ fromDate: date, toDate: endDate })) {
    const p = getPrep(e.accountId, e.eventKey);
    items.push({ id: e.eventKey, kind: "event", title: e.title, date: e.localDate, calendar: e.calendar ?? undefined, startAt: e.startAt, endAt: e.endAt, allDay: e.allDay,
      state: p ? "prepped" : undefined, marks: getEventNote(e.accountId, e.eventKey) ? ["note"] : [], link: p?.sessionId ? { kind: "chat", sessionId: p.sessionId } : null });
  }
  const fires = listFiresOn(date);
  // Rows PUBLISHED today (by publish time, not occurrence date), so a lead row — "in 3 days" — is on the rail too.
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const published = listRowFiresPublishedBetween(dayStart, dayStart + 86_400_000);
  for (const r of listActiveReminders().filter((r) => inWindow(r.dueDate) || fires.some((f) => f.reminderId === r.id) || published.some((f) => f.reminderId === r.id))) {
    const row = published.filter((f) => f.reminderId === r.id).pop() ?? listRowFires(r.id, date)[0] ?? null;
    const occ = row?.occurrence ?? (inWindow(r.dueDate) ? r.dueDate : date);
    const chat = getFire(r.id, date, "chat");
    // A lead row published today is all-day under its lead title; otherwise the plain title and the due time.
    const timed = !!r.dueTime && (occ === date || !row);
    items.push({ id: r.id, kind: "reminder", title: row ? titleForLead(r, occ, date) : r.title, date: occ, allDay: !timed,
      startAt: timed ? new Date(`${occ}T${r.dueTime}:00`).getTime() : null,
      state: chat?.status === "ok" ? "sent" : "open",
      link: row ? { kind: "task", sourceRef: rowSourceRef(r.id, occ) } : chat?.sessionId ? { kind: "chat", sessionId: chat.sessionId } : null });
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || Number(b.allDay) - Number(a.allDay) || (a.startAt ?? 0) - (b.startAt ?? 0));
  return c.json({ template: "schedule", date, connected: true, fault: null, connector, items });
});
