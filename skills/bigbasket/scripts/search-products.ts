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

const scrollActions = [
  { action: "waitForSelector", selector: `[qa="product"], [class*="ProductCard"], [class*="product-card"], .SKUDeck, .prod-deck, li[class*="PaginateItems"]`, delay: 5000 },
  { action: "scroll", deltaY: 600 },
  { action: "wait", delay: 1000 },
  { action: "scroll", deltaY: 600 },
  { action: "wait", delay: 1000 },
];

const evalScript = `(() => {
  const maxResults = ${maxResults};
  const products = [];
  const cards = document.querySelectorAll('[qa="product"], [class*="ProductCard"], [class*="product-card"], .SKUDeck, .prod-deck, li[class*="PaginateItems"]');
  const items = cards.length > 0 ? cards : document.querySelectorAll('[class*="Product"] a, [class*="item-info"], .uiv2-list-box-img-container');

  items.forEach((el, i) => {
    if (i >= maxResults) return;
    const nameEl = el.querySelector('[class*="BrandName"], [class*="prod-name"], [class*="Name"], h3, h4, .Description') || el;
    const priceEl = el.querySelector('[class*="DiscountPriceTile"], [class*="selling-price"], [class*="Price"], [class*="sp"]');
    const mrpEl = el.querySelector('[class*="MRPPrice"], [class*="strike"], s, del, [class*="mp"]');
    const stockEl = el.querySelector('[class*="out-of-stock"], [class*="OutOfStock"], [class*="sold-out"]');
    const imgEl = el.querySelector('img');
    const quantityEl = el.querySelector('[class*="PackChanger"], [class*="weight"], [class*="quantity"], [class*="unit"], [class*="Label"]');
    const deliveryEl = el.querySelector('[class*="delivery"], [class*="eta"], [class*="minute"]');
    const discountEl = el.querySelector('[class*="discount"], [class*="offer"], [class*="Offer"], [class*="save"]');
    const brandEl = el.querySelector('[class*="Brand"], [class*="brand"]');

    const link = el.closest('a')?.href || el.querySelector('a')?.href || '';
    const idMatch = link.match(/\\/pd\\/[\\w-]+\\/(\\d+)/) || link.match(/\\/(\\d{5,})/) || link.match(/\\/product\\/(\\w+)/);

    const name = (nameEl.textContent || '').trim().substring(0, 200);
    if (!name) return;

    const priceText = (priceEl?.textContent || '').replace(/[^\\d.]/g, '');
    const mrpText = (mrpEl?.textContent || '').replace(/[^\\d.]/g, '');

    products.push({
      id: idMatch ? idMatch[1] : 'unknown-' + i,
      name: name,
      brand: (brandEl?.textContent || '').trim().substring(0, 100),
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
