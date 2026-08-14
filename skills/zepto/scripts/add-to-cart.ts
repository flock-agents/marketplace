#!/usr/bin/env bun
/**
 * Zepto — add a product to cart by searching and clicking Add.
 * Params: query, quantity?
 */
import {
  requireBrowserSession,
  validateParam,
  errorJson,
  urlencode,
  persistentCreate,
  persistentInteract,
  type GroceryServiceConfig,
} from "../../_shared/_grocery_helpers";

const config: GroceryServiceConfig = {
  name: "Zepto",
  baseUrl: "https://www.zeptonow.com",
  loginPattern: /zeptonow\.com\/auth|zeptonow\.com\/login/i,
};

const PARAMS = JSON.parse(process.env.SKILL_PARAMS || "{}");
const query: string = PARAMS.query || "";
let quantity: number = parseInt(PARAMS.quantity, 10) || 1;

requireBrowserSession();
validateParam(query, "query");

if (isNaN(quantity) || quantity < 1) quantity = 1;
if (quantity > 10) {
  errorJson("QUANTITY_LIMIT", "Maximum quantity per item is 10");
}

const encodedQuery = urlencode(query);
const searchUrl = `${config.baseUrl}/search?query=${encodedQuery}`;
const safeQueryJs = JSON.stringify(query);

const sessionResult = await persistentCreate(config, searchUrl, [
  { action: "wait", delay: 3000 },
  { action: "scroll", deltaY: 300 },
  { action: "wait", delay: 1000 },
]);

const persistentId: string = sessionResult.persistentSessionId || "";
if (!persistentId) {
  errorJson("SESSION_ERROR", "Failed to create persistent session");
}

const addScript = `(() => {
  const quantity = ${quantity};
  const searchQuery = ${safeQueryJs};

  const allButtons = Array.from(document.querySelectorAll('button'));
  const addBtn = allButtons.find(btn => {
    const text = (btn.textContent || '').trim().toUpperCase();
    return text === 'ADD' || text === 'ADD TO CART';
  });

  if (!addBtn) {
    return JSON.stringify({ error: true, code: 'NO_PRODUCTS', message: 'No products with ADD button found in search results' });
  }

  addBtn.scrollIntoView({ block: 'center' });
  addBtn.click();

  if (quantity > 1) {
    let remaining = quantity - 1;
    const clickPlus = () => {
      if (remaining <= 0) return;
      const plusBtns = Array.from(document.querySelectorAll('button')).filter(btn =>
        (btn.textContent || '').trim() === '+'
      );
      if (plusBtns.length > 0) {
        plusBtns[0].click();
        remaining--;
        if (remaining > 0) setTimeout(clickPlus, 300);
      }
    };
    setTimeout(clickPlus, 800);
  }

  const resolveDelay = 2000 + Math.max(0, quantity - 1) * 400;
  return new Promise(resolve => {
    setTimeout(() => {
      const card = addBtn.closest('[data-testid="product-card"], [class*="product"], [class*="Product"], a');
      const nameEl = card?.querySelector('[class*="name"], [class*="Name"], [class*="title"], [class*="Title"], h3, h4') || card;
      const name = (nameEl?.textContent || '').trim().substring(0, 200);

      const link = card?.closest('a')?.href || card?.querySelector('a')?.href || '';
      const idMatch = link.match(/\\/pvid\\/([^\\/?#]+)/) || link.match(/\\/pn\\/([^\\/?#]+)/);
      const productId = idMatch ? idMatch[1] : '';

      const cartCountEl = document.querySelector('[class*="cart-count"], [class*="CartCount"], [class*="cartCount"], [class*="badge"], [data-testid="cart-count"]');
      const cartTotalEl = document.querySelector('[class*="cart-total"], [class*="CartTotal"], [class*="cartTotal"], [class*="total"]');

      const cartCount = parseInt((cartCountEl?.textContent || '').replace(/[^\\d]/g, '')) || 0;
      const totalText = (cartTotalEl?.textContent || '').replace(/[^\\d.]/g, '');
      const cartTotal = totalText ? parseFloat(totalText) : 0;

      resolve(JSON.stringify({
        success: true,
        productId: productId,
        name: name,
        query: searchQuery.substring(0, 200),
        quantityAdded: quantity,
        cartItemCount: cartCount,
        cartTotal: cartTotal
      }));
    }, resolveDelay);
  });
})()`;

const addActions = [{ action: "screenshot" }];

const result = await persistentInteract(config, persistentId, addActions, true, addScript);
const content: string = result.content || "{}";

let parsed: any;
try {
  parsed = JSON.parse(content);
} catch {
  errorJson("PAGE_CHANGED", "Could not interact with the search results page. The service may have updated its layout.");
}

if (parsed.error) {
  console.log(JSON.stringify(parsed));
  process.exit(1);
}

console.log(JSON.stringify(parsed));
