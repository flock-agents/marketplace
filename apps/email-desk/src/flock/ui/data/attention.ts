/** Whether the viewer is at this page: it is visible and has focus. An app runs in a frame in Flock's app viewer, and a
 *  frame has focus only once something in it is clicked: while the Flock window around it has focus (its bar, or nothing
 *  clicked yet after a notification's tap opened the app) the frame's own hasFocus() is false. So the viewer tells the
 *  frame whether its window is visible and focused (HOST_ATTENTION, on every change), and the frame asks once when it
 *  starts listening (HOST_ATTENTION_ASK). Flock's half: frontend/src/components/apps/useHostAttention.ts. */
export const HOST_ATTENTION = "flock:host-attention";
export const HOST_ATTENTION_ASK = "flock:host-attention?";

let hostAttentive = false;
const subs = new Set<() => void>();
const changed = () => subs.forEach((f) => f());
const inFrame = () => { try { return window.parent !== window; } catch { return true; } };

export function attentive(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible" && (document.hasFocus() || hostAttentive);
}

// Only the window this page is framed in speaks for the window around it.
const onMessage = (e: MessageEvent) => {
  if (e.source !== window.parent || e.data?.type !== HOST_ATTENTION) return;
  hostAttentive = e.data.attentive === true; changed();
};
// Focus leaving the frame went to the viewer (which then says so) or out of the window (which says nothing): not here, until told.
const onBlur = () => { hostAttentive = false; changed(); };

function listen() {
  document.addEventListener("visibilitychange", changed);
  window.addEventListener("focus", changed);
  window.addEventListener("blur", onBlur);
  window.addEventListener("message", onMessage);
  if (inFrame()) window.parent.postMessage({ type: HOST_ATTENTION_ASK }, "*");   // carries nothing: any origin may hear it
}
function unlisten() {
  document.removeEventListener("visibilitychange", changed);
  window.removeEventListener("focus", changed);
  window.removeEventListener("blur", onBlur);
  window.removeEventListener("message", onMessage);
  hostAttentive = false;   // unheard from here on
}

/** Calls `fn` whenever `attentive()` may have changed. Returns the unsubscribe. */
export function onAttention(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  if (!subs.size) listen();
  subs.add(fn);
  return () => { subs.delete(fn); if (!subs.size) unlisten(); };
}
