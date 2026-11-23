// The app's side of the bridge to Flock's app viewer (/apps/view), which hosts the app in an iframe on the same origin.
// Mirrors Flock's frontend/src/lib/viewer-bridge.ts: the two sides must agree on every field. Opened bare (/a/<id>/) the
// app has no viewer around it and nothing is said.

/** app → viewer. */
export type ViewerAppMessage =
  /** The chat took the phone's full page (`on`) or left it: the viewer goes full screen (no bar, no banner) and back. */
  | { type: "flock:viewer-chat-full"; on: boolean }
  /** The add-to-home banner, shown here while the viewer is full screen: Add, or its dismiss. */
  | { type: "flock:viewer-home-add" }
  | { type: "flock:viewer-home-dismiss" }
  /** This side's listener is attached: the viewer answers with the offer. */
  | { type: "flock:viewer-ready" };

/** viewer → app: whether to offer the add-to-home banner (on the full page's App tab). Sent in answer to every viewer-ready
 *  and viewer-chat-full, and whenever the offer changes. */
export interface ViewerHomeOffer {
  type: "flock:viewer-home-offer";
  show: boolean;
  appName: string;
}

const inFrame = () => { try { return window.parent !== window; } catch { return true; } };

/** Tells the viewer around this page, on our own origin only. A no-op with no viewer (the page is not framed). */
export function tellViewer(msg: ViewerAppMessage): void {
  if (typeof window === "undefined" || !inFrame()) return;
  try { window.parent.postMessage(msg, location.origin); } catch { /* the viewer went away */ }
}

function isHomeOffer(data: unknown): data is ViewerHomeOffer {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return d.type === "flock:viewer-home-offer" && typeof d.show === "boolean" && typeof d.appName === "string";
}

/** Listens for the viewer's messages: only from the window this page is framed in, on our own origin. Says viewer-ready once
 *  attached. Returns the unsubscribe. */
export function onViewerMessage(handler: (msg: ViewerHomeOffer) => void): () => void {
  if (typeof window === "undefined" || !inFrame()) return () => {};
  const listener = (event: MessageEvent) => {
    if (event.source !== window.parent || event.origin !== location.origin) return;
    if (isHomeOffer(event.data)) handler(event.data);
  };
  window.addEventListener("message", listener);
  tellViewer({ type: "flock:viewer-ready" });
  return () => window.removeEventListener("message", listener);
}
