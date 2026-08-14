#!/usr/bin/env bun
/**
 * Track an order on BigBasket.
 * Params: orderId
 */
import {
  getParam,
  errorJson,
  validateParam,
  validateId,
  requireBrowserSession,
  browserWrite,
  type GroceryServiceConfig,
} from "../../_shared/_grocery_helpers";

const config: GroceryServiceConfig = {
  name: "BigBasket",
  baseUrl: "https://www.bigbasket.com",
  loginPattern: /bigbasket\.com\/signin|bigbasket\.com\/login/i,
};

const orderId = getParam("orderId");

requireBrowserSession();
validateParam(orderId, "orderId");
validateId(orderId, "orderId");

const orderUrl = `${config.baseUrl}/order/list`;

const evalScript = `(() => {
  const targetOrderId = '${orderId}';
  const orders = document.querySelectorAll('[class*="order-card"], [class*="OrderCard"], [class*="order-item"], [class*="OrderItem"], [class*="order-row"], [class*="OrderRow"]');

  let matched = null;

  orders.forEach(el => {
    if (matched) return;
    const orderIdEl = el.querySelector('[class*="order-id"], [class*="OrderId"], [class*="orderId"], [class*="order-number"]');
    const orderText = (orderIdEl?.textContent || el.textContent || '').trim();

    if (orderText.includes(targetOrderId)) {
      const statusEl = el.querySelector('[class*="status"], [class*="Status"], [class*="OrderStatus"]');
      const dateEl = el.querySelector('[class*="date"], [class*="Date"], [class*="OrderDate"], time');
      const totalEl = el.querySelector('[class*="total"], [class*="Total"], [class*="amount"], [class*="Amount"]');
      const deliveryEl = el.querySelector('[class*="delivery"], [class*="eta"], [class*="minute"], [class*="DeliveryInfo"]');

      const itemEls = el.querySelectorAll('[class*="item-name"], [class*="ItemName"], [class*="product-name"], li');
      const items = [];
      itemEls.forEach(itemEl => {
        const name = (itemEl.textContent || '').trim().substring(0, 200);
        if (name) items.push({ name: name, quantity: 1, price: null });
      });

      const statusText = (statusEl?.textContent || '').trim();
      const statusLower = statusText.toLowerCase();
      let status = 'unknown';
      if (statusLower.includes('deliver')) status = 'delivered';
      else if (statusLower.includes('out for')) status = 'out_for_delivery';
      else if (statusLower.includes('pack') || statusLower.includes('prepar')) status = 'being_packed';
      else if (statusLower.includes('confirm')) status = 'confirmed';
      else if (statusLower.includes('cancel')) status = 'cancelled';
      else if (statusLower.includes('refund')) status = 'refunded';
      else if (statusLower.includes('placed') || statusLower.includes('received')) status = 'placed';

      const totalText = (totalEl?.textContent || '').replace(/[^\\d.]/g, '');

      matched = {
        orderId: targetOrderId,
        status: status,
        statusLabel: statusText.substring(0, 100) || status,
        placedAt: (dateEl?.textContent || dateEl?.getAttribute('datetime') || '').trim().substring(0, 50) || null,
        estimatedDelivery: (deliveryEl?.textContent || '').trim().substring(0, 50) || null,
        items: items,
        total: totalText ? parseFloat(totalText) : null,
        deliveryPartner: null,
        trackingUrl: null
      };
    }
  });

  if (!matched) {
    return JSON.stringify({ error: true, code: 'ORDER_NOT_FOUND', message: 'Order ' + targetOrderId + ' not found' });
  }

  return JSON.stringify(matched);
})()`;

const result = await browserWrite(config, orderUrl, evalScript, undefined);
const content = (result as any)?.content || "{}";

let parsed: any;
try {
  parsed = JSON.parse(content);
} catch {
  errorJson("PAGE_CHANGED", "Could not read order information. The service may have updated its layout.");
}

if (parsed.error) {
  console.log(JSON.stringify(parsed));
  process.exit(1);
}

console.log(JSON.stringify(parsed));
