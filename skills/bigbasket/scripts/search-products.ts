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
  type GroceryServiceConfig,
} from "../../_shared/_grocery_helpers";

const config: GroceryServiceConfig = {
  name: "BigBasket",
  baseUrl: "https://www.bigbasket.com",
  loginPattern: /bigbasket\.com\/signin|bigbasket\.com\/login/i,
};

const query = getParam("query");
let maxResults = parseInt(getParam("maxResults") || "10", 10);

requireBrowserSession();
validateParam(query, "query");

if (isNaN(maxResults) || maxResults < 1) maxResults = 1;
if (maxResults > 25) maxResults = 25;

const searchUrl = `${config.baseUrl}/ps/?q=${urlencode(query)}`;

const CARD = '[class*="SKUDeck___StyledDiv"], [qa="product"], [class*="ProductCard"], .SKUDeck';

const scrollActions = [
  { action: "waitForSelector", selector: CARD, delay: 10000 },
  { action: "scroll", deltaY: 600 },
  { action: "wait", delay: 1000 },
  { action: "scroll", deltaY: 600 },
  { action: "wait", delay: 1000 },
];

// Markup checked live 2026-11-10: one `SKUDeck___StyledDiv-…` per product; its h3 holds brand, name
// and pack on separate lines, with the rating ("4.2", "5122 Ratings") between them; the link is /pd/<id>/<slug>/; prices are the ₹ amounts (selling first,
// then MRP); an in-stock card has an "Add" button.
const evalScript = String.raw`(() => {
  const maxResults = ${maxResults};
  const rupees = (t) => (t.match(/₹\s*[\d,]+(?:\.\d+)?/g) || []).map((s) => parseFloat(s.replace(/[₹,\s]/g, "")));
  const cards = Array.from(document.querySelectorAll('${CARD}'));
  const products = [];
  for (const el of cards) {
    if (products.length >= maxResults) break;
    const href = (el.querySelector('a[href*="/pd/"]') || {}).getAttribute?.("href") || "";
    const id = (href.match(/\/pd\/(\d+)/) || [])[1];
    const head = ((el.querySelector("h3") || {}).innerText || "").split("\n").map((s) => s.trim()).filter((s) => s && !/^\d+(\.\d+)?$/.test(s) && !/ratings?$/i.test(s));
    if (!id || head.length === 0) continue;
    const text = el.innerText || "";
    const [price, mrp] = rupees(text);
    const brand = head.length > 2 ? head[0] : "";
    const name = head.length > 2 ? head[1] : head[0];
    const pack = head.length > 2 ? head[2] : (head[1] || "");
    const add = Array.from(el.querySelectorAll("button")).some((b) => /^add$/i.test(b.innerText.trim()));
    const img = el.querySelector("img");
    products.push({
      id, name: (brand ? brand + " " : "") + name, brand, quantity: pack,
      price: price ?? null, mrp: mrp ?? null,
      discount: (text.match(/\d+% OFF/i) || [null])[0],
      inStock: add || !/out of stock|notify me|sold out/i.test(text),
      imageUrl: img?.src || null,
      deliveryEstimate: (text.match(/\d+\s*MINS?/i) || [null])[0],
    });
  }
  return JSON.stringify({ products, totalResults: cards.length });
})()`;

const result = await browserInteract(config, searchUrl, scrollActions, undefined, evalScript);
const content = (result as any)?.content || "{}";

let parsed: any;
try {
  parsed = JSON.parse(content);
} catch {
  errorJson("PAGE_CHANGED", "Could not find product listings on the page. The service may have updated its layout.");
}

const products = parsed.products || [];
const total = parsed.totalResults || 0;

if (products.length === 0) {
  console.log(JSON.stringify({ products: [], totalResults: 0, query }));
} else {
  console.log(JSON.stringify({ products, totalResults: total, query }));
}
