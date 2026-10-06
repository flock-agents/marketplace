// A planned event Google confirmed deleted: its steps are withdrawn from the owner's TODOs and the event is forgotten.
// (A moved event needs nothing here: eventsToPlan offers it again as "changed" and its report re-publishes the steps.)
import type { PlatformContext } from "@flock/app-sdk";
import { stepKeysFor, forgetStep, forgetEvent, pendingWithdrawals } from "./planning-store";
import { getEvent } from "./store";

type Withdraw = (sourceRef: string, opts?: { reason?: string }) => Promise<{ ok: boolean }>;

async function withdrawOne(platform: PlatformContext, accountId: string, eventKey: string, stepKey: string, title: string): Promise<boolean> {
  const ref = `step:${eventKey}:${stepKey}`;
  try {
    const withdraw = platform.tasks.withdraw as unknown as Withdraw;
    const r = await withdraw.call(platform.tasks, ref, { reason: `${title} was deleted from your calendar` });
    if (r.ok) { forgetStep(accountId, eventKey, stepKey); return true; }
    console.warn(`[calendar-desk] withdrawing ${ref} failed: ${JSON.stringify(r)}`);
  } catch (e) { console.warn(`[calendar-desk] withdrawing ${ref} threw: ${e instanceof Error ? e.message : e}`); }
  return false;
}

/** Withdraws every recorded step of the event; a key is forgotten only once it withdrew (a failed one stays for retryPendingWithdrawals). Returns how many were withdrawn. */
export async function withdrawStepsOf(platform: PlatformContext, accountId: string, eventKey: string, title: string): Promise<number> {
  const keys = stepKeysFor(accountId, eventKey);
  let n = 0;
  for (const k of keys) if (await withdrawOne(platform, accountId, eventKey, k, title)) n++;
  if (keys.length === 0) forgetEvent(accountId, eventKey);
  return n;
}

/** Retries steps whose earlier withdrawal failed: recorded keys of events confirmed deleted. */
export async function retryPendingWithdrawals(platform: PlatformContext, accountId: string): Promise<number> {
  let n = 0;
  for (const { eventKey, stepKey } of pendingWithdrawals(accountId)) {
    const title = getEvent(accountId, eventKey)?.title || "An event";
    if (await withdrawOne(platform, accountId, eventKey, stepKey, title)) n++;
  }
  return n;
}
