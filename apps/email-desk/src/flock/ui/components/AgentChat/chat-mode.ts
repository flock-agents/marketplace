import { createContext, useContext } from "react";

/** How AppShell shows the side chat right now, and what the chat's own controls ask of it. AppShell provides it around
 *  `chat.render()`; AgentChat hands it to Flock's chat (FlockChatFrame). */
export interface ChatMode {
  /** A panel beside the app, a phone sheet over it, or the phone's full page (Chat | App tabs). */
  mode: "side" | "sheet" | "full";
  /** Hide the side panel, or close the sheet. */
  hide(): void;
  /** The sheet becomes the full page. */
  expand(): void;
  /** The full page goes back to the sheet. */
  shrink(): void;
  /** A reply in the chat changed this app. */
  appChanged(): void;
  /** Bring the app into view: the sheet closes, the full page goes to its App tab; beside the app it is already in view. */
  showApp(): void;
  /** The full page's tab, the app's name on its App tab, and its dot (the app changed while the chat was in view). Flock's
   *  chat draws these tabs itself, in its top. */
  tab: "chat" | "app";
  appName: string;
  dot: boolean;
  /** The viewer picked a tab in Flock's chat. */
  pickTab(t: "chat" | "app"): void;
  /** The light or dark the app shows, which Flock's chat inside it wears too. None without AppShell. */
  theme?: "light" | "dark";
  /** The chat is still deciding or loading (Flock's chat not yet shown): the phone sheet holds a light placeholder of the
   *  card over it until it says false. A chat that never calls this is ready from the start. */
  loading?(on: boolean): void;
  /** The chat is in view now (the panel or sheet shown, the full page on its Chat tab). Closed, preloaded hidden, or on the
   *  App tab it is false: the chat then reports nothing about what the viewer sees, and a visitor's pass waits for the
   *  first open. None (without AppShell): always in view. */
  open?: boolean;
}

const noop = () => {};
/** Without AppShell around it, the chat is a side panel whose controls do nothing. */
export const ChatModeContext = createContext<ChatMode>({
  mode: "side", hide: noop, expand: noop, shrink: noop, appChanged: noop, showApp: noop, tab: "chat", appName: "", dot: false, pickTab: noop,
});
export const useChatMode = (): ChatMode => useContext(ChatModeContext);
