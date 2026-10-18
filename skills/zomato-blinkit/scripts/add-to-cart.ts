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
if (!/^\d+$/.test(productId)) errorJson("INVALID_ID", "productId must be Blinkit's numeric product id (from search-products)");

if (isNaN(quantity) || quantity < 1) quantity = 1;
if (quantity > 10) {
  errorJson("QUANTITY_LIMIT", "Maximum quantity per item is 10");
}

// Product page, confirmed live on 35720 on 2026-10-16: the product's own button reads
// "Add to cart" (a `div[role="button"]`) in `[class*="ProductWrapperRightSection"]`; the
// page's other "ADD" buttons belong to similar-product cards. The header cart button
// (`[class*="CartButton"]`) reads "3 items ₹120" once something is in the cart.
const productUrl = `${config.baseUrl}/prn/product/prid/${productId}`;

const sessionResult = await persistentCreate(config, productUrl);
const persistentId: string = sessionResult.persistentSessionId || "";

if (!persistentId) {
  errorJson("SESSION_ERROR", "Failed to create persistent session");
}

const findMainButton = `
  const section = document.querySelector('[class*="ProductWrapperRightSection"]') || document;
  const buttons = Array.from(section.querySelectorAll('[role="button"], button'));
  const addBtn = buttons.find((b) => /^\\s*add to cart\\s*$/i.test(b.textContent || ""))
    || buttons.find((b) => /^\\s*add\\s*$/i.test(b.textContent || "") && !b.closest('div[role="button"][id]'));
  const nameEl = document.querySelector('[class*="ProductInfoCard__BreadcrumbProductName"]') || document.querySelector('[class*="tw-font-extrabold"]') || document.querySelector('h1');
  const name = ((nameEl && nameEl.textContent) || document.title.replace(/^Buy\\s+|\\s+Online\\s*\\|.*$/g, "") || "").trim().substring(0, 200);
`;

// Check stock availability
const checkActions = [
  { action: "waitForSelector", selector: '[class*="ProductWrapperRightSection"], [class*="ProductInfoCard"]', delay: 15000 },
  { action: "wait", delay: 1000 },
];

const checkScript = `(() => {
  ${findMainButton}
  const sectionText = (section.innerText || "");
  if (!addBtn && /out of stock|currently unavailable|notify me/i.test(sectionText)) {
    return JSON.stringify({ error: true, code: 'OUT_OF_STOCK', message: (name || 'This product') + ' is currently out of stock' });
  }
  return JSON.stringify({ inStock: true, hasButton: !!addBtn, name });
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

// Click "Add to cart" once, then the stepper's "+" for each further unit. The stepper's
// +/− are icon-font glyphs: "+" is the last clickable part of the control that replaced
// the button (not confirmed live; see the task report).
const addScript = `(async () => {
  const quantity = ${quantity};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  ${findMainButton}
  if (!addBtn) {
    return JSON.stringify({ error: true, code: 'PAGE_CHANGED', message: 'Could not find the Add to cart button. The page layout may have changed.' });
  }
  const holder = addBtn.parentElement;
  addBtn.click();
  await sleep(1500);
  const stepperQty = () => {
    const t = ((holder && holder.innerText) || "").split("\\n").map((s) => s.trim()).find((s) => /^\\d+$/.test(s));
    return t ? parseInt(t, 10) : 0;
  };
  for (let i = 1; i < quantity; i++) {
    const plus = (holder && (holder.querySelector('[class*="icon-plus"], [aria-label*="add" i], [aria-label*="increase" i]')
      || Array.from(holder.querySelectorAll('[role="button"], button, div')).filter((e) => !e.children.length || e.getAttribute('role') === 'button').pop()));
    if (!plus) break;
    plus.click();
    await sleep(900);
  }
  await sleep(600);
  const header = document.querySelector('[class*="CartButton__Button"]') || document.querySelector('[class*="CartButton"]');
  const headerText = ((header && header.innerText) || "").replace(/\\s+/g, " ");
  const countMatch = headerText.match(/(\\d+)\\s*items?/i);
  const totalMatch = headerText.match(/₹\\s*([\\d,.]+)/);
  return JSON.stringify({
    success: true,
    productId: '${productId}',
    name: name,
    quantityAdded: stepperQty() || quantity,
    cartItemCount: countMatch ? parseInt(countMatch[1], 10) : 0,
    cartTotal: totalMatch ? parseFloat(totalMatch[1].replace(/,/g, "")) : 0
  });
})()`;

const result = await persistentInteract(config, persistentId, [], true, addScript);
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

if (!parsed.cartItemCount) {
  console.log(JSON.stringify({ ...parsed, success: false, code: "NOT_ADDED", message: "Clicked Add to cart but the cart still shows no items. Check the delivery location or view the cart." }));
  process.exit(1);
}

console.log(JSON.stringify(parsed));
