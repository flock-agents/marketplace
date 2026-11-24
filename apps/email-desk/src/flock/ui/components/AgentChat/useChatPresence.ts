import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { kitFetch } from "../../data/client";
import { attentive, onAttention } from "../../data/attention";

/** How often an open conversation tells the kit its viewer is still here. The kit's report holds 30s (CHAT_VIEWING_TTL_MS):
 *  a page that goes without saying so (a crash, a lost network) stops holding back notifications within it. */
export const VIEWING_BEAT_MS = 15_000;

/** The viewer is at this page: visible and focused (in Flock's app viewer, its window's focus counts: data/attention.ts). */
export const useAttention = () => useSyncExternalStore(onAttention, attentive, () => true);

/** Tells the kit what the viewer has in front of them, which is what decides the reply notification (owner 2026-10-27:
 *  never an open stream). While the conversation is on screen to a viewer who is here, it beats `viewing`, and says when
 *  that ends; once the latest reply has been shown to them, it says `seen` (the kit clears the notification for it). */
export function useChatPresence(conversationId: string | null, latestReplyId: string | null): void {
  const here = useAttention();
  // Tells this page's report from another's on the same conversation (a second tab, the phone). Not a secret.
  const [client] = useState(() => Math.random().toString(36).slice(2));
  const told = useRef<string | null>(null);

  useEffect(() => {
    if (!conversationId || !here) return;
    // keepalive: the last report goes out even as the page unloads.
    const report = (on: boolean) => void kitFetch(`_agent/conversations/${conversationId}/viewing`, { method: "POST", keepalive: true, body: JSON.stringify({ on, client }) }).catch(() => {});
    const leave = () => report(false);
    report(true);
    const beat = setInterval(() => report(true), VIEWING_BEAT_MS);
    window.addEventListener("pagehide", leave);
    return () => { clearInterval(beat); window.removeEventListener("pagehide", leave); leave(); };
  }, [conversationId, here, client]);

  useEffect(() => {
    if (!conversationId || !here || !latestReplyId || told.current === latestReplyId) return;
    const id = latestReplyId;
    told.current = id;
    void kitFetch(`_agent/conversations/${conversationId}/seen`, { method: "POST", body: JSON.stringify({ messageId: id }) })
      .catch(() => { if (told.current === id) told.current = null; });   // said again the next time it is in view
  }, [conversationId, here, latestReplyId]);
}
