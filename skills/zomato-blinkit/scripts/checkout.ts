#!/usr/bin/env bun
/**
 * Blinkit — checkout: initiate checkout flow with payment capture.
 * Params: persistentSessionId?
 *
 * NOTE: This script relies on the shared checkout helpers
 * (smart-checkout + checkout orchestration) which are provided
 * by _grocery_helpers.ts as runCheckoutFlow().
 */
import {
  requireBrowserSession,
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
let persistentId: string = PARAMS.persistentSessionId || "";

requireBrowserSession();

const cartUrl = "https://blinkit.com/cart";

// Create a persistent session if one wasn't provided
if (!persistentId) {
  const sessionResult = await persistentCreate(config, cartUrl, [
    { action: "wait", delay: 3000 },
  ]);
  persistentId = sessionResult.persistentSessionId || "";
  if (!persistentId) {
    errorJson("SESSION_ERROR", "Failed to create persistent session for checkout");
  }
}

// Check cart is not empty
const cartInfoScript = `(() => {
  const priceEls = document.querySelectorAll('[class*="total" i], [class*="price" i], [class*="amount" i], [data-testid*="total" i]');
  let total = "";
  for (const el of priceEls) {
    const text = (el.textContent || "").trim();
    if (/₹|rs\\.?|inr/i.test(text) && /\\d/.test(text)) { total = text; break; }
  }
  const cartItems = document.querySelectorAll('[class*="cart-item" i], [class*="cartitem" i], [class*="cart_item" i], [class*="basket-item" i]');
  const items = Array.from(cartItems).slice(0, 20).map(el => (el.textContent || "").trim().substring(0, 100));
  return JSON.stringify({ orderTotal: total, itemCount: cartItems.length, items: items });
})()`;

const cartResult = await persistentInteract(config, persistentId, [], false, cartInfoScript);
const cartContent = cartResult.content || "{}";
let cartInfo: any;
try { cartInfo = JSON.parse(cartContent); } catch { cartInfo = {}; }

const itemCount = cartInfo.itemCount || 0;
const orderTotal = cartInfo.orderTotal || "unknown";

if (itemCount === 0) {
  await persistentClose(config, persistentId).catch(() => {});
  errorJson("EMPTY_CART", "Cart is empty. Add items before checking out.");
}

// Run checkout actions
const checkoutActions = [
  { action: "evaluate", script: `(() => { const btn = Array.from(document.querySelectorAll("button, a")).find(el => /proceed|checkout|place.order/i.test(el.textContent)); if (btn) { btn.scrollIntoView({block:"center"}); btn.click(); return "clicked_proceed"; } return "no_proceed_button"; })()` },
  { action: "wait", delay: 3000 },
  { action: "evaluate", script: `(() => { const btn = Array.from(document.querySelectorAll("button, a, div[role=button]")).find(el => /pay\\s*online|online.payment|upi|net.banking/i.test(el.textContent)); if (btn) { btn.scrollIntoView({block:"center"}); btn.click(); return "clicked_payment_method"; } return "no_payment_method"; })()` },
  { action: "wait", delay: 2000 },
  { action: "evaluate", script: `(() => { const btn = Array.from(document.querySelectorAll("button, a, div[role=button]")).find(el => /pay\\s*₹|pay\\s*now|place.order|confirm|make.payment/i.test(el.textContent)); if (btn) { btn.scrollIntoView({block:"center"}); btn.click(); return "clicked_pay"; } return "no_pay_button"; })()` },
  { action: "wait", delay: 5000 },
];

const checkoutResult = await persistentInteract(config, persistentId, checkoutActions, true);

// Extract payment result
const paymentUrl = checkoutResult.capturedPayment?.paymentUrl || "";
const upiIntent = checkoutResult.capturedPayment?.upiIntent || "";
const source = checkoutResult.capturedPayment?.source || "";

if (!paymentUrl && !upiIntent) {
  console.log(JSON.stringify({
    success: false,
    platform: "blinkit",
    message: "No payment URL captured. The checkout flow may have changed, or payment was not initiated.",
    orderTotal,
    itemCount,
  }));
  process.exit(1);
}

const output: any = {
  success: true,
  platform: "blinkit",
  orderTotal,
  itemCount,
  source,
};
if (paymentUrl) output.paymentUrl = paymentUrl;
if (upiIntent) output.upiIntent = upiIntent;

console.log(JSON.stringify(output));
