#!/usr/bin/env bun
/**
 * WhatsApp: the last messages of one existing chat or group, by its name as the chat list shows it.
 *
 * Params: chat (the chat's exact name); count? (messages, default 10, at most 30).
 * Answer: { chat, messages: [{ from, time, text, mine }] } oldest first; a photo, voice message and
 * the like is a short placeholder ("[photo]"). The same chat is loaded at most once every 10 minutes:
 * inside that, the kept read comes back with cached and ageSeconds.
 */
import { PARAMS, main, openWhatsApp, openChat, fail, count, text } from "./_whatsapp";
import { cachedRead, keepRead, takeReadSlot, chatKey } from "./_limits";
import { readChatScript, type ChatRead } from "./_page";

const MAX_MESSAGES = 30;
const chat = text(PARAMS.chat);
const want = count(PARAMS.count, 10, MAX_MESSAGES);
const key = `chat:${chatKey(chat)}`;

await main(async () => {
  if (!chat) fail("MISSING_PARAM", "Give chat: the chat's exact name as the chat list shows it.");
  const kept = cachedRead(key) as { result: ChatRead; ageSeconds: number } | null;
  if (kept) return { chat: kept.result.chat, messages: kept.result.messages.slice(-want), cached: true, ageSeconds: kept.ageSeconds };
  takeReadSlot();
  await openWhatsApp();
  const read = await openChat<ChatRead>(chat, readChatScript(MAX_MESSAGES));
  if (!read || chatKey(read.chat) !== chatKey(chat)) fail("CHAT_MISMATCH", `The chat that opened is "${read?.chat ?? "unreadable"}", not "${chat}": nothing was read.`);
  keepRead(key, read);
  return { chat: read!.chat, messages: read!.messages.slice(-want) };
});
