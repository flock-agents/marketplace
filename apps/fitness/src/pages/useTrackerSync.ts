import { useCallback, useEffect, useRef, useState } from "react";
import { kitFetch, useToast } from "../flock/ui";
import type { SyncView } from "../../server/trackers/routes";
import type { TrackerResult, TrackerState } from "../../server/trackers/run";
import { failedTrackers, outcomeToast } from "./tracker-sync";

const POLL_MS = 5000;
const STATUS = "trackers/sync-now";

/** The Sync button's state: start a pass over every connected tracker, follow it until it finishes, then say how it went. */
export function useTrackerSync() {
  const toast = useToast();
  const show = useRef(toast.show);
  show.current = toast.show;
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState<TrackerResult[]>([]);
  const [trackers, setTrackers] = useState<TrackerState[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const follow = useCallback((s: SyncView) => {
    setRunning(s.running);
    setTrackers(s.trackers);
    if (s.running) {
      timer.current = setTimeout(() => kitFetch<SyncView>(STATUS).then(follow).catch(() => setRunning(false)), POLL_MS);
      return;
    }
    setFailed(failedTrackers(s));
    const t = outcomeToast(s);
    if (t) show.current(t);
  }, []);

  // A pass already under way shows as syncing; an old finished one says nothing but keeps its failures beside the button.
  useEffect(() => {
    kitFetch<SyncView>(STATUS).then((s) => {
      setTrackers(s.trackers);
      if (s.running) follow(s); else setFailed(failedTrackers(s));
    }).catch(() => {});
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [follow]);

  const start = useCallback(async () => {
    setRunning(true);
    try { follow(await kitFetch<SyncView>(STATUS, { method: "POST" })); }
    catch { setRunning(false); show.current({ message: "Couldn't start the sync", tone: "danger" }); }
  }, [follow]);

  return { running, failed, trackers, start };
}
