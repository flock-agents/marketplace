// Sync trackers, run by the app: the dashboard's button and the scheduled routine start the same pass, one at a time.
import type { RunReport, TrackerResult } from "./run";

/** The routine handler the manifest names (flock.app.json routines[].handler): the scheduled pass. */
export const SYNC_ROUTINE = "tracker-sync";

export type Pass = () => Promise<RunReport>;
export interface LastPass { at: string; ok: boolean; message: string; newest: string | null; todayAsOf: string | null; trackers: TrackerResult[] }
export interface SyncStatus { running: boolean; last: LastPass | null }

const failure = (e: unknown): RunReport =>
  ({ ok: false, trackers: [], message: `Sync failed: ${e instanceof Error ? e.message : String(e)}`, newest: null, todayAsOf: null });

export function syncNow(pass: Pass, clock: () => Date = () => new Date()) {
  let current: Promise<RunReport> | null = null;
  let last: LastPass | null = null;

  const status = (): SyncStatus => ({ running: current !== null, last });

  /** Run a pass, or join the one under way: two at once would only fetch the same numbers twice. */
  function run(): Promise<RunReport> {
    if (current) return current;
    current = pass()
      .catch(failure)
      .then((r) => { last = { at: clock().toISOString(), ok: r.ok, message: r.message, newest: r.newest, todayAsOf: r.todayAsOf, trackers: r.trackers }; return r; })
      .finally(() => { current = null; });
    return current;
  }

  return {
    status,
    run,
    /** The button: start a pass and answer at once; the page follows it through `status`. */
    request(): SyncStatus { void run(); return status(); },
  };
}

export type SyncNow = ReturnType<typeof syncNow>;
