#!/usr/bin/env bun
/**
 * WhatsApp: the last messages of one existing chat or group, by its name as the chat list shows it.
 *
 * Params: chat (the chat's exact name); count? (messages, default 10, at most 30).
 * Answer: { chat, messages: [{ from, time, text, mine }], minutesLeftToday }, oldest first; a photo,
 * voice message and the like is a short placeholder ("[photo]").
 */
import { PARAMS, main, openWhatsApp, openChat, fail, count, text, sameName } from "./_whatsapp";
import { readChatScript, type ChatRead } from "./_page";

const MAX_MESSAGES = 30;
const chat = text(PARAMS.chat);
const want = count(PARAMS.count, 10, MAX_MESSAGES);

await main(async () => {
  if (!chat) fail("MISSING_PARAM", "Give chat: the chat's exact name as the chat list shows it.");
  await openWhatsApp();
  const read = await openChat<ChatRead>(chat, readChatScript(want));
  if (!read || !sameName(read.chat, chat)) fail("CHAT_MISMATCH", `The chat that opened is "${read?.chat ?? "unreadable"}", not "${chat}": nothing was read.`);
  return { chat: read!.chat, messages: read!.messages };
});
