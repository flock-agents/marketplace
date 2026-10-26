import { useCallback, useEffect, useRef, useState } from "react";
import { kitFetch, useToast, type ToastInput } from "../flock/ui";
import type { SyncStatus } from "../../server/trackers/sync-now";
import type { TrackerResult } from "../../server/trackers/run";

const POLL_MS = 5000;
const STATUS = "trackers/sync-now";

/** What a finished pass says to the viewer. */
export function outcomeToast(s: SyncStatus): ToastInput | null {
  if (s.running || !s.last) return null;
  return { message: s.last.message, tone: s.last.ok ? "success" : "danger" };
}

/** The trackers that failed on the last pass, each with its reason: shown beside the Sync button. */
export const failedTrackers = (s: SyncStatus | null): TrackerResult[] => s?.last?.trackers.filter((t) => !t.ok) ?? [];

/** The Sync button's state: start a pass over every connected tracker, follow it until it finishes, then say how it went. */
export function useTrackerSync() {
  const toast = useToast();
  const show = useRef(toast.show);
  show.current = toast.show;
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState<TrackerResult[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const follow = useCallback((s: SyncStatus) => {
    setRunning(s.running);
    if (s.running) {
      timer.current = setTimeout(() => kitFetch<SyncStatus>(STATUS).then(follow).catch(() => setRunning(false)), POLL_MS);
      return;
    }
    setFailed(failedTrackers(s));
    const t = outcomeToast(s);
    if (t) show.current(t);
  }, []);

  // A pass already under way shows as syncing; an old finished one says nothing but keeps its failures beside the button.
  useEffect(() => {
    kitFetch<SyncStatus>(STATUS).then((s) => { if (s.running) follow(s); else setFailed(failedTrackers(s)); }).catch(() => {});
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [follow]);

  const start = useCallback(async () => {
    setRunning(true);
    try { follow(await kitFetch<SyncStatus>(STATUS, { method: "POST" })); }
    catch { setRunning(false); show.current({ message: "Couldn't start the sync", tone: "danger" }); }
  }, [follow]);

  return { running, failed, start };
}
