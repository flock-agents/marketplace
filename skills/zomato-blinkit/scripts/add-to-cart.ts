#!/usr/bin/env bun
/**
 * Blinkit — add a product to cart by productId.
 * Params: productId, quantity?
 */
import {
  requireBrowserSession,
  validateParam,
  errorJson,
  persistentCreate,
  persistentInteract,
  persistentClose,
  type GroceryServiceConfig,
} from "../../_shared/_grocery_helpers";

const config: GroceryServiceConfig = {
  name: "Blinkit",
  baseUrl: "https://blinkit.com",
  loginPattern: /blinkit\.com\/login|blinkit\.com\/auth/i,
};

const PARAMS = JSON.parse(process.env.SKILL_PARAMS || "{}");
const productId: string = PARAMS.productId || "";
let quantity: number = parseInt(PARAMS.quantity, 10) || 1;

requireBrowserSession();
validateParam(productId, "productId");

if (isNaN(quantity) || quantity < 1) quantity = 1;
if (quantity > 10) {
  errorJson("QUANTITY_LIMIT", "Maximum quantity per item is 10");
}

const productUrl = `${config.baseUrl}/prn/product/prid/${productId}`;

const sessionResult = await persistentCreate(config, productUrl);
const persistentId: string = sessionResult.persistentSessionId || "";

if (!persistentId) {
  errorJson("SESSION_ERROR", "Failed to create persistent session");
}

// Check stock availability
const checkActions = [
  { action: "waitForSelector", selector: '[class*="AddToCart"], [class*="add-to-cart"], [data-testid="add-btn"], button[class*="add"], button[class*="Add"], [class*="out-of-stock"], [class*="OutOfStock"]', delay: 5000 },
];

const checkScript = `(() => {
  const outOfStock = document.querySelector('[class*="out-of-stock"], [class*="OutOfStock"], [class*="sold-out"], [class*="SoldOut"], [class*="Unavailable"]');
  if (outOfStock) {
    const nameEl = document.querySelector('[class*="name"], [class*="Name"], [class*="Title"], h1, h2');
    const name = (nameEl?.textContent || 'This product').trim().substring(0, 200);
    return JSON.stringify({ error: true, code: 'OUT_OF_STOCK', message: name + ' is currently out of stock' });
  }
  const addBtn = document.querySelector('[class*="AddToCart"], [class*="add-to-cart"], [data-testid="add-btn"], button[class*="add"], button[class*="Add"]');
  return JSON.stringify({ inStock: true, hasButton: !!addBtn });
})()`;

const checkResult = await persistentInteract(config, persistentId, checkActions, false, checkScript);
const checkContent: string = checkResult.content || "{}";

let checkParsed: any;
try { checkParsed = JSON.parse(checkContent); } catch { checkParsed = {}; }

if (checkParsed.error) {
  await persistentClose(config, persistentId).catch(() => {});
  console.log(JSON.stringify(checkParsed));
  process.exit(1);
}

// Click add-to-cart
const addScript = `(() => {
  const quantity = ${quantity};
  const addBtn = document.querySelector('[class*="AddToCart"], [class*="add-to-cart"], [data-testid="add-btn"], button[class*="add"], button[class*="Add"]');
  if (!addBtn) {
    return JSON.stringify({ error: true, code: 'PAGE_CHANGED', message: 'Could not find add-to-cart button. The page layout may have changed.' });
  }

  for (let i = 0; i < quantity; i++) {
    addBtn.click();
  }

  return new Promise(resolve => {
    setTimeout(() => {
      const nameEl = document.querySelector('[class*="name"], [class*="Name"], [class*="Title"], h1, h2');
      const cartCountEl = document.querySelector('[class*="cart-count"], [class*="CartCount"], [class*="badge"], [data-testid="cart-count"]');
      const cartTotalEl = document.querySelector('[class*="cart-total"], [class*="CartTotal"], [class*="total"]');

      const name = (nameEl?.textContent || '').trim().substring(0, 200);
      const cartCount = parseInt((cartCountEl?.textContent || '').replace(/[^\\d]/g, '')) || 0;
      const totalText = (cartTotalEl?.textContent || '').replace(/[^\\d.]/g, '');
      const cartTotal = totalText ? parseFloat(totalText) : 0;

      resolve(JSON.stringify({
        success: true,
        productId: '${productId}',
        name: name,
        quantityAdded: quantity,
        cartItemCount: cartCount,
        cartTotal: cartTotal
      }));
    }, 1500);
  });
})()`;

const addActions = [{ action: "screenshot" }];

const result = await persistentInteract(config, persistentId, addActions, true, addScript);
const content: string = result.content || "{}";

let parsed: any;
try {
  parsed = JSON.parse(content);
} catch {
  errorJson("PAGE_CHANGED", "Could not interact with the product page. The service may have updated its layout.");
}

if (parsed.error) {
  console.log(JSON.stringify(parsed));
  process.exit(1);
}

console.log(JSON.stringify(parsed));
