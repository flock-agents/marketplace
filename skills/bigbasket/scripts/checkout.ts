#!/usr/bin/env bun
/**
 * Checkout flow for BigBasket.
 * Params: persistentSessionId?
 *
 * Note: This script delegates to the shared checkout helpers.
 * The smart-checkout + checkout .sh modules handle coupon discovery,
 * delivery fee analysis, and payment capture. The TS equivalent calls
 * the same persistent-session browser APIs directly.
 */
import {
  getParam,
  errorJson,
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

const FLOCK_API = process.env.FLOCK_API_URL || "http://localhost:35625";
const FLOCK_AUTH_TOKEN = process.env.FLOCK_AUTH_TOKEN || "";
const FLOCK_AGENT_ID = process.env.FLOCK_AGENT_ID || "";
const BROWSER_SESSION = process.env.BROWSER_SESSION || "bigbasket";

requireBrowserSession();

let persistentId = getParam("persistentSessionId");

const cartUrl = `${config.baseUrl}/basket`;

// ── Create persistent session if not provided ──
if (!persistentId) {
  const sessionResult = await persistentCreate(config, cartUrl, [{ action: "wait", delay: 3000 }]);
  persistentId = (sessionResult as any)?.persistentSessionId || "";
  if (!persistentId) {
    errorJson("SESSION_ERROR", "Failed to create persistent session for checkout");
  }
}

// ── Check cart is not empty ──
const cartInfoScript = `(() => {
  const priceEls = document.querySelectorAll("[class*=\\"total\\" i], [class*=\\"price\\" i], [class*=\\"amount\\" i], [data-testid*=\\"total\\" i]");
  let total = "";
  for (const el of priceEls) {
    const text = (el.textContent || "").trim();
    if (/₹|rs\\.?|inr/i.test(text) && /\\d/.test(text)) { total = text; break; }
  }
  const cartItems = document.querySelectorAll("[class*=\\"cart-item\\" i], [class*=\\"cartitem\\" i], [class*=\\"cart_item\\" i], [class*=\\"basket-item\\" i]");
  const items = Array.from(cartItems).slice(0, 20).map(el => (el.textContent || "").trim().substring(0, 100));
  return JSON.stringify({ orderTotal: total, itemCount: cartItems.length, items: items });
})()`;

const cartResult = await persistentInteract(config, persistentId, [], false, cartInfoScript).catch(() => null);
let orderTotal = "unknown";
let itemCount = 0;
try {
  const cartContent = JSON.parse((cartResult as any)?.content || "{}");
  orderTotal = cartContent.orderTotal || "unknown";
  itemCount = cartContent.itemCount || 0;
} catch { /* ignore */ }

if (itemCount === 0) {
  await persistentClose(config, persistentId).catch(() => {});
  errorJson("EMPTY_CART", "Cart is empty. Add items before checking out.");
}

// ── Checkout actions ──
const checkoutActions = [
  { action: "evaluate", script: `(() => { const btn = Array.from(document.querySelectorAll("button, a")).find(el => /proceed|checkout|place.order/i.test(el.textContent)); if (btn) { btn.scrollIntoView({block:"center"}); btn.click(); return "clicked_proceed"; } return "no_proceed_button"; })()` },
  { action: "wait", delay: 3000 },
  { action: "evaluate", script: `(() => { const addr = document.querySelector("[class*=\\"address\\" i] input[type=radio], [class*=\\"address\\" i] button"); if (addr) { addr.click(); return "selected_address"; } return "address_preselected"; })()` },
  { action: "wait", delay: 2000 },
  { action: "evaluate", script: `(() => { const slot = document.querySelector("[class*=\\"slot\\" i] button, [class*=\\"delivery-slot\\" i] button"); if (slot) { slot.click(); return "selected_slot"; } return "slot_preselected"; })()` },
  { action: "wait", delay: 2000 },
  { action: "evaluate", script: `(() => { const btn = Array.from(document.querySelectorAll("button, a, div[role=button]")).find(el => /pay\\s*online|online.payment|upi|net.banking/i.test(el.textContent)); if (btn) { btn.scrollIntoView({block:"center"}); btn.click(); return "clicked_payment_method"; } return "no_payment_method"; })()` },
  { action: "wait", delay: 2000 },
  { action: "evaluate", script: `(() => { const btn = Array.from(document.querySelectorAll("button, a, div[role=button]")).find(el => /pay\\s*₹|pay\\s*now|place.order|confirm|make.payment/i.test(el.textContent)); if (btn) { btn.scrollIntoView({block:"center"}); btn.click(); return "clicked_pay"; } return "no_pay_button"; })()` },
  { action: "wait", delay: 5000 },
];

// ── Run checkout with payment capture ──
async function persistentInteractWithCapture(
  pid: string,
  pageActions: any[],
  captureConfig: any,
  close: boolean,
): Promise<any> {
  const payload: Record<string, any> = {
    sessionName: BROWSER_SESSION,
    agentId: FLOCK_AGENT_ID,
    persistentSessionId: pid,
    pageActions,
    extractText: true,
    capturePaymentUrls: captureConfig,
  };
  if (close) payload.closePersistentSession = true;

  const res = await fetch(`${FLOCK_API}/api/internal/browser-fetch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${FLOCK_AUTH_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  if (res.status >= 400) {
    const body = await res.text();
    let errMsg = `HTTP ${res.status}`;
    try { errMsg = JSON.parse(body).error || errMsg; } catch { /* ignore */ }
    errorJson("CHECKOUT_ERROR", `Payment capture failed (${res.status}): ${errMsg.substring(0, 200)}`);
  }

  return await res.json();
}

const captureResult = await persistentInteractWithCapture(
  persistentId,
  checkoutActions,
  { timeout: 15000 },
  true,
);

// ── Extract payment result ──
const paymentUrl = captureResult?.capturedPayment?.paymentUrl || "";
const upiIntent = captureResult?.capturedPayment?.upiIntent || "";
const source = captureResult?.capturedPayment?.source || "";

if (!paymentUrl && !upiIntent) {
  console.log(JSON.stringify({
    success: false,
    platform: "bigbasket",
    message: "No payment URL captured. The checkout flow may have changed, or payment was not initiated.",
  }));
  process.exit(1);
}

const paymentJson: Record<string, any> = {
  success: true,
  platform: "bigbasket",
  orderTotal,
  itemCount,
};
if (paymentUrl) paymentJson.paymentUrl = paymentUrl;
if (upiIntent) paymentJson.upiIntent = upiIntent;
paymentJson.source = source;

console.log(JSON.stringify(paymentJson));
