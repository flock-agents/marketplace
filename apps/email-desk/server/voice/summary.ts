// voice_summary: the declared read-only op an agent of this copy's person calls for "what's my voice?". Per mailbox, the
// same voice block reply_context carries (voice/block.ts), the state reply_context reports, and a plain line to say when
// there is no voice yet. Who may call it is Flock's declared-op rule (routes/app-ops.ts), like every agent op. Reads only
// this copy's store and the connector's account list: no mail, no model.
import type { OpCtx } from "../ops";
import { voiceBlockOrNull } from "./block";
import { voiceStateFor, type VoiceState } from "./crawl";

export interface VoiceSummaryMailbox {
  accountId: string;
  email: string | null;
  voiceState: VoiceState;
  /** The voice as reply_context gives it, or null while the mailbox has none. */
  voice: string | null;
  /** Only when there is no voice: why, in words the person can be told. */
  note?: string;
}

const NOTE_LEARNING = "Still learning this voice from the person's sent mail. Ask again in a little while.";
const NOTE_NONE = "Not learned yet. Nothing in the sent mail read so far was long enough to learn from, or it has not been read yet. Drafts use plain defaults until then.";

export async function voiceSummary(p: Record<string, unknown>, ctx: OpCtx): Promise<{ mailboxes: VoiceSummaryMailbox[] }> {
  const only = typeof p.accountId === "string" ? p.accountId.trim() : "";
  let accounts: Array<{ accountId: string; email: string | null }> = [];
  try {
    const r = await ctx.platform.connectors.accounts?.("gmail");
    if (r?.ok) accounts = (r.data?.accounts ?? []).map((a) => ({ accountId: a.accountId, email: a.email ?? null }));
  } catch { /* none known */ }
  if (only) {
    const known = accounts.find((a) => a.accountId === only);
    accounts = [known ?? { accountId: only, email: null }];
  }
  return {
    mailboxes: accounts.map(({ accountId, email }) => {
      const voice = voiceBlockOrNull(accountId);
      const voiceState: VoiceState = voice ? "ready" : voiceStateFor(accountId) === "learning" ? "learning" : "none";
      return {
        accountId, email, voiceState, voice,
        ...(voice ? {} : { note: voiceState === "learning" ? NOTE_LEARNING : NOTE_NONE }),
      };
    }),
  };
}
