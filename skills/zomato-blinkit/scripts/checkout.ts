#!/usr/bin/env bun
/**
 * Blinkit — checkout, in three phases. Params: { phase?: "review" | "pay" | "status", persistentSessionId? }
 *
 *  review (default): opens the cart drawer, reports the real items and total, clicks
 *    "Proceed To Pay" and stops at the payment page (blinkit.com/checkout, whose payment
 *    screen is an iframe served from zomato.com). Never pays, never closes the session.
 *  pay: run only after the person said yes to the total. Inside the payment iframe, chooses
 *    UPI with payment capture on, so the QR can be shown through the qr-card route. Clicks
 *    and waits only: a payment document the agent scripted is not payable (Task 3). Never
 *    presses the final Pay. Reports whether the server captured a payment, never the intent.
 *  status: reads the page text (no script) → { state: "paid" | "pending" | "failed", orderId? }.
 *
 * Selectors: see _blinkit.ts (confirmed live on 35720, 2026-10-16). Payment iframe content
 * (the "UPI" option) is NOT yet confirmed live: the frame was refused before Task 2.
 */
import {
  requireBrowserSession,
  errorJson,
  persistentCreate,
  persistentInteract,
  persistentCapture,
} from "../../_shared/_grocery_helpers";
import { BLINKIT as config, HOME_URL, OPEN_CART_ACTIONS, READ_CART_SCRIPT, headerShowsItems } from "./_blinkit";

const PARAMS = JSON.parse(process.env.SKILL_PARAMS || "{}");
const phase: string = PARAMS.phase || "review";
const givenId: string = PARAMS.persistentSessionId || "";

/** Blinkit's payment screen: an iframe from zomato.com (zpaykit) on blinkit.com/checkout. */
const PAYMENT_FRAME = "iframe[src*='zomato']";

requireBrowserSession();

if (phase === "review") await review();
else if (phase === "pay") await pay();
else if (phase === "status") await status();
else errorJson("INVALID_PARAM", `phase must be "review", "pay" or "status" (got "${String(phase).substring(0, 20)}")`);

async function review(): Promise<void> {
  // Opening a persistent session reuses this agent's open page on the same sign-in, so a
  // persistentSessionId from an earlier phase needs no special path here.
  const opened = await persistentCreate(config, HOME_URL, [
    ...OPEN_CART_ACTIONS,
    { action: "evaluate", script: READ_CART_SCRIPT },
  ]);
  const persistentSessionId: string = opened.persistentSessionId || givenId;
  if (!persistentSessionId) errorJson("SESSION_ERROR", "Failed to open a persistent session for checkout");

  let cart: any;
  try { cart = JSON.parse(opened.content || "{}"); } catch { cart = {}; }
  const itemCount: number = Number(cart.itemCount) || 0;

  if (itemCount === 0) {
    // Not an empty cart when the header still counts items: the drawer did not open, or its
    // lines are no longer where this script looks.
    if (headerShowsItems(cart.headerText)) {
      errorJson("PAGE_CHANGED", `The cart has items (${String(cart.headerText).substring(0, 40)}) but they could not be read from its drawer. Blinkit's page may have changed.`);
    }
    errorJson("EMPTY_CART", "Cart is empty. Add items before checking out.");
  }

  // To the payment page with clicks and waits only: the payment frame must load after the
  // last script, or what it shows is not payable (Task 3 provenance).
  const atPay = await persistentInteract(config, persistentSessionId, [
    { action: "waitForSelector", text: "Proceed To Pay", delay: 10000 },
    { action: "click", text: "Proceed To Pay" },
    { action: "waitForSelector", selector: PAYMENT_FRAME, delay: 20000 },
  ]);
  const url = String(atPay.url || "");
  if (!/blinkit\.com\/checkout/i.test(url)) {
    errorJson("NOT_AT_PAYMENT_PAGE", "Clicked Proceed To Pay but Blinkit did not open its payment page. The session is still open; look at the page or hand it to the person.");
  }

  console.log(JSON.stringify({
    success: true,
    platform: "blinkit",
    orderTotal: cart.orderTotal || "unknown",
    itemCount,
    items: Array.isArray(cart.items) ? cart.items : [],
    ...(Array.isArray(cart.bill) && cart.bill.length ? { bill: cart.bill } : {}),
    persistentSessionId,
    atPaymentPage: true,
  }));
}

async function pay(): Promise<void> {
  if (!givenId) errorJson("MISSING_PARAM", "persistentSessionId is required (from the review phase)");
  const result = await persistentCapture(config, givenId, [
    {
      action: "iframe",
      selector: PAYMENT_FRAME,
      actions: [
        // The method label exactly ("UPI"), never a "Pay ₹…" / "Pay Now" control.
        { action: "click", text: "UPI", exact: true, delay: 10000 },
        { action: "wait", delay: 3000 },
      ],
    },
  ], true);
  const captured = !!(result.capturedPayment?.upiIntent || result.capturedPayment?.paymentUrl);
  console.log(JSON.stringify({ success: true, platform: "blinkit", captured, persistentSessionId: givenId }));
}

async function status(): Promise<void> {
  if (!givenId) errorJson("MISSING_PARAM", "persistentSessionId is required (from the review phase)");
  // No page actions: the server reads the page text itself, so nothing is scripted.
  const page = await persistentInteract(config, givenId, []);
  const text = String(page.content || "").substring(0, 20000);
  const url = String(page.url || "");
  let state: "paid" | "pending" | "failed" = "pending";
  if (/payment (?:has )?failed|transaction failed|payment (?:was )?declined|payment unsuccessful|payment cancelled/i.test(text)) state = "failed";
  else if (/order (?:placed|confirmed|received)|payment successful|thank you for (?:your )?order|arriving in/i.test(text) || /blinkit\.com\/order\//i.test(url)) state = "paid";
  const idMatch = state === "paid" ? text.match(/order\s*(?:id|#|no\.?)\s*[:#]?\s*([A-Z0-9-]{6,40})/i) : null;
  console.log(JSON.stringify({ platform: "blinkit", state, ...(idMatch ? { orderId: idMatch[1] } : {}), persistentSessionId: givenId }));
}
