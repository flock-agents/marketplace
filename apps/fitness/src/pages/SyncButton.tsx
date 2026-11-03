import { Button } from "../flock/ui";
import { connectPath, noneConnected, toConnect } from "./tracker-sync";
import { useTrackerSync } from "./useTrackerSync";

/** Fetch the newest numbers from every connected tracker now; a tracker that failed says why, beside the button, with a way
 *  to fix its connection. With no tracker connected there is nothing to sync, so the button offers to connect one. */
export function SyncButton() {
  const { running, failed, trackers, start, asking, connect } = useTrackerSync();
  const missing = trackers && noneConnected(trackers) ? toConnect(trackers) : undefined;
  if (missing) {
    return <Button variant="soft" size="sm" icon="plug" loading={asking} onClick={() => connect(missing)}>{`Connect ${missing.name}`}</Button>;
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
