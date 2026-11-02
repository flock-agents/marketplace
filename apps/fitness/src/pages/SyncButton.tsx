import { Button } from "../flock/ui";
import { useTrackerSync } from "./useTrackerSync";

/** Fetch the newest numbers from every connected tracker now; a tracker that failed says why, beside the button. */
export function SyncButton() {
  const { running, failed, start } = useTrackerSync();
  return (
    <span className="db-sync">
      <Button variant="soft" size="sm" icon="refresh-cw" loading={running} onClick={start}>{running ? "Syncing…" : "Sync"}</Button>
      {failed.map((t) => <small key={t.id} className="db-sync-error" title={t.message}>{t.name}: {t.message}</small>)}
    </span>
  );
}
