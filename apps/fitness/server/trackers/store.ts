// The dashboard's own tables, as a tracker's sync needs them: find a row it wrote before, add one, correct one.
import type { Kit } from "@flock/app-kit";
import { eq } from "drizzle-orm";
import { metrics, events } from "../db/schema";
import { syncAuthor } from "./types";

export interface Reading { label: string; value: number; unit: string | null; created_at: string }
/** A reading as the sync files it: `stamp` (the day's last minute, the morning a night ended) is how a re-run finds its
 *  row; `created_at` is that stamp, or the pass's own time when the stamp is still ahead (today's running totals). */
export interface FiledReading extends Reading { stamp: string }

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** The row a reading is kept in: the same tracker, label and stamp always give the same row, however its time has moved since. */
export const syncId = (trackerId: string, r: FiledReading) => `${trackerId}-${slug(r.label)}-${slug(r.stamp)}`;

export interface StoredReading { id: string; value: number; updated_by: string | null }

export interface SyncStore {
  findReading(r: FiledReading): StoredReading | null;
  hasEvent(title: string, at: string): boolean;
  addReading(r: FiledReading): Promise<void>;
  updateReading(id: string, r: FiledReading): Promise<void>;
  addEvent(e: { title: string; at: string; kind: string }): Promise<void>;
}

export function kitStore(kit: Kit, trackerId: string): SyncStore {
  const author = syncAuthor(trackerId);
  // Rows written before readings had their own id are still found by their stamp: those are past days, never moved.
  const readingQuery = kit.sqlite.query(`SELECT id, value, updated_by FROM metrics WHERE label = ?1 AND (id = ?2 OR created_at = ?3) LIMIT 1`);
  const eventQuery = kit.sqlite.query(`SELECT 1 FROM events WHERE title = ? AND at = ? LIMIT 1`);
  return {
    findReading: (r) => (readingQuery.get(r.label, syncId(trackerId, r), r.stamp) as StoredReading | null) ?? null,
    hasEvent: (title, at) => !!eventQuery.get(title, at),
    async addReading(r) {
      const id = syncId(trackerId, r);
      await kit.db.insert(metrics).values({ id, label: r.label, value: r.value, unit: r.unit, created_at: r.created_at, updated_at: r.created_at, updated_by: author });
      kit.emitChange("metrics", id, "insert", author);
    },
    async updateReading(id, r) {
      await kit.db.update(metrics).set({ value: r.value, created_at: r.created_at, updated_at: new Date().toISOString(), updated_by: author }).where(eq(metrics.id, id));
      kit.emitChange("metrics", id, "update", author);
    },
    async addEvent(e) {
      const [row] = await kit.db.insert(events).values({ ...e, updated_by: author }).returning({ id: events.id });
      kit.emitChange("events", row.id, "insert", author);
    },
  };
}
