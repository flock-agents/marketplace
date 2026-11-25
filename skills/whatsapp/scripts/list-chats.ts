#!/usr/bin/env bun
/**
 * WhatsApp: the recent chats and groups, as the chat list shows them.
 *
 * Params: max? (chats to list, default 20, at most 30).
 * Answer: { chats: [{ name, kind ("group" | "person" | "unknown"), unread, lastMessageAt, preview }] },
 * plus cached and ageSeconds when it is a read from the last 10 minutes.
 */
import { PARAMS, main, openWhatsApp, step, count } from "./_whatsapp";
import { cachedRead, keepRead, takeReadSlot } from "./_limits";
import { chatListScript, type ChatRow } from "./_page";

const max = count(PARAMS.max, 20, 30);
const key = `list:${max}`;

await main(async () => {
  const kept = cachedRead(key);
  if (kept) return { ...(kept.result as object), cached: true, ageSeconds: kept.ageSeconds };
  takeReadSlot();
  await openWhatsApp();
  const read = await step<{ chats: ChatRow[] }>([], chatListScript(max));
  const result = { chats: read?.chats ?? [] };
  if (result.chats.length === 0) return { ...result, note: "The chat list read empty: WhatsApp Web's page may have changed, or there are no chats yet." };
  keepRead(key, result);
  return result;
});
