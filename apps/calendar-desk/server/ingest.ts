import type { PlatformContext } from "@flock/app-sdk";
import { getCursor, setCursor, insertReminder, updateReminder, findReminderBySourceRef, findActiveReminderByTitleDate } from "./store";
import { reminderFromFact, type RemindersConfig, type FactLike } from "./rules";
import { ymd } from "./events";

export const INGEST_BATCH = 200;
const FIRST_RUN_LOOKBACK_MS = 30 * 86_400_000;

export async function ingestFacts(platform: PlatformContext, cfg: RemindersConfig, now: Date = new Date()) {
  const out = { read: 0, created: 0, updated: 0, skipped: 0, cursorAdvanced: false };
  if (!platform.configured) return out;
  const since = getCursor("facts_since") ?? new Date(now.getTime() - FIRST_RUN_LOOKBACK_MS).toISOString();
  const res = await platform.memory.factsSince<{ facts: FactLike[]; nextSince: string }>({ sinceIso: since, limit: INGEST_BATCH, datedOnly: true });
  if (!res.ok) { console.warn(`[calendar-desk] facts read failed: ${res.reason}`); return out; }
  const today = ymd(now);
  for (const f of res.data.facts) {
    out.read++;
    const existing = findReminderBySourceRef(`fact:${f.id}`);
    if (existing) { out.skipped++; continue; }                       // seen before (active, done or cancelled)
    const draft = reminderFromFact(f, cfg, today);
    if (!draft) { out.skipped++; continue; }
    const twin = findActiveReminderByTitleDate(draft.title, draft.dueDate);
    if (twin) { updateReminder(twin.id, { body: draft.body, sourceLink: twin.sourceLink ?? draft.sourceLink }); out.updated++; continue; }
    insertReminder(draft); out.created++;
  }
  setCursor("facts_since", res.data.nextSince > since ? res.data.nextSince : since);
  out.cursorAdvanced = true;
  if (out.read) console.log(`[calendar-desk] ingest read=${out.read} created=${out.created} updated=${out.updated} skipped=${out.skipped}`);
  return out;
}
