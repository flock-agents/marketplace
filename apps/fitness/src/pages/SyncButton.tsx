import { Button } from "../flock/ui";
import { connectPath, noneConnected } from "./tracker-sync";
import { useTrackerSync } from "./useTrackerSync";

/** Opens Flock's page for a connector: the app is framed on Flock's own origin, so the whole window goes there. */
const openInFlock = (path: string) => { window.open(path, "_top"); };

/** Fetch the newest numbers from every connected tracker now; a tracker that failed says why, beside the button, with a way
 *  to fix its connection. With no tracker connected there is nothing to sync, so the button offers to connect one. */
export function SyncButton() {
  const { running, failed, trackers, start } = useTrackerSync();
  if (trackers && noneConnected(trackers)) {
    const label = trackers.length === 1 ? `Connect ${trackers[0].name}` : "Connect a tracker";
    return <Button variant="soft" size="sm" icon="plug" onClick={() => openInFlock(connectPath(trackers))}>{label}</Button>;
  }
  return (
    <span className="db-sync">
      <Button variant="soft" size="sm" icon="refresh-cw" loading={running} onClick={start}>{running ? "Syncing…" : "Sync"}</Button>
      {failed.map((t) => (
        <small key={t.id} className="db-sync-error" title={t.message}>
          {t.name} couldn't sync. <a href={connectPath([t])} target="_top">Check the connection</a>
        </small>
      ))}
    </span>
  );
}
