#!/usr/bin/env bun
/**
 * WhatsApp: the last messages of one existing chat or group, by its name as the chat list shows it.
 *
 * Params: chat (the chat's exact name); count? (messages, default 10, at most 30).
 * Answer: { chat, messages: [{ from, time, text, mine, document? }], minutesLeftToday }, oldest
 * first; a photo, voice message and the like is a short placeholder ("[photo]"). A document carries
 * `document`: a PDF as `{ name, path, size }`, a file the agent can read, downloaded in the same open
 * window (_documents.ts: PDFs only, at most 5 a read, at most 10 MB each); any other document, or a
 * PDF not downloaded, as `{ name, error }`.
 */
import { PARAMS, main, openWhatsApp, openChat, fail, count, text, sameName, step, downloadStep, openTimeLeftMs, Fail } from "./_whatsapp";
import { readChatScript, markDocumentScript, downloadActions, type ChatRead } from "./_page";
import { DOC_LIMITS, StopDownloads, fetchDocuments, withDocuments } from "./_documents";

const MAX_MESSAGES = 30;
/** The run's own timeout (flock.skill.json functions.read-chat.timeoutMs) less a margin for closing. */
const RUN_BUDGET_MS = 240_000 - 20_000;
const runStarted = Date.now();
const chat = text(PARAMS.chat);
const want = count(PARAMS.count, 10, MAX_MESSAGES);

await main(async () => {
  if (!chat) fail("MISSING_PARAM", "Give chat: the chat's exact name as the chat list shows it.");
  await openWhatsApp();
  const read = await openChat<ChatRead>(chat, readChatScript(want));
  if (!read || !sameName(read.chat, chat)) fail("CHAT_MISMATCH", `The chat that opened is "${read?.chat ?? "unreadable"}", not "${chat}": nothing was read.`);
  const documents = await fetchDocuments(read!.messages, {
    mark: async (id) => !!(await step<{ found: boolean }>([], markDocumentScript(id)))?.found,
    download: async () => {
      try {
        return await downloadStep(downloadActions(DOC_LIMITS.waitMs));
      } catch (e) {
        // A failed click or no download is this document's; anything else ends this read's downloads.
        if (e instanceof Fail && e.code !== "BROWSER_ERROR") throw new StopDownloads(e.code === "HANDED_OFF" ? "the person has the WhatsApp window open" : "WhatsApp is not reachable right now");
        throw e;
      }
    },
    timeLeftMs: () => Math.min(openTimeLeftMs(), RUN_BUDGET_MS - (Date.now() - runStarted)),
    dataDir: process.env.SKILL_DATA_DIR || "",
  });
  return { chat: read!.chat, messages: withDocuments(read!.messages, documents) };
});
