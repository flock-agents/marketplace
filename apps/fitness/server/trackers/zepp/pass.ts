// One Zepp sync pass, run by the app itself: call each Zepp action the plan names, then file what came back. No agent run.
import { ingest, syncPlan, type RawReplies, type SyncReport } from "./ingest";
import { LOOKBACK_DAYS } from "./config";
import type { SyncStore } from "../store";
import type { CallTool } from "../types";

/** Kept for the tests' wording: a Zepp call is any connector call. */
export type CallZepp = CallTool;

export async function syncPass(call: CallTool, store: SyncStore, now = new Date(), days = LOOKBACK_DAYS): Promise<SyncReport> {
  const replies: RawReplies = {};
  // One action at a time: one Zepp login, no burst of requests against it.
  for (const [name, { tool, args }] of Object.entries(syncPlan(now, days).calls)) {
    replies[name as keyof RawReplies] = await call(tool, args);
  }
  return ingest(replies, store, now, days);
}
