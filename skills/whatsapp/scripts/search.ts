#!/usr/bin/env bun
/**
 * WhatsApp: WhatsApp Web's own search box.
 *
 * Params: query (what to search, up to 100 characters); max? (results per kind, default 10, at most 20).
 * Answer: { query, chats: [ChatRow], messages: [{ chat, text, time }], minutesLeftToday }. People with
 * no chat yet are left out.
 */
import { PARAMS, main, openWhatsApp, step, fail, count, text } from "./_whatsapp";
import { MARK_SEARCH_JS, searchActions, searchResultsScript, type SearchRead } from "./_page";

const query = text(PARAMS.query);
const max = count(PARAMS.max, 10, 20);

await main(async () => {
  if (!query) fail("MISSING_PARAM", "Give query: what to search for.");
  if (query.length > 100) fail("BAD_PARAM", "query is at most 100 characters.");
  await openWhatsApp();
  const box = await step<{ found: boolean }>([], MARK_SEARCH_JS);
  if (!box?.found) fail("PAGE_CHANGED", "WhatsApp Web's search box was not found: its page may have changed.");
  const read = await step<SearchRead>(searchActions(query), searchResultsScript(max));
  const result = { query, chats: read?.chats ?? [], messages: read?.messages ?? [] };
  return read?.sections ? result : { ...result, note: "No results, or WhatsApp Web's search page has changed." };
});
