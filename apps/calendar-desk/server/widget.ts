import { Hono } from "hono";
import { listEvents, listActiveReminders, listFiresOn, getPrep, getEventNote, listInit, getFire } from "./store";
import { lastFault } from "./sync";
import { rowSourceRef } from "./scheduler";
import { ymd } from "./events";

export const widgetRoutes = new Hono();
// Loopback-only, unauthenticated like every widget dataUrl: the platform's widget proxy is the only caller.
widgetRoutes.get("/api/widget/today", (c) => {
  const date = ymd(new Date());
  const inits = listInit();
  const fault = inits.map((i) => lastFault(i.accountId)).find(Boolean) ?? null;
  const connected = inits.some((i) => i.outcome === "done") && !fault;
  const items: any[] = [];
  for (const e of listEvents({ fromDate: date, toDate: date })) {
    const p = getPrep(e.accountId, e.eventKey);
    items.push({ id: e.eventKey, kind: "event", title: e.title, date, startAt: e.startAt, endAt: e.endAt, allDay: e.allDay,
      state: p ? "prepped" : undefined, marks: getEventNote(e.accountId, e.eventKey) ? ["note"] : [], link: p?.sessionId ? { kind: "chat", sessionId: p.sessionId } : null });
  }
  const fires = listFiresOn(date);
  for (const r of listActiveReminders().filter((r) => r.dueDate === date || fires.some((f) => f.reminderId === r.id))) {
    const row = getFire(r.id, date, "row"); const chat = getFire(r.id, date, "chat");
    items.push({ id: r.id, kind: "reminder", title: r.title, date, allDay: !r.dueTime,
      startAt: r.dueTime ? new Date(`${date}T${r.dueTime}:00`).getTime() : null,
      state: chat?.status === "ok" ? "sent" : "open",
      link: row ? { kind: "task", sourceRef: rowSourceRef(r.id, date) } : chat?.sessionId ? { kind: "chat", sessionId: chat.sessionId } : null });
  }
  return c.json({ template: "schedule", date, connected, fault: fault ? "Google session needs attention" : null, items });
});
