// The settings page and its voice editor (Task 2.9, ruling R6): `GET /settings` (and `/`) serve public/settings.html, one
// static page with no build step; `GET /api/voice` reads the person's voice for each of their mailboxes, `PUT /api/voice`
// edits, forgets or restores one row (written as 'owner-edit', which no re-learn overwrites), or learns a mailbox again.
// Ported from Flock's Voice tab (wiki/voice-page.ts, routes/wiki.ts) and its re-crawl route (email-desk/routes/voice-crawl.ts).
//
// WHO REACHES IT. Flock's proxy is the only way in (the app listens on loopback): its gate (app-gate.ts) opens an app paired
// with a person's assistant to that person alone, and admits agents too. The voice is the person's own word on how they
// write and is trusted text in every draft, so these routes take the PERSON only: a request the proxy marks as an agent's
// (X-Flock-Agent) or as nobody's (no X-Flock-User) is refused. The proxy strips any incoming x-flock-* header, so neither
// can be forged through it. Agents read the voice through reply_context, never here.
import { Hono, type Context } from "hono";
import { readFileSync } from "fs";
import { join } from "path";
import type { PlatformContext } from "@flock/app-sdk";
import { EDITABLE_DIMENSIONS, editVoiceRow, forgetVoiceRow, restoreVoiceRow, voiceAccounts, voicePageFor, type VoicePageAccount } from "../voice/store";
import { beginVoiceCrawl, voiceLearningUntil, voiceStateFor, type VoiceState } from "../voice/crawl";

export const SETTINGS_PAGE = join(import.meta.dir, "../../public/settings.html");

export interface VoiceAccountView extends VoicePageAccount {
  accountId: string;
  email: string | null;
  state: VoiceState;
  /** While learning: when it is due to be done (ISO). */
  learningUntil?: string;
}

const NOT_YOURS = "Only you can see or change your voice here.";

/** The person, as Flock's proxy vouched for them; null for an agent or nobody. */
function person(c: Context): string | null {
  if (c.req.header("x-flock-agent")) return null;
  const user = c.req.header("x-flock-user");
  return user && user.trim() ? user.trim() : null;
}

/** The person's Gmail mailboxes (connectors.accounts), plus any mailbox the store holds a voice for. */
async function mailboxes(platform: PlatformContext): Promise<Array<{ accountId: string; email: string | null }>> {
  const out = new Map<string, string | null>();
  try {
    const r = await platform.connectors.accounts?.("gmail");
    if (r?.ok) for (const a of r.data?.accounts ?? []) out.set(a.accountId, a.email ?? null);
  } catch { /* the stored ones still show */ }
  for (const id of voiceAccounts()) if (!out.has(id)) out.set(id, null);
  return [...out.entries()].map(([accountId, email]) => ({ accountId, email }));
}

export function voiceView(accountId: string, email: string | null): VoiceAccountView {
  const state = voiceStateFor(accountId);
  const until = voiceLearningUntil(accountId);
  return {
    accountId, email, state,
    ...(until !== null ? { learningUntil: new Date(until).toISOString() } : {}),
    ...voicePageFor(accountId),
  };
}

export function voiceRoutes(platform: PlatformContext): Hono {
  const app = new Hono();

  const page = (c: Context) => {
    try {
      return c.html(readFileSync(SETTINGS_PAGE, "utf-8"));
    } catch {
      return c.text("Settings page missing", 500);
    }
  };
  app.get("/", page);
  app.get("/settings", page);

  app.get("/api/voice", async (c) => {
    if (!person(c)) return c.json({ error: NOT_YOURS }, 403);
    const accounts = (await mailboxes(platform)).map((m) => voiceView(m.accountId, m.email));
    return c.json({ accounts });
  });

  app.put("/api/voice", async (c) => {
    if (!person(c)) return c.json({ error: NOT_YOURS }, 403);
    let body: Record<string, unknown> = {};
    try { body = await c.req.json(); } catch { /* answered below */ }
    const accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
    const action = typeof body.action === "string" ? body.action : "edit";
    const known = await mailboxes(platform);
    const mailbox = known.find((m) => m.accountId === accountId);
    if (!mailbox) return c.json({ error: "That mailbox is not one of yours." }, 400);

    if (action === "relearn") {
      const begun = await beginVoiceCrawl(platform, accountId, { force: true, interactive: true });
      if (!begun.started) {
        const why = begun.reason === "running" ? "Your voice is already being learned for this mailbox."
          : begun.reason === "busy" ? "Your mailbox is busy right now. Try again in a few minutes."
          : "Your voice could not be learned right now. Try again later.";
        return c.json({ error: why, reason: begun.reason }, 409);
      }
      return c.json({ ok: true, account: voiceView(accountId, mailbox.email) });
    }

    const dimension = typeof body.dimension === "string" ? body.dimension : "";
    if (!EDITABLE_DIMENSIONS.has(dimension)) return c.json({ error: "That part of your voice can't be changed here." }, 400);
    const part = body.part === "phrases" || body.part === "abbreviations" ? body.part : undefined;
    if (action === "edit") {
      const value = typeof body.value === "string" ? body.value.trim() : "";
      if (!value) return c.json({ error: "Write something, or use Forget." }, 400);
      if (value.length > 1000) return c.json({ error: "That is too long. Keep it under 1000 characters." }, 400);
      editVoiceRow(accountId, dimension, value, part);
    } else if (action === "forget") {
      forgetVoiceRow(accountId, dimension);
    } else if (action === "restore") {
      restoreVoiceRow(accountId, dimension);
    } else {
      return c.json({ error: "Unknown change." }, 400);
    }
    return c.json({ ok: true, account: voiceView(accountId, mailbox.email) });
  });

  return app;
}
