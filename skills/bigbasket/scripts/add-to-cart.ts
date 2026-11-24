#!/usr/bin/env bun
/**
 * Add a product to cart on BigBasket.
 * Params: productId, quantity?, query?
 * With `query` (the search the product was found with) it adds from those search results: the card's
 * Add, then its "+" for each more unit, without opening the product page. Without it, the product page.
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
  browserInteract,
  urlencode,
  pressLoop,
  PRESS_KIT_JS,
  type GroceryServiceConfig,
} from "../../_shared/_grocery_helpers";
import { addFromSearchActions } from "./_bigbasket";

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

const query = getParam("query");
if (query) await addFromSearch(query);

/** Adds from the search results page and exits: the result line, or the error line with exit 1. */
async function addFromSearch(searchQuery: string): Promise<never> {
  const searchUrl = `${config.baseUrl}/ps/?q=${urlencode(searchQuery)}`;
  const result = await browserInteract(config, searchUrl, addFromSearchActions(productId, quantity));
  let out: any;
  try {
    out = JSON.parse((result as any)?.content || "");
  } catch {
    errorJson("PAGE_CHANGED", "Could not read the search results. The service may have updated its layout.");
  }
  console.log(JSON.stringify(out));
  process.exit(out.error ? 1 : 0);
}

const productUrl = `${config.baseUrl}/pd/${productId}`;

const sessionResult = await persistentCreate(config, productUrl);
const persistentId = (sessionResult as any)?.persistentSessionId || "";

if (!persistentId) {
  errorJson("SESSION_ERROR", "Failed to create persistent session");
}

const checkActions = [
  { action: "waitForSelector", selector: `h1`, delay: 5000 },
];

/** The product page's own Add button (found by its text). */
const FIND_ADD = `Array.from(document.querySelectorAll("button")).find((b) => /^add( to basket)?$/i.test(b.innerText.trim()))`;

const checkScript = `(() => {
  const outOfStock = document.querySelector('[class*="out-of-stock"], [class*="OutOfStock"], [class*="sold-out"], [class*="SoldOut"], [class*="currently-unavailable"]');
  if (outOfStock) {
    const nameEl = document.querySelector('[class*="ProductName"], [class*="prod-name"], [class*="Name"], h1, h2');
    const name = (nameEl?.textContent || 'This product').trim().substring(0, 200);
    return JSON.stringify({ error: true, code: 'OUT_OF_STOCK', message: name + ' is currently out of stock' });
  }
  const addBtn = ${FIND_ADD};
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

/** The mark Flock's real click on the Add button goes to, and its page state. */
const ADD_MARK = "bb-product-add";

// The Add button is marked once and pressed `quantity` times, each press a real click while it is
// still on screen (a press on a button the page took away does nothing).
const markAddScript = `(() => {
  ${PRESS_KIT_JS}
  const s = flockState("${ADD_MARK}", true);
  const addBtn = ${FIND_ADD};
  s.missing = !addBtn;
  s.done = !addBtn;
  s.step = () => { flockMark("${ADD_MARK}", addBtn.isConnected && addBtn.getClientRects().length > 0 ? addBtn : null); };
  if (addBtn) s.step();
})()`;

const addScript = `(() => {
  ${PRESS_KIT_JS}
  const s = flockState("${ADD_MARK}");
  flockClear("${ADD_MARK}");
  if (s.missing) {
    return JSON.stringify({ error: true, code: 'PAGE_CHANGED', message: 'Could not find add-to-cart button. The page layout may have changed.' });
  }
  const quantity = ${quantity};

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

const result = await persistentInteract(config, persistentId, pressLoop({ key: ADD_MARK, mark: ADD_MARK, start: markAddScript, finish: addScript, presses: quantity }), true);
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
