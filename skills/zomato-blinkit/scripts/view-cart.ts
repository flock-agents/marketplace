#!/usr/bin/env bun
/**
 * Blinkit — view current cart contents.
 * Params: (none)
 *
 * Blinkit has no cart page: the cart is a drawer opened from the header button on the home
 * page (selectors in _blinkit.ts, confirmed live on 35720, 2026-10-16).
 */
import {
  requireBrowserSession,
  errorJson,
  browserInteract,
} from "../../_shared/_grocery_helpers";
import { BLINKIT as config, HOME_URL, OPEN_CART_ACTIONS, READ_CART_SCRIPT, headerShowsItems, rupeeAmount } from "./_blinkit";

requireBrowserSession();

const result = await browserInteract(config, HOME_URL, OPEN_CART_ACTIONS, undefined, READ_CART_SCRIPT);

let cart: any;
try {
  cart = JSON.parse(result.content || "");
} catch {
  errorJson("PAGE_CHANGED", "Could not read cart contents. The service may have updated its layout.");
}

const items: any[] = Array.isArray(cart.items) ? cart.items : [];
if (items.length === 0 && headerShowsItems(cart.headerText)) {
  errorJson("PAGE_CHANGED", "The cart has items but they could not be read from its drawer. Blinkit's page may have changed.");
}

const bill: Array<{ label: string; amount: number | null }> = Array.isArray(cart.bill) ? cart.bill : [];
const billAmount = (re: RegExp): number | null => bill.find((r) => re.test(r.label))?.amount ?? null;
const lines = items.map((it) => ({
  productId: "",
  name: it.name,
  variant: it.variant || "",
  quantity: it.quantity,
  price: it.price,
  subtotal: it.price != null ? it.price * it.quantity : null,
}));
const computedSubtotal = lines.reduce((sum, it) => sum + (it.subtotal || 0), 0);

console.log(JSON.stringify({
  items: lines,
  itemCount: lines.length,
  subtotal: billAmount(/items total/i) ?? computedSubtotal,
  deliveryFee: billAmount(/delivery/i) ?? 0,
  handlingFee: billAmount(/handling/i) ?? 0,
  discount: billAmount(/discount|saving/i) ?? 0,
  total: rupeeAmount(cart.orderTotal) ?? computedSubtotal,
  bill,
  deliveryEstimate: cart.deliveryEstimate || null,
}));
