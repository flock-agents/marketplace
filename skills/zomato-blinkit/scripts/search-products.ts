#!/usr/bin/env bun
/**
 * Blinkit — search products by query.
 * Params: query, maxResults?
 */
import {
  requireBrowserSession,
  validateParam,
  errorJson,
  urlencode,
  browserInteract,
  type GroceryServiceConfig,
} from "../../_shared/_grocery_helpers";

const config: GroceryServiceConfig = {
  name: "Blinkit",
  baseUrl: "https://blinkit.com",
  loginPattern: /blinkit\.com\/login|blinkit\.com\/auth/i,
};

const PARAMS = JSON.parse(process.env.SKILL_PARAMS || "{}");
const query: string = PARAMS.query || "";
let maxResults: number = parseInt(PARAMS.maxResults, 10) || 10;

requireBrowserSession();
validateParam(query, "query");

if (isNaN(maxResults) || maxResults < 1) maxResults = 1;
if (maxResults > 25) maxResults = 25;

const searchUrl = `${config.baseUrl}/s/?q=${urlencode(query)}`;

// Result cards, confirmed live on 35720 on 2026-10-16: each product is a
// `div[role="button"]` whose id is the product id (450546 = Cornetto), styled with Tailwind
// utility classes only. A card's text reads, line by line: "20% OFF", "11 MINS", name,
// pack size, price, MRP, "ADD". The older class names stay as a fallback.
const CARD_SELECTOR = 'div[role="button"][id]';
const LEGACY_CARDS = '[data-testid="product-card"], [class*="Product__UpdatedPlpProductContainer"], [class*="plp-product"], [class*="ProductCard"], [class*="product-card"]';

const scrollActions = [
  { action: "waitForSelector", selector: `${CARD_SELECTOR}, ${LEGACY_CARDS}`, delay: 15000 },
  { action: "scroll", deltaY: 600 },
  { action: "wait", delay: 1000 },
  { action: "scroll", deltaY: 600 },
  { action: "wait", delay: 1000 },
];

const evalScript = `(() => {
  const maxResults = ${maxResults};
  const isCard = (el) => /^\\d{3,}$/.test(el.id || "") && /₹/.test(el.innerText || "");
  let cards = Array.from(document.querySelectorAll('${CARD_SELECTOR}')).filter(isCard);
  if (!cards.length) cards = Array.from(document.querySelectorAll('${LEGACY_CARDS}'));
  const products = [];
  cards.slice(0, maxResults).forEach((el, i) => {
    const lines = (el.innerText || "").split("\\n").map((s) => s.trim()).filter(Boolean);
    const isPrice = (s) => /^₹\\s*[\\d,.]+$/.test(s);
    const isMeta = (s) => isPrice(s) || /% OFF$/i.test(s) || /^\\d+\\s*MINS?$/i.test(s) || /^(ADD|Out of Stock|Notify)$/i.test(s);
    const nameEl = el.querySelector('[class*="line-clamp-2"]');
    const name = ((nameEl && nameEl.textContent) || lines.find((s) => !isMeta(s)) || "").trim().substring(0, 200);
    if (!name) return;
    const after = lines.slice(lines.indexOf(name) + 1);
    const prices = lines.filter(isPrice).map((s) => parseFloat(s.replace(/[^\\d.]/g, "")));
    const discount = lines.find((s) => /% OFF$/i.test(s)) || null;
    const eta = lines.find((s) => /^\\d+\\s*MINS?$/i.test(s)) || null;
    const quantity = (after.find((s) => !isMeta(s)) || "").substring(0, 50);
    const img = el.querySelector('img');
    products.push({
      id: /^\\d+$/.test(el.id || "") ? el.id : "unknown-" + i,
      name,
      brand: "",
      quantity,
      price: prices.length ? prices[0] : null,
      mrp: prices.length > 1 ? prices[1] : null,
      discount: discount ? discount.substring(0, 50) : null,
      inStock: !/out of stock|notify me/i.test(el.innerText || ""),
      imageUrl: (img && img.src) || null,
      deliveryEstimate: eta ? eta.substring(0, 50) : null,
    });
  });
  return JSON.stringify({ products, totalResults: cards.length });
})()`;

const result = await browserInteract(config, searchUrl, scrollActions, undefined, evalScript);
const content: string = result.content || "{}";

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
