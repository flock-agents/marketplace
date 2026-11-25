#!/usr/bin/env bun
/**
 * WhatsApp: one text message to one existing chat or group, by its name as the chat list shows it.
 *
 * Params: chat (the chat's exact name: one chat, never a list); text (the message, as the person
 * approved it). Answer: { chat, sent: true | null, pending, message }. sent null: it was typed and
 * sent but not seen in the chat yet; read the chat later before saying it went.
 *
 * Refused before anything is typed: a list of chats, a mention of everyone, a chat that is not in
 * the chat list (no new numbers), and the send limits (_limits.ts): 5 an hour, 20 a day, a minute
 * apart, and never the same text to a second chat within 24 hours. The open chat's own header must
 * name the chat asked for, or nothing is typed.
 */
import { PARAMS, main, openWhatsApp, openChat, step, fail, text } from "./_whatsapp";
import { forgetRead, takeSendSlot, chatKey } from "./_limits";
import { markComposeScript, typeActions, markSendScript, sendActions, verifySentScript } from "./_page";

const MAX_TEXT = 4000;
const LIST_PARAMS = ["chats", "to", "recipients", "recipient", "numbers", "phone"];
const MASS_MENTION = /(^|\s)@(all|everyone|here|channel|group|members)\b/i;

const chat = text(PARAMS.chat);
const message = typeof PARAMS.text === "string" ? PARAMS.text.replace(/\r\n/g, "\n").trim() : "";

await main(async () => {
  if (Array.isArray(PARAMS.chat) || LIST_PARAMS.some((p) => p in PARAMS)) fail("ONE_RECIPIENT", "One existing chat per send: give chat as one chat's name from the chat list. Lists, broadcasts and new numbers are never sent to.");
  if (!chat) fail("MISSING_PARAM", "Give chat: the chat's exact name as the chat list shows it.");
  if (!message) fail("MISSING_PARAM", "Give text: the message the person approved.");
  if (message.length > MAX_TEXT) fail("TOO_LONG", `The message is ${message.length} characters; at most ${MAX_TEXT}.`);
  if (MASS_MENTION.test(message)) fail("MASS_MENTION", "Messages that mention everyone in a group are never sent.");

  takeSendSlot(chat, message);
  await openWhatsApp();
  const box = await openChat<{ chat: string; found: boolean }>(chat, markComposeScript(chat));
  if (!box || chatKey(box.chat) !== chatKey(chat)) fail("CHAT_MISMATCH", `The chat that opened is "${box?.chat ?? "unreadable"}", not "${chat}": nothing was typed.`);
  if (!box!.found) fail("CANNOT_SEND", `"${chat}" has no message box (you may not be allowed to send there): nothing was typed.`);

  const typed = await step<{ typed: boolean; found: boolean }>(typeActions(message), markSendScript(message));
  if (!typed?.typed) fail("NOT_TYPED", "The message did not show in the box as written, so it was not sent. It may be left as an unsent draft in that chat.");
  if (!typed!.found) fail("PAGE_CHANGED", "The Send button was not found, so nothing was sent. The text may be left as an unsent draft in that chat.");

  const sent = await step<{ sent: true | null; pending: boolean }>(sendActions(), verifySentScript(message));
  forgetRead(`chat:${chatKey(chat)}`);
  const seen = sent?.sent === true;
  return {
    chat: box!.chat,
    sent: seen ? true : null,
    pending: !!sent?.pending,
    message: seen ? (sent?.pending ? "Sent; WhatsApp is still delivering it." : "Sent.") : "Send was pressed but the message was not seen in the chat yet. Do not send it again: read the chat later to check.",
  };
});
