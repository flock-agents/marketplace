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

const scrollActions = [
  { action: "waitForSelector", selector: '[data-testid="product-card"], [class*="Product__UpdatedPlpProductContainer"], [class*="plp-product"], .Product, [class*="ProductCard"], [class*="product-card"]', delay: 5000 },
  { action: "scroll", deltaY: 600 },
  { action: "wait", delay: 1000 },
  { action: "scroll", deltaY: 600 },
  { action: "wait", delay: 1000 },
];

const evalScript = `(() => {
  const maxResults = ${maxResults};
  const products = [];
  const cards = document.querySelectorAll('[data-testid="product-card"], [class*="Product__UpdatedPlpProductContainer"], [class*="plp-product"], .Product, [class*="ProductCard"], [class*="product-card"]');
  const items = cards.length > 0 ? cards : document.querySelectorAll('[class*="Product"] a, [class*="item"] a');

  items.forEach((el, i) => {
    if (i >= maxResults) return;
    const nameEl = el.querySelector('[class*="Product__UpdatedTitle"], [class*="product-name"], [class*="Name"], h3, h4, [class*="Title"]') || el;
    const priceEl = el.querySelector('[class*="Product__UpdatedPriceAndAtc498"], [class*="price"], [class*="Price"], [class*="rupee"]');
    const mrpEl = el.querySelector('[class*="Product__UpdatedMrpText"], [class*="mrp"], [class*="strike"], s, del');
    const stockEl = el.querySelector('[class*="out-of-stock"], [class*="OutOfStock"], [class*="sold-out"], [class*="Unavailable"]');
    const imgEl = el.querySelector('img');
    const quantityEl = el.querySelector('[class*="Product__UpdatedPackSizeAndUnitText"], [class*="weight"], [class*="quantity"], [class*="unit"], [class*="Weight"]');
    const deliveryEl = el.querySelector('[class*="delivery"], [class*="eta"], [class*="minute"]');
    const discountEl = el.querySelector('[class*="discount"], [class*="offer"], [class*="Offer"]');

    const link = el.closest('a')?.href || el.querySelector('a')?.href || '';
    const idMatch = link.match(/\\/prn\\/([\\w-]+)\\/prid\\/(\\d+)/) || link.match(/\\/product\\/([\\w-]+)/) || link.match(/\\/(\\d{5,})/);

    const name = (nameEl.textContent || '').trim().substring(0, 200);
    if (!name) return;

    const priceText = (priceEl?.textContent || '').replace(/[^\\d.]/g, '');
    const mrpText = (mrpEl?.textContent || '').replace(/[^\\d.]/g, '');

    products.push({
      id: idMatch ? (idMatch[2] || idMatch[1]) : 'unknown-' + i,
      name: name,
      brand: '',
      quantity: (quantityEl?.textContent || '').trim().substring(0, 50),
      price: priceText ? parseFloat(priceText) : null,
      mrp: mrpText ? parseFloat(mrpText) : null,
      discount: (discountEl?.textContent || '').trim().substring(0, 50) || null,
      inStock: !stockEl,
      imageUrl: imgEl?.src || null,
      deliveryEstimate: (deliveryEl?.textContent || '').trim().substring(0, 50) || null
    });
  });
  return JSON.stringify({ products, totalResults: items.length });
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
