// The app's side of the bridge to Flock's chat inside it (/embed/chat). The app hosts the page in an iframe on the same
// origin and the two talk by postMessage. Mirrors Flock's frontend/src/lib/embed-bridge.ts: the two sides must agree on
// every field.

/** host → embed: which chat to show, for which app and agent. Sent in answer to chat-ready, and again to switch chats. */
export interface ChatInit {
  type: "flock:chat-init";
  appId: string;
  agentId: string;
  session: string | null;
  starters: string[];
  path: string | null;
  /** A visitor's pass (anyone on a public app who is not the owner): the embed uses it, not Flock's cookie, and it opens only
   *  this viewer's own chat with the app's agent. The owner's init carries none. */
  pass?: string;
  /** The app's agent, as the kit names it, for a visitor's chat (which can't read Flock's agents). */
  agentName?: string;
  agentAvatar?: string;
  /** The viewer chose New chat and has not sent yet: with no session, open the new chat screen, never the last chat. */
  fresh?: true;
}

/** embed → host. */
export type EmbedMessage =
  /** The embed's listener is attached: the host may send chat-init now (WebKit drops a message sent before). */
  | { type: "flock:chat-ready" }
  /** The chat's first load has settled and is in view (the transcript revealed): a placeholder over it can go. */
  | { type: "flock:chat-shown" }
  /** The chat the embed settled on (a new one created on the first send, or one picked from Earlier chats). */
  | { type: "flock:chat-session"; session: string }
  /** The viewer chose New chat: the host forgets the old chat (and its address's flock_session). */
  | { type: "flock:chat-new" }
  /** Hide or close the chat (the viewer asked). */
  | { type: "flock:chat-hide" }
  /** The viewer is not signed in to Flock (or not let in): the host falls back to its own chat. */
  | { type: "flock:chat-unavailable" }
  | { type: "flock:chat-expand" }
  | { type: "flock:chat-shrink" }
  /** A live reply linked the host's own app: something there changed. */
  | { type: "flock:chat-app-changed" }
  /** A card in the chat opened this app: move to `path` (null: stay where it is) and show the app. */
  | { type: "flock:chat-navigate"; path: string | null }
  /** A visitor's pass was refused: the host asks its kit for a fresh one now and posts it as chat-pass (none: nothing). */
  | { type: "flock:chat-pass-request" }
  /** On the phone's full page, the viewer picked a tab in the embed's Chat | <app> row: the host shows that one. */
  | { type: "flock:chat-tab-pick"; tab: ChatTab };

/** How the app shows the chat: a side panel, a phone sheet, or the phone's full page. */
export type ChatMode = "side" | "sheet" | "full";

/** host → embed: the app now shows the chat another way (the embed's header controls follow). The frame stays as it is:
 *  its address names only the mode it first opened in. */
export interface ChatModeMessage {
  type: "flock:chat-mode";
  mode: ChatMode;
}

/** host → embed: a visitor's next pass, before the one it has expires. The chat goes on as it is. */
export interface ChatPassMessage {
  type: "flock:chat-pass";
  pass: string;
}

/** The phone's full page has two tabs: the chat, or the app (the layer is then only the embed's top, the app below it). */
export type ChatTab = "chat" | "app";

/** host → embed: on the phone's full page the embed draws the top: its header, then the Chat | <app name> tabs (`dot`: the
 *  app changed while the chat was in view). Sent whenever one of these changes in full mode, and after every chat-ready. */
export interface ChatTabsMessage {
  type: "flock:chat-tabs";
  tab: ChatTab;
  appName: string;
  dot: boolean;
}

/** The height of the embed's top on the phone's full page: its 48px header and the 45px tab row. On the app tab the host
 *  cuts the layer to it and pads the app's page by it. */
export const FULL_TOP_PX = 93;

/** host → embed: the light or dark the app shows, which the chat wears (its own page only). The embed's address carries the
 *  first one; a change is posted, and the theme is posted again after every chat-ready. */
export interface ChatThemeMessage {
  type: "flock:chat-theme";
  theme: "light" | "dark";
}

/** host → embed: whether the app shows the chat now. A chat preloaded hidden (or closed again) is not where the viewer is:
 *  the embed reports no presence until shown. The embed's address says the first one (`visible=0` when hidden); a change
 *  is posted, and posted again after chat-ready when it differs from the address. */
export interface ChatVisibleMessage {
  type: "flock:chat-visible";
  visible: boolean;
}

/** host → embed: the app asked to open its chat with a message (the kit's useChat): put `text` in the typing box, or send it
 *  when `send`. Posted once per ask, after the init. An older embed ignores it (the chat just opens). */
export interface ChatComposeMessage {
  type: "flock:chat-compose";
  text: string;
  send: boolean;
}

export type HostMessage = ChatInit | ChatModeMessage | ChatPassMessage | ChatTabsMessage | ChatThemeMessage | ChatVisibleMessage | ChatComposeMessage;

const BARE = new Set(["flock:chat-ready", "flock:chat-shown", "flock:chat-hide", "flock:chat-unavailable", "flock:chat-expand", "flock:chat-shrink", "flock:chat-app-changed",
  "flock:chat-pass-request", "flock:chat-new"]);
function isEmbedMessage(data: unknown): data is EmbedMessage {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  if (d.type === "flock:chat-session") return typeof d.session === "string" && !!d.session;
  if (d.type === "flock:chat-navigate") return d.path === null || typeof d.path === "string";
  if (d.type === "flock:chat-tab-pick") return d.tab === "chat" || d.tab === "app";
  return typeof d.type === "string" && BARE.has(d.type);
}

/** Posts to the embed in `frame`, on our own origin only. A no-op while the frame has no window. */
export function postToEmbed(frame: HTMLIFrameElement | null, msg: HostMessage): void {
  frame?.contentWindow?.postMessage(msg, window.location.origin);
}

/** Listens for the embed's messages: only from our own origin and from the frame's own window. Returns the unsubscribe. */
export function onEmbedMessage(frame: () => HTMLIFrameElement | null, handler: (msg: EmbedMessage) => void): () => void {
  const listener = (event: MessageEvent) => {
    if (event.origin !== window.location.origin) return;
    const win = frame()?.contentWindow;
    if (!win || event.source !== win) return;
    if (isEmbedMessage(event.data)) handler(event.data);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
