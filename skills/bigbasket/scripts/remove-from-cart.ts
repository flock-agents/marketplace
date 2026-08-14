#!/usr/bin/env bun
/**
 * Remove a product from cart on BigBasket.
 * Params: productId
 */
import {
  getParam,
  errorJson,
  validateParam,
  validateId,
  requireBrowserSession,
  browserWrite,
  type GroceryServiceConfig,
} from "../../_shared/_grocery_helpers";

const config: GroceryServiceConfig = {
  name: "BigBasket",
  baseUrl: "https://www.bigbasket.com",
  loginPattern: /bigbasket\.com\/signin|bigbasket\.com\/login/i,
};

const productId = getParam("productId");

requireBrowserSession();
validateParam(productId, "productId");
validateId(productId, "productId");

const cartUrl = `${config.baseUrl}/basket`;

const removeEvalScript = `(() => {
  const targetId = '${productId}';
  const cartItems = document.querySelectorAll('[class*="cart-item"], [class*="CartItem"], [class*="BasketItem"], [data-testid="cart-item"], [class*="itemlist"] > div, [class*="ItemList"] > div');

  let found = false;
  let removedName = '';

  cartItems.forEach(el => {
    if (found) return;
    const link = el.querySelector('a')?.href || '';
    const idMatch = link.match(/\\/pd\\/[\\w-]+\\/(\\d+)/) || link.match(/\\/(\\d{5,})/);
    const itemId = idMatch ? idMatch[1] : '';

    const nameEl = el.querySelector('[class*="name"], [class*="Name"], [class*="prod-name"], h4, h3');
    const name = (nameEl?.textContent || '').trim().substring(0, 200);

    if (itemId === targetId) {
      const removeBtn = el.querySelector('[class*="remove"], [class*="Remove"], [class*="delete"], [class*="Delete"], [aria-label*="remove"], [aria-label*="delete"], button[class*="close"]');
      if (removeBtn) {
        removeBtn.click();
        found = true;
        removedName = name;
      }
    }
  });

  if (!found) {
    return JSON.stringify({ error: true, code: 'PRODUCT_NOT_FOUND', message: 'Product ' + targetId + ' not found in cart' });
  }

  return new Promise(resolve => {
    setTimeout(() => {
      const cartCountEl = document.querySelector('[class*="cart-count"], [class*="CartCount"], [class*="badge"], [class*="BasketCount"]');
      const cartTotalEl = document.querySelector('[class*="cart-total"], [class*="CartTotal"], [class*="total"], [class*="PayableAmount"]');

      const cartCount = parseInt((cartCountEl?.textContent || '').replace(/[^\\d]/g, '')) || 0;
      const totalText = (cartTotalEl?.textContent || '').replace(/[^\\d.]/g, '');
      const cartTotal = totalText ? parseFloat(totalText) : 0;

      resolve(JSON.stringify({
        success: true,
        productId: targetId,
        removed: removedName,
        cartItemCount: cartCount,
        cartTotal: cartTotal
      }));
    }, 1500);
  });
})()`;

const result = await browserWrite(config, cartUrl, removeEvalScript, undefined);
const content = (result as any)?.content || "{}";

let parsed: any;
try {
  parsed = JSON.parse(content);
} catch {
  errorJson("PAGE_CHANGED", "Could not interact with the cart page. The service may have updated its layout.");
}

if (parsed.error) {
  console.log(JSON.stringify(parsed));
  process.exit(1);
}

console.log(JSON.stringify(parsed));
