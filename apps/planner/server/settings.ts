import type { Database } from "bun:sqlite";
import { SETTINGS } from "./db/constants";

/** Every declared setting's current value, read straight from the kit's own `_settings` table (one JSON-encoded row
 *  per key), falling back to its declared default. A routine handler gets no `kit.settings` from the SDK (only
 *  `db`, `sqlite` and `emitChange`), so this reads the same table app-info.ts's `all()` does, independently. */
export function readSettings(sqlite: Database): Record<string, unknown> {
  const out: Record<string, unknown> = Object.fromEntries(SETTINGS.map((s) => [s.key, s.default]));
  let rows: { key: string; value: string | null }[] = [];
  try { rows = sqlite.query(`SELECT key, value FROM _settings`).all() as typeof rows; } catch { /* no _settings table yet (a fresh boot) */ }
  for (const r of rows) {
    if (!(r.key in out)) continue;
    try { out[r.key] = JSON.parse(r.value ?? "null"); } catch { /* keep the default */ }
  }
  return out;
}

/** `timeline.ts`'s functions take a `{ get(key) }` reader (the same shape as the kit's own `Settings`, for the
 *  on-demand route, which has it); this adapts the same read for a routine. */
export function settingsReaderFrom(sqlite: Database): { get<T = unknown>(key: string): T } {
  const values = readSettings(sqlite);
  return { get: <T,>(key: string) => values[key] as T };
}
