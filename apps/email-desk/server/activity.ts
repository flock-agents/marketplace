// What this process is working on right now: the routine runs (registry.ts wraps each handler). "Delete my mail data"
// refuses while any is in progress (ruling R29), so a run never writes into a store being emptied. A first read in progress
// is told by its lifecycle_state row instead (mail-data.ts), which a claim writes before the run starts.
import type { RoutineHandler } from "@flock/app-sdk";

const active = new Map<string, number>();

/** Marks `what` as in progress; the returned function ends it (once). */
export function beginWork(what: string): () => void {
  active.set(what, (active.get(what) ?? 0) + 1);
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    const n = (active.get(what) ?? 1) - 1;
    if (n > 0) active.set(what, n); else active.delete(what);
  };
}

/** The work in progress now, by name. */
export function workInProgress(): string[] {
  return [...active.keys()];
}

/** A routine handler counted as work for as long as it runs. */
export function trackedRoutine(name: string, handler: RoutineHandler): RoutineHandler {
  return async (ctx) => {
    const end = beginWork(name);
    try {
      return await handler(ctx);
    } finally {
      end();
    }
  };
}

/** Tests: forget all work in progress. */
export function _resetWorkForTesting(): void {
  active.clear();
}
