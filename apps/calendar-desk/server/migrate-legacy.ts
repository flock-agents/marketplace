import { existsSync, readFileSync, renameSync } from "fs";
import { join } from "path";
import { insertReminder, findActiveReminderByTitleDate } from "./store";

/** The reminders skill's `active.json`, handed over by the platform as `legacy-reminders.json`.
 *  One-shot entries become reminders (local date + HH:MM from scheduledFor); cron entries are
 *  counted and left — a cron has no day semantics here, and progress tells the user to re-ask. */
export function migrateLegacyReminders(dataDir: string, today: string): { migrated: number; skippedRecurring: number; absent: boolean } {
  const path = join(dataDir, "legacy-reminders.json");
  if (!existsSync(path)) return { migrated: 0, skippedRecurring: 0, absent: true };
  let entries: any[] = [];
  try { entries = JSON.parse(readFileSync(path, "utf-8")); } catch { entries = []; }
  let migrated = 0, skippedRecurring = 0;
  for (const e of Array.isArray(entries) ? entries : []) {
    if (e?.recurring) { skippedRecurring++; continue; }
    const at = typeof e?.scheduledFor === "string" ? new Date(e.scheduledFor) : null;
    if (!at || !Number.isFinite(at.getTime())) continue;
    // The wall-clock the reminder was written with (its own offset), not the server's timezone.
    const wall = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(e.scheduledFor);
    const pad = (n: number) => String(n).padStart(2, "0");
    const dueDate = wall ? wall[1]! : `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
    const dueTime = wall ? `${wall[2]}:${wall[3]}` : `${pad(at.getHours())}:${pad(at.getMinutes())}`;
    if (dueDate < today) continue;
    const title = String(e.message ?? "").trim().slice(0, 120); if (!title) continue;
    if (findActiveReminderByTitleDate(title, dueDate)) continue;
    insertReminder({ id: `rem_legacy_${String(e.id ?? migrated).replace(/[^a-z0-9_]/gi, "")}`, title, body: null, dueDate, dueTime, recurrence: "none", leadDays: [0], sourceKind: "migrated", sourceRef: null, sourceLink: null, accountId: null, state: "active" });
    migrated++;
  }
  renameSync(path, path.replace(/\.json$/, ".migrated.json"));
  return { migrated, skippedRecurring, absent: false };
}
