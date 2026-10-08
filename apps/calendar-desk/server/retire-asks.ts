// Calendar Desk used to ask the owner one question per personal step kind, as an `ask:<kind>` card on their board. It never
// asks now (amendment 1, A1): any card still open is withdrawn once. Closed cards are left as they are. The run is remembered
// only when the board was read and every open card withdrew, so a failure is retried on the next planning run.
import type { PlatformContext } from "@flock/app-sdk";
import { getCursor, setCursor } from "./store";

const DONE = "asks_retired";

export async function retireAskCards(platform: PlatformContext): Promise<number> {
  if (getCursor(DONE)) return 0;
  const listed = await platform.tasks.list({ prefix: "ask:" });
  if (!listed.ok) return 0;
  let withdrawn = 0, allOk = true;
  for (const t of listed.data.tasks) {
    if (t.status !== "open") continue;
    const r = await platform.tasks.withdraw(t.sourceRef, { reason: "no longer used" });
    if (r.ok) withdrawn++;
    else { allOk = false; console.warn(`[calendar-desk] could not withdraw ${t.sourceRef}: ${(r as any).reason ?? "unknown"}`); }
  }
  if (allOk) setCursor(DONE, String(Date.now()));
  return withdrawn;
}
