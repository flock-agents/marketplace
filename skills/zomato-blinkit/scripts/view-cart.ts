#!/usr/bin/env bun
/**
 * Blinkit — the cart's items and its full total with every fee. Params: (none)
 *
 * Blinkit has no cart page (blinkit.com/cart shows the home page and its suggestions): the cart
 * is a drawer opened from the header button (selectors in _blinkit.ts, confirmed live on 35720,
 * 2026-10-16). Only the open drawer is read; when it did not open, this fails as NOT_CART_PAGE
 * unless the header itself says the cart is empty.
 */
import { requireBrowserSession, errorJson, browserInteract } from "../../_shared/_grocery_helpers";
import { BLINKIT as config, HOME_URL, OPEN_CART_ACTIONS, READ_CART_SCRIPT, headerShowsItems, rupeeAmount } from "./_blinkit";
import { parseJson, summarizeBill, type BillRow } from "./_shop";

requireBrowserSession();

const result = await browserInteract(config, HOME_URL, OPEN_CART_ACTIONS, undefined, READ_CART_SCRIPT);
const cart = parseJson(result.content);
if (!cart) errorJson("PAGE_CHANGED", "Could not read cart contents. The service may have updated its layout.");

const items: any[] = Array.isArray(cart.items) ? cart.items : [];
if (!cart.drawerOpen) {
  if (headerShowsItems(cart.headerText) || !cart.headerText) {
    errorJson("NOT_CART_PAGE", `Blinkit's cart drawer did not open, so the page read is not the cart (header: "${String(cart.headerText || "none").substring(0, 40)}"). Nothing was read from it; try view-cart once more, then report it.`);
  }
}
if (items.length === 0 && headerShowsItems(cart.headerText)) {
  errorJson("PAGE_CHANGED", "The cart has items but they could not be read from its drawer. Blinkit's page may have changed.");
}

const bill: BillRow[] = Array.isArray(cart.bill) ? cart.bill : [];
const lines = items.map((it) => ({
  productId: "",
  name: it.name,
  variant: it.variant || "",
  quantity: it.quantity,
  price: it.price,
  subtotal: it.price != null ? it.price * it.quantity : null,
}));
const totals = summarizeBill(bill, lines.reduce((sum, it) => sum + (it.subtotal || 0), 0));
const toPay = rupeeAmount(cart.orderTotal);

console.log(JSON.stringify({
  platform: "Blinkit",
  verifiedCart: true,
  items: lines,
  itemCount: lines.length,
  ...totals,
  ...(toPay != null && lines.length ? { total: toPay, totalSource: "page" } : {}),
  bill,
  deliveryEstimate: cart.deliveryEstimate || null,
}));
