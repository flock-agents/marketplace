// A planned event Google confirmed deleted: its steps are withdrawn from the owner's TODOs and the event is forgotten.
// (A moved event needs nothing here: eventsToPlan offers it again as "changed" and its report re-publishes the steps.)
import type { PlatformContext } from "@flock/app-sdk";
import { stepKeysFor, forgetEvent } from "./planning-store";

type Withdraw = (sourceRef: string, opts?: { reason?: string }) => Promise<{ ok: boolean }>;

/** Withdraws every recorded step of the event, then forgets its marks and keys. Returns how many steps were withdrawn. */
export async function withdrawStepsOf(platform: PlatformContext, accountId: string, eventKey: string, title: string): Promise<number> {
  const withdraw = platform.tasks.withdraw as unknown as Withdraw;
  let n = 0;
  for (const key of stepKeysFor(accountId, eventKey)) {
    const r = await withdraw.call(platform.tasks, `step:${eventKey}:${key}`, { reason: `${title} was deleted from your calendar` });
    if (r.ok) n++; else console.warn(`[calendar-desk] withdrawing step:${eventKey}:${key} failed: ${JSON.stringify(r)}`);
  }
  forgetEvent(accountId, eventKey);
  return n;
}
