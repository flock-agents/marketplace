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
  pressLoop,
  PRESS_KIT_JS,
} from "../../_shared/_grocery_helpers";
import { BLINKIT as config } from "./_blinkit";

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

/** The mark Flock's real clicks on "Add to cart" and the stepper's "+" go to, and its page state. */
const ADD_MARK = "blinkit-add";

// Press "Add to cart" once, then the stepper's "+" for each further unit, each a real click on the
// element the script marked. The stepper's +/− are icon-font glyphs: "+" is the last clickable part
// of the control that replaced the button (not confirmed live; see the task report). A "+" that is not
// on screen ends the presses, as a missing one does: a real click cannot reach it.
const markAddScript = `(() => {
  ${PRESS_KIT_JS}
  ${findMainButton}
  const s = flockState("${ADD_MARK}", true);
  flockClear("${ADD_MARK}");
  s.name = name;
  if (!addBtn) { s.missing = true; s.done = true; return; }
  const holder = addBtn.parentElement;
  s.holder = holder;
  s.step = async () => {
    flockMark("${ADD_MARK}", null);
    await flockSettle(s);
    const plus = (holder && (holder.querySelector('[class*="icon-plus"], [aria-label*="add" i], [aria-label*="increase" i]')
      || Array.from(holder.querySelectorAll('[role="button"], button, div')).filter((e) => !e.children.length || e.getAttribute('role') === 'button').pop()));
    if (!plus || plus.getClientRects().length === 0) { s.done = true; return; }
    flockMark("${ADD_MARK}", plus);
    s.settleMs = 900;
  };
  flockMark("${ADD_MARK}", addBtn);
  s.settleMs = 1500;
})()`;

const addScript = `(async () => {
  ${PRESS_KIT_JS}
  const quantity = ${quantity};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const s = flockState("${ADD_MARK}");
  flockClear("${ADD_MARK}");
  await flockSettle(s);
  if (s.missing) {
    return JSON.stringify({ error: true, code: 'PAGE_CHANGED', message: 'Could not find the Add to cart button. The page layout may have changed.' });
  }
  const holder = s.holder;
  const name = s.name;
  const stepperQty = () => {
    const t = ((holder && holder.innerText) || "").split("\\n").map((s) => s.trim()).find((s) => /^\\d+$/.test(s));
    return t ? parseInt(t, 10) : 0;
  };
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

const result = await persistentInteract(config, persistentId, pressLoop({ key: ADD_MARK, mark: ADD_MARK, start: markAddScript, finish: addScript, presses: quantity }), true);
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
