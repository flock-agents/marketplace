// The app keeps its routines off until it is set up: Flock holds them (really off, with this reason on the routines page)
// and releases them once the person's name and time zone are filled in. A Flock without hold/release leaves them on; each
// run then ends at once (server/coach/routines.ts, the tracker sync).

export const HOLD_REASON = "Waiting for the person's name and time zone in the Fitness app";

/** Flock's hold/release of this app's routines (app SDK `platform.routines`), when this Flock has them. */
export interface RoutineHold {
  hold?(reason: string): Promise<{ ok: boolean }>;
  release?(): Promise<{ ok: boolean }>;
}

/** Holds or releases the routines to match `setUp()`. Asks Flock only when that changed since the last call that went through;
 *  a failed call is tried again on the next one. */
export function routineHold(routines: RoutineHold | undefined, setUp: () => boolean, log: (m: string) => void = console.warn) {
  let applied: boolean | null = null;
  return async (): Promise<void> => {
    const want = setUp();
    if (want === applied || !routines?.hold || !routines.release) return;
    try {
      const done = want ? await routines.release() : await routines.hold(HOLD_REASON);
      if (done.ok) applied = want;
      else log(`[fitness] routines not ${want ? "released" : "held"}: ${JSON.stringify(done)}`);
    } catch (e) {
      log(`[fitness] routines not ${want ? "released" : "held"}: ${(e as Error).message}`);
    }
  };
}
