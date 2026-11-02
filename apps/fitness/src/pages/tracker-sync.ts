// What the Sync button says, worked out from the sync status alone (no kit, so it is tested on its own).
import type { SyncStatus } from "../../server/trackers/sync-now";
import type { TrackerResult, TrackerState } from "../../server/trackers/run";

/** A toast as the kit's `useToast().show` takes it. */
export interface Toast { message: string; tone: "success" | "danger" }

/** The trackers that failed on the last pass, each with its reason: shown beside the Sync button. */
export const failedTrackers = (s: SyncStatus | null): TrackerResult[] => s?.last?.trackers.filter((t) => !t.ok) ?? [];

/** What a finished pass says to the viewer: the trackers that failed by name; their reasons stay beside the button. */
export function outcomeToast(s: SyncStatus): Toast | null {
  if (s.running || !s.last) return null;
  if (s.last.ok) return { message: s.last.message, tone: "success" };
  const names = failedTrackers(s).map((t) => t.name);
  return { message: names.length ? `${names.join(", ")} couldn't sync` : "Couldn't sync", tone: "danger" };
}

/** The Flock page that installs and connects a tracker's connector; the generic list when there are several to pick from. */
export const connectPath = (trackers: readonly Pick<TrackerState, "skillId">[]): string =>
  trackers.length === 1 ? `/connectors/${encodeURIComponent(trackers[0].skillId)}` : "/connectors";

/** None of the trackers is connected (known only once the page has asked): Sync would have nothing to read. */
export const noneConnected = (trackers: readonly TrackerState[] | null): boolean => !!trackers && !trackers.some((t) => t.ready);

