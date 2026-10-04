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
  const inits = listInit();
  const fault = inits.map((i) => lastFault(i.accountId)).find(Boolean) ?? null;
  // A10: reminders never needed Google. `connected` = the app answered; the Google link is a separate state.
  const connector = inits.length === 0 ? "none" : fault ? "attention" : inits.some((i) => i.outcome === "done") ? "ok" : "syncing";
  const items: any[] = [];
  for (const e of listEvents({ fromDate: date, toDate: date })) {
    const p = getPrep(e.accountId, e.eventKey);
    items.push({ id: e.eventKey, kind: "event", title: e.title, date, startAt: e.startAt, endAt: e.endAt, allDay: e.allDay,
      state: p ? "prepped" : undefined, marks: getEventNote(e.accountId, e.eventKey) ? ["note"] : [], link: p?.sessionId ? { kind: "chat", sessionId: p.sessionId } : null });
  }
  const fires = listFiresOn(date);
  // Rows PUBLISHED today (by publish time, not occurrence date), so a lead row — "in 3 days" — is on the rail too.
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const published = listRowFiresPublishedBetween(dayStart, dayStart + 86_400_000);
  for (const r of listActiveReminders().filter((r) => r.dueDate === date || fires.some((f) => f.reminderId === r.id) || published.some((f) => f.reminderId === r.id))) {
    const row = published.filter((f) => f.reminderId === r.id).pop() ?? listRowFires(r.id, date)[0] ?? null;
    const occ = row?.occurrence ?? date;
    const chat = getFire(r.id, date, "chat");
    items.push({ id: r.id, kind: "reminder", title: occ === date ? r.title : titleForLead(r, occ, date), date, allDay: occ !== date || !r.dueTime,
      startAt: occ === date && r.dueTime ? new Date(`${date}T${r.dueTime}:00`).getTime() : null,
      state: chat?.status === "ok" ? "sent" : "open",
      link: row ? { kind: "task", sourceRef: rowSourceRef(r.id, occ) } : chat?.sessionId ? { kind: "chat", sessionId: chat.sessionId } : null });
  }
  return c.json({ template: "schedule", date, connected: true, fault: null, connector, items });
});
