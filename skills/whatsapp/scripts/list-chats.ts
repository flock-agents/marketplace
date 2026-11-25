#!/usr/bin/env bun
/**
 * WhatsApp: the recent chats and groups, as the chat list shows them.
 *
 * Params: max? (chats to list, default 20, at most 30).
 * Answer: { chats: [{ name, kind ("group" | "person" | "unknown"), unread, lastMessageAt, preview }], minutesLeftToday }.
 */
import { PARAMS, main, openWhatsApp, step, count } from "./_whatsapp";
import { chatListScript, type ChatRow } from "./_page";

const max = count(PARAMS.max, 20, 30);

await main(async () => {
  await openWhatsApp();
  const read = await step<{ chats: ChatRow[] }>([], chatListScript(max));
  const chats = read?.chats ?? [];
  if (chats.length === 0) return { chats, note: "The chat list read empty: WhatsApp Web's page may have changed, or there are no chats yet." };
  return { chats };
});
