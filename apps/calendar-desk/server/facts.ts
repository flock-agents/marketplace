// Dated facts from memory become events (Part B §3). The platform's gate decides what qualifies
// and serves a SNAPSHOT (R36); this file reconciles against it. Google events are never touched here.
import type { PlatformContext, EventFactWire } from "@flock/app-sdk";
import { listEvents, listFactEvents, upsertFactEvent, deleteFactEvent, factEventKey, type EventRow } from "./store";

const TITLE_MAX = 120;
const DUP_WINDOW_MS = 60 * 60_000;
// Words that never make two titles the same event: function words, and generic event nouns
// ("Dentist call" and "Sales call" are different events).
const STOP = new Set(["the", "and", "for", "with", "from", "your", "our", "his", "her", "their", "this", "that", "about", "before", "after", "into", "onto", "will", "has", "have", "are", "was", "were", "due", "day", "today", "tomorrow", "meeting", "call", "event", "appointment", "reminder", "session"]);

export function factTitle(content: string): string {
  const one = content.replace(/\s+/g, " ").trim().replace(/\.$/, "");
  const cps = Array.from(one);
  return cps.length <= TITLE_MAX ? one : cps.slice(0, TITLE_MAX - 1).join("") + "…";
}
export function significantWords(title: string): Set<string> {
  return new Set(title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !STOP.has(w)));
}
export function isDuplicateOfGoogle(f: { localDate: string; startAt: number | null; title: string }, google: EventRow[]): boolean {
  const words = significantWords(f.title);
  return google.some((g) => g.localDate === f.localDate && (
    (f.startAt != null && g.startAt != null && Math.abs(f.startAt - g.startAt) <= DUP_WINDOW_MS)
    || [...significantWords(g.title)].some((w) => words.has(w))));
}
function startOf(date: string, time: string | null): number | null {
  if (!time) return null;
  const [y, m, d] = date.split("-").map(Number); const [hh, mm] = time.split(":").map(Number);
  return new Date(y!, m! - 1, d!, hh, mm).getTime();
}

export async function syncFactEvents(platform: PlatformContext, now = new Date()) {
  const out = { ok: false, created: 0, updated: 0, withdrawn: 0, suppressed: 0 } as { ok: boolean; created: number; updated: number; withdrawn: number; suppressed: number; reason?: string };
  const read = (platform.memory as any)?.eventFacts as undefined | (() => Promise<any>);
  if (typeof read !== "function") return { ...out, reason: "eventFacts unsupported" };
  let res: any;
  try { res = await read.call(platform.memory); } catch (err: any) { res = { ok: false, reason: err?.message ?? String(err) }; }
  // Never read a failure as "no facts": that would withdraw every fact event.
  if (!res?.ok || !Array.isArray(res.data?.facts)) {
    console.warn(`[calendar-desk] fact snapshot unavailable: ${res?.reason ?? "bad payload"} — fact events unchanged`);
    return { ...out, reason: res?.reason ?? "bad payload" };
  }
  const facts = res.data.facts as EventFactWire[];
  const dates = facts.map((f) => f.eventDate).sort();
  const google = dates.length ? listEvents({ fromDate: dates[0]!, toDate: dates[dates.length - 1]!, source: "google" }) : [];
  const at = now.getTime();
  const keep = new Set<string>();
  for (const f of facts) {
    const row = { accountId: f.accountId ?? "", factId: f.id, title: factTitle(f.content), localDate: f.eventDate, startAt: startOf(f.eventDate, f.eventTime), sourceLink: f.sourceLink ?? null };
    if (isDuplicateOfGoogle(row, google)) { out.suppressed++; console.log(`[calendar-desk] fact ${f.id} suppressed: duplicate of a Google event on ${row.localDate}`); continue; }
    keep.add(factEventKey(f.id));
    const r = upsertFactEvent(row, at);
    if (r === "inserted") out.created++; else if (r === "updated") out.updated++;
  }
  for (const e of listFactEvents()) if (!keep.has(e.eventKey)) { deleteFactEvent(e.accountId, e.eventKey); out.withdrawn++; }
  return { ...out, ok: true };
}
