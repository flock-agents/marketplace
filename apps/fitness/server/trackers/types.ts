// A tracker adapter: one wearable's connector, read by the app itself and filed into the dashboard's own tables.
import type { SyncStore } from "./store";
import type { ToolReply } from "./tool-result";

/** Calls one function of the adapter's connector through the platform, as the paired coach. */
export type CallTool = (tool: string, args: Record<string, unknown>) => Promise<ToolReply>;

/** `newest`: the device's newest data the pass saw (ISO), or null. `todayAsOf`: how far today's activity totals reach, only
 *  when the pass read them fresh; null otherwise (the pace check trusts nothing else). */
export interface SyncReport { ok: boolean; added: number; updated: number; failed: string[]; message: string; newest: string | null; todayAsOf: string | null }

export interface TrackerContext { call: CallTool; store: SyncStore; now: Date }

export interface Tracker {
  /** Stable id: row ids and the sync author derive from it, so it never changes once rows exist. */
  id: string;
  /** Shown beside the Sync button. */
  name: string;
  /** The connector (skill) the adapter calls; the adapter runs only when the paired coach has it granted and ready. */
  skillId: string;
  /** The metric labels the adapter files: goals that need them become available once they have data. */
  metrics: readonly string[];
  /** One pass over the last `days` days. Must not throw for a failed call: report it. */
  sync(ctx: TrackerContext, days: number): Promise<SyncReport>;
}

/** Who a tracker's rows are written by: the owner's own edit of such a row is never overwritten. */
export const syncAuthor = (trackerId: string) => `app:${trackerId}-sync`;
