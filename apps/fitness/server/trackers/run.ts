// One sync of every tracker whose connector the paired coach has granted and ready. Each runs on its own: one failing (or
// throwing) never stops the others. No tracker connected is a quiet no-op, not an error.
import type { CallTool, SyncReport, Tracker, TrackerContext } from "./types";

/** What the platform says of each connector the app declares (core SDK `connectors.list()`). */
export interface ConnectorState { skillId: string; optional: boolean; granted: boolean; ready: boolean }
export type ListConnectors = () => Promise<ConnectorState[]>;

export interface TrackerResult { id: string; name: string; ok: boolean; message: string }
export interface RunReport {
  ok: boolean;
  /** One line per tracker that ran, failed ones included, for the Sync button. Empty when none is connected. */
  trackers: TrackerResult[];
  message: string;
  newest: string | null;
  /** How far today's activity totals reach, from the first tracker that read them fresh; null when none did. */
  todayAsOf: string | null;
}

export const NO_TRACKER = "No tracker connected: connect one (Zepp) to the coach to fill steps, sleep and more automatically";

const failed = (e: unknown): SyncReport =>
  ({ ok: false, added: 0, updated: 0, failed: [], message: `sync failed: ${e instanceof Error ? e.message : String(e)}`, newest: null, todayAsOf: null });

/** The trackers whose connector is granted and ready. A listing that fails reads as none ready. */
export async function readyTrackers(trackers: readonly Tracker[], list: ListConnectors): Promise<Tracker[]> {
  const states = await list().catch(() => [] as ConnectorState[]);
  const ready = new Set(states.filter((s) => s.granted && s.ready).map((s) => s.skillId));
  return trackers.filter((t) => ready.has(t.skillId));
}

export async function runTrackers(
  trackers: readonly Tracker[], list: ListConnectors, context: (t: Tracker) => TrackerContext, days: number,
): Promise<RunReport> {
  const ready = await readyTrackers(trackers, list);
  if (!ready.length) return { ok: true, trackers: [], message: NO_TRACKER, newest: null, todayAsOf: null };
  const reports: [Tracker, SyncReport][] = [];
  for (const t of ready) reports.push([t, await t.sync(context(t), days).catch(failed)]);   // one at a time, each isolated
  const results = reports.map(([t, r]) => ({ id: t.id, name: t.name, ok: r.ok, message: r.message }));
  const newest = reports.map(([, r]) => r.newest).filter((n): n is string => !!n).sort().at(-1) ?? null;
  return {
    ok: results.some((r) => r.ok),
    trackers: results,
    message: results.map((r) => (r.ok ? r.message : `${r.name}: ${r.message}`)).join(" · "),
    newest,
    todayAsOf: reports.find(([, r]) => r.ok && r.todayAsOf)?.[1].todayAsOf ?? null,
  };
}

/** How long one connector call may take: the first call of a day can start the connection up. */
export const CALL_TIMEOUT_MS = 90_000;
export type { CallTool };
