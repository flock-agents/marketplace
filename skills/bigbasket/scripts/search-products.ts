#!/usr/bin/env bun
/**
 * Search products on BigBasket.
 * Params: query, maxResults?
 */
import {
  getParam,
  errorJson,
  validateParam,
  requireBrowserSession,
  urlencode,
  browserInteract,
} from "../../_shared/_grocery_helpers";
import { BIGBASKET, searchScript } from "./_bigbasket";

const NO_CARDS_NOTE = "BigBasket showed no products for this search: it may not sell this, or nothing matched. Try other words, or another service.";

const query = getParam("query");
let maxResults = parseInt(getParam("maxResults") || "10", 10);

requireBrowserSession();
validateParam(query, "query");

if (isNaN(maxResults) || maxResults < 1) maxResults = 1;
if (maxResults > 25) maxResults = 25;

const searchUrl = `${BIGBASKET.config.baseUrl}/ps/?q=${urlencode(query)}`;

// The page script waits for the cards itself, so a search with none ends with a note, not a timeout.
const result = await browserInteract(BIGBASKET.config, searchUrl, [], undefined, searchScript(maxResults));
const content = (result as any)?.content || "{}";

let parsed: any;
try {
  parsed = JSON.parse(content);
} catch {
  errorJson("PAGE_CHANGED", "Could not find product listings on the page. The service may have updated its layout.");
}

const products = parsed.products || [];
if (parsed.noCards) console.log(JSON.stringify({ products: [], totalResults: 0, query, note: NO_CARDS_NOTE }));
else console.log(JSON.stringify({ products, totalResults: products.length ? parsed.totalResults || 0 : 0, query }));
