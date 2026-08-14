#!/usr/bin/env bun
/**
 * Zepto — remove a product from cart by productId.
 * Params: productId
 */
import {
  requireBrowserSession,
  validateParam,
  validateId,
  errorJson,
  browserWrite,
  type GroceryServiceConfig,
} from "../../_shared/_grocery_helpers";

const config: GroceryServiceConfig = {
  name: "Zepto",
  baseUrl: "https://www.zeptonow.com",
  loginPattern: /zeptonow\.com\/auth|zeptonow\.com\/login/i,
};

const PARAMS = JSON.parse(process.env.SKILL_PARAMS || "{}");
const productId: string = PARAMS.productId || "";

requireBrowserSession();
validateParam(productId, "productId");
validateId(productId, "productId");

const cartUrl = `${config.baseUrl}/cart`;

const removeEvalScript = `(() => {
  const targetId = '${productId}';
  const cartItems = document.querySelectorAll('[class*="cart-item"], [class*="CartItem"], [class*="cart_item"], [class*="cartItem"], [data-testid="cart-item"]');

  if (cartItems.length === 0) {
    return JSON.stringify({ error: true, code: 'CART_EMPTY', message: 'Cart has no items' });
  }

  let found = false;
  let removedName = '';

  cartItems.forEach(el => {
    if (found) return;
    const link = el.querySelector('a')?.href || '';
    const idMatch = link.match(/\\/pvid\\/([^\\/?#]+)/) || link.match(/\\/pn\\/([^\\/?#]+)/);
    const itemId = idMatch ? idMatch[1] : '';

    if (itemId === targetId) {
      const nameEl = el.querySelector('[class*="name"], [class*="Name"], [class*="title"], h4, h3');
      removedName = (nameEl?.textContent || '').trim().substring(0, 200);

      const removeBtn = el.querySelector('[class*="remove"], [class*="Remove"], [class*="delete"], [class*="Delete"], [data-testid="remove-btn"], button[aria-label*="remove"], button[aria-label*="delete"]');
      if (!removeBtn) {
        const minusBtn = el.querySelector('[class*="minus"], [class*="Minus"], button[aria-label*="decrease"]');
        if (minusBtn) {
          const qtyEl = el.querySelector('[class*="quantity"], [class*="count"], input[type="number"]');
          const qty = parseInt((qtyEl?.textContent || qtyEl?.value || '1').replace(/[^\\d]/g, '')) || 1;
          for (let i = 0; i < qty; i++) {
            minusBtn.click();
          }
          found = true;
          return;
        }
      } else {
        removeBtn.click();
        found = true;
      }
    }
  });

  if (!found) {
    return JSON.stringify({ error: true, code: 'PRODUCT_NOT_FOUND', message: 'Product ' + targetId + ' not found in cart' });
  }

  return new Promise(resolve => {
    setTimeout(() => {
      const countEl = document.querySelector('[class*="cart-count"], [class*="CartCount"], [class*="cartCount"], [class*="badge"], [data-testid="cart-count"]');
      const totalEl = document.querySelector('[class*="grand-total"], [class*="GrandTotal"], [class*="total-amount"], [class*="TotalAmount"], [class*="totalAmount"], [data-testid="cart-total"]');
      const cartCount = parseInt((countEl?.textContent || '0').replace(/[^\\d]/g, '')) || 0;
      const totalText = (totalEl?.textContent || '').replace(/[^\\d.]/g, '');
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

const result = await browserWrite(config, cartUrl, removeEvalScript);
const content: string = result.content || "{}";

let parsed: any;
try {
  parsed = JSON.parse(content);
} catch {
  errorJson("PAGE_CHANGED", "Could not interact with cart. The service may have updated its layout.");
}

if (parsed.error) {
  console.log(JSON.stringify(parsed));
  process.exit(1);
}

console.log(JSON.stringify(parsed));
