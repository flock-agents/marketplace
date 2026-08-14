#!/usr/bin/env bun
/**
 * Add a product to cart on BigBasket.
 * Params: productId, quantity?
 */
import {
  getParam,
  errorJson,
  validateParam,
  validateId,
  requireBrowserSession,
  persistentCreate,
  persistentInteract,
  persistentClose,
  type GroceryServiceConfig,
} from "../../_shared/_grocery_helpers";

const config: GroceryServiceConfig = {
  name: "BigBasket",
  baseUrl: "https://www.bigbasket.com",
  loginPattern: /bigbasket\.com\/signin|bigbasket\.com\/login/i,
};

const productId = getParam("productId");
let quantity = parseInt(getParam("quantity") || "1", 10);

requireBrowserSession();
validateParam(productId, "productId");
validateId(productId, "productId");

if (isNaN(quantity) || quantity < 1) quantity = 1;
if (quantity > 10) {
  errorJson("QUANTITY_LIMIT", "Maximum quantity per item is 10");
}

const productUrl = `${config.baseUrl}/pd/${productId}`;

const sessionResult = await persistentCreate(config, productUrl);
const persistentId = (sessionResult as any)?.persistentSessionId || "";

if (!persistentId) {
  errorJson("SESSION_ERROR", "Failed to create persistent session");
}

const checkActions = [
  { action: "waitForSelector", selector: `[class*="add-to-cart"], [class*="AddToCart"], [qa="add"], button[class*="add"], [class*="ATCButton"], [data-testid="add-btn"], [class*="out-of-stock"], [class*="OutOfStock"]`, delay: 5000 },
];

const checkScript = `(() => {
  const outOfStock = document.querySelector('[class*="out-of-stock"], [class*="OutOfStock"], [class*="sold-out"], [class*="SoldOut"], [class*="currently-unavailable"]');
  if (outOfStock) {
    const nameEl = document.querySelector('[class*="ProductName"], [class*="prod-name"], [class*="Name"], h1, h2');
    const name = (nameEl?.textContent || 'This product').trim().substring(0, 200);
    return JSON.stringify({ error: true, code: 'OUT_OF_STOCK', message: name + ' is currently out of stock' });
  }
  const addBtn = document.querySelector('[class*="add-to-cart"], [class*="AddToCart"], [qa="add"], button[class*="add"], [class*="ATCButton"], [data-testid="add-btn"]');
  return JSON.stringify({ inStock: true, hasButton: !!addBtn });
})()`;

const checkResult = await persistentInteract(config, persistentId, checkActions, false, checkScript);
const checkContent = (checkResult as any)?.content || "{}";

let checkParsed: any;
try {
  checkParsed = JSON.parse(checkContent);
} catch {
  checkParsed = {};
}

if (checkParsed.error) {
  await persistentClose(config, persistentId);
  console.log(JSON.stringify(checkParsed));
  process.exit(1);
}

const addScript = `(() => {
  const quantity = ${quantity};
  const addBtn = document.querySelector('[class*="add-to-cart"], [class*="AddToCart"], [qa="add"], button[class*="add"], [class*="ATCButton"], [data-testid="add-btn"]');
  if (!addBtn) {
    return JSON.stringify({ error: true, code: 'PAGE_CHANGED', message: 'Could not find add-to-cart button. The page layout may have changed.' });
  }

  for (let i = 0; i < quantity; i++) {
    addBtn.click();
  }

  return new Promise(resolve => {
    setTimeout(() => {
      const nameEl = document.querySelector('[class*="ProductName"], [class*="prod-name"], [class*="Name"], h1, h2');
      const cartCountEl = document.querySelector('[class*="cart-count"], [class*="CartCount"], [class*="badge"], [data-testid="cart-count"], [class*="BasketCount"]');
      const cartTotalEl = document.querySelector('[class*="cart-total"], [class*="CartTotal"], [class*="total"], [class*="BasketTotal"]');

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
const content = (result as any)?.content || "{}";

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
