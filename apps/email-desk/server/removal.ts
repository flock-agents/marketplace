// "Delete my mail data" (spec §5.4, rulings R6, R23, R29): the route. The person confirms in Settings; mail-data.ts does the
// delete. The route takes the platform only to list the person's mailboxes and to take the open cards and TODOs off Home;
// it never calls memory: what memory learned is Flock's and the person's.
import { Hono } from "hono";
import type { PlatformContext } from "@flock/app-sdk";
import { getStore } from "./store";
import { person } from "./routes/voice";
import { busyReason, deleteMailData } from "./mail-data";

const NOT_YOURS = "Only you can delete your mail data.";
const NEEDS_CONFIRM = "Confirm to delete your mail data.";
export const BUSY_REFUSAL = "Email Desk is reading your mail right now. Try again in a few minutes.";

let log: (line: string) => void = (line) => console.warn(line);
/** Tests: silence (or capture) the route's warnings; null restores console.warn. */
export function _setRemovalLogForTesting(fn: ((line: string) => void) | null): void {
  log = fn ?? ((line) => console.warn(line));
}

/** The person's Gmail mailboxes Flock knows, so each gets a done sequence row. None on any failure. */
async function knownAccounts(platform: PlatformContext | null): Promise<string[]> {
  try {
    const r = await platform?.connectors.accounts?.("gmail");
    return r?.ok ? (r.data?.accounts ?? []).map((a) => a.accountId).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function removalRoutes(platform: () => PlatformContext | null): Hono {
  const app = new Hono();
  app.post("/api/mail-data/delete", async (c) => {
    if (!person(c)) return c.json({ error: NOT_YOURS }, 403);
    let body: Record<string, unknown> = {};
    try { body = await c.req.json(); } catch { /* answered below */ }
    if (body.confirm !== true) return c.json({ error: NEEDS_CONFIRM }, 400);
    const p = platform();
    const accounts = await knownAccounts(p);
    // Checked and deleted with nothing awaited in between: no run can start inside the delete.
    const db = getStore();
    if (busyReason(db)) return c.json({ error: BUSY_REFUSAL }, 409);
    const out = deleteMailData(db, { accounts });
    let withdrawn = 0;
    for (const ref of out.withdraw) {
      try {
        const r = await p?.tasks.withdraw(ref, { reason: "mail data deleted" });
        if (r?.ok || r?.skipped) withdrawn++;
        else log(`[email-desk] delete: could not withdraw ${ref} (${r ? (r.message ?? r.reason) : "no platform"})`);
      } catch (e: any) {
        log(`[email-desk] delete: withdraw ${ref} threw (${e?.message ?? e})`);
      }
    }
    return c.json({ ok: true, deleted: out.rows, withdrawn });
  });
  return app;
}
