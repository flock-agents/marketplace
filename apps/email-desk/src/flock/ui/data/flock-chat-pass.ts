import { useEffect, useState } from "react";
import { kitFetch } from "./client";

/** A visitor's pass for Flock's chat beside the app (spec R2.6): anyone on a public app who is not the owner. */
export interface VisitorPass { pass: string; expiresAt: string }

/** Asks the app's kit for this viewer's pass (GET ./api/_agent/flock-chat-pass). Null when there is none to have: a private
 *  app, an unpaired or older kit, a platform that refused (it holds 100 per app) or can't be reached. `refused`: the pass
 *  Flock refused, which the kit replaces (once) rather than handing it back. */
export async function fetchFlockChatPass(opts: { refused?: string } = {}): Promise<VisitorPass | null> {
  try {
    const query = opts.refused ? `?${new URLSearchParams({ fresh: opts.refused })}` : "";
    const b = await kitFetch<{ pass?: unknown; expiresAt?: unknown } | null>(`_agent/flock-chat-pass${query}`);
    if (typeof b?.pass !== "string" || !b.pass || typeof b.expiresAt !== "string" || Number.isNaN(Date.parse(b.expiresAt))) return null;
    return { pass: b.pass, expiresAt: b.expiresAt };
  } catch { return null; }
}

/** This viewer's pass, asked for once `enabled` (the viewer is not the owner). `loading` until the kit answers. */
export function useFlockChatPass(enabled: boolean): { pass: VisitorPass | null; loading: boolean } {
  const [pass, setPass] = useState<VisitorPass | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void fetchFlockChatPass().then((p) => { if (live) setPass(p); });
    return () => { live = false; };
  }, [enabled]);
  return { pass: pass ?? null, loading: enabled && pass === undefined };
}
