// A planned event Google confirmed deleted: its steps are withdrawn from the owner's TODOs and the event is forgotten.
// A moved event is offered again as "changed"; its report re-publishes every step's limit (plan-report refreshStepCaps).
// A renamed one that kept its time is not re-offered, so its steps' limit reason is re-published here.
import type { PlatformContext } from "@flock/app-sdk";
import { stepKeysFor, forgetStep, forgetEvent, pendingWithdrawals, plannedMark } from "./planning-store";
import { getEvent } from "./store";
import { refreshStepCaps, type StepState } from "./plan-report";

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

/** Events renamed in this read: a planned one whose date and time did not change gets its open steps' limit re-published,
 *  since the reason Flock shows carries the title. One that also moved is left to the planning run. */
export async function refreshRenamedSteps(platform: PlatformContext, accountId: string, eventKeys: string[]): Promise<number> {
  type List = (o: { prefix?: string }) => Promise<{ ok: true; data: { tasks: StepState[] } } | { ok: false; reason: string }>;
  let n = 0;
  for (const k of eventKeys) {
    const ev = getEvent(accountId, k), mark = plannedMark(accountId, k);
    if (!ev || !mark || stepKeysFor(accountId, k).length === 0) continue;
    if (mark.date !== ev.localDate || mark.startAt !== (ev.allDay ? null : ev.startAt)) continue;
    const listed = await (platform.tasks as unknown as { list: List }).list({ prefix: `step:${k}:` });
    if (!listed.ok) { console.warn(`[calendar-desk] renamed ${k}: could not read its steps: ${listed.reason}`); continue; }
    const failed = await refreshStepCaps(platform, ev, listed.data.tasks, new Set());
    for (const f of failed) console.warn(`[calendar-desk] renamed ${k}: step ${f.key} kept its old limit: ${f.reason}`);
    n++;
  }
  return n;
}
