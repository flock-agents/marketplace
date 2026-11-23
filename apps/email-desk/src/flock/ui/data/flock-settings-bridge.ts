// The app's side of the bridge to Flock's Settings & routines page inside it (/embed/app-settings). The app hosts the page in
// an iframe on the same origin and the two talk by postMessage, as with Flock's chat (flock-chat-bridge.ts). Mirrors Flock's
// frontend/src/lib/settings-embed-bridge.ts: the two sides must agree on every field.

/** embed → host. */
export type SettingsEmbedMessage =
  /** The signed-in owner's page loaded: the host may post its theme now (WebKit drops a message sent before). */
  | { type: "flock:settings-ready" }
  /** Anyone else (a visitor, signed out, not let in): the host takes its Settings page away. */
  | { type: "flock:settings-unavailable" };

/** host → embed: the light or dark the app shows, which the page wears. The address carries the first one. */
export interface SettingsThemeMessage {
  type: "flock:settings-theme";
  theme: "light" | "dark";
}

const BARE = new Set(["flock:settings-ready", "flock:settings-unavailable"]);
function isSettingsEmbedMessage(data: unknown): data is SettingsEmbedMessage {
  if (!data || typeof data !== "object") return false;
  const t = (data as Record<string, unknown>).type;
  return typeof t === "string" && BARE.has(t);
}

/** Posts to the embed in `frame`, on our own origin only. A no-op while the frame has no window. */
export function postToSettingsEmbed(frame: HTMLIFrameElement | null, msg: SettingsThemeMessage): void {
  frame?.contentWindow?.postMessage(msg, window.location.origin);
}

/** Listens for the embed's messages: only from our own origin and from the frame's own window. Returns the unsubscribe. */
export function onSettingsEmbedMessage(frame: () => HTMLIFrameElement | null, handler: (msg: SettingsEmbedMessage) => void): () => void {
  const listener = (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return;
    const win = frame()?.contentWindow;
    if (!win || event.source !== win) return;
    if (isSettingsEmbedMessage(event.data)) handler(event.data);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
