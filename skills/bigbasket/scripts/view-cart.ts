#!/usr/bin/env bun
/**
 * View cart contents on BigBasket.
 * Params: (none)
 */
import {
  errorJson,
  requireBrowserSession,
  browserWrite,
  type GroceryServiceConfig,
} from "../../_shared/_grocery_helpers";

const config: GroceryServiceConfig = {
  name: "BigBasket",
  baseUrl: "https://www.bigbasket.com",
  loginPattern: /bigbasket\.com\/signin|bigbasket\.com\/login/i,
};

requireBrowserSession();

const cartUrl = `${config.baseUrl}/basket`;

const evalScript = `(() => {
  const items = [];
  const cartItems = document.querySelectorAll('[class*="cart-item"], [class*="CartItem"], [class*="BasketItem"], [data-testid="cart-item"], [class*="itemlist"] > div, [class*="ItemList"] > div');

  cartItems.forEach(el => {
    const nameEl = el.querySelector('[class*="name"], [class*="Name"], [class*="prod-name"], h4, h3');
    const qtyEl = el.querySelector('[class*="quantity"], [class*="Quantity"], [class*="count"], input[type="number"], [class*="qty"]');
    const priceEl = el.querySelector('[class*="price"], [class*="Price"], [class*="amount"], [class*="sp"]');
    const imgEl = el.querySelector('img');

    const name = (nameEl?.textContent || '').trim().substring(0, 200);
    if (!name) return;

    const qtyText = (qtyEl?.textContent || qtyEl?.value || '1').replace(/[^\\d]/g, '');
    const priceText = (priceEl?.textContent || '').replace(/[^\\d.]/g, '');
    const qty = parseInt(qtyText) || 1;
    const price = priceText ? parseFloat(priceText) : 0;

    const link = el.querySelector('a')?.href || '';
    const idMatch = link.match(/\\/pd\\/[\\w-]+\\/(\\d+)/) || link.match(/\\/(\\d{5,})/);

    items.push({
      productId: idMatch ? idMatch[1] : '',
      name: name,
      quantity: qty,
      price: price,
      subtotal: price * qty
    });
  });

  const subtotalEl = document.querySelector('[class*="subtotal"], [class*="Subtotal"], [class*="sub-total"], [class*="SubTotal"]');
  const deliveryFeeEl = document.querySelector('[class*="delivery-fee"], [class*="DeliveryFee"], [class*="delivery_fee"], [class*="DeliveryCharges"]');
  const discountEl = document.querySelector('[class*="discount"], [class*="Discount"], [class*="savings"], [class*="Savings"]');
  const totalEl = document.querySelector('[class*="grand-total"], [class*="GrandTotal"], [class*="total-amount"], [class*="TotalAmount"], [class*="PayableAmount"], [data-testid="cart-total"]');
  const deliveryEstEl = document.querySelector('[class*="delivery-time"], [class*="eta"], [class*="minute"], [class*="DeliveryInfo"]');
  const addressEl = document.querySelector('[class*="address"], [class*="Address"], [class*="location"], [class*="DeliveryAddress"]');

  const subtotalText = (subtotalEl?.textContent || '').replace(/[^\\d.]/g, '');
  const deliveryFeeText = (deliveryFeeEl?.textContent || '').replace(/[^\\d.]/g, '');
  const discountText = (discountEl?.textContent || '').replace(/[^\\d.]/g, '');
  const totalText = (totalEl?.textContent || '').replace(/[^\\d.]/g, '');

  const computedSubtotal = items.reduce((sum, it) => sum + it.subtotal, 0);

  return JSON.stringify({
    items: items,
    itemCount: items.length,
    subtotal: subtotalText ? parseFloat(subtotalText) : computedSubtotal,
    deliveryFee: deliveryFeeText ? parseFloat(deliveryFeeText) : 0,
    discount: discountText ? parseFloat(discountText) : 0,
    total: totalText ? parseFloat(totalText) : computedSubtotal,
    deliveryEstimate: (deliveryEstEl?.textContent || '').trim().substring(0, 50) || null,
    deliveryAddress: (addressEl?.textContent || '').trim().substring(0, 200) || null
  });
})()`;

const result = await browserWrite(config, cartUrl, evalScript, undefined);
const content = (result as any)?.content || "{}";

let parsed: any;
try {
  parsed = JSON.parse(content);
} catch {
  errorJson("PAGE_CHANGED", "Could not read cart contents. The service may have updated its layout.");
}

console.log(JSON.stringify(parsed));
