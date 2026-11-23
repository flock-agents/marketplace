import { createContext, useContext, useEffect, useRef } from "react";

/** What app code may ask of the shell's chat. */
export interface OpenChatOptions {
  /** Words for the chat: put in its typing box, or sent with `send: true`. */
  message?: string;
  /** Send `message` at once instead of leaving it in the box. */
  send?: boolean;
}

/** A message the app asked the chat to take: `id` tells a new ask from one already taken. */
export interface ChatRequest { id: number; text: string; send: boolean }

export interface ShellChat {
  /** The app has a chat this shell shows (side or page). False outside AppShell, with no chat, or beside a Flock chat. */
  available: boolean;
  /** Open the chat (the side panel on a wide screen, the sheet on a phone, or the Chat page), optionally with a message. */
  openChat(options?: OpenChatOptions): void;
  /** The latest message asked for, for the chat inside the shell to take. */
  request: ChatRequest | null;
}

const noop = () => {};
/** Outside AppShell: no chat, and opening it does nothing. */
export const ShellChatContext = createContext<ShellChat>({ available: false, openChat: noop, request: null });

/** App code: `const { openChat, available } = useChat(); openChat({ message: "Hi" })`. */
export function useChat(): Pick<ShellChat, "available" | "openChat"> {
  const { available, openChat } = useContext(ShellChatContext);
  return { available, openChat };
}

/** Inside the chat: calls `take` once for each new message the app asks for (none already taken before this mounted twice). */
export function useChatRequest(take: (r: ChatRequest) => void): void {
  const { request } = useContext(ShellChatContext);
  const taken = useRef(0);
  const latest = useRef(take);
  latest.current = take;
  useEffect(() => {
    if (!request || request.id <= taken.current) return;
    taken.current = request.id;
    latest.current(request);
  }, [request]);
}
