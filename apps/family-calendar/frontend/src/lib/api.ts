import type { CalendarEvent, Member, Reminder } from "@shared/types";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export const api = {
  events: {
    list: (params?: { from?: string; to?: string; memberId?: number }) => {
      const qs = new URLSearchParams();
      if (params?.from) qs.set("from", params.from);
      if (params?.to) qs.set("to", params.to);
      if (params?.memberId) qs.set("memberId", String(params.memberId));
      const q = qs.toString();
      return request<CalendarEvent[]>(`/api/events${q ? `?${q}` : ""}`);
    },
    create: (data: Partial<CalendarEvent>) =>
      request<CalendarEvent>("/api/events", { method: "POST", body: JSON.stringify(data) }),
    update: (id: number, data: Partial<CalendarEvent>) =>
      request<CalendarEvent>(`/api/events/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    delete: (id: number) =>
      request<{ ok: boolean }>(`/api/events/${id}`, { method: "DELETE" }),
  },
  members: {
    list: () => request<Member[]>("/api/members"),
    create: (data: Partial<Member>) =>
      request<Member>("/api/members", { method: "POST", body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Member>) =>
      request<Member>(`/api/members/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    delete: (id: number) =>
      request<{ ok: boolean }>(`/api/members/${id}`, { method: "DELETE" }),
  },
  reminders: {
    list: (params?: { from?: string; to?: string; status?: string }) => {
      const qs = new URLSearchParams();
      if (params?.from) qs.set("from", params.from);
      if (params?.to) qs.set("to", params.to);
      if (params?.status) qs.set("status", params.status);
      const q = qs.toString();
      return request<Reminder[]>(`/api/reminders${q ? `?${q}` : ""}`);
    },
    create: (data: Partial<Reminder>) =>
      request<Reminder>("/api/reminders", { method: "POST", body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Reminder>) =>
      request<Reminder>(`/api/reminders/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  },
};
