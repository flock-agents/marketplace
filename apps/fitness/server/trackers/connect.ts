// Connect a tracker by asking the coach: the account has to land on the coach (the app reads trackers through the paired
// agent's connector), so the app wakes the coach, which asks the owner through Flock to connect this person's own account.
import type { TrackerState } from "./run";

/** The intent that wakes the coach to ask the owner for a tracker account (flock.app.json agentInterface). */
export const CONNECT_INTENT = "connect-tracker";
/** The least time between two asks for the same tracker: every ask is a model run. */
export const CONNECT_WAIT_MS = 3 * 60_000;

export type AskToConnect = (tracker: { name: string; skillId: string }) => Promise<{ ok: true } | { ok: false; reason: string }>;
export type ConnectResult = { asked: true } | { error: string; status: 400 | 502 };

/** Asks the coach to get one tracker connected, at most once per CONNECT_WAIT_MS for the same tracker. */
export function trackerConnector(trackers: () => Promise<TrackerState[]>, ask: AskToConnect, clock: () => Date = () => new Date()) {
  const asked = new Map<string, number>();   // tracker id → when the coach was last asked
  return async (id: unknown): Promise<ConnectResult> => {
    const tracker = (await trackers()).find((t) => t.id === id);
    if (!tracker) return { error: "Send the id of one of the app's trackers", status: 400 };
    const last = asked.get(tracker.id);
    if (last && clock().getTime() - last < CONNECT_WAIT_MS) return { asked: true };
    const woken = await ask({ name: tracker.name, skillId: tracker.skillId });
    if (!woken.ok) return { error: woken.reason, status: 502 };
    asked.set(tracker.id, clock().getTime());
    return { asked: true };
  };
}
